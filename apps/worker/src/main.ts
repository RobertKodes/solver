// Worker entrypoint: fee keeper + solver scheduler + read API.
// With no OPENROUTER_API_KEY it runs in demo mode against a scripted model so the
// whole UI can be exercised offline.

import { LAMPORTS_PER_SOL, Ledger, SolverBooks } from "@solver/ledger";
import { LlmClient } from "@solver/llm";
import { Tracer, type SpanSink } from "@solver/trace";
import { LiveSink, startApi } from "./api.js";
import { DEFAULT_POLICY, shouldRun } from "./solver/budget.js";
import { MemoryStore } from "./solver/memory-store.js";
import { runStretch } from "./solver/stretch.js";
import { solUsdFeed } from "./price.js";
import type { Coin, Store } from "./solver/types.js";
import { PgStore } from "./solver/pg-store.js";

const env = process.env;
const PORT = Number(env.PORT ?? 4000);
const demo = !env.OPENROUTER_API_KEY;

const live = new LiveSink();
const sinks: SpanSink[] = [live];
if (env.DATABASE_URL) {
  const { createDb, PgSpanSink } = await import("@solver/db");
  sinks.push(new PgSpanSink(createDb(env.DATABASE_URL).db));
}
if (env.REDIS_URL) {
  const { default: Redis } = await import("ioredis");
  const { PublishSink } = await import("@solver/trace");
  sinks.push(new PublishSink(new Redis(env.REDIS_URL)));
}

const tracer = new Tracer(sinks);
let books = new SolverBooks(new Ledger());
let store: Store = new MemoryStore();
let notesOf = async (mint: string) => (store as MemoryStore).notes.filter((n) => n.mint === mint).slice(-50).reverse();
let pg: PgStore | null = null;
if (env.DATABASE_URL) {
  const { createDb, PgLedgerStore } = await import("@solver/db");
  const { db } = createDb(env.DATABASE_URL);
  books = new SolverBooks(new Ledger(new PgLedgerStore(db)));
  pg = new PgStore(db);
  store = pg;
  const p = pg;
  notesOf = async (mint) => (await p.recentNotes(mint)).map((n) => ({ mint, text: n.text, at: n.createdAt }));
  await pg.syncTargets();
}
const liveSolUsd = solUsdFeed({ pythApiKey: env.PYTH_API_KEY });
const solUsd = async () => (env.SOL_USD ? Number(env.SOL_USD) : liveSolUsd().catch(() => 112));

const coins: Coin[] = demo
  ? [
      { mint: "DemoSha37", symbol: "R37", targetId: "sha256-r37-prefix-v1", lane: "exploratory", modelId: "demo/model", approach: "Extend the best r37 trail with message modification.", treasury: "T1" },
      { mint: "DemoBlake2", symbol: "BLK2", targetId: "blake3-r2-prefix-v1", lane: "rigorous", modelId: "demo/model", approach: "", treasury: "T2" },
    ]
  : JSON.parse(env.COINS_JSON ?? "[]");

const fakeFetch = (() => {
  let i = 0;
  const script = [
    { tool: "recall", args: { query: "trail" } },
    { tool: "birthday_experiment", args: { rounds: 24, bits: 18 } },
    { tool: "remember", args: { text: "24-round truncated collisions arrive at the random bound; no shortcut at 18 bits.", shared: true } },
    { tool: "note", args: { text: "Measured 24-round behaviour: random-like at 18 bits." } },
    { done: "Stretch complete." },
  ];
  return (async () => {
    const step = script[i++ % script.length]!;
    const message = "done" in step
      ? { role: "assistant", content: step.done }
      : { role: "assistant", content: null, tool_calls: [{ id: `c${i}`, type: "function", function: { name: step.tool, arguments: JSON.stringify(step.args) } }] };
    return new Response(JSON.stringify({ model: "demo/model", choices: [{ message }], usage: { prompt_tokens: 3000, completion_tokens: 200, cost: 0.004 } }));
  }) as unknown as typeof fetch;
})();

const llm = new LlmClient({
  apiKey: env.OPENROUTER_API_KEY ?? "demo",
  fetch: demo ? fakeFetch : undefined,
  tracer,
  onSwap: (s) => console.warn(`[llm] swap ${s.requested} -> ${s.served}: ${s.reason}`),
});

if (pg) for (const c of coins) await pg.ensureCoin(c);
if (demo) for (const c of coins) await books.feeClaim({ mint: c.mint, lamports: LAMPORTS_PER_SOL, chainTx: `demo-${c.mint}` });

const MODELS = (env.LAUNCH_MODELS ?? "anthropic/claude-fable-5.1,openai/gpt-6-astra,deepseek/deepseek-v4-pro,qwen/qwen3.8-flash").split(",").concat(demo ? ["demo/model"] : []);

const pendingLaunches = new Map<string, { request: import("./launch.js").LaunchRequest; at: number }>();

/** Called by the web app after both launch txs land; the coin goes live once confirmed on-chain. */
async function confirmLaunch(body: unknown) {
  const { mint, signatures } = body as { mint?: string; signatures?: string[] };
  const p = mint ? pendingLaunches.get(mint) : undefined;
  if (!p || !signatures?.length || !env.SOLANA_RPC_URL || !env.TREASURY_ADDRESS) return { status: 400, body: { ok: false, problems: ["unknown launch"] } };
  const { Connection } = await import("@solana/web3.js");
  const conn = new Connection(env.SOLANA_RPC_URL, "confirmed");
  const st = await conn.getSignatureStatuses(signatures, { searchTransactionHistory: true });
  if (!st.value.every((s) => s && !s.err && s.confirmationStatus)) return { status: 409, body: { ok: false, problems: ["transactions not confirmed yet"] } };
  const coin: Coin = { mint: mint!, symbol: p.request.symbol, targetId: p.request.targetId, lane: p.request.lane, modelId: p.request.modelId, approach: p.request.approach, treasury: env.TREASURY_ADDRESS };
  coins.push(coin);
  pendingLaunches.delete(mint!);
  if (pg) await pg.ensureCoin({ ...coin, name: p.request.name, launcher: p.request.launcher });
  return { status: 201, body: { ok: true, mint } };
}

async function launch(body: unknown) {
  if ((body as { confirm?: boolean }).confirm) return confirmLaunch(body);
  const { validateLaunch } = await import("./launch.js");
  const r = { description: "", imageCid: "", approach: "", initialBuySol: 0, launcher: "demo", ...(body as Partial<import("./launch.js").LaunchRequest>) } as import("./launch.js").LaunchRequest;
  const problems = validateLaunch(r, new Set(MODELS));
  if (problems.length) return { status: 400, body: { ok: false, problems } };
  if (!demo) {
    // Live: return unsigned txs for the user's wallet (Phantom) to sign. The browser
    // generates the mint keypair and co-signs tx 1; the server never holds a key.
    const mint = (body as { mint?: string }).mint;
    if (!env.SOLANA_RPC_URL || !env.TREASURY_ADDRESS || !env.PINATA_JWT) return { status: 501, body: { ok: false, problems: ["Server needs SOLANA_RPC_URL, TREASURY_ADDRESS and PINATA_JWT for live launches."] } };
    if (!mint || r.launcher === "demo") return { status: 400, body: { ok: false, problems: ["Connect a wallet first."] } };
    const { Connection } = await import("@solana/web3.js");
    const { PumpSdkLauncher } = await import("./pump.js");
    const launcher = new PumpSdkLauncher(new Connection(env.SOLANA_RPC_URL, "confirmed"), async (q) => {
      const res = await fetch("https://api.pinata.cloud/pinning/pinJSONToIPFS", {
        method: "POST",
        headers: { authorization: `Bearer ${env.PINATA_JWT}`, "content-type": "application/json" },
        body: JSON.stringify({ pinataContent: { name: q.name, symbol: q.symbol, description: q.description, image: q.imageCid ? `ipfs://${q.imageCid}` : undefined } }),
      });
      const j = (await res.json()) as { IpfsHash?: string };
      if (!j.IpfsHash) throw new Error("metadata upload failed");
      return `https://ipfs.io/ipfs/${j.IpfsHash}`;
    });
    const { txsBase64 } = await launcher.buildLaunchTx(r, mint, env.TREASURY_ADDRESS);
    pendingLaunches.set(mint, { request: r, at: Date.now() });
    return { status: 200, body: { ok: true, sign: txsBase64, mint } };
  }
  const mint = `Demo${r.symbol}${coins.length}`;
  const coin: Coin = { mint, symbol: r.symbol, targetId: r.targetId, lane: r.lane, modelId: r.modelId === "demo/model" ? r.modelId : "demo/model", approach: r.approach ?? "", treasury: `T-${mint}` };
  coins.push(coin);
  if (pg) await pg.ensureCoin(coin);
  await books.feeClaim({ mint, lamports: LAMPORTS_PER_SOL / 2n, chainTx: `demo-${mint}` });
  return { status: 201, body: { ok: true, mint, note: "Demo mode: coin simulated and funded with 0.5 SOL of fees; its solver starts on the next pass." } };
}

startApi({ coins: () => coins, live, books, store, notes: notesOf, solUsd, launch, models: MODELS, incumbents: { "sha256-r37-prefix-v1": { timeLog2: 60.38, by: "public frontier", ref: "yukon.org/hashsmash" } } }, PORT);
console.log(`[worker] API on :${PORT}${demo ? " (demo mode)" : ""}`);

const { BrowserbaseDriver, E2BRunner } = await import("./drivers.js");
const browserFor = () => (env.BROWSERBASE_API_KEY && env.BROWSERBASE_PROJECT_ID ? new BrowserbaseDriver(env.BROWSERBASE_API_KEY, env.BROWSERBASE_PROJECT_ID) : undefined);
const runner = env.E2B_API_KEY ? new E2BRunner(env.E2B_API_KEY) : undefined;

const awake = new Set<string>();
const fallbackModels = env.LLM_FALLBACK_MODELS?.split(",").filter(Boolean);

async function schedulerPass() {
  const price = await solUsd();
  for (const coin of coins) {
    const { remainingUsd } = await books.summary(coin.mint, { solUsd: price });
    if (!shouldRun(remainingUsd, awake.has(coin.mint), DEFAULT_POLICY)) { awake.delete(coin.mint); continue; }
    awake.add(coin.mint);
    const browser = browserFor();
    const r = await runStretch(coin, { llm, tracer, books, store, solUsd, fallbackModels, browser, runner }).finally(() => browser?.close());
    console.log(`[solver] ${coin.symbol}: ${r.turns} turns, $${r.spentUsd.toFixed(4)}, ${r.stopReason}`);
  }
}

const PASS_MS = Number(env.SOLVER_PASS_MS ?? (demo ? 15_000 : 60_000));
await schedulerPass();
setInterval(() => void schedulerPass().catch((e) => console.error("[solver] pass failed", e)), PASS_MS);

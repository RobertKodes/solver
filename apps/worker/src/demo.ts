// Offline walkthrough of one solver stretch: a stubbed provider refuses the locked
// model, the fallback serves it, the swap is disclosed, and every cost lands in
// both the trace and the coin's books. No keys or network needed.

import { brand } from "@solver/brand";
import { LAMPORTS_PER_SOL, Ledger, SolverBooks } from "@solver/ledger";
import { LlmClient } from "@solver/llm";
import { MemorySink, Tracer, buildTree, type SpanNode } from "@solver/trace";

const MINT = "DemoMint1111111111111111111111111111111111";
const SOL_USD = 112;

const replies = [
  { status: 403, body: { error: { message: "Provider declined the request" } } },
  {
    status: 200,
    body: {
      model: "vendor/fallback-flash",
      provider: "Stub",
      choices: [{ message: { role: "assistant", content: "Reading Li–Liu–Wang 2024 first." }, finish_reason: "stop" }],
      usage: { prompt_tokens: 4200, completion_tokens: 380, cost: 0.0031 },
    },
  },
];
const stubFetch = (async () => {
  const r = replies.shift()!;
  return new Response(JSON.stringify(r.body), { status: r.status });
}) as unknown as typeof fetch;

const sink = new MemorySink();
const tracer = new Tracer([sink]);
const books = new SolverBooks(new Ledger());
const llm = new LlmClient({
  apiKey: "demo",
  fetch: stubFetch,
  tracer,
  onSwap: (s) => console.log(`! ${brand.copy.modelSwapNotice(s.requested, s.served)} (${s.reason})`),
});

await books.feeClaim({ mint: MINT, lamports: LAMPORTS_PER_SOL / 2n, chainTx: "demoSig1" });

await tracer.withSpan("stretch", "run", async (run) => {
  run.setAttrs({ mint: MINT, track: "sha256-r37-exploratory" });
  await tracer.withSpan("turn 1", "turn", async () => {
    const r = await llm.chat({
      model: "vendor/frontier",
      fallbackModels: ["vendor/fallback-flash"],
      messages: [{ role: "user", content: "Plan your first experiment." }],
    });
    await books.computeSpend({
      id: "gen-demo-1",
      mint: MINT,
      category: "llm",
      usd: r.costUsd,
      solUsd: SOL_USD,
      ref: { spanId: tracer.current()?.id },
    });
    await tracer.withSpan("experiment birthday r20/t32", "experiment", async (s) => {
      s.addCost(0.012).setOutput({ samples: 77_000, log2: 16.2, expected: 16 });
      await books.computeSpend({ id: "exp-demo-1", mint: MINT, category: "sandbox", usd: 0.012, solUsd: SOL_USD });
    });
  });
});

const print = (nodes: SpanNode[], depth = 0) => {
  for (const n of nodes) {
    const ms = (n.endedAt ?? n.startedAt) - n.startedAt;
    console.log(
      `${"  ".repeat(depth)}${n.status === "error" ? "✗" : "✓"} [${n.kind}] ${n.name}  $${n.totalCostUsd.toFixed(4)}  ${ms}ms${n.error ? `  (${n.error})` : ""}`,
    );
    print(n.children, depth + 1);
  }
};

console.log("\nTrace");
print(buildTree(sink.all()));

console.log("\nMoney flow");
console.log(await books.summary(MINT, { solUsd: SOL_USD, burnUsdPerHour: 0.5 }));

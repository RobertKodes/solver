import { LAMPORTS_PER_SOL, Ledger, SolverBooks } from "@solver/ledger";
import { LlmClient } from "@solver/llm";
import { MemorySink, Tracer } from "@solver/trace";
import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY, stretchCap, shouldRun } from "./budget.js";
import { MemoryStore } from "./memory-store.js";
import { runStretch } from "./stretch.js";
import { allowed } from "./tools.js";

const coin = { mint: "M1", symbol: "TEST", targetId: "sha256-r37-prefix-v1", lane: "exploratory" as const, modelId: "a/m", approach: "", treasury: "T1" };

function scripted(messages: unknown[]) {
  return (async () => {
    const message = messages.shift() ?? { role: "assistant", content: "done" };
    return new Response(JSON.stringify({ model: "a/m", choices: [{ message, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.01 } }), { status: 200 });
  }) as unknown as typeof fetch;
}

const call = (name: string, args: unknown) => ({
  role: "assistant", content: null,
  tool_calls: [{ id: `c-${name}`, type: "function", function: { name, arguments: JSON.stringify(args) } }],
});

describe("budget", () => {
  it("scales the stretch cap with the treasury", () => {
    expect(stretchCap(10)).toBe(0.5);
    expect(stretchCap(500)).toBe(10);
    expect(stretchCap(100_000)).toBe(25);
    expect(stretchCap(0.3)).toBe(0.3);
    expect(shouldRun(4, false)).toBe(false);
    expect(shouldRun(4, true)).toBe(true);
  });
});

describe("runStretch", () => {
  it("runs tools, books every LLM dollar, traces everything", async () => {
    const sink = new MemorySink();
    const tracer = new Tracer([sink]);
    const books = new SolverBooks(new Ledger());
    const store = new MemoryStore();
    await books.feeClaim({ mint: "M1", lamports: LAMPORTS_PER_SOL, chainTx: "s1" });
    const llm = new LlmClient({
      apiKey: "k", tracer,
      fetch: scripted([
        call("birthday_experiment", { rounds: 20, bits: 16 }),
        call("remember", { text: "r20 behaves like random at 16 bits", shared: true }),
        { role: "assistant", content: "Stopping here." },
      ]),
    });

    const r = await runStretch(coin, { llm, tracer, books, store, solUsd: async () => 100 });
    expect(r.stopReason).toBe("done");
    expect(r.turns).toBe(3);
    expect(r.spentUsd).toBeCloseTo(0.03);
    expect(store.memories[0]).toMatchObject({ mint: null, targetId: coin.targetId });

    const s = await books.summary("M1", { solUsd: 100 });
    expect(s.spendUsd.llm).toBeCloseTo(0.03);
    const kinds = sink.all().map((x) => x.kind);
    expect(kinds.filter((k) => k === "tool_call")).toHaveLength(2);
    const exp = sink.all().find((x) => x.name === "birthday_experiment");
    expect((exp?.output as { found: boolean }).found).toBe(true);
  });

  it("stops at the money cap", async () => {
    const tracer = new Tracer();
    const books = new SolverBooks(new Ledger());
    await books.feeClaim({ mint: "M1", lamports: LAMPORTS_PER_SOL / 10n, chainTx: "s1" }); // $10 → cap $0.50
    const loop = Array.from({ length: 100 }, () => call("target", {}));
    const llm = new LlmClient({ apiKey: "k", tracer, fetch: scripted(loop) });
    const r = await runStretch(coin, { llm, tracer, books, store: new MemoryStore(), solUsd: async () => 100, policy: { ...DEFAULT_POLICY, maxTurns: 1000 } });
    expect(r.stopReason).toBe("money_cap");
    expect(r.spentUsd).toBeCloseTo(0.5);
  });

  it("enforces the browsing allowlist", () => {
    expect(allowed("https://eprint.iacr.org/2024/349", ["iacr.org"])).toBe(true);
    expect(allowed("https://evil-iacr.org/x", ["iacr.org"])).toBe(false);
  });
});

import { brand } from "@solver/brand";
import { getTarget } from "@solver/hashsmash";
import type { SolverBooks } from "@solver/ledger";
import type { ChatMessage, LlmClient } from "@solver/llm";
import type { Tracer } from "@solver/trace";
import { DEFAULT_POLICY, stretchCap, type BudgetPolicy } from "./budget.js";
import { DEFAULT_ALLOWLIST, TOOL_DEFS, runTool } from "./tools.js";
import type { BrowserDriver, Coin, ExperimentRunner, Store } from "./types.js";

export interface StretchDeps {
  llm: LlmClient;
  tracer: Tracer;
  books: SolverBooks;
  store: Store;
  solUsd: () => Promise<number>;
  browser?: BrowserDriver;
  runner?: ExperimentRunner;
  sandboxUsdPerSecond?: number;
  fallbackModels?: string[];
  policy?: BudgetPolicy;
}

export interface StretchResult {
  runId: string;
  turns: number;
  spentUsd: number;
  stopReason: "done" | "turn_cap" | "money_cap" | "time_cap" | "error";
  servedModels: string[];
}

function systemPrompt(coin: Coin, memories: string[]): string {
  const t = getTarget(coin.targetId);
  return [
    `You are an AI cryptanalyst funded by the $${coin.symbol} coin, working the HashSmash target ${t.id} (${t.primitive}, first ${t.rounds} of ${t.fullRounds} rounds), lane ${coin.lane}.`,
    "Goal: an ordinary collision with lower log2 total charged cost (collision-frontier-v5) than the current incumbent. Lower is better; nominal is 128.",
    "Rules: run real experiments before claiming; declare every unproved premise as a heuristic; never present published results as new; an honest 128.1 beats a fictional 90.",
    "Each stretch starts fresh: save what matters with `remember` (shared=true for findings every solver on this track should know).",
    coin.approach ? `Launcher's brief: ${coin.approach}` : "",
    memories.length ? `Your recent notes:\n- ${memories.join("\n- ")}` : "No notes yet.",
  ].filter(Boolean).join("\n\n");
}

export async function runStretch(coin: Coin, deps: StretchDeps): Promise<StretchResult> {
  const policy = deps.policy ?? DEFAULT_POLICY;
  const { tracer, books, store } = deps;
  const solUsd = await deps.solUsd();
  const before = await books.summary(coin.mint, { solUsd });
  const cap = stretchCap(before.remainingUsd, policy);
  const started = Date.now();
  const served = new Set<string>();

  return tracer.withSpan(`stretch ${coin.symbol}`, "run", async (run) => {
    run.setAttrs({ mint: coin.mint, target: coin.targetId, requestedModel: coin.modelId, capUsd: cap });
    const notes = (await store.recall(coin.targetId, coin.mint, "", 6)).map((m) => m.text);
    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt(coin, notes) },
      { role: "user", content: "Begin this stretch. Check my_claims and recall, then continue the most promising line of work." },
    ];
    const ctx = {
      coin,
      store,
      browser: deps.browser,
      runner: deps.runner,
      bookSandbox: async (seconds: number) => {
        const usd = seconds * (deps.sandboxUsdPerSecond ?? 0.0001);
        tracer.current()?.addCost(usd).setAttrs({ sandboxSeconds: seconds });
        await books.computeSpend({ id: `sbx:${tracer.current()?.id ?? Date.now()}`, mint: coin.mint, category: "sandbox", usd, solUsd });
      },
      allowlist: DEFAULT_ALLOWLIST,
      status: async () => {
        const s = await books.summary(coin.mint, { solUsd });
        return { ...s, stretchCapUsd: cap, spentThisStretchUsd: run.record.totalCostUsd };
      },
    };

    let turns = 0;
    let stopReason: StretchResult["stopReason"] = "done";
    while (true) {
      if (turns >= policy.maxTurns) { stopReason = "turn_cap"; break; }
      if (run.record.totalCostUsd >= cap) { stopReason = "money_cap"; break; }
      if (Date.now() - started >= policy.maxMs) { stopReason = "time_cap"; break; }
      turns++;

      const done = await tracer.withSpan(`turn ${turns}`, "turn", async (turn) => {
        const r = await deps.llm.chat({ model: coin.modelId, fallbackModels: deps.fallbackModels, messages, tools: TOOL_DEFS });
        served.add(r.servedModel);
        if (r.swap) await store.note(coin.mint, brand.copy.modelSwapNotice(r.swap.requested, r.swap.served));
        await books.computeSpend({
          id: `llm:${turn.id}`, mint: coin.mint, category: "llm", usd: r.costUsd, solUsd, ref: { spanId: turn.id },
        });
        messages.push(r.message);
        const calls = r.message.tool_calls ?? [];
        if (!calls.length) return true;
        for (const call of calls) {
          const out = await tracer.withSpan(call.function.name, "tool_call", async (s) => {
            const res = await runTool(call.function.name, call.function.arguments, ctx);
            s.setOutput(res);
            if (call.function.name.startsWith("browser_") && deps.browser?.lastFrame) s.setAttrs({ screenshot: deps.browser.lastFrame });
            return res;
          }, { input: call.function.arguments });
          messages.push({ role: "tool", tool_call_id: call.id, content: typeof out === "string" ? out : JSON.stringify(out) });
        }
        return false;
      }).catch((err) => {
        stopReason = "error";
        run.setAttrs({ error: String(err) });
        return true;
      });
      if (done) break;
    }

    run.setAttrs({ turns, stopReason, servedModels: [...served] });
    return { runId: run.id, turns, spentUsd: run.record.totalCostUsd, stopReason, servedModels: [...served] };
  });
}

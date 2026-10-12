import { createServer, type ServerResponse } from "node:http";
import { TARGETS, launchableTargets } from "@solver/hashsmash";
import type { SolverBooks } from "@solver/ledger";
import { buildTree, type SpanRecord, type SpanSink } from "@solver/trace";
import type { Coin, Store } from "./solver/types.js";

/** Span sink that also fans events out to SSE subscribers. */
export class LiveSink implements SpanSink {
  readonly spans = new Map<string, SpanRecord>();
  readonly #subs = new Set<(s: SpanRecord) => void>();
  onStart(s: Readonly<SpanRecord>) { this.#put(s); }
  onEnd(s: Readonly<SpanRecord>) { this.#put(s); }
  subscribe(fn: (s: SpanRecord) => void) { this.#subs.add(fn); return () => this.#subs.delete(fn); }
  #put(s: Readonly<SpanRecord>) {
    const copy = { ...s };
    this.spans.set(s.id, copy);
    for (const fn of this.#subs) fn(copy);
  }
}

export interface ApiDeps {
  coins: () => Coin[];
  live: LiveSink;
  books: SolverBooks;
  store: Store;
  notes: (mint: string) => Promise<{ text: string; at: Date }[]>;
  solUsd: () => Promise<number>;
  incumbents: Record<string, { timeLog2: number; by: string; ref: string }>;
}

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*" });
  res.end(JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
};

export function startApi(deps: ApiDeps, port: number) {
  const runsOf = (mint?: string) =>
    [...deps.live.spans.values()].filter((s) => s.kind === "run" && (!mint || s.attrs.mint === mint)).sort((a, b) => b.startedAt - a.startedAt);

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const parts = url.pathname.split("/").filter(Boolean); // ["v1", ...]
    try {
      if (parts[0] !== "v1") return json(res, 404, { error: "not found" });
      const [, resource, id, sub] = parts;
      const solUsd = await deps.solUsd();

      if (resource === "targets") return json(res, 200, { targets: TARGETS.map(({ hash, ...t }) => t), launchable: launchableTargets().map((t) => t.id) });

      if (resource === "coins" && !id) {
        const out = await Promise.all(deps.coins().map(async (c) => {
          const last = runsOf(c.mint)[0];
          const best = (await deps.store.claims(c.mint))[0];
          return { ...c, money: await deps.books.summary(c.mint, { solUsd }), lastRun: last ?? null, best: best ? { timeLog2: best.claim.claim.time_log2, status: best.status } : null };
        }));
        return json(res, 200, { coins: out });
      }

      if (resource === "coins" && id) {
        const coin = deps.coins().find((c) => c.mint === id);
        if (!coin) return json(res, 404, { error: "unknown coin" });
        if (sub === "ledger") return json(res, 200, { entries: await deps.books.entries(id) });
        const runs = runsOf(id);
        const burn = runs.length ? runs.slice(0, 10).reduce((a, r) => a + r.totalCostUsd, 0) / Math.max(1, (Date.now() - runs[Math.min(9, runs.length - 1)]!.startedAt) / 3_600_000) : 0;
        return json(res, 200, {
          coin,
          money: await deps.books.summary(id, { solUsd, burnUsdPerHour: burn }),
          reconciliation: null,
          runs,
          claims: await deps.store.claims(id),
          notes: await deps.notes(id),
          incumbent: deps.incumbents[coin.targetId] ?? null,
        });
      }

      if (resource === "traces" && id) {
        const spans = [...deps.live.spans.values()].filter((s) => s.traceId === id);
        return json(res, 200, { tree: buildTree(spans) });
      }

      if (resource === "models") {
        const runs = runsOf();
        const by = new Map<string, { runs: number; costUsd: number; swaps: number }>();
        for (const r of runs) {
          for (const m of (r.attrs.servedModels as string[] | undefined) ?? []) {
            const e = by.get(m) ?? { runs: 0, costUsd: 0, swaps: 0 };
            e.runs++; e.costUsd += r.totalCostUsd;
            if (m !== r.attrs.requestedModel) e.swaps++;
            by.set(m, e);
          }
        }
        return json(res, 200, { models: Object.fromEntries(by) });
      }

      if (resource === "stream") {
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", "access-control-allow-origin": "*" });
        const unsub = deps.live.subscribe((s) => {
          if (!id || s.attrs.mint === id || s.traceId === id) res.write(`data: ${JSON.stringify(s)}\n\n`);
        });
        req.on("close", unsub);
        return;
      }

      return json(res, 404, { error: "not found" });
    } catch (err) {
      return json(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
  });
  server.listen(port);
  return server;
}

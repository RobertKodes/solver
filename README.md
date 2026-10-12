# Solver (codename)

Memecoin-funded AI cryptanalysis agents working HashSmash targets, with every step observable.
The full plan is in `~/.claude/plans/really-learn-them-and-jaunty-blum.md`.

## Layout

| Path | What |
|---|---|
| `packages/brand` | All names, colors, copy. Swap here to rebrand. |
| `packages/trace` | Span tracer (run → turn → llm_call / tool_call / experiment), sinks, tree builder. Powers the trace explorer. |
| `packages/llm` | OpenRouter client: records the model actually served, tokens, cost; discloses every fallback / reroute. |
| `packages/ledger` | Double-entry ledger + `SolverBooks` (fees in, compute out by category, runway, on-chain reconciliation). |
| `packages/db` | Drizzle schema (coins, tracks, runs, spans, claims, submissions, memories, ledger, sessions, alerts) + Postgres sinks/stores. |
| `packages/hashsmash` | Reduced-round SHA-256 (verified vs node:crypto), target catalog with track status (only open tracks launchable), birthday experiments, collision verifier, claim intake, cost-model breakdown, submission gate (refuses closed tracks, reproductions, non-improvements). |
| `apps/worker` | Solver runtime (tool loop, treasury-scaled budgets, shared track memory, disclosed model swaps), pump.fun launch builder + fee collector (`pump.ts`, @pump-fun/pump-sdk v4, fee-sharing to treasury), keeper + on-chain reconciliation, HashSmash submission pipeline (dry-run by default), alerts, read API + SSE (`/v1/...`). `pnpm --filter @solver/worker start` runs demo mode without keys. |
| `apps/web` | Observability UI: frontier race, coin page (money flow, runway, claims with downloads, notes, ledger), trace explorer with replay scrubber, models page. `pnpm --filter @solver/web dev` (:3000). |

Not yet wired (need accounts): Browserbase/E2B drivers behind `BrowserDriver` / a sandboxed `run_experiment`, Postgres-backed `Store` for claims & memories, price feed, and devnet validation of `pump.ts`.

## Getting started

```sh
pnpm install
pnpm test          # unit tests
pnpm typecheck
pnpm --filter @solver/worker demo
pnpm infra:up      # Postgres (pgvector) + Redis, needs Docker
cp .env.example .env
pnpm --filter @solver/db db:generate && pnpm --filter @solver/db db:migrate
```

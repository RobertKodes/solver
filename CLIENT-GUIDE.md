# Solver: client guide

**What it is.** A launchpad where each memecoin funds an AI cryptanalyst working on an open HashSmash challenge (reduced-round SHA-256, SHA3, BLAKE3). Creator fees pay for the AI, and everything it does is public: traces, replays, a money-flow ledger and the research frontier.

## Try the demo (no accounts needed)
Requires Node 22+ and pnpm 9.
```sh
pnpm install
pnpm dev          # API on :4000, website on http://localhost:3000
```
Or with Docker Desktop running: `docker compose up --build`, then open http://localhost:3000.

Demo mode uses a scripted AI and simulated coins, so nothing costs money.

| Page | What you see |
|---|---|
| `/` | Landing page with live stats |
| `/dashboard` | Frontier race per target and all solvers |
| `/launch` | Launch form (open HashSmash tracks only). In the demo the new solver starts within seconds |
| `/coin/<id>` | Money flow, runway, claims (download `claim.json` / `proof.md`), notes, ledger, run history |
| `/trace/<id>` | Every model and tool call with prompt, output, cost, requested vs. served model, and a replay scrubber |
| `/models` | Which models actually served runs, and how often a fallback stood in |

## Going live: what's still needed
1. **Accounts / keys** in `.env` (see `.env.example`): OpenRouter (AI models), a Solana RPC such as Helius, Browserbase (research browser), E2B (sandboxed experiments), Pinata (coin images). Optional: Pyth price feed key.
2. **Wallet flow on the website**: the launch page connects a Phantom/Backpack wallet and signs the two launch transactions that `apps/worker/src/pump.ts` builds. The transaction builder exists; the wallet button is not wired yet.
3. **Devnet test** of the launch and fee collection with a funded devnet wallet, then mainnet.
4. **Treasury**: a Squads multisig (or program address) that receives each coin's creator fees.
5. **Hosting**: one small server for the worker and API (Railway, Fly or a VPS), Postgres with pgvector, Redis, and the website on Vercel. Set `DATABASE_URL` / `REDIS_URL`.
6. **Branding**: name, colours and copy live in `packages/brand/src/index.ts`.
7. **Legal review** before launch: see `LEGAL-CHECKLIST.md`.

## Running costs
AI tokens, browser minutes and sandbox seconds are paid from each coin's own fees and recorded line by line in the ledger. Fixed costs are hosting, the database and RPC.

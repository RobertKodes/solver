"use client";
import { brand } from "@solver/brand";
import { useLive, usd, type Money } from "../lib/api";

interface CoinRow { mint: string; money: Money; best: { timeLog2: number } | null }

const steps = [
  { t: "Launch a coin", d: "Pick a HashSmash target, an AI model and a research brief. One wallet signature creates the coin." },
  { t: "Trading funds compute", d: "Creator fees flow on-chain to the coin's own treasury and pay for model calls, browser time and sandboxed experiments." },
  { t: "Watch every step", d: "Every model call, tool call, experiment and dollar is public: traces, replays, the ledger and the research frontier." },
];

const features = [
  ["Full traces", "Each run is a tree of model and tool calls with prompts, outputs, tokens and cost. Requested vs. served model is always shown."],
  ["Money-flow ledger", "Fees in, compute out by category, runway, and a public check of the books against the on-chain treasury."],
  ["Honest submissions", "Only open HashSmash tracks. Reproductions of published work are labelled and never submitted as new."],
  ["Replay", "Scrub through a run with browser frames and events on one timeline."],
];

export default function Landing() {
  const data = useLive<{ coins: CoinRow[] }>("/v1/coins");
  const coins = data?.coins ?? [];
  const raised = coins.reduce((a, c) => a + c.money.totalSpendUsd + c.money.remainingUsd, 0);
  const spent = coins.reduce((a, c) => a + c.money.totalSpendUsd, 0);
  const best = coins.map((c) => c.best?.timeLog2).filter((x): x is number => x != null).sort((a, b) => a - b)[0];

  return (
    <>
      <section style={{ padding: "48px 0 24px" }}>
        <h1 style={{ fontSize: 40, lineHeight: 1.1, maxWidth: 720 }}>{brand.tagline}</h1>
        <p className="muted" style={{ fontSize: 16, maxWidth: 640 }}>
          Each coin funds an AI cryptanalyst working on an open HashSmash challenge. Trading pays for the research, and everything it does is on the record.
        </p>
        <div className="row" style={{ marginTop: 16 }}>
          <a className="btn" href="/launch">Launch a solver</a>
          <a className="btn ghost" href="/dashboard">Open dashboard</a>
        </div>
      </section>

      <div className="grid">
        <div className="card stat"><b>{coins.length}</b><span className="muted">solvers</span></div>
        <div className="card stat"><b>{usd(raised)}</b><span className="muted">compute raised</span></div>
        <div className="card stat"><b>{usd(spent)}</b><span className="muted">compute spent</span></div>
        <div className="card stat"><b>{best != null ? `2^${best}` : "—"}</b><span className="muted">best draft claim</span></div>
      </div>

      <h2 style={{ marginTop: 32 }}>How it works</h2>
      <div className="grid">
        {steps.map((s, i) => (
          <div key={s.t} className="card"><span className="pill">{i + 1}</span><h3>{s.t}</h3><p className="muted">{s.d}</p></div>
        ))}
      </div>

      <h2 style={{ marginTop: 32 }}>Built to be checked</h2>
      <div className="grid">
        {features.map(([t, d]) => <div key={t} className="card"><h3>{t}</h3><p className="muted">{d}</p></div>)}
      </div>
    </>
  );
}

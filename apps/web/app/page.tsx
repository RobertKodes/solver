"use client";
import { ago, useLive, usd, type Money, type Span } from "../lib/api";

interface CoinRow {
  mint: string; symbol: string; targetId: string; lane: string; modelId: string;
  money: Money; lastRun: Span | null; best: { timeLog2: number; status: string } | null;
}

export default function Home() {
  const data = useLive<{ coins: CoinRow[] }>("/v1/coins");
  const targets = useLive<{ targets: { id: string; status: string; rounds: number; primitive: string }[] }>("/v1/targets");
  if (!data || !targets) return <p className="muted">Loading…</p>;

  return (
    <>
      <h1>Frontier race</h1>
      <div className="grid">
        {targets.targets.filter((t) => t.status === "open").map((t) => {
          const coins = data.coins.filter((c) => c.targetId === t.id);
          const best = coins.map((c) => c.best?.timeLog2).filter((x): x is number => x != null).sort((a, b) => a - b)[0];
          return (
            <div key={t.id} className="card">
              <div className="mono muted">{t.id}</div>
              <div className="row"><b>{t.primitive} · {t.rounds} rounds</b><span className="pill">{coins.length} solvers</span></div>
              <div className="muted">best here: {best != null ? `2^${best}` : "—"}</div>
            </div>
          );
        })}
      </div>

      <h2 style={{ marginTop: 24 }}>Solvers</h2>
      <div className="grid">
        {data.coins.map((c) => (
          <a key={c.mint} href={`/coin/${c.mint}`} className="card" style={{ textDecoration: "none" }}>
            <div className="row"><b>${c.symbol}</b><span className="mono muted">{c.targetId}</span></div>
            <div className="muted">{c.modelId} · {c.lane}</div>
            <div className="row" style={{ marginTop: 8 }}>
              <span className="stat"><b>{usd(c.money.remainingUsd)}</b><span className="muted">compute left</span></span>
              <span className="stat"><b>{usd(c.money.totalSpendUsd)}</b><span className="muted">spent</span></span>
            </div>
            {c.lastRun && (
              <div className="muted" style={{ marginTop: 6 }}>
                <span className={`pill ${c.lastRun.status}`}>{c.lastRun.status}</span> last stretch {ago(c.lastRun.startedAt)}
              </div>
            )}
          </a>
        ))}
      </div>
    </>
  );
}

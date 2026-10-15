"use client";
import { use } from "react";
import { ago, API, useLive, usd, type Money, type Span } from "../../../lib/api";

interface Claim {
  id: string; title: string; status: string; problems: string[];
  claim: { claim: { time_log2: number } } & Record<string, unknown>;
  proofMd: string; certificate?: { a: string; b: string; digest: string };
}
interface Detail {
  coin: { mint: string; symbol: string; targetId: string; lane: string; modelId: string; approach: string; treasury: string };
  money: Money; runs: Span[]; claims: Claim[];
  notes: { text: string; at: string }[];
  incumbent: { timeLog2: number; by: string; ref: string } | null;
}
interface Entry { id: string; at: string; kind: string; ref?: { chainTx?: string; spanId?: string }; postings: { account: string; asset: string; amount: string }[] }

const COLORS: Record<string, string> = { llm: "#6366f1", browser: "#0ea5e9", sandbox: "#f59e0b", gas: "#a1a1aa" };

function download(name: string, body: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([body]));
  a.download = name;
  a.click();
}

export default function CoinPage({ params }: { params: Promise<{ mint: string }> }) {
  const { mint } = use(params);
  const d = useLive<Detail>(`/v1/coins/${mint}`, mint);
  const ledger = useLive<{ entries: Entry[] }>(`/v1/coins/${mint}/ledger`, mint);
  if (!d) return <p className="muted">Loading…</p>;
  const { coin, money } = d;
  const total = money.totalSpendUsd + money.remainingUsd || 1;
  const swaps = d.runs.filter((r) => ((r.attrs.servedModels as string[]) ?? []).some((m) => m !== r.attrs.requestedModel));

  return (
    <>
      <h1>${coin.symbol}</h1>
      <div className="row muted">
        <span className="mono">{coin.targetId}</span><span>· {coin.lane}</span><span>· model {coin.modelId}</span>
        <span className="mono">· treasury {coin.treasury}</span>
      </div>
      {coin.approach && <p><b>Launcher's brief:</b> {coin.approach}</p>}
      {swaps.length > 0 && (
        <div className="card warn">{swaps.length} stretch(es) were served by a different model than {coin.modelId}. See the runs below.</div>
      )}

      <div className="split" style={{ marginTop: 12 }}>
        <section className="card">
          <h3>Money flow</h3>
          <div className="row">
            <span className="stat"><b>{money.feesSol.toFixed(4)} SOL</b><span className="muted">fees in</span></span>
            <span className="stat"><b>{usd(money.totalSpendUsd)}</b><span className="muted">compute out</span></span>
            <span className="stat"><b>{usd(money.remainingUsd)}</b><span className="muted">left</span></span>
            <span className="stat"><b>{money.runwayHours != null ? `${money.runwayHours.toFixed(0)}h` : "—"}</b><span className="muted">runway</span></span>
          </div>
          <div className="bar" style={{ marginTop: 10 }}>
            {Object.entries(money.spendUsd).map(([k, v]) => <span key={k} title={`${k} ${usd(v)}`} style={{ width: `${(v / total) * 100}%`, background: COLORS[k] }} />)}
          </div>
          <div className="row muted" style={{ marginTop: 6 }}>
            {Object.entries(money.spendUsd).map(([k, v]) => <span key={k}><span style={{ color: COLORS[k] }}>■</span> {k} {usd(v)}</span>)}
            <span>■ remaining</span>
          </div>
        </section>

        <section className="card">
          <h3>Research progress</h3>
          <p className="muted">Incumbent: {d.incumbent ? `2^${d.incumbent.timeLog2} by ${d.incumbent.by}` : "nominal 2^128"}</p>
          {d.claims.length === 0 && <p className="muted">No claims drafted yet.</p>}
          <table><tbody>
            {d.claims.map((c) => (
              <tr key={c.id}>
                <td><b>2^{c.claim.claim.time_log2}</b></td>
                <td>{c.title}<div className="muted">{c.problems.join("; ")}</div></td>
                <td><span className="pill">{c.status}</span>{c.certificate && <span className="pill ok">cert ✓</span>}</td>
                <td>
                  <button onClick={() => download("claim.json", JSON.stringify(c.claim, null, 2))}>claim.json</button>
                  <button onClick={() => download("proof.md", c.proofMd)}>proof.md</button>
                </td>
              </tr>
            ))}
          </tbody></table>
        </section>
      </div>

      <section className="card" style={{ marginTop: 12 }}>
        <h3>Stretches</h3>
        <table>
          <thead><tr><th>When</th><th>Models served</th><th>Turns</th><th>Cost</th><th>Stop</th><th /></tr></thead>
          <tbody>
            {d.runs.length === 0 && <tr><td colSpan={6} className="muted">No stretches yet. The solver starts on the next scheduler pass.</td></tr>}
            {d.runs.map((r) => (
              <tr key={r.id}>
                <td>{ago(r.startedAt)}</td>
                <td className="mono">{((r.attrs.servedModels as string[]) ?? []).join(", ") || "—"}</td>
                <td>{String(r.attrs.turns ?? "…")}</td>
                <td>{usd(r.totalCostUsd)}</td>
                <td><span className={`pill ${r.status}`}>{String(r.attrs.stopReason ?? r.status)}</span></td>
                <td><a href={`/trace/${r.traceId}`}>trace & replay →</a></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="split" style={{ marginTop: 12 }}>
        <section className="card">
          <h3>Solver notes</h3>
          {d.notes.length === 0 && <p className="muted">No notes yet.</p>}
          {d.notes.map((n, i) => <p key={i}><span className="muted">{new Date(n.at).toLocaleTimeString()}</span> {n.text}</p>)}
        </section>
        <section className="card">
          <h3>Ledger</h3>
          <table><tbody>
            {ledger?.entries.slice(0, 40).map((e) => {
              const p = e.postings.find((x) => x.account.startsWith(`coin:${mint}:`));
              const amt = p ? (p.asset === "SOL" ? `${(Number(p.amount) / 1e9).toFixed(6)} SOL` : usd(Number(p.amount) / 1e6)) : "";
              return (
                <tr key={e.id}>
                  <td>{e.kind}</td><td className="mono">{p?.account.split(":").slice(2).join(":")}</td><td>{amt}</td>
                  <td className="mono muted">{e.ref?.chainTx ?? (e.ref?.spanId ? <a href="#" title={e.ref.spanId}>span</a> : "")}</td>
                </tr>
              );
            })}
          </tbody></table>
          <p className="muted">Raw: <a href={`${API}/v1/coins/${mint}/ledger`}>JSON</a></p>
        </section>
      </div>
    </>
  );
}

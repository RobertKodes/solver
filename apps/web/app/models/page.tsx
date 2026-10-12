"use client";
import { useLive, usd } from "../../lib/api";

export default function Models() {
  const d = useLive<{ models: Record<string, { runs: number; costUsd: number; swaps: number }> }>("/v1/models");
  if (!d) return <p className="muted">Loading…</p>;
  const rows = Object.entries(d.models).sort((a, b) => b[1].runs - a[1].runs);
  return (
    <>
      <h1>Models</h1>
      <p className="muted">Which models actually served solver stretches. Swaps are stretches where this model stood in for the one the launcher picked.</p>
      <div className="card">
        <table>
          <thead><tr><th>Model (as served)</th><th>Stretches</th><th>Spend</th><th>Avg / stretch</th><th>As stand-in</th></tr></thead>
          <tbody>
            {rows.map(([m, s]) => (
              <tr key={m}>
                <td className="mono">{m}</td><td>{s.runs}</td><td>{usd(s.costUsd)}</td><td>{usd(s.costUsd / s.runs)}</td>
                <td>{s.swaps ? <span className="pill error">{s.swaps}</span> : 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

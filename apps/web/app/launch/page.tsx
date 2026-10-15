"use client";
import { useEffect, useState } from "react";
import { API } from "../../lib/api";

interface Target { id: string; primitive: string; rounds: number; status: string }

export default function Launch() {
  const [targets, setTargets] = useState<Target[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [form, setForm] = useState({ name: "", symbol: "", targetId: "", lane: "exploratory", modelId: "", approach: "", initialBuySol: 0.1 });
  const [result, setResult] = useState<{ ok: boolean; problems?: string[]; mint?: string; note?: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`${API}/v1/targets`).then((r) => r.json()).then((d) => {
      const open = (d.targets as Target[]).filter((t) => t.status === "open");
      setTargets(open);
      setForm((f) => ({ ...f, targetId: f.targetId || open[0]?.id || "" }));
    }).catch(() => {});
    fetch(`${API}/v1/catalog`).then((r) => r.json()).then((d) => {
      setModels(d.models);
      setForm((f) => ({ ...f, modelId: f.modelId || d.models[0] || "" }));
    }).catch(() => {});
  }, []);

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm({ ...form, [k]: k === "initialBuySol" ? Number(e.target.value) : k === "symbol" ? e.target.value.toUpperCase() : e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      const r = await fetch(`${API}/v1/launch`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(form) });
      setResult(await r.json());
    } catch {
      setResult({ ok: false, problems: ["Could not reach the API."] });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 640 }}>
      <h1>Launch a solver</h1>
      <p className="muted">The coin's creator fees pay for its AI solver. Target, model and brief are fixed at launch.</p>
      <form className="card form" onSubmit={submit}>
        <label>Coin name<input value={form.name} onChange={set("name")} maxLength={32} required /></label>
        <label>Ticker<input value={form.symbol} onChange={set("symbol")} maxLength={10} required /></label>
        <label>HashSmash target (open tracks only)
          <select value={form.targetId} onChange={set("targetId")}>
            {targets.map((t) => <option key={t.id} value={t.id}>{t.primitive} · {t.rounds} rounds ({t.id})</option>)}
          </select>
        </label>
        <label>Model<select value={form.modelId} onChange={set("modelId")}>{models.map((m) => <option key={m}>{m}</option>)}</select></label>
        <label>Review lane
          <select value={form.lane} onChange={set("lane")}><option value="exploratory">Exploratory</option><option value="rigorous">Rigorous</option></select>
        </label>
        <label>Research brief (optional)<textarea value={form.approach} onChange={set("approach")} maxLength={800} rows={4} /></label>
        <label>Initial buy (SOL)<input type="number" min={0} max={50} step={0.01} value={form.initialBuySol} onChange={set("initialBuySol")} /></label>
        <button className="btn" disabled={busy}>{busy ? "Launching…" : "Launch"}</button>
      </form>
      {result && (
        <div className={`card ${result.ok ? "" : "warn"}`} style={{ marginTop: 12 }}>
          {result.ok ? (
            <>
              <b>Launched.</b> <span className="muted">{result.note}</span>
              <p><a href={`/coin/${result.mint}`}>Open the coin page →</a></p>
            </>
          ) : (
            <ul>{result.problems?.map((p) => <li key={p}>{p}</li>)}</ul>
          )}
        </div>
      )}
    </div>
  );
}

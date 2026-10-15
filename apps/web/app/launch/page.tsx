"use client";
import { useEffect, useState } from "react";
import { API } from "../../lib/api";

interface Target { id: string; primitive: string; rounds: number; status: string }

type Phantom = {
  isPhantom?: boolean;
  connect(): Promise<{ publicKey: { toBase58(): string } }>;
  signAllTransactions<T>(txs: T[]): Promise<T[]>;
};
const phantom = () => (typeof window !== "undefined" ? (window as unknown as { solana?: Phantom }).solana : undefined);
const b64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export default function Launch() {
  const [targets, setTargets] = useState<Target[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [form, setForm] = useState({ name: "", symbol: "", targetId: "", lane: "exploratory", modelId: "", approach: "", initialBuySol: 0.1 });
  const [result, setResult] = useState<{ ok: boolean; problems?: string[]; mint?: string; note?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [wallet, setWallet] = useState<string | null>(null);

  async function connect() {
    const p = phantom();
    if (!p) return setResult({ ok: false, problems: ["Install the Phantom wallet extension to launch for real."] });
    const { publicKey } = await p.connect();
    setWallet(publicKey.toBase58());
  }

  /** Live mode: server returns unsigned txs; the mint keypair co-signs tx 1, the wallet signs both. */
  async function signAndSend(sign: string[], mintKp: import("@solana/web3.js").Keypair) {
    const { Connection, Transaction } = await import("@solana/web3.js");
    const txs = sign.map((s) => Transaction.from(b64(s)));
    txs[0]!.partialSign(mintKp);
    const signed = await phantom()!.signAllTransactions(txs);
    const conn = new Connection(process.env.NEXT_PUBLIC_SOLANA_RPC ?? "https://api.mainnet-beta.solana.com", "confirmed");
    const signatures: string[] = [];
    for (const tx of signed) {
      const sig = await conn.sendRawTransaction(tx.serialize());
      await conn.confirmTransaction(sig, "confirmed");
      signatures.push(sig);
    }
    const r = await fetch(`${API}/v1/launch`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirm: true, mint: mintKp.publicKey.toBase58(), signatures }) });
    return r.json();
  }

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
      const { Keypair } = await import("@solana/web3.js");
      const mintKp = Keypair.generate();
      const body = { ...form, ...(wallet ? { launcher: wallet, mint: mintKp.publicKey.toBase58() } : {}) };
      const r = await fetch(`${API}/v1/launch`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json();
      setResult(d.ok && d.sign ? await signAndSend(d.sign, mintKp) : d);
    } catch (err) {
      setResult({ ok: false, problems: [err instanceof Error ? err.message : "Could not reach the API."] });
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
        <div className="row">
          <button type="button" className="btn ghost" onClick={connect}>{wallet ? `Wallet ${wallet.slice(0, 4)}…${wallet.slice(-4)}` : "Connect wallet"}</button>
          <button className="btn" disabled={busy}>{busy ? "Launching…" : "Launch"}</button>
        </div>
        <span className="muted">Demo server: no wallet needed. Live server: connect Phantom, then approve the two launch transactions.</span>
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

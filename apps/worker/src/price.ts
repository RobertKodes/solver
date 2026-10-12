// SOL/USD from Pyth Hermes (when PYTH_API_KEY is set), falling back to Coinbase's public spot price.
// Cached briefly; ticks can be persisted to price_ticks for the money-flow chart.

const PYTH_SOL_USD = "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";

export function solUsdFeed(opts: { ttlMs?: number; fetch?: typeof fetch; pythApiKey?: string; onTick?: (usd: number, source: string) => void } = {}) {
  const f = opts.fetch ?? fetch;
  const ttl = opts.ttlMs ?? 30_000;
  let cache: { usd: number; at: number } | null = null;

  async function pyth(): Promise<number> {
    if (!opts.pythApiKey) throw new Error("pyth: no key");
    const r = await f(`https://hermes.pyth.network/v2/updates/price/latest?ids%5B%5D=${PYTH_SOL_USD}&parsed=true`, { headers: { "x-api-key": opts.pythApiKey } });
    const j = (await r.json()) as { parsed?: { price: { price: string; expo: number } }[] };
    const p = j.parsed?.[0]?.price;
    if (!p) throw new Error("pyth: no price");
    return Number(p.price) * 10 ** p.expo;
  }

  async function coinbase(): Promise<number> {
    const r = await f("https://api.coinbase.com/v2/prices/SOL-USD/spot");
    const j = (await r.json()) as { data?: { amount?: string } };
    const v = Number(j.data?.amount);
    if (!(v > 0)) throw new Error("coinbase: no price");
    return v;
  }

  return async function solUsd(): Promise<number> {
    if (cache && Date.now() - cache.at < ttl) return cache.usd;
    for (const [src, get] of [["pyth", pyth], ["coinbase", coinbase]] as const) {
      try {
        const usd = await get();
        if (usd > 0) {
          cache = { usd, at: Date.now() };
          opts.onTick?.(usd, src);
          return usd;
        }
      } catch {
        /* try next source */
      }
    }
    if (cache) return cache.usd; // stale beats nothing
    throw new Error("no SOL/USD price available");
  };
}

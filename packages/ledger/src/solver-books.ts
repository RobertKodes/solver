import type { Ledger, LedgerRef } from "./ledger.js";

/**
 * The coin-level books behind the money-flow view.
 *
 * Accounts:
 *   chain:pump                     where creator fees come from (contra account)
 *   coin:<mint>:treasury    SOL    mirror of the coin's on-chain treasury
 *   platform:reimbursed     SOL    SOL drawn from treasuries to repay vendor bills
 *   platform:fronted        USD    what the platform paid vendors on a coin's behalf
 *   coin:<mint>:spend:<cat> USD    compute spent, by category
 *
 * Fees land in the treasury in SOL. Each compute charge books the USD cost by
 * category and draws the same value in SOL from the treasury at the spot rate,
 * so the treasury balance always equals fees in minus compute out and can be
 * reconciled against the chain.
 */

export const LAMPORTS_PER_SOL = 1_000_000_000n;
export const MICRO_USD = 1_000_000n;

export type SpendCategory = "llm" | "browser" | "sandbox" | "gas";

export const acct = {
  feeSource: "chain:pump",
  treasury: (mint: string) => `coin:${mint}:treasury`,
  spend: (mint: string, cat: SpendCategory) => `coin:${mint}:spend:${cat}`,
  reimbursed: "platform:reimbursed",
  fronted: "platform:fronted",
};

export function usdToMicro(usd: number): bigint {
  return BigInt(Math.round(usd * 1_000_000));
}

/** Lamports worth `usdMicro` at `solUsd` dollars per SOL, rounded up so treasuries never under-pay. */
export function microUsdToLamports(usdMicro: bigint, solUsd: number): bigint {
  const rateMicro = usdToMicro(solUsd);
  if (rateMicro <= 0n) throw new RangeError("solUsd must be positive");
  const num = usdMicro * LAMPORTS_PER_SOL;
  return (num + rateMicro - 1n) / rateMicro;
}

export class SolverBooks {
  constructor(private readonly ledger: Ledger) {}

  feeClaim(args: { mint: string; lamports: bigint; chainTx: string; at?: Date }) {
    return this.ledger.post({
      id: `fee:${args.chainTx}:${args.mint}`,
      at: args.at ?? new Date(),
      kind: "fee_claim",
      ref: { chainTx: args.chainTx },
      postings: [
        { account: acct.treasury(args.mint), asset: "SOL", amount: args.lamports },
        { account: acct.feeSource, asset: "SOL", amount: -args.lamports },
      ],
    });
  }

  computeSpend(args: {
    id: string;
    mint: string;
    category: SpendCategory;
    usd: number;
    solUsd: number;
    ref?: LedgerRef;
    at?: Date;
  }) {
    const usdMicro = usdToMicro(args.usd);
    const lamports = microUsdToLamports(usdMicro, args.solUsd);
    return this.ledger.post({
      id: `spend:${args.id}`,
      at: args.at ?? new Date(),
      kind: "compute_spend",
      ref: args.ref,
      meta: { category: args.category, solUsd: args.solUsd },
      postings: [
        { account: acct.spend(args.mint, args.category), asset: "USD", amount: usdMicro },
        { account: acct.fronted, asset: "USD", amount: -usdMicro },
        { account: acct.reimbursed, asset: "SOL", amount: lamports },
        { account: acct.treasury(args.mint), asset: "SOL", amount: -lamports },
      ],
    });
  }

  /** Everything the coin page's money-flow Sankey and runway need. */
  async summary(mint: string, opts: { solUsd: number; burnUsdPerHour?: number }) {
    const prefix = `coin:${mint}:`;
    const balances = await this.ledger.balances(prefix);
    const txs = await this.ledger.store.list(prefix);

    let feesLamports = 0n;
    for (const tx of txs) {
      if (tx.kind !== "fee_claim") continue;
      for (const p of tx.postings) if (p.account === acct.treasury(mint)) feesLamports += p.amount;
    }

    const spendMicro: Record<SpendCategory, bigint> = { llm: 0n, browser: 0n, sandbox: 0n, gas: 0n };
    for (const cat of Object.keys(spendMicro) as SpendCategory[]) {
      spendMicro[cat] = balances.get(`${acct.spend(mint, cat)}|USD`) ?? 0n;
    }

    const treasuryLamports = balances.get(`${acct.treasury(mint)}|SOL`) ?? 0n;
    const remainingUsd = (Number(treasuryLamports) / Number(LAMPORTS_PER_SOL)) * opts.solUsd;
    const totalSpendUsd =
      Number(Object.values(spendMicro).reduce((a, b) => a + b, 0n)) / Number(MICRO_USD);

    return {
      feesSol: Number(feesLamports) / Number(LAMPORTS_PER_SOL),
      treasurySol: Number(treasuryLamports) / Number(LAMPORTS_PER_SOL),
      remainingUsd,
      totalSpendUsd,
      spendUsd: Object.fromEntries(
        Object.entries(spendMicro).map(([k, v]) => [k, Number(v) / Number(MICRO_USD)]),
      ) as Record<SpendCategory, number>,
      runwayHours:
        opts.burnUsdPerHour && opts.burnUsdPerHour > 0 ? remainingUsd / opts.burnUsdPerHour : null,
    };
  }

  /** Every ledger line touching the coin, newest first, for the public money-flow table. */
  async entries(mint: string) {
    return (await this.ledger.store.list(`coin:${mint}:`)).reverse();
  }

  /** Difference between the books and the chain; positive means the chain holds more. */
  async reconcile(mint: string, onChainLamports: bigint) {
    const booked = await this.ledger.balance(acct.treasury(mint), "SOL");
    return { booked, onChain: onChainLamports, diff: onChainLamports - booked };
  }
}

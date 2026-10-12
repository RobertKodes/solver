import { Connection, PublicKey } from "@solana/web3.js";
import type { SolverBooks } from "@solver/ledger";

/**
 * Chain side of fee collection. The concrete pump.fun implementation calls the
 * permissionless SWEEP_FEES + COLLECT_CREATOR_FEE instructions (pump-public-docs)
 * into each coin's fee-sharing treasury and returns what landed, measured as the
 * treasury balance delta so we never book more than arrived.
 */
export interface FeeCollector {
  collect(mint: string, treasury: string): Promise<{ lamports: bigint; signature: string } | null>;
}

export class SolanaTreasuryReader {
  readonly conn: Connection;
  constructor(rpcUrl: string) {
    this.conn = new Connection(rpcUrl, "confirmed");
  }
  async balance(treasury: string): Promise<bigint> {
    return BigInt(await this.conn.getBalance(new PublicKey(treasury)));
  }
}

export async function keeperPass(
  coins: { mint: string; treasury: string }[],
  collector: FeeCollector,
  books: SolverBooks,
  log: (msg: string) => void = console.log,
) {
  for (const c of coins) {
    try {
      const r = await collector.collect(c.mint, c.treasury);
      if (r && r.lamports > 0n) {
        await books.feeClaim({ mint: c.mint, lamports: r.lamports, chainTx: r.signature });
        log(`[keeper] ${c.mint}: +${r.lamports} lamports (${r.signature})`);
      }
    } catch (err) {
      log(`[keeper] ${c.mint}: collect failed: ${err instanceof Error ? err.message : err}`);
    }
  }
}

/** Books vs chain for every coin; any drift is surfaced publicly on the coin page. */
export async function reconcileAll(coins: { mint: string; treasury: string }[], reader: SolanaTreasuryReader, books: SolverBooks) {
  return Promise.all(coins.map(async (c) => ({ mint: c.mint, ...(await books.reconcile(c.mint, await reader.balance(c.treasury))) })));
}

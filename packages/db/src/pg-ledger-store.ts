import type { LedgerStore, LedgerTx } from "@solver/ledger";
import { asc, eq, inArray, like } from "drizzle-orm";
import type { Db } from "./client.js";
import { ledgerPostings, ledgerTxs } from "./schema.js";

export class PgLedgerStore implements LedgerStore {
  constructor(private readonly db: Db) {}

  async get(id: string): Promise<LedgerTx | undefined> {
    return (await this.#load([id]))[0];
  }

  async insert(tx: LedgerTx): Promise<void> {
    await this.db.transaction(async (q) => {
      await q.insert(ledgerTxs).values({
        id: tx.id,
        at: tx.at,
        kind: tx.kind,
        memo: tx.memo ?? null,
        ref: tx.ref ?? null,
        meta: tx.meta ?? null,
      });
      await q.insert(ledgerPostings).values(
        tx.postings.map((p, seq) => ({ txId: tx.id, seq, account: p.account, asset: p.asset, amount: p.amount })),
      );
    });
  }

  async list(prefix = ""): Promise<LedgerTx[]> {
    const escaped = prefix.replace(/[\\%_]/g, (c) => `\\${c}`);
    const ids = await this.db
      .selectDistinct({ id: ledgerPostings.txId })
      .from(ledgerPostings)
      .where(like(ledgerPostings.account, `${escaped}%`));
    return this.#load(ids.map((r) => r.id));
  }

  async #load(ids: string[]): Promise<LedgerTx[]> {
    if (ids.length === 0) return [];
    const txs = await this.db.select().from(ledgerTxs).where(inArray(ledgerTxs.id, ids)).orderBy(asc(ledgerTxs.at));
    const postings = await this.db
      .select()
      .from(ledgerPostings)
      .where(ids.length === 1 ? eq(ledgerPostings.txId, ids[0]!) : inArray(ledgerPostings.txId, ids))
      .orderBy(asc(ledgerPostings.seq));

    return txs.map((t) => ({
      id: t.id,
      at: t.at,
      kind: t.kind,
      memo: t.memo ?? undefined,
      ref: (t.ref as LedgerTx["ref"]) ?? undefined,
      meta: (t.meta as LedgerTx["meta"]) ?? undefined,
      postings: postings
        .filter((p) => p.txId === t.id)
        .map((p) => ({ account: p.account, asset: p.asset, amount: p.amount })),
    }));
  }
}

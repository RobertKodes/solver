import { describe, expect, it } from "vitest";
import { Ledger, LedgerError } from "./ledger.js";
import { LAMPORTS_PER_SOL, SolverBooks, acct, microUsdToLamports } from "./solver-books.js";

const MINT = "Mint111";

describe("Ledger", () => {
  it("rejects unbalanced transactions", async () => {
    const ledger = new Ledger();
    await expect(
      ledger.post({
        id: "t1",
        at: new Date(),
        kind: "x",
        postings: [
          { account: "a", asset: "SOL", amount: 5n },
          { account: "b", asset: "SOL", amount: -4n },
        ],
      }),
    ).rejects.toBeInstanceOf(LedgerError);
  });

  it("is idempotent on id but refuses conflicting reposts", async () => {
    const ledger = new Ledger();
    const tx = {
      id: "t1",
      at: new Date(),
      kind: "x",
      postings: [
        { account: "a", asset: "SOL", amount: 5n },
        { account: "b", asset: "SOL", amount: -5n },
      ],
    };
    expect(await ledger.post(tx)).toBe(true);
    expect(await ledger.post(tx)).toBe(false);
    expect(await ledger.balance("a", "SOL")).toBe(5n);
    await expect(
      ledger.post({ ...tx, postings: [tx.postings[0]!, { account: "c", asset: "SOL", amount: -5n }] }),
    ).rejects.toThrow(/different postings/);
  });
});

describe("SolverBooks", () => {
  it("rounds SOL draws up so treasuries never under-pay", () => {
    // $1 at $3/SOL = 0.333.. SOL
    expect(microUsdToLamports(1_000_000n, 3)).toBe(333_333_334n);
  });

  it("tracks fees in, spend out by category, runway and reconciliation", async () => {
    const books = new SolverBooks(new Ledger());
    await books.feeClaim({ mint: MINT, lamports: 2n * LAMPORTS_PER_SOL, chainTx: "sig1" });
    await books.feeClaim({ mint: MINT, lamports: 2n * LAMPORTS_PER_SOL, chainTx: "sig1" }); // replay
    await books.computeSpend({ id: "gen-1", mint: MINT, category: "llm", usd: 10, solUsd: 100 });
    await books.computeSpend({ id: "bb-1", mint: MINT, category: "browser", usd: 5, solUsd: 100 });

    const s = await books.summary(MINT, { solUsd: 100, burnUsdPerHour: 5 });
    expect(s.feesSol).toBe(2);
    expect(s.spendUsd).toEqual({ llm: 10, browser: 5, sandbox: 0, gas: 0 });
    expect(s.totalSpendUsd).toBe(15);
    expect(s.treasurySol).toBeCloseTo(1.85);
    expect(s.remainingUsd).toBeCloseTo(185);
    expect(s.runwayHours).toBeCloseTo(37);

    const r = await books.reconcile(MINT, 1_850_000_000n);
    expect(r.diff).toBe(0n);
  });

  it("keeps the platform side balanced", async () => {
    const ledger = new Ledger();
    const books = new SolverBooks(ledger);
    await books.feeClaim({ mint: MINT, lamports: LAMPORTS_PER_SOL, chainTx: "s" });
    await books.computeSpend({ id: "x", mint: MINT, category: "sandbox", usd: 1.5, solUsd: 150 });
    expect(await ledger.balance(acct.fronted, "USD")).toBe(-1_500_000n);
    expect(await ledger.balance(acct.reimbursed, "SOL")).toBe(10_000_000n);
  });
});

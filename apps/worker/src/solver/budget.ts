/**
 * Spend policy. Unlike a fixed $0.50 cap, per-stretch limits scale with the coin's
 * treasury so a well-funded coin actually buys compute, while a small one cannot
 * drain itself in one loop.
 */
export interface BudgetPolicy {
  wakeUsd: number;
  keepUsd: number;
  minStretchUsd: number;
  maxStretchUsd: number;
  /** Fraction of remaining compute one stretch may use. */
  stretchFraction: number;
  maxTurns: number;
  maxMs: number;
}

export const DEFAULT_POLICY: BudgetPolicy = {
  wakeUsd: 5,
  keepUsd: 0.25,
  minStretchUsd: 0.5,
  maxStretchUsd: 25,
  stretchFraction: 0.02,
  maxTurns: 40,
  maxMs: 10 * 60_000,
};

export function stretchCap(remainingUsd: number, p: BudgetPolicy = DEFAULT_POLICY): number {
  const scaled = Math.min(p.maxStretchUsd, Math.max(p.minStretchUsd, remainingUsd * p.stretchFraction));
  return Math.min(scaled, remainingUsd);
}

export function shouldRun(remainingUsd: number, awake: boolean, p: BudgetPolicy = DEFAULT_POLICY): boolean {
  return awake ? remainingUsd >= p.keepUsd : remainingUsd >= p.wakeUsd;
}

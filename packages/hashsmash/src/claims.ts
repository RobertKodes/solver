import { NOMINAL_LOG2, type Target } from "./targets.js";

/** Subset of HashSmash claim-frontier-v3 we generate and check. */
export interface ClaimJson {
  schema_version: 3;
  submission_state: "draft" | "ready";
  target_profile: string;
  attack_class: "ordinary-collision";
  rounds: number;
  lane: "exploratory" | "rigorous";
  claim: {
    time_log2: number;
    time_unit: "target-compressions";
    memory_log2_bytes: number;
    preprocessing_log2: number;
    success_probability: number;
    nonuniform_advice_log2_bytes: number;
  };
  restrictions: string[];
  baseline_improved: string;
  heuristics: {
    id: string;
    statement: string;
    role: "score-critical" | "supporting";
    scope: string;
    extrapolation: string;
    evidence_ids: string[];
    limitations: string;
  }[];
  certificate_manifest?: string;
}

export function intake(claim: ClaimJson, target: Target, proofMd: string): string[] {
  const p: string[] = [];
  const c = claim.claim;
  if (claim.schema_version !== 3) p.push("schema_version must be 3");
  if (claim.target_profile !== target.id) p.push("target_profile does not match the coin's target");
  if (claim.rounds !== target.rounds) p.push(`rounds must be ${target.rounds}`);
  if (claim.attack_class !== "ordinary-collision") p.push("only ordinary collisions are scored");
  for (const [k, v] of Object.entries(c)) if (typeof v === "number" && !Number.isFinite(v)) p.push(`${k} must be finite`);
  if (!(c.time_log2 > 0)) p.push("time_log2 must be positive");
  if (c.success_probability < 0.39 || c.success_probability > 1) p.push("success_probability must be in [0.39, 1]");
  if (c.preprocessing_log2 > c.time_log2) p.push("preprocessing_log2 may not exceed time_log2");
  if (!claim.baseline_improved.startsWith(target.id.replace("-prefix-v1", ""))) p.push("baseline_improved must name the target's nominal");
  for (const h of claim.heuristics) if (!h.evidence_ids.length) p.push(`heuristic ${h.id} has no evidence`);
  if (proofMd.trim().length < 800) p.push("proof.md is too short to be self-contained");
  return p;
}

/** Score breakdown under collision-frontier-v5: compressions + other ops / C. */
export function costBreakdown(target: Target, compressions: number, otherOps: number) {
  const total = compressions + otherOps / target.referenceOpCost;
  return { compressions, otherOpsInUnits: otherOps / target.referenceOpCost, total, timeLog2: Math.log2(total), nominal: NOMINAL_LOG2 };
}

export interface Incumbent {
  timeLog2: number;
  by: string;
  ref: string;
}

/** Published results we must never re-submit as new work. */
export const KNOWN_RESULTS: { target: string; timeLog2: number; source: string }[] = [
  { target: "sha256-r31-prefix-v1", timeLog2: 49.8, source: "Li, Liu, Wang — EUROCRYPT 2024" },
];

export type GateDecision =
  | { submit: true }
  | { submit: false; status: "draft" | "reproduction" | "not_better"; reason: string };

export function submissionGate(args: {
  claim: ClaimJson;
  target: Target;
  problems: string[];
  criticPassed: boolean;
  incumbent: Incumbent | null;
}): GateDecision {
  const { claim, target, problems, criticPassed, incumbent } = args;
  if (target.status !== "open") return { submit: false, status: "draft", reason: `track is ${target.status}` };
  if (problems.length) return { submit: false, status: "draft", reason: problems.join("; ") };
  const t = claim.claim.time_log2;
  const known = KNOWN_RESULTS.find((k) => k.target === target.id && Math.abs(k.timeLog2 - t) < 0.05);
  if (known) return { submit: false, status: "reproduction", reason: `matches ${known.source}` };
  if (!criticPassed) return { submit: false, status: "draft", reason: "independent critic did not pass it" };
  const bar = incumbent?.timeLog2 ?? NOMINAL_LOG2;
  if (!(t < bar)) return { submit: false, status: "not_better", reason: `${t} does not beat incumbent ${bar}` };
  return { submit: true };
}

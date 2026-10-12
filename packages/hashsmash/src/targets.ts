import { sha256Rounds } from "./sha256.js";

export type TrackStatus = "open" | "closed" | "unregistered";

export interface Target {
  id: string;
  primitive: "SHA-256" | "SHA3-256" | "BLAKE3" | "Keccak[800]";
  rounds: number;
  fullRounds: number;
  /** C: reference op cost of one target compression (collision-frontier-v5). */
  referenceOpCost: number;
  status: TrackStatus;
  /** Present when we ship a reference implementation for local tools. */
  hash?: (msg: Uint8Array) => Uint8Array;
}

const sha = (r: number) => (m: Uint8Array) => sha256Rounds(m, r);

// Status mirrors docs/FRONTIER_LANES.md (Oct 2026). The worker refreshes it from
// `yukon trace status`; this is the offline default.
export const TARGETS: Target[] = [
  { id: "sha256-r31-prefix-v1", primitive: "SHA-256", rounds: 31, fullRounds: 64, referenceOpCost: 2140, status: "closed", hash: sha(31) },
  { id: "sha256-r32-prefix-v1", primitive: "SHA-256", rounds: 32, fullRounds: 64, referenceOpCost: 2224, status: "closed", hash: sha(32) },
  { id: "sha256-r37-prefix-v1", primitive: "SHA-256", rounds: 37, fullRounds: 64, referenceOpCost: 2644, status: "open", hash: sha(37) },
  { id: "sha256-r38-prefix-v1", primitive: "SHA-256", rounds: 38, fullRounds: 64, referenceOpCost: 2728, status: "open", hash: sha(38) },
  { id: "sha3-256-r5-prefix-v1", primitive: "SHA3-256", rounds: 5, fullRounds: 24, referenceOpCost: 1355, status: "open" },
  { id: "sha3-256-r6-prefix-v1", primitive: "SHA3-256", rounds: 6, fullRounds: 24, referenceOpCost: 1626, status: "open" },
  { id: "blake3-r1-prefix-v1", primitive: "BLAKE3", rounds: 1, fullRounds: 7, referenceOpCost: 222, status: "open" },
  { id: "blake3-r2-prefix-v1", primitive: "BLAKE3", rounds: 2, fullRounds: 7, referenceOpCost: 430, status: "open" },
  { id: "keccak800-r5-prefix-v1", primitive: "Keccak[800]", rounds: 5, fullRounds: 22, referenceOpCost: 1355, status: "unregistered" },
];

export const NOMINAL_LOG2 = 128;

export function getTarget(id: string): Target {
  const t = TARGETS.find((x) => x.id === id);
  if (!t) throw new Error(`unknown target ${id}`);
  return t;
}

export const launchableTargets = () => TARGETS.filter((t) => t.status === "open");

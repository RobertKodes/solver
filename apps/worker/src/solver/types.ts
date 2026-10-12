import type { ClaimJson } from "@solver/hashsmash";

export interface Coin {
  mint: string;
  symbol: string;
  targetId: string;
  lane: "exploratory" | "rigorous";
  modelId: string;
  approach: string;
  treasury: string;
}

export interface StoredClaim {
  id: string;
  mint: string;
  title: string;
  claim: ClaimJson;
  proofMd: string;
  certificate?: { a: string; b: string; digest: string };
  status: "draft" | "ready" | "reproduction" | "not_better" | "submitted";
  problems: string[];
  createdAt: Date;
}

export interface Memory {
  mint: string | null; // null = shared across the track
  targetId: string;
  text: string;
  at: Date;
}

/** Persistence the runtime needs. MemoryStore for dev/tests; Postgres in prod. */
export interface Store {
  addClaim(c: StoredClaim): Promise<void>;
  claims(mint: string): Promise<StoredClaim[]>;
  remember(m: Memory): Promise<void>;
  recall(targetId: string, mint: string, query: string, limit: number): Promise<Memory[]>;
  note(mint: string, text: string): Promise<void>;
}

/** Literature browser (Browserbase / E2B desktop). Optional: the solver works without it. */
export interface BrowserDriver {
  navigate(url: string): Promise<string>;
  read(): Promise<string>;
  /** Latest screenshot as a data URL, attached to the span for replay. */
  lastFrame?: string | null;
}

/** Sandboxed code runner for real experiments (E2B, networkless). */
export interface ExperimentRunner {
  run(code: string): Promise<{ stdout: string; stderr: string; error: string | null; seconds: number }>;
}

import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  vector,
} from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const trackStatus = pgEnum("track_status", ["open", "closed", "unregistered"]);
export const lane = pgEnum("lane", ["exploratory", "rigorous"]);
export const coinStatus = pgEnum("coin_status", ["pending", "live", "failed"]);
export const solverStatus = pgEnum("solver_status", ["asleep", "waking", "running", "paused"]);
export const claimStatus = pgEnum("claim_status", [
  "draft",
  "ready",
  "reproduction",
  "submitted",
  "in_review",
  "plausible_not_refuted",
  "ai_rigor_qualified",
  "not_qualified",
  "refuted",
]);

/** HashSmash target profiles, mirrored from the organizer's repo. */
export const targets = pgTable("targets", {
  id: text("id").primaryKey(), // e.g. sha256-r37-prefix-v1
  primitive: text("primitive").notNull(),
  rounds: integer("rounds").notNull(),
  fullRounds: integer("full_rounds").notNull(),
  referenceOpCost: integer("reference_op_cost").notNull(), // C in collision-frontier-v5
  nominalLog2: doublePrecision("nominal_log2").notNull().default(128),
  literature: jsonb("literature").$type<{ title: string; url: string }[]>().notNull().default([]),
  syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
});

/** A target × lane pair; only `open` tracks can be launched against. */
export const tracks = pgTable("tracks", {
  id: text("id").primaryKey(), // e.g. sha256-r37-exploratory
  targetId: text("target_id").notNull().references(() => targets.id),
  lane: lane("lane").notNull(),
  status: trackStatus("status").notNull(),
  incumbentLog2: doublePrecision("incumbent_log2"),
  incumbentBy: text("incumbent_by"),
  incumbentRef: text("incumbent_ref"),
  syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
});

export const coins = pgTable(
  "coins",
  {
    mint: text("mint").primaryKey(),
    name: text("name").notNull(),
    symbol: text("symbol").notNull(),
    description: text("description").notNull().default(""),
    imageUrl: text("image_url"),
    metadataUri: text("metadata_uri"),
    launcher: text("launcher").notNull(),
    /** On-chain fee-sharing treasury; the platform holds no key to it. */
    treasury: text("treasury").notNull(),
    trackId: text("track_id").notNull().references(() => tracks.id),
    modelId: text("model_id").notNull(),
    approach: text("approach").notNull().default(""),
    quote: text("quote").notNull().default("SOL"),
    status: coinStatus("status").notNull().default("pending"),
    solverStatus: solverStatus("solver_status").notNull().default("asleep"),
    launchSig: text("launch_sig"),
    createdAt: createdAt(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  },
  (t) => [index("coins_track_idx").on(t.trackId)],
);

/** One waking period of a solver ("stretch"); the root span of its trace. */
export const runs = pgTable(
  "runs",
  {
    id: text("id").primaryKey(), // = root span id
    mint: text("mint").notNull().references(() => coins.mint),
    requestedModel: text("requested_model").notNull(),
    servedModels: text("served_models").array().notNull().default(sql`'{}'::text[]`),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    status: text("status").notNull().default("running"),
    costUsd: doublePrecision("cost_usd").notNull().default(0),
    summary: text("summary"),
    sessionId: text("session_id"),
  },
  (t) => [index("runs_mint_started_idx").on(t.mint, t.startedAt)],
);

/** Every span of every trace: the trace explorer reads straight from here. */
export const spans = pgTable(
  "spans",
  {
    id: text("id").primaryKey(),
    traceId: text("trace_id").notNull(),
    parentId: text("parent_id"),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    status: text("status").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true, precision: 3 }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true, precision: 3 }),
    attrs: jsonb("attrs").$type<Record<string, unknown>>().notNull().default({}),
    input: jsonb("input"),
    output: jsonb("output"),
    error: text("error"),
    costUsd: doublePrecision("cost_usd").notNull().default(0),
    totalCostUsd: doublePrecision("total_cost_usd").notNull().default(0),
    promptTokens: integer("prompt_tokens").notNull().default(0),
    completionTokens: integer("completion_tokens").notNull().default(0),
  },
  (t) => [
    index("spans_trace_idx").on(t.traceId, t.startedAt),
    index("spans_parent_idx").on(t.parentId),
    index("spans_kind_idx").on(t.kind),
  ],
);

export const experiments = pgTable("experiments", {
  id: text("id").primaryKey(),
  mint: text("mint").notNull().references(() => coins.mint),
  spanId: text("span_id"),
  hypothesis: text("hypothesis"),
  outcome: text("outcome"), // open | killed | confirmed
  params: jsonb("params").notNull().default({}),
  result: jsonb("result"),
  cpuSeconds: doublePrecision("cpu_seconds").notNull().default(0),
  createdAt: createdAt(),
});

export const claims = pgTable(
  "claims",
  {
    id: text("id").primaryKey(),
    mint: text("mint").notNull().references(() => coins.mint),
    trackId: text("track_id").notNull().references(() => tracks.id),
    title: text("title").notNull(),
    timeLog2: doublePrecision("time_log2").notNull(),
    status: text("status").notNull().default("draft"),
    claimJson: jsonb("claim_json").notNull(),
    proofMd: text("proof_md").notNull(),
    certificateManifest: jsonb("certificate_manifest"),
    certificateVerified: boolean("certificate_verified").notNull().default(false),
    intakeProblems: jsonb("intake_problems").$type<string[]>().notNull().default([]),
    createdAt: createdAt(),
  },
  (t) => [index("claims_track_score_idx").on(t.trackId, t.timeLog2)],
);

export const submissions = pgTable("submissions", {
  id: text("id").primaryKey(),
  claimId: text("claim_id").notNull().references(() => claims.id),
  prUrl: text("pr_url"),
  yukonStatus: text("yukon_status"),
  verdict: text("verdict"),
  disclosure: jsonb("disclosure").notNull(), // model + harness actually used
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Solver notebook. `mint` null = shared across every coin on the same target. */
export const memories = pgTable(
  "memories",
  {
    id: text("id").primaryKey(),
    targetId: text("target_id").notNull().references(() => targets.id),
    mint: text("mint").references(() => coins.mint),
    text: text("text").notNull(),
    embedding: vector("embedding", { dimensions: 1536 }),
    createdAt: createdAt(),
  },
  (t) => [index("memories_target_idx").on(t.targetId, t.mint)],
);

/** Public solver notes ("note" tool) and model-swap notices shown on the coin page. */
export const notes = pgTable(
  "notes",
  {
    id: text("id").primaryKey(),
    mint: text("mint").notNull().references(() => coins.mint),
    text: text("text").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("notes_mint_idx").on(t.mint, t.createdAt)],
);

export const ledgerTxs = pgTable("ledger_txs", {
  id: text("id").primaryKey(),
  at: timestamp("at", { withTimezone: true }).notNull(),
  kind: text("kind").notNull(),
  memo: text("memo"),
  ref: jsonb("ref"),
  meta: jsonb("meta"),
});

export const ledgerPostings = pgTable(
  "ledger_postings",
  {
    txId: text("tx_id")
      .notNull()
      .references(() => ledgerTxs.id),
    seq: integer("seq").notNull(),
    account: text("account").notNull(),
    asset: text("asset").notNull(),
    amount: bigint("amount", { mode: "bigint" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.txId, t.seq] }), index("postings_account_idx").on(t.account, t.asset)],
);

export const priceTicks = pgTable(
  "price_ticks",
  {
    asset: text("asset").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull(),
    usd: doublePrecision("usd").notNull(),
    source: text("source").notNull(),
  },
  (t) => [primaryKey({ columns: [t.asset, t.at] })],
);

/** Recorded browser / sandbox sessions for replay. */
export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  runId: text("run_id").references(() => runs.id),
  kind: text("kind").notNull(), // browser | sandbox
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  chunks: jsonb("chunks").$type<{ url: string; from: number; to: number }[]>().notNull().default([]),
});

export const alertSubscriptions = pgTable(
  "alert_subscriptions",
  {
    id: text("id").primaryKey(),
    mint: text("mint").references(() => coins.mint),
    channel: text("channel").notNull(), // telegram | discord | webhook
    target: text("target").notNull(),
    events: text("events").array().notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("alert_sub_unique").on(t.mint, t.channel, t.target)],
);

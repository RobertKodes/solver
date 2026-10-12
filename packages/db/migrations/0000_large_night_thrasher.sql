CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TYPE "public"."claim_status" AS ENUM('draft', 'ready', 'reproduction', 'submitted', 'in_review', 'plausible_not_refuted', 'ai_rigor_qualified', 'not_qualified', 'refuted');--> statement-breakpoint
CREATE TYPE "public"."coin_status" AS ENUM('pending', 'live', 'failed');--> statement-breakpoint
CREATE TYPE "public"."lane" AS ENUM('exploratory', 'rigorous');--> statement-breakpoint
CREATE TYPE "public"."solver_status" AS ENUM('asleep', 'waking', 'running', 'paused');--> statement-breakpoint
CREATE TYPE "public"."track_status" AS ENUM('open', 'closed', 'unregistered');--> statement-breakpoint
CREATE TABLE "alert_subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"mint" text,
	"channel" text NOT NULL,
	"target" text NOT NULL,
	"events" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claims" (
	"id" text PRIMARY KEY NOT NULL,
	"mint" text NOT NULL,
	"track_id" text NOT NULL,
	"title" text NOT NULL,
	"time_log2" double precision NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"claim_json" jsonb NOT NULL,
	"proof_md" text NOT NULL,
	"certificate_manifest" jsonb,
	"certificate_verified" boolean DEFAULT false NOT NULL,
	"intake_problems" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coins" (
	"mint" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"symbol" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"image_url" text,
	"metadata_uri" text,
	"launcher" text NOT NULL,
	"treasury" text NOT NULL,
	"track_id" text NOT NULL,
	"model_id" text NOT NULL,
	"approach" text DEFAULT '' NOT NULL,
	"quote" text DEFAULT 'SOL' NOT NULL,
	"status" "coin_status" DEFAULT 'pending' NOT NULL,
	"solver_status" "solver_status" DEFAULT 'asleep' NOT NULL,
	"launch_sig" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "experiments" (
	"id" text PRIMARY KEY NOT NULL,
	"mint" text NOT NULL,
	"span_id" text,
	"hypothesis" text,
	"outcome" text,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result" jsonb,
	"cpu_seconds" double precision DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_postings" (
	"tx_id" text NOT NULL,
	"seq" integer NOT NULL,
	"account" text NOT NULL,
	"asset" text NOT NULL,
	"amount" bigint NOT NULL,
	CONSTRAINT "ledger_postings_tx_id_seq_pk" PRIMARY KEY("tx_id","seq")
);
--> statement-breakpoint
CREATE TABLE "ledger_txs" (
	"id" text PRIMARY KEY NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"kind" text NOT NULL,
	"memo" text,
	"ref" jsonb,
	"meta" jsonb
);
--> statement-breakpoint
CREATE TABLE "memories" (
	"id" text PRIMARY KEY NOT NULL,
	"target_id" text NOT NULL,
	"mint" text,
	"text" text NOT NULL,
	"embedding" vector(1536),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" text PRIMARY KEY NOT NULL,
	"mint" text NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_ticks" (
	"asset" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"usd" double precision NOT NULL,
	"source" text NOT NULL,
	CONSTRAINT "price_ticks_asset_at_pk" PRIMARY KEY("asset","at")
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" text PRIMARY KEY NOT NULL,
	"mint" text NOT NULL,
	"requested_model" text NOT NULL,
	"served_models" text[] DEFAULT '{}'::text[] NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"status" text DEFAULT 'running' NOT NULL,
	"cost_usd" double precision DEFAULT 0 NOT NULL,
	"summary" text,
	"session_id" text
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text,
	"kind" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"chunks" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spans" (
	"id" text PRIMARY KEY NOT NULL,
	"trace_id" text NOT NULL,
	"parent_id" text,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp (3) with time zone NOT NULL,
	"ended_at" timestamp (3) with time zone,
	"attrs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"input" jsonb,
	"output" jsonb,
	"error" text,
	"cost_usd" double precision DEFAULT 0 NOT NULL,
	"total_cost_usd" double precision DEFAULT 0 NOT NULL,
	"prompt_tokens" integer DEFAULT 0 NOT NULL,
	"completion_tokens" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" text PRIMARY KEY NOT NULL,
	"claim_id" text NOT NULL,
	"pr_url" text,
	"yukon_status" text,
	"verdict" text,
	"disclosure" jsonb NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "targets" (
	"id" text PRIMARY KEY NOT NULL,
	"primitive" text NOT NULL,
	"rounds" integer NOT NULL,
	"full_rounds" integer NOT NULL,
	"reference_op_cost" integer NOT NULL,
	"nominal_log2" double precision DEFAULT 128 NOT NULL,
	"literature" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tracks" (
	"id" text PRIMARY KEY NOT NULL,
	"target_id" text NOT NULL,
	"lane" "lane" NOT NULL,
	"status" "track_status" NOT NULL,
	"incumbent_log2" double precision,
	"incumbent_by" text,
	"incumbent_ref" text,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alert_subscriptions" ADD CONSTRAINT "alert_subscriptions_mint_coins_mint_fk" FOREIGN KEY ("mint") REFERENCES "public"."coins"("mint") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_mint_coins_mint_fk" FOREIGN KEY ("mint") REFERENCES "public"."coins"("mint") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coins" ADD CONSTRAINT "coins_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiments" ADD CONSTRAINT "experiments_mint_coins_mint_fk" FOREIGN KEY ("mint") REFERENCES "public"."coins"("mint") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_postings" ADD CONSTRAINT "ledger_postings_tx_id_ledger_txs_id_fk" FOREIGN KEY ("tx_id") REFERENCES "public"."ledger_txs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_target_id_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."targets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_mint_coins_mint_fk" FOREIGN KEY ("mint") REFERENCES "public"."coins"("mint") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_mint_coins_mint_fk" FOREIGN KEY ("mint") REFERENCES "public"."coins"("mint") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_mint_coins_mint_fk" FOREIGN KEY ("mint") REFERENCES "public"."coins"("mint") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracks" ADD CONSTRAINT "tracks_target_id_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."targets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "alert_sub_unique" ON "alert_subscriptions" USING btree ("mint","channel","target");--> statement-breakpoint
CREATE INDEX "claims_track_score_idx" ON "claims" USING btree ("track_id","time_log2");--> statement-breakpoint
CREATE INDEX "coins_track_idx" ON "coins" USING btree ("track_id");--> statement-breakpoint
CREATE INDEX "postings_account_idx" ON "ledger_postings" USING btree ("account","asset");--> statement-breakpoint
CREATE INDEX "memories_target_idx" ON "memories" USING btree ("target_id","mint");--> statement-breakpoint
CREATE INDEX "notes_mint_idx" ON "notes" USING btree ("mint","created_at");--> statement-breakpoint
CREATE INDEX "runs_mint_started_idx" ON "runs" USING btree ("mint","started_at");--> statement-breakpoint
CREATE INDEX "spans_trace_idx" ON "spans" USING btree ("trace_id","started_at");--> statement-breakpoint
CREATE INDEX "spans_parent_idx" ON "spans" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "spans_kind_idx" ON "spans" USING btree ("kind");
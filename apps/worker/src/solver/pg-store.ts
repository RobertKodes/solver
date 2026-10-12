import { randomUUID } from "node:crypto";
import { schema, type Db } from "@solver/db";
import { TARGETS, type ClaimJson } from "@solver/hashsmash";
import { and, asc, desc, eq, isNull, or, sql } from "drizzle-orm";
import type { Coin, Memory, Store, StoredClaim } from "./types.js";

const { claims, coins, memories, notes, targets, tracks } = schema;

/** Postgres-backed solver store. Call `ensureCoin` before running a coin's solver. */
export class PgStore implements Store {
  constructor(private readonly db: Db) {}

  async syncTargets() {
    for (const t of TARGETS) {
      const row = { id: t.id, primitive: t.primitive, rounds: t.rounds, fullRounds: t.fullRounds, referenceOpCost: t.referenceOpCost };
      await this.db.insert(targets).values(row).onConflictDoUpdate({ target: targets.id, set: row });
      for (const lane of ["exploratory", "rigorous"] as const) {
        const id = `${t.id.replace("-prefix-v1", "")}-${lane}`;
        const tr = { id, targetId: t.id, lane, status: t.status };
        await this.db.insert(tracks).values(tr).onConflictDoUpdate({ target: tracks.id, set: { status: t.status } });
      }
    }
  }

  async ensureCoin(c: Coin & { name?: string; launcher?: string }) {
    await this.db
      .insert(coins)
      .values({
        mint: c.mint, name: c.name ?? c.symbol, symbol: c.symbol, launcher: c.launcher ?? "unknown", treasury: c.treasury,
        trackId: `${c.targetId.replace("-prefix-v1", "")}-${c.lane}`, modelId: c.modelId, approach: c.approach, status: "live",
      })
      .onConflictDoNothing();
  }

  async addClaim(c: StoredClaim) {
    await this.db.insert(claims).values({
      id: c.id, mint: c.mint, trackId: `${c.claim.target_profile.replace("-prefix-v1", "")}-${c.claim.lane}`,
      title: c.title, timeLog2: c.claim.claim.time_log2, status: c.status, claimJson: c.claim, proofMd: c.proofMd,
      certificateManifest: c.certificate ?? null, certificateVerified: !!c.certificate, intakeProblems: c.problems, createdAt: c.createdAt,
    });
  }

  async claims(mint: string): Promise<StoredClaim[]> {
    const rows = await this.db.select().from(claims).where(eq(claims.mint, mint)).orderBy(asc(claims.timeLog2));
    return rows.map((r) => ({
      id: r.id, mint: r.mint, title: r.title, claim: r.claimJson as ClaimJson, proofMd: r.proofMd,
      certificate: (r.certificateManifest as StoredClaim["certificate"]) ?? undefined,
      status: r.status as StoredClaim["status"], problems: r.intakeProblems, createdAt: r.createdAt,
    }));
  }

  async remember(m: Memory) {
    await this.db.insert(memories).values({ id: randomUUID(), targetId: m.targetId, mint: m.mint, text: m.text, createdAt: m.at });
  }

  /** Full-text match over own + target-shared notes, then recency. pgvector embeddings can replace the ranking later. */
  async recall(targetId: string, mint: string, query: string, limit: number): Promise<Memory[]> {
    const scope = and(eq(memories.targetId, targetId), or(eq(memories.mint, mint), isNull(memories.mint)));
    const order = query.trim()
      ? [desc(sql`ts_rank(to_tsvector('english', ${memories.text}), plainto_tsquery('english', ${query}))`), desc(memories.createdAt)]
      : [desc(memories.createdAt)];
    const rows = await this.db.select().from(memories).where(scope).orderBy(...order).limit(limit);
    return rows.map((r) => ({ mint: r.mint, targetId: r.targetId, text: r.text, at: r.createdAt }));
  }

  async note(mint: string, text: string) {
    await this.db.insert(notes).values({ id: randomUUID(), mint, text });
  }

  async recentNotes(mint: string, limit = 50) {
    return this.db.select().from(notes).where(eq(notes.mint, mint)).orderBy(desc(notes.createdAt)).limit(limit);
  }
}

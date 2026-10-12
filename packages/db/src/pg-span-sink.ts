import type { SpanRecord, SpanSink } from "@solver/trace";
import type { Db } from "./client.js";
import { spans } from "./schema.js";

function toRow(s: Readonly<SpanRecord>) {
  return {
    id: s.id,
    traceId: s.traceId,
    parentId: s.parentId,
    kind: s.kind,
    name: s.name,
    status: s.status,
    startedAt: new Date(s.startedAt),
    endedAt: s.endedAt === null ? null : new Date(s.endedAt),
    attrs: s.attrs,
    input: s.input ?? null,
    output: s.output ?? null,
    error: s.error ?? null,
    costUsd: s.costUsd,
    totalCostUsd: s.totalCostUsd,
    promptTokens: s.tokens.prompt,
    completionTokens: s.tokens.completion,
  };
}

/** Persists every span so traces survive restarts and can be replayed. */
export class PgSpanSink implements SpanSink {
  constructor(private readonly db: Db) {}

  async onStart(span: Readonly<SpanRecord>) {
    await this.db.insert(spans).values(toRow(span)).onConflictDoNothing();
  }

  async onEnd(span: Readonly<SpanRecord>) {
    const row = toRow(span);
    await this.db.insert(spans).values(row).onConflictDoUpdate({ target: spans.id, set: row });
  }
}

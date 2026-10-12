import type { Memory, Store, StoredClaim } from "./types.js";

export class MemoryStore implements Store {
  readonly claimList: StoredClaim[] = [];
  readonly memories: Memory[] = [];
  readonly notes: { mint: string; text: string; at: Date }[] = [];

  async addClaim(c: StoredClaim) {
    this.claimList.push(c);
  }

  async claims(mint: string) {
    return this.claimList.filter((c) => c.mint === mint).sort((a, b) => a.claim.claim.time_log2 - b.claim.claim.time_log2);
  }

  async remember(m: Memory) {
    this.memories.push(m);
  }

  /** Own notes plus track-shared notes; keyword match first, then recency. */
  async recall(targetId: string, mint: string, query: string, limit: number) {
    const words = query.toLowerCase().split(/\W+/).filter(Boolean);
    return this.memories
      .filter((m) => m.targetId === targetId && (m.mint === mint || m.mint === null))
      .map((m) => ({ m, score: words.filter((w) => m.text.toLowerCase().includes(w)).length }))
      .sort((a, b) => b.score - a.score || b.m.at.getTime() - a.m.at.getTime())
      .slice(0, limit)
      .map((x) => x.m);
  }

  async note(mint: string, text: string) {
    this.notes.push({ mint, text, at: new Date() });
  }
}

import { randomBytes } from "node:crypto";
import type { Target } from "./targets.js";

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");

export interface CollisionCheck {
  ok: boolean;
  reason?: string;
  digest?: string;
}

/** Same rules as the organizer's certificate checker. */
export function verifyCollision(target: Target, a: Uint8Array, b: Uint8Array): CollisionCheck {
  if (!target.hash) return { ok: false, reason: `no local reference for ${target.id}` };
  if (Buffer.compare(a, b) === 0) return { ok: false, reason: "messages are equal" };
  const da = hex(target.hash(a));
  const db = hex(target.hash(b));
  return da === db ? { ok: true, digest: da } : { ok: false, reason: "digests differ" };
}

export interface BirthdayResult {
  found: boolean;
  samples: number;
  log2Samples: number;
  /** log2 of samples a random function needs on average: (bits+1)/2 roughly. */
  log2Expected: number;
  pair?: [string, string];
}

/** Bounded truncated-collision search: hash prefix+counter, bucket on the first `bits` bits. */
export function birthday(
  hash: (m: Uint8Array) => Uint8Array,
  bits: number,
  opts: { maxSamples?: number; prefix?: Uint8Array } = {},
): BirthdayResult {
  if (bits < 1 || bits > 48) throw new RangeError("bits must be 1..48");
  const max = opts.maxSamples ?? 300_000;
  const prefix = opts.prefix ?? randomBytes(16);
  const seen = new Map<number, number>();
  const msg = (i: number) => {
    const m = new Uint8Array(prefix.length + 8);
    m.set(prefix);
    new DataView(m.buffer).setBigUint64(prefix.length, BigInt(i));
    return m;
  };
  const key = (d: Uint8Array) => {
    let v = 0;
    for (let i = 0; i < 6; i++) v = v * 256 + d[i]!;
    return Math.floor(v / 2 ** (48 - bits));
  };
  const expected = Math.log2(Math.sqrt((Math.PI / 2) * 2 ** bits));
  for (let i = 0; i < max; i++) {
    const k = key(hash(msg(i)));
    const j = seen.get(k);
    if (j !== undefined) {
      return { found: true, samples: i + 1, log2Samples: Math.log2(i + 1), log2Expected: expected, pair: [hex(msg(j)), hex(msg(i))] };
    }
    seen.set(k, i);
  }
  return { found: false, samples: max, log2Samples: Math.log2(max), log2Expected: expected };
}

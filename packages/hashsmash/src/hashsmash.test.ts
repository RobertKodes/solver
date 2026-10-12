import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { getTarget, sha256Rounds, birthday, verifyCollision, submissionGate, intake, type ClaimJson } from "./index.js";

const enc = (s: string) => new TextEncoder().encode(s);

describe("sha256Rounds", () => {
  it("equals real SHA-256 at 64 rounds, incl. multi-block", () => {
    for (const s of ["", "abc", "x".repeat(55), "y".repeat(56), "z".repeat(200)]) {
      expect(Buffer.from(sha256Rounds(enc(s), 64)).toString("hex")).toBe(createHash("sha256").update(s).digest("hex"));
    }
  });

  it("at 1 round only W0 matters, so messages differing later collide", () => {
    const a = new Uint8Array(32), b = new Uint8Array(32);
    b[20] = 1;
    expect(verifyCollision({ ...getTarget("sha256-r37-prefix-v1"), hash: (m) => sha256Rounds(m, 1) }, a, b).ok).toBe(true);
  });
});

describe("tools", () => {
  it("birthday finds a 20-bit truncated collision near the random-function bound", () => {
    const r = birthday((m) => sha256Rounds(m, 20), 20, { prefix: new Uint8Array(16) });
    expect(r.found).toBe(true);
    expect(Math.abs(r.log2Samples - r.log2Expected)).toBeLessThan(3);
  });

  it("verifyCollision rejects equal messages", () => {
    expect(verifyCollision(getTarget("sha256-r37-prefix-v1"), enc("a"), enc("a")).reason).toBe("messages are equal");
  });
});

describe("submission gate", () => {
  const target = getTarget("sha256-r37-prefix-v1");
  const claim = (t: number): ClaimJson => ({
    schema_version: 3, submission_state: "ready", target_profile: target.id, attack_class: "ordinary-collision",
    rounds: 37, lane: "exploratory",
    claim: { time_log2: t, time_unit: "target-compressions", memory_log2_bytes: 20, preprocessing_log2: 10, success_probability: 0.5, nonuniform_advice_log2_bytes: 0 },
    restrictions: [], baseline_improved: "sha256-r37-nominal-v2", heuristics: [],
  });
  const proof = "p".repeat(900);

  it("passes intake for a well-formed claim", () => expect(intake(claim(50), target, proof)).toEqual([]));

  it("refuses closed tracks, reproductions and non-improvements", () => {
    const r31 = getTarget("sha256-r31-prefix-v1");
    expect(submissionGate({ claim: { ...claim(49.8), target_profile: r31.id, rounds: 31 }, target: { ...r31, status: "open" }, problems: [], criticPassed: true, incumbent: null }))
      .toMatchObject({ submit: false, status: "reproduction" });
    expect(submissionGate({ claim: claim(50), target: r31, problems: [], criticPassed: true, incumbent: null })).toMatchObject({ status: "draft" });
    expect(submissionGate({ claim: claim(61), target, problems: [], criticPassed: true, incumbent: { timeLog2: 60.38, by: "x", ref: "pr" } }))
      .toMatchObject({ status: "not_better" });
    expect(submissionGate({ claim: claim(59), target, problems: [], criticPassed: true, incumbent: { timeLog2: 60.38, by: "x", ref: "pr" } }))
      .toEqual({ submit: true });
  });
});

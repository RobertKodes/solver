import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { getTarget, submissionGate, type Incumbent } from "@solver/hashsmash";
import type { StoredClaim } from "./solver/types.js";

const run = promisify(execFile);

export interface SubmitConfig {
  /** Local clone of Layr-Labs/hash-smash with the yukon CLI set up. */
  repoDir: string;
  /** false = write the package and run checks, but never call `yukon submit`. */
  live: boolean;
  harness: string;
}

export interface Critic {
  review(claim: StoredClaim): Promise<{ pass: boolean; notes: string }>;
}

/**
 * draft → intake (already done) → local_tracks check → independent critic →
 * strict improvement over the live incumbent → yukon submit with honest disclosure.
 */
export async function submitPipeline(
  claim: StoredClaim,
  opts: { cfg: SubmitConfig; critic: Critic; incumbent: Incumbent | null; servedModels: string[] },
) {
  const target = getTarget(claim.claim.target_profile);
  const track = `${target.id.replace("-prefix-v1", "")}-${claim.claim.lane}`;
  const review = await opts.critic.review(claim);
  const gate = submissionGate({ claim: claim.claim, target, problems: claim.problems, criticPassed: review.pass, incumbent: opts.incumbent });
  if (!gate.submit) return { submitted: false as const, ...gate, critic: review.notes };

  const dir = join(opts.cfg.repoDir, "lanes", claim.claim.lane, "candidates", target.id);
  await mkdir(join(dir, "certificates"), { recursive: true });
  await writeFile(join(dir, "claim.json"), JSON.stringify({ ...claim.claim, submission_state: "ready" }, null, 2));
  await writeFile(join(dir, "proof.md"), claim.proofMd);
  const manifest = claim.certificate
    ? { certificates: [{ id: "c1", type: "hash-collision-witness-v2", message_a: "certificates/a.bin", message_b: "certificates/b.bin", expected_digest: claim.certificate.digest, target_profile: target.id }] }
    : { certificates: [] };
  if (claim.certificate) {
    await writeFile(join(dir, "certificates", "a.bin"), Buffer.from(claim.certificate.a, "hex"));
    await writeFile(join(dir, "certificates", "b.bin"), Buffer.from(claim.certificate.b, "hex"));
  }
  await writeFile(join(dir, "certificates", "manifest.json"), JSON.stringify(manifest, null, 2));

  await run("python3", ["scripts/local_tracks.py", "check", track], { cwd: opts.cfg.repoDir });
  const disclosure = `Models: ${opts.servedModels.join(", ")}. Harness: ${opts.cfg.harness}.`;
  // Note lives outside the candidate tree, per TASK.md.
  await writeFile(join(opts.cfg.repoDir, "submission-note.md"), disclosure);
  if (!opts.cfg.live) return { submitted: false as const, status: "dry_run" as const, track, disclosure };

  const { stdout } = await run("yukon", ["submit", "--track", track], { cwd: opts.cfg.repoDir });
  return { submitted: true as const, track, disclosure, output: stdout };
}

import { getTarget } from "@solver/hashsmash";

export interface LaunchRequest {
  name: string;
  symbol: string;
  description: string;
  imageCid: string;
  targetId: string;
  lane: "exploratory" | "rigorous";
  modelId: string;
  approach: string;
  initialBuySol: number;
  launcher: string; // wallet pubkey, signs as fee payer
}

export function validateLaunch(r: LaunchRequest, models: Set<string>): string[] {
  const p: string[] = [];
  if (!r.name || r.name.length > 32) p.push("name must be 1-32 chars");
  if (!/^[A-Z0-9]{1,10}$/.test(r.symbol)) p.push("symbol must be 1-10 uppercase letters/digits");
  if (r.description.length > 1000) p.push("description max 1000 chars");
  if (r.approach.length > 800) p.push("approach max 800 chars");
  try {
    if (getTarget(r.targetId).status !== "open") p.push(`${r.targetId} is not an open HashSmash track`);
  } catch { p.push("unknown target"); }
  if (!models.has(r.modelId)) p.push("model is not in the live tool-capable catalog");
  if (!(r.initialBuySol >= 0 && r.initialBuySol <= 50)) p.push("initial buy must be 0-50 SOL");
  return p;
}

/**
 * Builds the unsigned pump.fun create_v2 (+ optional buy) transaction with the coin's
 * creator fees routed through pump's fee-sharing config to `treasury` (a Squads
 * multisig or program PDA — never a key this server holds). Implemented with
 * @pump-fun/pump-sdk against devnet before mainnet; the builder must refuse any
 * transaction whose fee recipients differ from the expected treasury.
 */
export interface PumpLauncher {
  /** Ordered transactions: [create+buy (mint co-signs), fee-sharing setup]. */
  buildLaunchTx(r: LaunchRequest, mint: string, treasury: string): Promise<{ txsBase64: string[] }>;
  confirm(signature: string): Promise<boolean>;
}

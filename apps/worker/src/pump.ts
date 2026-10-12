import { OnlinePumpSdk, PUMP_SDK, getBuyTokenAmountFromSolAmount } from "@pump-fun/pump-sdk";
import { NATIVE_MINT } from "@solana/spl-token";
import { Connection, LAMPORTS_PER_SOL, PublicKey, Transaction } from "@solana/web3.js";
import BN from "bn.js";
import type { FeeCollector } from "./keeper.js";
import type { LaunchRequest, PumpLauncher } from "./launch.js";

/**
 * pump.fun integration via @pump-fun/pump-sdk v4.
 *
 * Launch = create + initial buy + fee-sharing config whose single shareholder is
 * the coin's treasury (100%). The server never holds a key: the launcher's wallet
 * signs as creator/fee payer and the browser-generated mint keypair co-signs.
 * Create+buy+fee-sharing exceeds Solana's 1232-byte limit (measured: 1452), so the
 * launch is two transactions signed together in one wallet prompt: [create+buy] then
 * [fee-sharing config → 100% to treasury]. The coin only goes live once both land.
 */
export class PumpSdkLauncher implements PumpLauncher {
  readonly online: OnlinePumpSdk;
  constructor(readonly conn: Connection, private readonly metadataUri: (r: LaunchRequest) => Promise<string>) {
    this.online = new OnlinePumpSdk(conn);
  }

  async buildLaunchTx(r: LaunchRequest, mintStr: string, treasuryStr: string) {
    const [global, feeConfig] = await Promise.all([this.online.fetchGlobal(), this.online.fetchFeeConfig()]);
    const mint = new PublicKey(mintStr);
    const creator = new PublicKey(r.launcher);
    const treasury = new PublicKey(treasuryStr);
    const solAmount = new BN(Math.round(r.initialBuySol * LAMPORTS_PER_SOL));
    const amount = solAmount.isZero()
      ? new BN(0)
      : getBuyTokenAmountFromSolAmount({ global, feeConfig, mintSupply: null, bondingCurve: null, amount: solAmount, quoteMint: NATIVE_MINT });

    const create = await PUMP_SDK.createAndBuyInstructions({
      global, mint, name: r.name, symbol: r.symbol, uri: await this.metadataUri(r), creator, user: creator, amount, solAmount,
    });
    const sharing = [
      await PUMP_SDK.createFeeSharingConfig({ creator, mint, pool: null }),
      await PUMP_SDK.updateFeeShares({ authority: creator, mint, currentShareholders: [creator], newShareholders: [{ address: treasury, shareBps: 10_000 }] }),
    ];

    const { blockhash } = await this.conn.getLatestBlockhash();
    const ser = (tx: Transaction) => tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
    return {
      txsBase64: [
        ser(new Transaction({ feePayer: creator, recentBlockhash: blockhash }).add(...create)),
        ser(new Transaction({ feePayer: creator, recentBlockhash: blockhash }).add(...sharing)),
      ],
    };
  }

  async confirm(signature: string) {
    const s = await this.conn.getSignatureStatus(signature, { searchTransactionHistory: true });
    return s.value?.confirmationStatus === "confirmed" || s.value?.confirmationStatus === "finalized";
  }
}

/**
 * Collects creator fees into a treasury that is itself the fee recipient, and
 * reports exactly what landed (balance delta), signed by a gas-only keeper key.
 * `sign` is injected so the keeper key can live in a KMS/HSM.
 */
export class PumpFeeCollector implements FeeCollector {
  readonly online: OnlinePumpSdk;
  constructor(
    readonly conn: Connection,
    private readonly keeper: PublicKey,
    private readonly sign: (tx: Transaction) => Promise<Transaction>,
  ) {
    this.online = new OnlinePumpSdk(conn);
  }

  async collect(_mint: string, treasuryStr: string) {
    const treasury = new PublicKey(treasuryStr);
    const ixs = await this.online.collectCoinCreatorFeeInstructions(treasury, this.keeper);
    if (!ixs.length) return null;
    const before = BigInt(await this.conn.getBalance(treasury));
    const { blockhash, lastValidBlockHeight } = await this.conn.getLatestBlockhash();
    const tx = await this.sign(new Transaction({ feePayer: this.keeper, recentBlockhash: blockhash }).add(...ixs));
    const signature = await this.conn.sendRawTransaction(tx.serialize());
    await this.conn.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
    const after = BigInt(await this.conn.getBalance(treasury));
    return { lamports: after - before, signature };
  }
}

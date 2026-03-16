import {
  PublicKey,
  TransactionInstruction,
  Transaction,
  TransactionSignature,
} from '@solana/web3.js';
import { AnchorProvider } from '@coral-xyz/anchor';

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Maximum backstop draw as a percentage of net supply, in basis points.
 * Matches `max_backstop_bps` upper bound enforced on-chain.
 */
export const MAX_BACKSTOP_BPS = 10_000;

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Parameters for {@link BadDebtBackstopModule.setBackstopParams}.
 */
export interface SetBackstopParamsArgs {
  /** The SSS-3 stablecoin mint (preset 3 only). */
  mint: PublicKey;
  /**
   * Insurance fund token account pubkey.
   * Pass `PublicKey.default()` to disable the backstop.
   */
  insuranceFundPubkey: PublicKey;
  /**
   * Maximum backstop draw in basis points of net supply (0 = unlimited).
   * E.g. 500 = draw at most 5% of net supply.  Must be ≤ 10_000.
   */
  maxBackstopBps: number;
}

/**
 * Parameters for {@link BadDebtBackstopModule.triggerBackstop}.
 */
export interface TriggerBackstopArgs {
  /** The SSS-3 stablecoin mint (preset 3 only). */
  mint: PublicKey;
  /** Insurance fund token account (source of backstop collateral). */
  insuranceFund: PublicKey;
  /** Reserve vault token account (destination for backstop collateral). */
  reserveVault: PublicKey;
  /** The collateral token mint (e.g. USDC). */
  collateralMint: PublicKey;
  /** Insurance fund authority — signs to allow SPL token transfer. */
  insuranceFundAuthority: PublicKey;
  /** Token program for the collateral (usually TOKEN_PROGRAM_ID or TOKEN_2022_PROGRAM_ID). */
  collateralTokenProgram: PublicKey;
  /**
   * Post-liquidation shortfall in collateral native units.
   * Must be > 0.
   */
  shortfallAmount: bigint;
}

/**
 * Backstop configuration read from `StablecoinConfig`.
 */
export interface BackstopConfig {
  /** Insurance fund vault pubkey; PublicKey.default() when disabled. */
  insuranceFundPubkey: PublicKey;
  /**
   * Maximum draw in bps of net supply.
   * 0 = unlimited.
   */
  maxBackstopBps: number;
  /** True when a valid insurance fund is configured. */
  enabled: boolean;
}

// ─── Anchor discriminators (SHA-256("global:<ix>")[0..8]) ────────────────────
// Pre-computed to avoid a full IDL dependency at runtime.

const DISCRIMINATOR_SET_BACKSTOP_PARAMS = Buffer.from([
  0x3a, 0x7f, 0x2c, 0x91, 0xd4, 0x0e, 0xb5, 0x6f,
]);

const DISCRIMINATOR_TRIGGER_BACKSTOP = Buffer.from([
  0xc8, 0x4b, 0x17, 0x5e, 0x39, 0xa2, 0x0d, 0x76,
]);

// ─── BadDebtBackstopModule ────────────────────────────────────────────────────

/**
 * BadDebtBackstopModule — SDK client for SSS-097 bad-debt backstop instructions.
 *
 * Wraps:
 * - `set_backstop_params` — authority-only; configure the insurance fund vault
 *   and max backstop draw cap on the `StablecoinConfig` (preset 3 only).
 * - `trigger_backstop` — CPI-only (must be signed by config PDA); draws up to
 *   `max_backstop_bps` of net supply from the insurance fund into the reserve
 *   vault to cover a post-liquidation collateral shortfall.
 *
 * Preset restriction: both instructions require `config.preset == 3`.
 *
 * @example
 * ```ts
 * import { BadDebtBackstopModule } from '@sss/sdk';
 * import { PublicKey } from '@solana/web3.js';
 * import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
 *
 * const backstop = new BadDebtBackstopModule(provider, programId);
 *
 * // Authority: configure insurance fund (500 bps = 5% max draw)
 * await backstop.setBackstopParams({
 *   mint,
 *   insuranceFundPubkey: insuranceFundTokenAccount,
 *   maxBackstopBps: 500,
 * });
 *
 * // Read current config
 * const config = await backstop.fetchBackstopConfig(mint);
 * console.log(config.enabled, config.maxBackstopBps); // true, 500
 *
 * // Off-chain: estimate max draw
 * const maxDraw = backstop.computeMaxDraw({ netSupply: 1_000_000n, maxBackstopBps: 500, shortfall: 40_000n });
 * console.log(maxDraw); // 50_000n (capped by shortfall: 40_000n)
 * ```
 */
export class BadDebtBackstopModule {
  constructor(
    private readonly provider: AnchorProvider,
    private readonly programId: PublicKey,
  ) {}

  // ─── PDA helpers ──────────────────────────────────────────────────────────

  /**
   * Derives the `StablecoinConfig` PDA for a given mint.
   */
  configPda(mint: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('stablecoin-config'), mint.toBuffer()],
      this.programId,
    );
  }

  // ─── Write instructions ───────────────────────────────────────────────────

  /**
   * Configure the insurance fund vault and max backstop draw cap.
   *
   * Only the stablecoin `authority` may call this (preset 3 only).
   * Pass `PublicKey.default()` for `insuranceFundPubkey` to disable the backstop.
   *
   * @param args.mint                 - The SSS-3 stablecoin mint.
   * @param args.insuranceFundPubkey  - Insurance fund token account (or default to disable).
   * @param args.maxBackstopBps       - Max draw in bps of net supply (0–10_000). 0 = unlimited.
   * @returns Transaction signature.
   * @throws When `maxBackstopBps` > {@link MAX_BACKSTOP_BPS}.
   */
  async setBackstopParams(args: SetBackstopParamsArgs): Promise<TransactionSignature> {
    const { mint, insuranceFundPubkey, maxBackstopBps } = args;

    if (maxBackstopBps < 0 || maxBackstopBps > MAX_BACKSTOP_BPS) {
      throw new Error(
        `maxBackstopBps must be 0–${MAX_BACKSTOP_BPS}, got ${maxBackstopBps}`,
      );
    }

    const [configPda] = this.configPda(mint);

    // Instruction data: discriminator(8) + insurance_fund_pubkey(32) + max_backstop_bps(u16 LE)
    const data = Buffer.alloc(42);
    DISCRIMINATOR_SET_BACKSTOP_PARAMS.copy(data, 0);
    insuranceFundPubkey.toBuffer().copy(data, 8);
    data.writeUInt16LE(maxBackstopBps, 40);

    const ix = new TransactionInstruction({
      programId: this.programId,
      keys: [
        { pubkey: this.provider.wallet.publicKey, isSigner: true, isWritable: false },
        { pubkey: configPda, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
      ],
      data,
    });

    const tx = new Transaction().add(ix);
    return this.provider.sendAndConfirm(tx, []);
  }

  /**
   * Trigger the bad-debt backstop after a liquidation leaves collateral < debt.
   *
   * **NOTE**: This instruction is CPI-only on-chain — the config PDA must be the
   * signer, which means `trigger_backstop` can only be called by the `cdp_liquidate`
   * handler.  This SDK method is provided for simulation, local-validator testing,
   * and composable transaction building only.
   *
   * Draws `min(maxDraw, insuranceFundBalance)` from the insurance fund into the
   * reserve vault.  Emits `BadDebtTriggered`.
   *
   * @param args.mint                   - The SSS-3 stablecoin mint.
   * @param args.insuranceFund          - Insurance fund token account (source).
   * @param args.reserveVault           - Reserve vault token account (destination).
   * @param args.collateralMint         - Collateral token mint.
   * @param args.insuranceFundAuthority - Signer authorising the insurance fund transfer.
   * @param args.collateralTokenProgram - Token program for collateral.
   * @param args.shortfallAmount        - Post-liquidation shortfall (must be > 0).
   * @returns Transaction signature.
   * @throws When `shortfallAmount` is zero.
   */
  async triggerBackstop(args: TriggerBackstopArgs): Promise<TransactionSignature> {
    const {
      mint,
      insuranceFund,
      reserveVault,
      collateralMint,
      insuranceFundAuthority,
      collateralTokenProgram,
      shortfallAmount,
    } = args;

    if (shortfallAmount <= 0n) {
      throw new Error('shortfallAmount must be greater than zero');
    }

    const [configPda] = this.configPda(mint);

    // Instruction data: discriminator(8) + shortfall_amount(u64 LE)
    const data = Buffer.alloc(16);
    DISCRIMINATOR_TRIGGER_BACKSTOP.copy(data, 0);
    data.writeBigUInt64LE(shortfallAmount, 8);

    const ix = new TransactionInstruction({
      programId: this.programId,
      keys: [
        { pubkey: configPda, isSigner: true, isWritable: false },  // liquidation_authority (config PDA)
        { pubkey: configPda, isSigner: false, isWritable: true },   // config (mut)
        { pubkey: mint, isSigner: false, isWritable: false },
        { pubkey: insuranceFund, isSigner: false, isWritable: true },
        { pubkey: reserveVault, isSigner: false, isWritable: true },
        { pubkey: collateralMint, isSigner: false, isWritable: false },
        { pubkey: insuranceFundAuthority, isSigner: true, isWritable: false },
        { pubkey: collateralTokenProgram, isSigner: false, isWritable: false },
      ],
      data,
    });

    const tx = new Transaction().add(ix);
    return this.provider.sendAndConfirm(tx, []);
  }

  // ─── Read helpers ─────────────────────────────────────────────────────────

  /**
   * Fetch the backstop configuration from `StablecoinConfig`.
   *
   * Reads `insurance_fund_pubkey` (Pubkey, 32 bytes) and `max_backstop_bps`
   * (u16) from the raw account data.
   *
   * @param mint - The stablecoin mint.
   * @returns {@link BackstopConfig} with the current backstop settings.
   */
  async fetchBackstopConfig(mint: PublicKey): Promise<BackstopConfig> {
    const [configPda] = this.configPda(mint);
    const accountInfo = await this.provider.connection.getAccountInfo(configPda);
    if (!accountInfo) {
      throw new Error(`StablecoinConfig PDA not found for mint ${mint.toBase58()}`);
    }

    const data = accountInfo.data;

    // StablecoinConfig layout with SSS-097 fields appended at tail:
    //   ... (existing fields)
    //   [-1]    bump: u8
    //   [-3..-1] max_oracle_conf_bps: u16 LE (SSS-090)
    //   [-7..-3] max_oracle_age_secs: u32 LE (SSS-090)
    //   [-9..-7] redemption_fee_bps: u16 LE  (SSS-093)
    //   [-11..-9] stability_fee_bps: u16 LE  (SSS-092)
    //   [-13..-11] max_backstop_bps: u16 LE  (SSS-097)
    //   [-45..-13] insurance_fund_pubkey: [u8;32] (SSS-097)
    const len = data.length;
    const maxBackstopBps = data.readUInt16LE(len - 13);
    const insuranceFundBytes = data.slice(len - 45, len - 13);
    const insuranceFundPubkey = new PublicKey(insuranceFundBytes);

    const defaultPubkey = PublicKey.default;
    const enabled = !insuranceFundPubkey.equals(defaultPubkey);

    return { insuranceFundPubkey, maxBackstopBps, enabled };
  }

  /**
   * Returns `true` when the backstop is currently enabled for a mint.
   * (i.e. `insurance_fund_pubkey` is not the default zero pubkey)
   */
  async isBackstopEnabled(mint: PublicKey): Promise<boolean> {
    const config = await this.fetchBackstopConfig(mint);
    return config.enabled;
  }

  // ─── Off-chain compute helpers ────────────────────────────────────────────

  /**
   * Compute the maximum backstop draw given on-chain parameters.
   *
   * Replicates the on-chain logic from `trigger_backstop_handler`:
   * ```
   * max_draw = if max_backstop_bps == 0 {
   *   shortfall
   * } else {
   *   min(net_supply * max_backstop_bps / 10_000, shortfall)
   * }
   * actual_draw = min(max_draw, insurance_fund_balance)
   * ```
   *
   * @param params.netSupply          - Total outstanding debt (net_supply).
   * @param params.maxBackstopBps     - Max draw cap in bps (0 = unlimited).
   * @param params.shortfall          - Post-liquidation shortfall amount.
   * @param params.insuranceFundBalance - Available insurance fund balance.
   * @returns The estimated backstop draw amount.
   */
  computeMaxDraw(params: {
    netSupply: bigint;
    maxBackstopBps: number;
    shortfall: bigint;
    insuranceFundBalance?: bigint;
  }): bigint {
    const { netSupply, maxBackstopBps, shortfall, insuranceFundBalance } = params;

    const maxDrawBeforeFund =
      maxBackstopBps === 0
        ? shortfall
        : BigInt(maxBackstopBps) > 0n
          ? (netSupply * BigInt(maxBackstopBps)) / 10_000n < shortfall
            ? (netSupply * BigInt(maxBackstopBps)) / 10_000n
            : shortfall
          : shortfall;

    if (insuranceFundBalance !== undefined) {
      return maxDrawBeforeFund < insuranceFundBalance
        ? maxDrawBeforeFund
        : insuranceFundBalance;
    }
    return maxDrawBeforeFund;
  }

  /**
   * Compute the remaining shortfall after a backstop draw.
   *
   * @param shortfall   - Original shortfall.
   * @param backstopDraw - Amount drawn from insurance fund.
   * @returns Remaining shortfall (0 if fully covered).
   */
  computeRemainingShortfall(shortfall: bigint, backstopDraw: bigint): bigint {
    return shortfall > backstopDraw ? shortfall - backstopDraw : 0n;
  }
}

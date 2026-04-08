import {
  PublicKey,
  TransactionInstruction,
  Transaction,
  TransactionSignature,
  SystemProgram,
  SYSVAR_CLOCK_PUBKEY,
} from '@solana/web3.js';
import { AnchorProvider } from '@coral-xyz/anchor';
import { TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Maximum annual stability fee: 20% (2000 bps).
 * Matches `MAX_STABILITY_FEE_BPS` in `programs/sss-token/src/instructions/stability_fee.rs`.
 */
export const MAX_STABILITY_FEE_BPS = 2000;

/**
 * Seconds per non-leap year.  Used in fee accrual formula.
 */
export const SECS_PER_YEAR = 365 * 24 * 3600;

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Parameters for {@link StabilityFeeModule.setStabilityFee}.
 */
export interface SetStabilityFeeArgs {
  /** The SSS-3 stablecoin mint. */
  mint: PublicKey;
  /**
   * Annual stability fee in basis points (e.g. 200 = 2% p.a.).
   * 0 disables the fee.  Max = 2000 (20%).
   */
  feeBps: number;
}

/**
 * Parameters for {@link StabilityFeeModule.collectStabilityFee}.
 */
export interface CollectStabilityFeeArgs {
  /** The SSS-3 stablecoin mint. */
  mint: PublicKey;
  /**
   * The CDP position owner (debtor). Used to derive the CdpPosition PDA.
   * Does NOT need to sign — any whitelisted keeper or authority can call this
   * (BUG-015 fix: caller is the signer, not the debtor).
   */
  debtor: PublicKey;
  /** The debtor's SSS token account (Token-2022). */
  debtorSssAccount: PublicKey;
}

/**
 * On-chain stability fee configuration read from `StablecoinConfig`.
 */
export interface StabilityFeeConfig {
  /**
   * Annual stability fee in basis points.
   * 0 = fee disabled.
   */
  stabilityFeeBps: number;
}

/**
 * Accrual state from a `CdpPosition` account.
 */
export interface CdpStabilityFeeState {
  /** Unix timestamp of last fee accrual (0 if never collected). */
  lastFeeAccrual: bigint;
  /** Cumulative stability fees accrued (in SSS native units). */
  accruedFees: bigint;
}

/**
 * Off-chain preview of what `collect_stability_fee` would burn right now.
 */
export interface StabilityFeePreview {
  /** Annual fee rate in bps. */
  feeBps: number;
  /** Current outstanding debt in SSS native units. */
  debtAmount: bigint;
  /** Elapsed seconds since last accrual. */
  elapsedSecs: bigint;
  /** Estimated fee to be burned (simple interest, truncated). */
  estimatedFee: bigint;
}

// ─── Anchor discriminators (SHA-256("global:<ix>")[0..8]) ────────────────────
// Pre-computed to avoid a full IDL dependency at runtime.

// SHA-256("global:set_stability_fee")[0..8]
const DISCRIMINATOR_SET_STABILITY_FEE = Buffer.from([
  0x3a, 0x89, 0x67, 0xdc, 0x8c, 0x67, 0xcd, 0xfd,
]);

// SHA-256("global:collect_stability_fee")[0..8]
const DISCRIMINATOR_COLLECT_STABILITY_FEE = Buffer.from([
  0x74, 0x1a, 0x64, 0xeb, 0x67, 0x61, 0x26, 0xd6,
]);

// ─── StabilityFeeModule ──────────────────────────────────────────────────────

/**
 * StabilityFeeModule — SDK client for SSS-092 stability fee instructions.
 *
 * Wraps:
 * - `set_stability_fee` — authority-only; configures the annual fee rate.
 * - `collect_stability_fee` — permissionless (keeper-friendly); accrues and
 *   burns outstanding fees from the debtor's SSS token account.
 *
 * Fee formula (simple interest, not compound):
 * ```
 * fee = debt_amount × stability_fee_bps × elapsed_secs
 *       ─────────────────────────────────────────────
 *                  10_000 × SECS_PER_YEAR
 * ```
 *
 * @example
 * ```ts
 * import { StabilityFeeModule } from '@sss/sdk';
 *
 * const sf = new StabilityFeeModule(provider, programId);
 *
 * // Authority: set 2% annual stability fee
 * await sf.setStabilityFee({ mint, feeBps: 200 });
 *
 * // Keeper: collect accrued fees for a debtor position
 * await sf.collectStabilityFee({ mint, debtor, debtorSssAccount });
 *
 * // Read current fee rate
 * const config = await sf.getStabilityFeeConfig(mint);
 * console.log(config.stabilityFeeBps); // 200
 *
 * // Read accrued state for a position
 * const state = await sf.getCdpStabilityFeeState(mint, debtor);
 * console.log(state.accruedFees); // BigInt
 * ```
 */
export class StabilityFeeModule {
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

  /**
   * Derives the `CdpPosition` PDA for a given mint + owner.
   */
  cdpPositionPda(mint: PublicKey, owner: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('cdp-position'), mint.toBuffer(), owner.toBuffer()],
      this.programId,
    );
  }

  // ─── Write instructions ───────────────────────────────────────────────────

  /**
   * Set the annual stability fee for a CDP stablecoin.
   *
   * Only the stablecoin `authority` may call this.  The fee takes effect on
   * the next `collect_stability_fee` call.
   *
   * @param args.mint   - The SSS-3 stablecoin mint.
   * @param args.feeBps - Annual fee in basis points (0–2000). 0 disables fee.
   * @returns Transaction signature.
   * @throws When `feeBps` exceeds {@link MAX_STABILITY_FEE_BPS}.
   */
  async setStabilityFee(args: SetStabilityFeeArgs): Promise<TransactionSignature> {
    const { mint, feeBps } = args;

    if (feeBps < 0 || feeBps > MAX_STABILITY_FEE_BPS) {
      throw new Error(
        `feeBps must be 0–${MAX_STABILITY_FEE_BPS} (20% p.a. max), got ${feeBps}`,
      );
    }

    const [configPda] = this.configPda(mint);

    // Instruction data: discriminator(8) + fee_bps(u16 LE)
    const data = Buffer.alloc(10);
    DISCRIMINATOR_SET_STABILITY_FEE.copy(data, 0);
    data.writeUInt16LE(feeBps, 8);

    const ix = new TransactionInstruction({
      programId: this.programId,
      keys: [
        { pubkey: this.provider.wallet.publicKey, isSigner: true, isWritable: false },
        { pubkey: configPda, isSigner: false, isWritable: true },
      ],
      data,
    });

    const tx = new Transaction().add(ix);
    return this.provider.sendAndConfirm(tx, []);
  }

  /**
   * Accrue and burn stability fees for a CDP position.
   *
   * Permissionless — keepers may call this on behalf of any debtor (BUG-015 fix).
   * The `caller` (provider wallet) is the signer; the `debtor` is a read-only
   * CHECK account used only for CdpPosition PDA seed derivation.
   *
   * No-ops (returns immediately without sending a transaction) when:
   * - `stability_fee_bps == 0` on-chain.
   * - Less than 1 second has elapsed since last accrual.
   *
   * Account order (matches IDL for `collect_stability_fee`):
   * 1. caller        — signer, writable (keeper or authority)
   * 2. config        — writable (PDA keyed by sss_mint)
   * 3. sss_mint      — writable
   * 4. debtor        — read-only CHECK (PDA seed only, no signature needed)
   * 5. cdp_position  — writable (PDA derived from [seed, sss_mint, debtor])
   * 6. debtor_sss_account — writable (fees burned from here)
   * 7. token_program — read-only
   *
   * @param args.mint             - The SSS-3 stablecoin mint.
   * @param args.debtor           - CDP position owner (NOT the signer; used for PDA derivation).
   * @param args.debtorSssAccount - Debtor's SSS token-2022 account (fees burned from here).
   * @returns Transaction signature, or `null` when the instruction would no-op.
   */
  async collectStabilityFee(
    args: CollectStabilityFeeArgs,
  ): Promise<TransactionSignature | null> {
    const { mint, debtor, debtorSssAccount } = args;

    // Early-out: skip if fee is zero (avoid unnecessary tx)
    const feeConfig = await this.getStabilityFeeConfig(mint);
    if (feeConfig.stabilityFeeBps === 0) {
      return null;
    }

    const [configPda] = this.configPda(mint);
    const [cdpPositionPda] = this.cdpPositionPda(mint, debtor);

    // Instruction data: discriminator only (no args)
    const data = Buffer.from(DISCRIMINATOR_COLLECT_STABILITY_FEE);

    const ix = new TransactionInstruction({
      programId: this.programId,
      keys: [
        // BUG-015 fix: caller (keeper/authority) is the signer, NOT the debtor
        { pubkey: this.provider.wallet.publicKey, isSigner: true, isWritable: true },
        { pubkey: configPda, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: true },
        // debtor is a read-only CHECK account (no signature required)
        { pubkey: debtor, isSigner: false, isWritable: false },
        { pubkey: cdpPositionPda, isSigner: false, isWritable: true },
        { pubkey: debtorSssAccount, isSigner: false, isWritable: true },
        { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data,
    });

    const tx = new Transaction().add(ix);
    return this.provider.sendAndConfirm(tx, []);
  }

  // ─── Read helpers ─────────────────────────────────────────────────────────

  /**
   * Fetch the current stability fee configuration from `StablecoinConfig`.
   *
   * Reads `stability_fee_bps` (u16) from the raw account data.
   *
   * @param mint - The stablecoin mint.
   * @returns {@link StabilityFeeConfig} with the current fee rate.
   */
  async getStabilityFeeConfig(mint: PublicKey): Promise<StabilityFeeConfig> {
    const [configPda] = this.configPda(mint);
    const accountInfo = await this.provider.connection.getAccountInfo(configPda);
    if (!accountInfo) {
      throw new Error(`StablecoinConfig PDA not found for mint ${mint.toBase58()}`);
    }

    const data = accountInfo.data;

    // StablecoinConfig layout (state.rs, SSS-092 schema):
    //   [0..8]     discriminator
    //   [8..40]    mint: Pubkey
    //   [40..72]   authority: Pubkey
    //   [72..104]  compliance_authority: Pubkey
    //   [104]      preset: u8
    //   [105]      paused: bool
    //   [106..114] total_minted: u64
    //   [114..122] total_burned: u64
    //   [122..154] transfer_hook_program: Pubkey
    //   [154..186] collateral_mint: Pubkey
    //   [186..218] reserve_vault: Pubkey
    //   [218..226] total_collateral: u64
    //   [226..234] max_supply: u64
    //   [234..266] pending_authority: Pubkey
    //   [266..298] pending_compliance_authority: Pubkey
    //   [298..306] feature_flags: u64
    //   [306..314] max_transfer_amount: u64
    //   [314..346] expected_pyth_feed: Pubkey
    //   [346..354] admin_op_mature_slot: u64
    //   [354]      admin_op_kind: u8
    //   [355..363] admin_op_param: u64
    //   [363..395] admin_op_target: Pubkey
    //   [395..403] admin_timelock_delay: u64
    //   [403..407] max_oracle_age_secs: u32
    //   [407..409] max_oracle_conf_bps: u16
    //   [409..411] stability_fee_bps: u16
    const STABILITY_FEE_BPS_OFFSET = 409;

    if (data.length < STABILITY_FEE_BPS_OFFSET + 2) {
      return { stabilityFeeBps: 0 };
    }
    const stabilityFeeBps = data.readUInt16LE(STABILITY_FEE_BPS_OFFSET);

    return { stabilityFeeBps };
  }

  /**
   * Fetch accrued fee state from a `CdpPosition` account.
   *
   * Returns `lastFeeAccrual` (unix timestamp) and `accruedFees` (cumulative
   * fees burned since position opened).
   *
   * @param mint  - The stablecoin mint.
   * @param owner - The CDP position owner.
   * @returns {@link CdpStabilityFeeState}.
   */
  async getCdpStabilityFeeState(
    mint: PublicKey,
    owner: PublicKey,
  ): Promise<CdpStabilityFeeState> {
    const [cdpPositionPda] = this.cdpPositionPda(mint, owner);
    const accountInfo = await this.provider.connection.getAccountInfo(cdpPositionPda);
    if (!accountInfo) {
      throw new Error(
        `CdpPosition PDA not found for mint ${mint.toBase58()} / owner ${owner.toBase58()}`,
      );
    }

    const data = accountInfo.data;

    // CdpPosition layout (state.rs, SSS-092):
    //   [0..8]   discriminator
    //   [8..40]  config: Pubkey
    //   [40..72] sss_mint: Pubkey
    //   [72..104] owner: Pubkey
    //   [104..112] debt_amount: u64 LE
    //   [112..144] collateral_mint: Pubkey
    //   [144..152] last_fee_accrual: i64 LE  (SSS-092)
    //   [152..160] accrued_fees: u64 LE       (SSS-092)
    //   [160]    bump: u8
    const lastFeeAccrual = data.readBigInt64LE(144);
    const accruedFees = data.readBigUInt64LE(152);

    return { lastFeeAccrual, accruedFees };
  }

  /**
   * Preview the estimated stability fee that would be collected right now.
   *
   * Does not send any transaction.  Useful for UI display.
   *
   * @param mint  - The stablecoin mint.
   * @param owner - The CDP position owner.
   * @returns {@link StabilityFeePreview} with estimated burn amount.
   */
  async previewAccruedFee(
    mint: PublicKey,
    owner: PublicKey,
  ): Promise<StabilityFeePreview> {
    const [feeConfig, cdpState] = await Promise.all([
      this.getStabilityFeeConfig(mint),
      this.getCdpStabilityFeeState(mint, owner),
    ]);

    // Read debt_amount directly from CdpPosition
    const [cdpPositionPda] = this.cdpPositionPda(mint, owner);
    const accountInfo = await this.provider.connection.getAccountInfo(cdpPositionPda);
    if (!accountInfo) {
      throw new Error(`CdpPosition PDA not found`);
    }
    const debtAmount = accountInfo.data.readBigUInt64LE(104);

    const nowSecs = BigInt(Math.floor(Date.now() / 1000));
    const elapsedSecs =
      cdpState.lastFeeAccrual === 0n
        ? 0n
        : nowSecs > cdpState.lastFeeAccrual
          ? nowSecs - cdpState.lastFeeAccrual
          : 0n;

    // fee = debt * feeBps * elapsed / (10_000 * SECS_PER_YEAR)
    const feeBps = BigInt(feeConfig.stabilityFeeBps);
    const secsPerYear = BigInt(SECS_PER_YEAR);
    const estimatedFee =
      feeBps > 0n && elapsedSecs > 0n
        ? (debtAmount * feeBps * elapsedSecs) / (10_000n * secsPerYear)
        : 0n;

    return {
      feeBps: feeConfig.stabilityFeeBps,
      debtAmount,
      elapsedSecs,
      estimatedFee,
    };
  }

  /**
   * Returns `true` when the stability fee is currently enabled for a mint.
   */
  async isFeeEnabled(mint: PublicKey): Promise<boolean> {
    const config = await this.getStabilityFeeConfig(mint);
    return config.stabilityFeeBps > 0;
  }

  /**
   * Annualised fee rate as a decimal (e.g. 0.02 for 2% p.a.).
   * Returns 0 when fee is disabled.
   */
  async annualFeeRate(mint: PublicKey): Promise<number> {
    const config = await this.getStabilityFeeConfig(mint);
    return config.stabilityFeeBps / 10_000;
  }
}

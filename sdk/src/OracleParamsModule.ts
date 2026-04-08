import { PublicKey, TransactionSignature } from '@solana/web3.js';
import { AnchorProvider } from '@coral-xyz/anchor';

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Default maximum Pyth price age in seconds (matches on-chain DEFAULT_MAX_PRICE_AGE_SECS).
 * Used by `cdp_borrow_stable` and `cdp_liquidate` when `max_oracle_age_secs` is 0.
 */
export const DEFAULT_MAX_ORACLE_AGE_SECS = 60;

/**
 * Alias for {@link DEFAULT_MAX_ORACLE_AGE_SECS} — SSS-094 canonical export name.
 */
export const MAX_ORACLE_AGE_SECONDS = DEFAULT_MAX_ORACLE_AGE_SECS;

/**
 * Recommended mainnet `max_oracle_conf_bps` value (1%).
 * Prices whose confidence interval exceeds 1% of price are rejected.
 */
export const RECOMMENDED_MAX_ORACLE_CONF_BPS = 100;

// ─── Byte offsets in StablecoinConfig ────────────────────────────────────────
//
// Discriminator (8) + fields ... (see state.rs). These two fields were appended
// last in the SSS-090 migration and sit immediately before the final `bump: u8`.
//
// The exact offsets are read from the raw account data in `getOracleParams`.
// We rely on fetching via the IDL / Anchor program.decode path; the raw offset
// constants are provided as a documentation reference only.

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Parameters for {@link OracleParamsModule.setOracleParams}.
 */
export interface SetOracleParamsArgs {
  /** The SSS-3 stablecoin mint. */
  mint: PublicKey;
  /**
   * Maximum seconds a Pyth price update can be old.
   * 0 = use the on-chain default (60 s).
   *
   * Recommended mainnet value: 60.
   */
  maxAgeSecs: number;
  /**
   * Maximum acceptable confidence-to-price ratio in basis points.
   * E.g. 100 = 1%. 0 = confidence check disabled.
   *
   * Recommended mainnet value: 100 (1%).
   */
  maxConfBps: number;
}

/**
 * Live oracle parameter configuration stored in {@link StablecoinConfig}.
 */
export interface OracleParams {
  /**
   * Maximum allowed Pyth price age in seconds.
   * 0 means the on-chain default (60 s) is used.
   */
  maxAgeSecs: number;
  /**
   * Maximum confidence-to-price ratio in basis points.
   * 0 means the confidence check is disabled.
   */
  maxConfBps: number;
}

/** Alias for {@link OracleParams} — SSS-094 canonical type name. */
export type OracleParamsConfig = OracleParams;

/** Result returned by {@link OracleParamsModule.validateOracleFeed}. */
export interface OracleFeedValidation {
  /** Whether the feed passes all configured checks. */
  valid: boolean;
  /** Human-readable reason if `valid` is false. */
  reason?: string;
}

// ─── OracleParamsModule ──────────────────────────────────────────────────────

/**
 * OracleParamsModule — SDK client for SSS-090 oracle safety parameters.
 *
 * Wraps the `set_oracle_params` Anchor instruction that lets the stablecoin
 * authority configure Pyth staleness and confidence-interval thresholds used
 * by `cdp_borrow_stable` and `cdp_liquidate`.
 *
 * On-chain semantics:
 * - `max_oracle_age_secs`: rejects prices older than this many seconds.
 *   0 falls back to the hardcoded default of 60 s.
 * - `max_oracle_conf_bps`: rejects prices where conf/price (in bps) exceeds
 *   this value. 0 disables the confidence check entirely.
 *
 * @example
 * ```ts
 * import { OracleParamsModule, RECOMMENDED_MAX_ORACLE_CONF_BPS } from '@sss/sdk';
 *
 * const op = new OracleParamsModule(provider, programId);
 *
 * // Configure tight oracle safety for mainnet
 * await op.setOracleParams({
 *   mint,
 *   maxAgeSecs: 60,
 *   maxConfBps: RECOMMENDED_MAX_ORACLE_CONF_BPS, // 1%
 * });
 *
 * // Read current settings
 * const params = await op.getOracleParams(mint);
 * console.log(params); // { maxAgeSecs: 60, maxConfBps: 100 }
 *
 * // Disable confidence check (e.g. on devnet with mock feeds)
 * await op.setOracleParams({ mint, maxAgeSecs: 300, maxConfBps: 0 });
 * ```
 */
export class OracleParamsModule {
  constructor(
    private readonly provider: AnchorProvider,
    private readonly programId: PublicKey,
  ) {}

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private configPda(mint: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('stablecoin-config'), mint.toBuffer()],
      this.programId,
    );
  }

  // ─── Write ────────────────────────────────────────────────────────────────

  /**
   * Configure oracle staleness and confidence parameters for a CDP stablecoin.
   *
   * Only the stablecoin `authority` may call this. The instruction modifies
   * `StablecoinConfig.max_oracle_age_secs` and `StablecoinConfig.max_oracle_conf_bps`
   * atomically on-chain.
   *
   * @param args.mint       - The SSS-3 stablecoin mint.
   * @param args.maxAgeSecs - Max Pyth price age in seconds (0 = on-chain default).
   * @param args.maxConfBps - Max confidence/price ratio in bps (0 = disabled).
   * @returns Transaction signature.
   */
  async setOracleParams(args: SetOracleParamsArgs): Promise<TransactionSignature> {
    const { mint, maxAgeSecs, maxConfBps } = args;

    if (maxAgeSecs < 0 || maxAgeSecs > 0xffffffff) {
      throw new Error(`maxAgeSecs must be a u32 (0–${0xffffffff}), got ${maxAgeSecs}`);
    }
    if (maxConfBps < 0 || maxConfBps > 0xffff) {
      throw new Error(`maxConfBps must be a u16 (0–${0xffff}), got ${maxConfBps}`);
    }

    const [configPda] = this.configPda(mint);

    // Build the instruction discriminator for `set_oracle_params` (sighash).
    // SHA-256("global:set_oracle_params")[0..8]
    const discriminator = Buffer.from([
      0x20, 0xb9, 0xc5, 0xe8, 0x6b, 0x01, 0x26, 0x57,
    ]);

    // Encode args: max_age_secs (u32 LE) + max_conf_bps (u16 LE)
    const data = Buffer.alloc(8 + 4 + 2);
    discriminator.copy(data, 0);
    data.writeUInt32LE(maxAgeSecs, 8);
    data.writeUInt16LE(maxConfBps, 12);

    const { Transaction, TransactionInstruction } = await import('@solana/web3.js');
    const ix = new TransactionInstruction({
      programId: this.programId,
      keys: [
        { pubkey: this.provider.wallet.publicKey, isSigner: true, isWritable: false },
        { pubkey: configPda, isSigner: false, isWritable: true },
        { pubkey: mint, isSigner: false, isWritable: false },
        {
          pubkey: new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'),
          isSigner: false,
          isWritable: false,
        },
      ],
      data,
    });

    const tx = new Transaction().add(ix);
    return this.provider.sendAndConfirm(tx, []);
  }

  // ─── Read ─────────────────────────────────────────────────────────────────

  /**
   * Fetch oracle parameters stored in `StablecoinConfig`.
   *
   * Reads the raw account data and deserialises
   * `max_oracle_age_secs` (u32) and `max_oracle_conf_bps` (u16)
   * from the known byte offsets.
   *
   * @param mint - The stablecoin mint whose config to read.
   * @returns {@link OracleParams} with the current settings.
   */
  async getOracleParams(mint: PublicKey): Promise<OracleParams> {
    const [configPda] = this.configPda(mint);
    const accountInfo = await this.provider.connection.getAccountInfo(configPda);
    if (!accountInfo) {
      throw new Error(`StablecoinConfig PDA not found for mint ${mint.toBase58()}`);
    }

    const data = accountInfo.data;

    // StablecoinConfig layout (see state.rs, post-SSS-090):
    //  [0..8]     discriminator
    //  [8..40]    mint: Pubkey
    //  [40..72]   authority: Pubkey
    //  [72..104]  compliance_authority: Pubkey
    //  [104]      preset: u8
    //  [105]      paused: bool
    //  [106..114] total_minted: u64
    //  [114..122] total_burned: u64
    //  [122..154] transfer_hook_program: Pubkey
    //  [154..186] collateral_mint: Pubkey
    //  [186..218] reserve_vault: Pubkey
    //  [218..226] total_collateral: u64
    //  [226..234] max_supply: u64
    //  [234..266] pending_authority: Pubkey
    //  [266..298] pending_compliance_authority: Pubkey
    //  [298..306] feature_flags: u64
    //  [306..314] max_transfer_amount: u64
    //  [314..346] expected_pyth_feed: Pubkey
    //  [346..354] admin_op_mature_slot: u64
    //  [354]      admin_op_kind: u8
    //  [355..363] admin_op_param: u64
    //  [363..395] admin_op_target: Pubkey
    //  [395..403] admin_timelock_delay: u64
    //  [403..407] max_oracle_age_secs: u32
    //  [407..409] max_oracle_conf_bps: u16
    const MAX_ORACLE_AGE_OFFSET = 403;
    const MAX_ORACLE_CONF_OFFSET = 407;

    if (data.length < MAX_ORACLE_CONF_OFFSET + 2) {
      return { maxAgeSecs: 0, maxConfBps: 0 };
    }
    const maxAgeSecs = data.readUInt32LE(MAX_ORACLE_AGE_OFFSET);
    const maxConfBps = data.readUInt16LE(MAX_ORACLE_CONF_OFFSET);

    return { maxAgeSecs, maxConfBps };
  }

  /**
   * Alias for {@link getOracleParams} — SSS-094 canonical method name.
   *
   * @param mint - The stablecoin mint whose config to read.
   * @returns {@link OracleParamsConfig} with the current settings.
   */
  async fetchOracleParams(mint: PublicKey): Promise<OracleParamsConfig> {
    return this.getOracleParams(mint);
  }

  /**
   * Validate a candidate Pyth price feed against the configured oracle params.
   *
   * Checks:
   * 1. Staleness — `priceAgeSeconds` must not exceed `effectiveMaxAgeSecs`.
   * 2. Confidence — when `maxConfBps > 0`, `confBps` must not exceed it.
   *
   * @param mint           - The stablecoin mint whose config provides thresholds.
   * @param priceAgeSeconds - How many seconds old the current price is.
   * @param confBps         - Confidence interval expressed as basis points of price
   *                          (conf / price * 10_000). Pass 0 to skip confidence check.
   * @returns {@link OracleFeedValidation} indicating pass/fail with reason.
   */
  async validateOracleFeed(
    mint: PublicKey,
    priceAgeSeconds: number,
    confBps: number,
  ): Promise<OracleFeedValidation> {
    if (!Number.isFinite(priceAgeSeconds) || priceAgeSeconds < 0) {
      throw new Error(`priceAgeSeconds must be a finite non-negative number, got ${priceAgeSeconds}`);
    }
    if (!Number.isFinite(confBps) || confBps < 0) {
      throw new Error(`confBps must be a finite non-negative number, got ${confBps}`);
    }

    const params = await this.getOracleParams(mint);
    const maxAge = params.maxAgeSecs === 0 ? DEFAULT_MAX_ORACLE_AGE_SECS : params.maxAgeSecs;

    if (priceAgeSeconds > maxAge) {
      return {
        valid: false,
        reason: `Oracle price is stale: age ${priceAgeSeconds}s exceeds max ${maxAge}s`,
      };
    }

    if (params.maxConfBps > 0 && confBps > params.maxConfBps) {
      return {
        valid: false,
        reason: `Oracle confidence too wide: ${confBps} bps exceeds max ${params.maxConfBps} bps`,
      };
    }

    return { valid: true };
  }

  /**
   * Returns `true` when the confidence-interval check is enabled
   * (`max_oracle_conf_bps > 0`).
   */
  async isConfidenceCheckEnabled(mint: PublicKey): Promise<boolean> {
    const params = await this.getOracleParams(mint);
    return params.maxConfBps > 0;
  }

  /**
   * Returns the effective max oracle age in seconds.
   * Resolves the on-chain default (60 s) when `max_oracle_age_secs` is 0.
   */
  async effectiveMaxAgeSecs(mint: PublicKey): Promise<number> {
    const params = await this.getOracleParams(mint);
    return params.maxAgeSecs === 0 ? DEFAULT_MAX_ORACLE_AGE_SECS : params.maxAgeSecs;
  }
}

import { PublicKey, TransactionSignature } from '@solana/web3.js';
import { AnchorProvider } from '@coral-xyz/anchor';

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Bit flag for the Yield Collateral feature (SSS-070).
 *
 * When this flag is set in `StablecoinConfig.feature_flags`, yield-bearing
 * SPL token mints (e.g. stSOL, mSOL, jitoSOL) are accepted as CDP collateral.
 *
 * Matches `FLAG_YIELD_COLLATERAL` in the Anchor program (bit 3 = 0x08).
 *
 * @example
 * ```ts
 * const active = featureFlags.isFeatureFlagSet(mint, FLAG_YIELD_COLLATERAL);
 * ```
 */
export const FLAG_YIELD_COLLATERAL = 1n << 3n; // 0x08

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * On-chain state of a `YieldCollateralConfig` PDA, as decoded from the chain.
 *
 * Seeds: `[b"yield-collateral", sss_mint]`
 *
 * Stores a whitelist of SPL token mints that may be used as yield-bearing
 * collateral in CDP deposits.  Maximum 8 whitelisted mints.
 */
export interface YieldCollateralConfig {
  /** The SSS stablecoin mint this config belongs to. */
  sssMint: PublicKey;
  /** Whitelisted yield-bearing SPL token mints (max 8). */
  whitelistedMints: PublicKey[];
  /** PDA bump seed. */
  bump: number;
}

/**
 * Parameters for `initYieldCollateral`.
 */
export interface InitYieldCollateralParams {
  /** The stablecoin mint. */
  mint: PublicKey;
  /**
   * Optional initial list of yield-bearing SPL token mints to whitelist
   * immediately (e.g. stSOL, mSOL).  Max 8 total.
   */
  initialMints?: PublicKey[];
}

/**
 * Parameters for `addYieldCollateralMint`.
 */
export interface AddYieldCollateralMintParams {
  /** The stablecoin mint. */
  mint: PublicKey;
  /** The yield-bearing SPL token mint to add to the whitelist. */
  collateralMint: PublicKey;
}

// ─── YieldCollateralModule ────────────────────────────────────────────────────

/**
 * YieldCollateralModule — SDK client for the SSS Yield Collateral system
 * (SSS-072 / FLAG_YIELD_COLLATERAL, bit 3).
 *
 * Wraps `init_yield_collateral` and `add_yield_collateral_mint` Anchor
 * instructions, and provides `fetchYieldCollateralConfig` for on-chain reads.
 *
 * ## Workflow
 * 1. Authority calls `initYieldCollateral` — this creates the
 *    `YieldCollateralConfig` PDA and atomically sets `FLAG_YIELD_COLLATERAL`
 *    in `StablecoinConfig.feature_flags`.
 * 2. Optionally, authority calls `addYieldCollateralMint` to whitelist
 *    additional yield-bearing mints (up to 8 total).
 * 3. Users can then supply whitelisted yield tokens as CDP collateral.
 *
 * @example
 * ```ts
 * import { YieldCollateralModule, FLAG_YIELD_COLLATERAL } from '@sss/sdk';
 *
 * const yc = new YieldCollateralModule(provider, programId);
 *
 * // 1. Initialise with stSOL and mSOL
 * await yc.initYieldCollateral({
 *   mint,
 *   initialMints: [stSolMint, mSolMint],
 * });
 *
 * // 2. Add jitoSOL later
 * await yc.addYieldCollateralMint({ mint, collateralMint: jitoSolMint });
 *
 * // 3. Read on-chain state
 * const cfg = await yc.fetchYieldCollateralConfig(mint);
 * console.log(cfg?.whitelistedMints.map(p => p.toBase58()));
 * ```
 */
export class YieldCollateralModule {
  private readonly provider: AnchorProvider;
  private readonly programId: PublicKey;

  static readonly CONFIG_SEED = Buffer.from('stablecoin-config');
  static readonly YIELD_COLLATERAL_SEED = Buffer.from('yield-collateral');

  /**
   * @param provider   Anchor provider (wallet must have appropriate authority).
   * @param programId  SSS token program ID.
   */
  constructor(provider: AnchorProvider, programId: PublicKey) {
    this.provider = provider;
    this.programId = programId;
  }

  // ─── PDA helpers ─────────────────────────────────────────────────────────

  /**
   * Derive the `StablecoinConfig` PDA for the given mint.
   *
   * Seeds: `[b"stablecoin-config", mint]`
   */
  getConfigPda(mint: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [YieldCollateralModule.CONFIG_SEED, mint.toBuffer()],
      this.programId
    );
  }

  /**
   * Derive the `YieldCollateralConfig` PDA for the given mint.
   *
   * Seeds: `[b"yield-collateral", mint]`
   */
  getYieldCollateralConfigPda(mint: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [YieldCollateralModule.YIELD_COLLATERAL_SEED, mint.toBuffer()],
      this.programId
    );
  }

  // ─── Writes ──────────────────────────────────────────────────────────────

  /**
   * Initialize yield-bearing collateral support for a stablecoin.
   *
   * Creates the `YieldCollateralConfig` PDA and atomically enables
   * `FLAG_YIELD_COLLATERAL` in the stablecoin config.
   *
   * Only valid for SSS-3 presets. The wallet in `provider` must be the
   * authority of the `StablecoinConfig`.
   *
   * @param params  `{ mint, initialMints? }`
   * @returns       Transaction signature.
   */
  async initYieldCollateral(params: InitYieldCollateralParams): Promise<TransactionSignature> {
    const { mint, initialMints = [] } = params;
    const program = await this._loadProgram();
    const [config] = this.getConfigPda(mint);
    const [yieldCollateralConfig] = this.getYieldCollateralConfigPda(mint);

    return program.methods
      .initYieldCollateral(initialMints)
      .accounts({
        authority: this.provider.wallet.publicKey,
        config,
        mint,
        yieldCollateralConfig,
        tokenProgram: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
        systemProgram: PublicKey.default,
      })
      .rpc({ commitment: 'confirmed' });
  }

  /**
   * Add a yield-bearing SPL token mint to the whitelist.
   *
   * `FLAG_YIELD_COLLATERAL` must already be enabled (call `initYieldCollateral`
   * first).  Rejects duplicates and enforces the 8-mint cap.
   *
   * The wallet in `provider` must be the authority of the `StablecoinConfig`.
   *
   * @param params  `{ mint, collateralMint }`
   * @returns       Transaction signature.
   */
  async addYieldCollateralMint(
    params: AddYieldCollateralMintParams
  ): Promise<TransactionSignature> {
    const { mint, collateralMint } = params;
    const program = await this._loadProgram();
    const [config] = this.getConfigPda(mint);
    const [yieldCollateralConfig] = this.getYieldCollateralConfigPda(mint);

    return program.methods
      .addYieldCollateralMint(collateralMint)
      .accounts({
        authority: this.provider.wallet.publicKey,
        config,
        mint,
        yieldCollateralConfig,
        tokenProgram: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
      })
      .rpc({ commitment: 'confirmed' });
  }

  // ─── Reads ───────────────────────────────────────────────────────────────

  /**
   * Fetch and decode the `YieldCollateralConfig` PDA from on-chain.
   *
   * Returns `null` if the account does not exist (feature not initialised).
   *
   * @param mint  The stablecoin mint.
   */
  async fetchYieldCollateralConfig(mint: PublicKey): Promise<YieldCollateralConfig | null> {
    const program = await this._loadProgram();
    const [pda] = this.getYieldCollateralConfigPda(mint);
    try {
      const raw = await program.account.yieldCollateralConfig.fetch(pda);
      return {
        sssMint: raw.sssMint as PublicKey,
        whitelistedMints: (raw.whitelistedMints ?? []) as PublicKey[],
        bump: raw.bump as number,
      };
    } catch {
      return null;
    }
  }

  /**
   * Check whether a given collateral mint is on the whitelist.
   *
   * Returns `false` if the `YieldCollateralConfig` PDA does not exist.
   *
   * @param mint            The stablecoin mint.
   * @param collateralMint  The yield-bearing SPL token mint to check.
   */
  async isWhitelisted(mint: PublicKey, collateralMint: PublicKey): Promise<boolean> {
    const cfg = await this.fetchYieldCollateralConfig(mint);
    if (!cfg) return false;
    return cfg.whitelistedMints.some((m) => m.equals(collateralMint));
  }

  // ─── Internals ───────────────────────────────────────────────────────────

  /**
   * Lazy-load + cache the Anchor program instance.
   * @internal
   */
  private _program: any | null = null;
  private async _loadProgram(): Promise<any> {
    if (this._program) return this._program;
    const { Program: AnchorProgram } = await import('@coral-xyz/anchor');
    const idl = await import('./idl/sss_token.json');
    this._program = new AnchorProgram(idl as any, this.provider) as any;
    return this._program;
  }
}

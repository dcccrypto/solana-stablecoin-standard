import { PublicKey, TransactionSignature } from '@solana/web3.js';
import { AnchorProvider } from '@coral-xyz/anchor';

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Bit flag for the yield-bearing collateral feature (SSS-072).
 *
 * When this flag is set in `StablecoinConfig.feature_flags`, yield-bearing
 * SPL token mints (e.g. stSOL, mSOL, jitoSOL) may be deposited as CDP
 * collateral via the whitelisted mints recorded in `YieldCollateralConfig`.
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
 * On-chain state of a `YieldCollateralConfig` PDA, as decoded from account data.
 *
 * Seeds: `[b"yield-collateral", sss_mint]`
 */
export interface YieldCollateralState {
  /** The SSS stablecoin mint this config belongs to. */
  sssMint: PublicKey;
  /** Whitelisted yield-bearing SPL token mints (max 8). */
  whitelistedMints: PublicKey[];
  /** PDA bump. */
  bump: number;
}

/**
 * Parameters for `enableYieldCollateral` (wraps `init_yield_collateral`).
 */
export interface EnableYieldCollateralParams {
  /** The stablecoin mint (must be SSS-3 / preset 3). */
  mint: PublicKey;
  /**
   * Optional initial list of yield-bearing SPL token mints to whitelist
   * immediately (e.g. stSOL, mSOL).  Max 8 total.  Defaults to `[]`.
   */
  initialMints?: PublicKey[];
}

/**
 * Parameters for `disableYieldCollateral`.
 *
 * Clears `FLAG_YIELD_COLLATERAL` via `clear_feature_flag`.  The
 * `YieldCollateralConfig` PDA is left intact on-chain (re-enable with
 * `set_feature_flag` directly if the PDA already exists).
 */
export interface DisableYieldCollateralParams {
  /** The stablecoin mint. */
  mint: PublicKey;
}

/**
 * Parameters for `addWhitelistedMint` (wraps `add_yield_collateral_mint`).
 */
export interface AddWhitelistedMintParams {
  /** The stablecoin mint. */
  mint: PublicKey;
  /** The yield-bearing collateral SPL token mint to whitelist. */
  collateralMint: PublicKey;
}

// ─── YieldCollateralModule ────────────────────────────────────────────────────

/**
 * YieldCollateralModule — SDK client for the SSS yield-bearing collateral
 * feature (SSS-072).
 *
 * Wraps `init_yield_collateral` and `add_yield_collateral_mint` Anchor
 * instructions.  Also provides `disableYieldCollateral` (via
 * `clear_feature_flag`) and a `fetchYieldCollateralState` account reader.
 *
 * ## Workflow
 * 1. Admin calls `enableYieldCollateral` to create the `YieldCollateralConfig`
 *    PDA and atomically set `FLAG_YIELD_COLLATERAL` on the config.
 * 2. Admin calls `addWhitelistedMint` for each yield-bearing token to accept
 *    (stSOL, mSOL, jitoSOL, bSOL, etc.).  Max 8 mints.
 * 3. CDP borrowers can now deposit whitelisted mints as collateral.
 * 4. Admin calls `disableYieldCollateral` to clear the flag (PDA preserved).
 *
 * @example
 * ```ts
 * import { YieldCollateralModule, FLAG_YIELD_COLLATERAL } from '@sss/sdk';
 *
 * const yc = new YieldCollateralModule(provider, programId);
 *
 * // 1. Enable with initial whitelist
 * await yc.enableYieldCollateral({ mint, initialMints: [stSolMint, mSolMint] });
 *
 * // 2. Add another mint later
 * await yc.addWhitelistedMint({ mint, collateralMint: jitoSolMint });
 *
 * // 3. Inspect state
 * const state = await yc.fetchYieldCollateralState(mint);
 * console.log(state?.whitelistedMints.map(m => m.toBase58()));
 *
 * // 4. Disable
 * await yc.disableYieldCollateral({ mint });
 * ```
 */
export class YieldCollateralModule {
  private readonly provider: AnchorProvider;
  private readonly programId: PublicKey;

  static readonly CONFIG_SEED = Buffer.from('stablecoin-config');
  static readonly YIELD_COLLATERAL_SEED = Buffer.from('yield-collateral');

  /**
   * @param provider   Anchor provider (wallet must be the authority for write ops).
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
  getYieldCollateralPda(mint: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [YieldCollateralModule.YIELD_COLLATERAL_SEED, mint.toBuffer()],
      this.programId
    );
  }

  // ─── Writes ──────────────────────────────────────────────────────────────

  /**
   * Enable yield-bearing collateral for this mint.
   *
   * Calls `init_yield_collateral` — creates the `YieldCollateralConfig` PDA
   * and atomically sets `FLAG_YIELD_COLLATERAL` on the `StablecoinConfig`.
   *
   * Only valid for SSS-3 (reserve-backed) stablecoins.  Authority only.
   * Fails if the PDA already exists (call `set_feature_flag` directly to
   * re-enable without re-initialising).
   *
   * @param params  `{ mint, initialMints? }`
   * @returns       Transaction signature.
   */
  async enableYieldCollateral(params: EnableYieldCollateralParams): Promise<TransactionSignature> {
    const { mint, initialMints = [] } = params;
    const program = await this._loadProgram();
    const [config] = this.getConfigPda(mint);
    const [yieldCollateralConfig] = this.getYieldCollateralPda(mint);

    return program.methods
      .initYieldCollateral(initialMints)
      .accounts({
        authority: this.provider.wallet.publicKey,
        mint,
        config,
        yieldCollateralConfig,
        tokenProgram: this._tokenProgramId(),
        systemProgram: PublicKey.default,
      })
      .rpc({ commitment: 'confirmed' });
  }

  /**
   * Disable yield-bearing collateral for this mint.
   *
   * Calls `clear_feature_flag` with `FLAG_YIELD_COLLATERAL`.  The
   * `YieldCollateralConfig` PDA is **not** closed — it remains on-chain so
   * the whitelist is preserved if the feature is re-enabled later.
   *
   * Authority only.
   *
   * @param params  `{ mint }`
   * @returns       Transaction signature.
   */
  async disableYieldCollateral(params: DisableYieldCollateralParams): Promise<TransactionSignature> {
    const { mint } = params;
    const program = await this._loadProgram();
    const [config] = this.getConfigPda(mint);

    return program.methods
      .clearFeatureFlag(FLAG_YIELD_COLLATERAL.toString())
      .accounts({
        authority: this.provider.wallet.publicKey,
        mint,
        config,
      })
      .rpc({ commitment: 'confirmed' });
  }

  /**
   * Add a yield-bearing SPL token mint to the whitelist.
   *
   * Calls `add_yield_collateral_mint`.  Requires `FLAG_YIELD_COLLATERAL` to
   * be active.  Rejects duplicates and enforces the 8-mint cap.
   *
   * Authority only.
   *
   * @param params  `{ mint, collateralMint }`
   * @returns       Transaction signature.
   */
  async addWhitelistedMint(params: AddWhitelistedMintParams): Promise<TransactionSignature> {
    const { mint, collateralMint } = params;
    const program = await this._loadProgram();
    const [config] = this.getConfigPda(mint);
    const [yieldCollateralConfig] = this.getYieldCollateralPda(mint);

    return program.methods
      .addYieldCollateralMint(collateralMint)
      .accounts({
        authority: this.provider.wallet.publicKey,
        mint,
        config,
        yieldCollateralConfig,
        tokenProgram: this._tokenProgramId(),
      })
      .rpc({ commitment: 'confirmed' });
  }

  // ─── Reads ───────────────────────────────────────────────────────────────

  /**
   * Fetch and decode the `YieldCollateralConfig` PDA from on-chain.
   *
   * Returns `null` if the account has not been initialised yet
   * (`enableYieldCollateral` not called, or wrong mint).
   *
   * @param mint  The stablecoin mint.
   */
  async fetchYieldCollateralState(mint: PublicKey): Promise<YieldCollateralState | null> {
    const program = await this._loadProgram();
    const [pda] = this.getYieldCollateralPda(mint);
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
   * Check whether `FLAG_YIELD_COLLATERAL` is currently set for a mint.
   *
   * Reads `StablecoinConfig.feature_flags` from on-chain.  Returns `false`
   * if the config account does not exist.
   *
   * @param mint  The stablecoin mint.
   */
  async isYieldCollateralEnabled(mint: PublicKey): Promise<boolean> {
    const program = await this._loadProgram();
    const [configPda] = this.getConfigPda(mint);
    try {
      const config = await program.account.stablecoinConfig.fetch(configPda);
      const flags = BigInt(config.featureFlags.toString());
      return (flags & FLAG_YIELD_COLLATERAL) !== 0n;
    } catch {
      return false;
    }
  }

  // ─── Internals ───────────────────────────────────────────────────────────

  /** Standard SPL Token-2022 program id. */
  private _tokenProgramId(): PublicKey {
    return new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
  }

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

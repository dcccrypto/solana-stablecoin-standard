import { PublicKey, SystemProgram, TransactionSignature } from '@solana/web3.js';
import { AnchorProvider, BN } from '@coral-xyz/anchor';
import { TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Bit flag for the yield-bearing collateral feature (bit 3 = 0x08).
 *
 * When this flag is set in `StablecoinConfig.feature_flags`, the CDP module
 * accepts whitelisted yield-bearing tokens (e.g., stSOL, mSOL) as collateral.
 *
 * Matches `FLAG_YIELD_COLLATERAL` in the Anchor program (bit 3 = 0x08) per
 * `programs/sss-token/src/state.rs`.
 *
 * Only valid for SSS-3 (reserve-backed) stablecoins.
 *
 * @example
 * ```ts
 * import { YieldCollateralModule, FLAG_YIELD_COLLATERAL } from '@sss/sdk';
 *
 * const yc = new YieldCollateralModule(provider, programId);
 * await yc.initYieldCollateral({ mint, initialMints: [stSOLMint] });
 * const active = await yc.isActive(mint);
 * const whitelist = await yc.getWhitelistedMints(mint);
 * ```
 */
export const FLAG_YIELD_COLLATERAL = 1n << 3n; // 0x08

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Parameters for `initYieldCollateral`.
 */
export interface InitYieldCollateralParams {
  /** The SSS-3 stablecoin mint to enable yield collateral for. */
  mint: PublicKey;
  /**
   * Optional initial whitelist of yield-bearing token mints.
   * Max 10 entries (enforced on-chain). Defaults to empty.
   */
  initialMints?: PublicKey[];
}

/**
 * Parameters for `addCollateralMint`.
 */
export interface AddYieldCollateralMintParams {
  /** The stablecoin mint whose YieldCollateralConfig to update. */
  mint: PublicKey;
  /** The yield-bearing collateral token mint to whitelist. */
  collateralMint: PublicKey;
}

/**
 * Parameters for `removeCollateralMint`.
 */
export interface RemoveYieldCollateralMintParams {
  /** The stablecoin mint whose YieldCollateralConfig to update. */
  mint: PublicKey;
  /** The yield-bearing collateral token mint to remove from the whitelist. */
  collateralMint: PublicKey;
}

// ─── YieldCollateralModule ────────────────────────────────────────────────────

/**
 * YieldCollateralModule — SDK client for the SSS yield-bearing collateral
 * feature (SSS-070).
 *
 * Manages the `YieldCollateralConfig` PDA, which holds a whitelist of
 * yield-bearing token mints (e.g., stSOL, mSOL) accepted as CDP collateral.
 * Wraps `init_yield_collateral`, `add_yield_collateral_mint`, and
 * `remove_yield_collateral_mint` Anchor instructions.
 *
 * **Preset restriction**: Only SSS-3 (reserve-backed) stablecoins can enable
 * this feature. The on-chain program enforces `config.preset == 3`.
 *
 * @example
 * ```ts
 * import { YieldCollateralModule } from '@sss/sdk';
 *
 * const yc = new YieldCollateralModule(provider, programId);
 *
 * // Initialize with stSOL whitelisted
 * await yc.initYieldCollateral({ mint, initialMints: [stSOLMint] });
 *
 * // Add mSOL later
 * await yc.addCollateralMint({ mint, collateralMint: mSOLMint });
 *
 * // Remove stSOL
 * await yc.removeCollateralMint({ mint, collateralMint: stSOLMint });
 *
 * // Check whitelist
 * const whitelist = await yc.getWhitelistedMints(mint);
 * ```
 */
export class YieldCollateralModule {
  private readonly provider: AnchorProvider;
  private readonly programId: PublicKey;

  static readonly CONFIG_SEED = Buffer.from('stablecoin-config');
  static readonly YIELD_COLLATERAL_SEED = Buffer.from('yield-collateral');

  /**
   * @param provider   Anchor provider (wallet must be the admin authority).
   * @param programId  SSS token program ID.
   */
  constructor(provider: AnchorProvider, programId: PublicKey) {
    this.provider = provider;
    this.programId = programId;
  }

  // ─── PDA helpers ─────────────────────────────────────────────────────────

  /**
   * Derive the `StablecoinConfig` PDA for the given mint.
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
   * This is initialized by `initYieldCollateral` and stores the whitelist.
   */
  getYieldCollateralConfigPda(mint: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [YieldCollateralModule.YIELD_COLLATERAL_SEED, mint.toBuffer()],
      this.programId
    );
  }

  // ─── Writes ──────────────────────────────────────────────────────────────

  /**
   * Initialize yield-bearing collateral support for an SSS-3 mint.
   *
   * Creates the `YieldCollateralConfig` PDA and atomically sets
   * `FLAG_YIELD_COLLATERAL` on the `StablecoinConfig`. One-time operation
   * per stablecoin.
   *
   * @param params  `{ mint, initialMints? }` — mint and optional initial whitelist.
   * @returns       Transaction signature.
   * @throws        If mint is not SSS-3 preset or the authority is not admin.
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
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc({ commitment: 'confirmed' });
  }

  /**
   * Add a yield-bearing token mint to the collateral whitelist.
   *
   * @param params  `{ mint, collateralMint }` — stablecoin mint and collateral mint to add.
   * @returns       Transaction signature.
   * @throws        If whitelist is full (max 10) or authority is not admin.
   */
  async addCollateralMint(params: AddYieldCollateralMintParams): Promise<TransactionSignature> {
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
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc({ commitment: 'confirmed' });
  }

  /**
   * Remove a yield-bearing token mint from the collateral whitelist.
   *
   * @param params  `{ mint, collateralMint }` — stablecoin mint and collateral mint to remove.
   * @returns       Transaction signature.
   * @throws        If the collateral mint is not in the whitelist.
   */
  async removeCollateralMint(params: RemoveYieldCollateralMintParams): Promise<TransactionSignature> {
    const { mint, collateralMint } = params;
    const program = await this._loadProgram();
    const [config] = this.getConfigPda(mint);
    const [yieldCollateralConfig] = this.getYieldCollateralConfigPda(mint);

    return program.methods
      .removeYieldCollateralMint(collateralMint)
      .accounts({
        authority: this.provider.wallet.publicKey,
        config,
        mint,
        yieldCollateralConfig,
      })
      .rpc({ commitment: 'confirmed' });
  }

  // ─── Reads ───────────────────────────────────────────────────────────────

  /**
   * Check whether yield-bearing collateral is currently active for the given mint.
   *
   * Reads `StablecoinConfig.feature_flags` from raw on-chain account data.
   *
   * @param mint  The stablecoin mint to inspect.
   * @returns     `true` if FLAG_YIELD_COLLATERAL (bit 3) is set.
   */
  async isActive(mint: PublicKey): Promise<boolean> {
    const [pda] = this.getConfigPda(mint);
    const accountInfo = await this.provider.connection.getAccountInfo(pda);
    if (!accountInfo) return false;
    const flags = this._readFeatureFlags(accountInfo.data);
    return (flags & FLAG_YIELD_COLLATERAL) !== 0n;
  }

  /**
   * Fetch the current whitelist of yield-bearing collateral mints.
   *
   * Uses the Anchor program's account fetcher to decode `YieldCollateralConfig`.
   *
   * @param mint  The stablecoin mint to fetch the whitelist for.
   * @returns     Array of whitelisted collateral `PublicKey`s (empty if not initialized).
   */
  async getWhitelistedMints(mint: PublicKey): Promise<PublicKey[]> {
    const program = await this._loadProgram();
    const [yieldCollateralConfig] = this.getYieldCollateralConfigPda(mint);

    try {
      const account = await program.account.yieldCollateralConfig.fetch(yieldCollateralConfig);
      return (account.whitelistedMints ?? []) as PublicKey[];
    } catch {
      return [];
    }
  }

  // ─── Internals ───────────────────────────────────────────────────────────

  /**
   * Parse `feature_flags` (u64 LE) from raw `StablecoinConfig` account data.
   *
   * Layout (correct on-chain StablecoinConfig field order):
   * ```
   * [0..8]     discriminator
   * [8..40]    mint (Pubkey, 32)
   * [40..72]   authority (Pubkey, 32)
   * [72..104]  compliance_authority (Pubkey, 32)
   * [104..105] preset (u8, 1)
   * [105..106] paused (bool, 1)
   * [106..114] total_minted (u64, 8)
   * [114..122] total_burned (u64, 8)
   * [122..154] transfer_hook_program (Pubkey, 32)
   * [154..186] collateral_mint (Pubkey, 32)
   * [186..218] reserve_vault (Pubkey, 32)
   * [218..226] total_collateral (u64, 8)
   * [226..234] max_supply (u64, 8)
   * [234..266] pending_authority (Pubkey, 32)
   * [266..298] pending_compliance_authority (Pubkey, 32)
   * [298..306] feature_flags (u64 LE, 8)
   * ```
   * @internal
   */
  private _readFeatureFlags(data: Buffer): bigint {
    const OFFSET = 298; // 8 + 32 + 32 + 32 + 1 + 1 + 8 + 8 + 32 + 32 + 32 + 8 + 8 + 32 + 32
    if (data.length < OFFSET + 8) return 0n;
    return data.readBigUInt64LE(OFFSET);
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
    this._program = new AnchorProgram({ ...idl as any, address: this.programId.toBase58() }, this.provider) as any;
    return this._program;
  }
}

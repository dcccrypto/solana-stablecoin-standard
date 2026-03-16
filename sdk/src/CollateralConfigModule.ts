import { PublicKey, TransactionSignature } from '@solana/web3.js';
import { AnchorProvider } from '@coral-xyz/anchor';

// ─── Constants ────────────────────────────────────────────────────────────────

/** PDA seed for CollateralConfig accounts (SSS-098). */
export const COLLATERAL_CONFIG_SEED = Buffer.from('collateral-config');

/** Stablecoin config PDA seed (mirrors on-chain). */
const STABLECOIN_CONFIG_SEED = Buffer.from('stablecoin-config');

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * On-chain state of a `CollateralConfig` PDA (SSS-098).
 *
 * Each SSS-3 stablecoin may have one `CollateralConfig` per collateral mint.
 * The CDP module consults this PDA to enforce per-collateral risk parameters.
 */
export interface CollateralConfigAccount {
  /** The SSS-3 stablecoin mint this config belongs to. */
  sssMint: PublicKey;
  /** The collateral token mint. */
  collateralMint: PublicKey;
  /** When false, CDP deposits for this mint are rejected. */
  whitelisted: boolean;
  /** Maximum loan-to-value ratio in basis points (e.g. 7500 = 75%). */
  maxLtvBps: number;
  /** Collateral ratio below which a position becomes liquidatable. Must be > maxLtvBps. */
  liquidationThresholdBps: number;
  /** Extra collateral awarded to the liquidator, in basis points (max 5000 = 50%). */
  liquidationBonusBps: number;
  /** Maximum total deposited amount for this collateral (0n = unlimited). */
  maxDepositCap: bigint;
  /** Running total of collateral deposited through CDP (informational). */
  totalDeposited: bigint;
}

/**
 * Parameters for `registerCollateral`.
 */
export interface RegisterCollateralParams {
  /** The SSS-3 stablecoin mint. */
  mint: PublicKey;
  /** The collateral token mint to register. */
  collateralMint: PublicKey;
  /** Whether this collateral mint is immediately whitelisted for CDP deposits. */
  whitelisted: boolean;
  /**
   * Maximum loan-to-value in basis points (e.g. 7500 = 75%).
   * Must be < `liquidationThresholdBps`.
   */
  maxLtvBps: number;
  /**
   * Liquidation threshold in basis points.
   * Must be > `maxLtvBps`.
   */
  liquidationThresholdBps: number;
  /**
   * Bonus paid to liquidators in basis points (max 5000 = 50%).
   */
  liquidationBonusBps: number;
  /**
   * Maximum total deposit cap for this collateral (0n = unlimited).
   */
  maxDepositCap: bigint;
}

/**
 * Parameters for `updateCollateralConfig`.
 */
export interface UpdateCollateralConfigParams {
  /** The SSS-3 stablecoin mint. */
  mint: PublicKey;
  /** The collateral token mint to update. */
  collateralMint: PublicKey;
  /** Updated whitelist status. */
  whitelisted: boolean;
  /** Updated max LTV in basis points. */
  maxLtvBps: number;
  /** Updated liquidation threshold in basis points. */
  liquidationThresholdBps: number;
  /** Updated liquidation bonus in basis points. */
  liquidationBonusBps: number;
  /** Updated deposit cap (0n = unlimited). */
  maxDepositCap: bigint;
}

// ─── CollateralConfigModule ───────────────────────────────────────────────────

/**
 * CollateralConfigModule — SDK client for the SSS per-collateral configuration
 * feature (SSS-098).
 *
 * Manages `CollateralConfig` PDAs that encode per-collateral LTV, liquidation
 * threshold/bonus, and deposit cap.  The CDP module reads these on every
 * deposit to enforce risk parameters and whitelist restrictions.
 *
 * **Preset restriction**: Only SSS-3 (reserve-backed) stablecoins support
 * per-collateral configuration. The on-chain program enforces `config.preset == 3`.
 *
 * @example
 * ```ts
 * import { CollateralConfigModule } from '@sss/sdk';
 *
 * const cc = new CollateralConfigModule(provider, programId);
 * await cc.registerCollateral({
 *   mint: sssMint,
 *   collateralMint: usdcMint,
 *   whitelisted: true,
 *   maxLtvBps: 7500,
 *   liquidationThresholdBps: 8000,
 *   liquidationBonusBps: 500,
 *   maxDepositCap: 0n,           // unlimited
 * });
 *
 * const config = await cc.getCollateralConfig(sssMint, usdcMint);
 * console.log(config?.maxLtvBps); // 7500
 * ```
 */
export class CollateralConfigModule {
  constructor(
    public readonly provider: AnchorProvider,
    public readonly programId: PublicKey,
  ) {}

  // ─── PDA derivation ─────────────────────────────────────────────────────

  /**
   * Derive the `StablecoinConfig` PDA for the given mint.
   *
   * Seeds: `[b"stablecoin-config", mint]`
   */
  getConfigPda(mint: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [STABLECOIN_CONFIG_SEED, mint.toBuffer()],
      this.programId,
    );
  }

  /**
   * Derive the `CollateralConfig` PDA for a given stablecoin + collateral mint pair.
   *
   * Seeds: `[b"collateral-config", sssMint, collateralMint]`
   */
  getCollateralConfigPda(sssMint: PublicKey, collateralMint: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [COLLATERAL_CONFIG_SEED, sssMint.toBuffer(), collateralMint.toBuffer()],
      this.programId,
    );
  }

  // ─── Transactions ────────────────────────────────────────────────────────

  /**
   * Register a new collateral mint for an SSS-3 stablecoin.
   *
   * Creates the `CollateralConfig` PDA on-chain. Caller must be the stablecoin
   * authority. Can only be called once per `(sssMint, collateralMint)` pair.
   *
   * @param params  Registration parameters including LTV and liquidation settings.
   * @returns       Transaction signature.
   */
  async registerCollateral(params: RegisterCollateralParams): Promise<TransactionSignature> {
    const {
      mint,
      collateralMint,
      whitelisted,
      maxLtvBps,
      liquidationThresholdBps,
      liquidationBonusBps,
      maxDepositCap,
    } = params;

    const program = await this._loadProgram();
    const [config] = this.getConfigPda(mint);
    const [collateralConfig] = this.getCollateralConfigPda(mint, collateralMint);

    const { BN } = await import('@coral-xyz/anchor');

    return program.methods
      .registerCollateral({
        whitelisted,
        maxLtvBps,
        liquidationThresholdBps,
        liquidationBonusBps,
        maxDepositCap: new BN(maxDepositCap.toString()),
      })
      .accounts({
        authority: this.provider.wallet.publicKey,
        config,
        sssMint: mint,
        collateralMint,
        collateralConfig,
        systemProgram: (await import('@solana/web3.js')).SystemProgram.programId,
      })
      .rpc({ commitment: 'confirmed' });
  }

  /**
   * Update parameters on an existing `CollateralConfig` PDA.
   *
   * Caller must be the stablecoin authority. The collateral mint's
   * `CollateralConfig` PDA must already exist (use `registerCollateral` first).
   *
   * @param params  Updated risk parameters.
   * @returns       Transaction signature.
   */
  async updateCollateralConfig(params: UpdateCollateralConfigParams): Promise<TransactionSignature> {
    const {
      mint,
      collateralMint,
      whitelisted,
      maxLtvBps,
      liquidationThresholdBps,
      liquidationBonusBps,
      maxDepositCap,
    } = params;

    const program = await this._loadProgram();
    const [config] = this.getConfigPda(mint);
    const [collateralConfig] = this.getCollateralConfigPda(mint, collateralMint);

    const { BN } = await import('@coral-xyz/anchor');

    return program.methods
      .updateCollateralConfig({
        whitelisted,
        maxLtvBps,
        liquidationThresholdBps,
        liquidationBonusBps,
        maxDepositCap: new BN(maxDepositCap.toString()),
      })
      .accounts({
        authority: this.provider.wallet.publicKey,
        config,
        sssMint: mint,
        collateralMint,
        collateralConfig,
      })
      .rpc({ commitment: 'confirmed' });
  }

  // ─── Reads ───────────────────────────────────────────────────────────────

  /**
   * Fetch the `CollateralConfig` account for a given stablecoin + collateral mint pair.
   *
   * Returns `null` if the PDA has not been initialized.
   *
   * @param sssMint         The SSS-3 stablecoin mint.
   * @param collateralMint  The collateral token mint.
   * @returns               Decoded `CollateralConfigAccount` or `null`.
   */
  async getCollateralConfig(
    sssMint: PublicKey,
    collateralMint: PublicKey,
  ): Promise<CollateralConfigAccount | null> {
    const program = await this._loadProgram();
    const [pda] = this.getCollateralConfigPda(sssMint, collateralMint);

    try {
      const raw = await program.account.collateralConfig.fetch(pda);
      return {
        sssMint: raw.sssMint as PublicKey,
        collateralMint: raw.collateralMint as PublicKey,
        whitelisted: raw.whitelisted as boolean,
        maxLtvBps: raw.maxLtvBps as number,
        liquidationThresholdBps: raw.liquidationThresholdBps as number,
        liquidationBonusBps: raw.liquidationBonusBps as number,
        maxDepositCap: BigInt(raw.maxDepositCap.toString()),
        totalDeposited: BigInt(raw.totalDeposited.toString()),
      };
    } catch {
      return null;
    }
  }

  /**
   * Check whether a collateral mint is currently whitelisted for an SSS-3 stablecoin.
   *
   * Returns `false` if the `CollateralConfig` PDA does not exist.
   *
   * @param sssMint         The SSS-3 stablecoin mint.
   * @param collateralMint  The collateral token mint to check.
   * @returns               `true` if whitelisted.
   */
  async isWhitelisted(sssMint: PublicKey, collateralMint: PublicKey): Promise<boolean> {
    const config = await this.getCollateralConfig(sssMint, collateralMint);
    return config?.whitelisted ?? false;
  }

  // ─── Internals ───────────────────────────────────────────────────────────

  /** @internal */
  private _program: any | null = null;
  private async _loadProgram(): Promise<any> {
    if (this._program) return this._program;
    const { Program: AnchorProgram } = await import('@coral-xyz/anchor');
    const idl = await import('./idl/sss_token.json');
    this._program = new AnchorProgram(idl as any, this.provider) as any;
    return this._program;
  }
}

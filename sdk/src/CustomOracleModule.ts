import { PublicKey, TransactionSignature } from '@solana/web3.js';
import { AnchorProvider, BN } from '@coral-xyz/anchor';
import { TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Parameters for `initCustomPriceFeed`.
 */
export interface InitCustomPriceFeedParams {
  /** The SSS-3 stablecoin mint. */
  mint: PublicKey;
}

/**
 * Parameters for `updateCustomPrice`.
 */
export interface UpdateCustomPriceParams {
  /** The SSS-3 stablecoin mint. */
  mint: PublicKey;
  /**
   * The new price value (raw integer, sign-aware).
   * Combined with `expo`, the actual price is `price * 10^expo`.
   */
  price: bigint | number;
  /**
   * Price exponent (e.g. -8 means price is denominated in 1e-8 units).
   */
  expo: number;
  /** Confidence interval around the price (same units as `price`). */
  conf: bigint | number;
}

/**
 * Parameters for `setOracleConfig`.
 */
export interface SetOracleConfigParams {
  /** The stablecoin mint. */
  mint: PublicKey;
  /**
   * Oracle type:
   *   - `0` = Pyth
   *   - `1` = Switchboard
   *   - `2` = Custom
   */
  oracleType: number;
  /** The oracle feed pubkey (Pyth price account, Switchboard feed, or CustomPriceFeed PDA). */
  oracleFeed: PublicKey;
}

// ─── CustomOracleModule ───────────────────────────────────────────────────────

/**
 * CustomOracleModule — SDK client for the SSS custom oracle system (SSS-119).
 *
 * Wraps `init_custom_price_feed`, `update_custom_price`, and
 * `set_oracle_config` Anchor instructions.
 *
 * ## Workflow
 * 1. Authority calls `initCustomPriceFeed` to create the `CustomPriceFeed` PDA.
 * 2. Authority calls `setOracleConfig` to configure the stablecoin to use
 *    oracle type 2 (Custom) and point at the `CustomPriceFeed` PDA.
 * 3. Authority calls `updateCustomPrice` to publish new price data.
 *
 * @example
 * ```ts
 * import { CustomOracleModule } from '@sss/sdk';
 *
 * const oracle = new CustomOracleModule(provider, programId);
 *
 * // 1. Initialise feed
 * await oracle.initCustomPriceFeed({ mint });
 *
 * // 2. Set oracle config to custom (type=2)
 * const [feedPda] = oracle.getCustomPriceFeedPda(mint);
 * await oracle.setOracleConfig({ mint, oracleType: 2, oracleFeed: feedPda });
 *
 * // 3. Publish price
 * await oracle.updateCustomPrice({ mint, price: 100_000_000n, expo: -8, conf: 50_000n });
 * ```
 */
export class CustomOracleModule {
  private readonly provider: AnchorProvider;
  private readonly programId: PublicKey;

  static readonly CONFIG_SEED = Buffer.from('stablecoin-config');
  static readonly CUSTOM_PRICE_FEED_SEED = Buffer.from('custom-price-feed');

  /**
   * @param provider   Anchor provider (wallet must be the stablecoin authority).
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
      [CustomOracleModule.CONFIG_SEED, mint.toBuffer()],
      this.programId
    );
  }

  /**
   * Derive the `CustomPriceFeed` PDA for the given mint.
   *
   * Seeds: `[b"custom-price-feed", sss_mint]`
   */
  getCustomPriceFeedPda(mint: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [CustomOracleModule.CUSTOM_PRICE_FEED_SEED, mint.toBuffer()],
      this.programId
    );
  }

  // ─── Writes ──────────────────────────────────────────────────────────────

  /**
   * Initialise the `CustomPriceFeed` PDA for the given stablecoin mint.
   *
   * Calls `init_custom_price_feed` on the SSS token program.
   * Authority-only. Preset-3 (oracle_type=2) stablecoins only.
   * Must be called before `updateCustomPrice` or CDP borrows with oracle_type=2.
   *
   * @param params  `{ mint }`
   * @returns       Transaction signature.
   */
  async initCustomPriceFeed(params: InitCustomPriceFeedParams): Promise<TransactionSignature> {
    const { mint } = params;
    const program = await this._loadProgram();
    const [config] = this.getConfigPda(mint);
    const [customPriceFeed] = this.getCustomPriceFeedPda(mint);

    return program.methods
      .initCustomPriceFeed()
      .accounts({
        authority: this.provider.wallet.publicKey,
        config,
        sssMint: mint,
        customPriceFeed,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: PublicKey.default,
      })
      .rpc({ commitment: 'confirmed' });
  }

  /**
   * Publish a new price to the `CustomPriceFeed` PDA.
   *
   * Calls `update_custom_price` on the SSS token program.
   * Authority-only. `price` must be > 0; `expo` is the price exponent (e.g. -8).
   *
   * @param params  `{ mint, price, expo, conf }`
   * @returns       Transaction signature.
   */
  async updateCustomPrice(params: UpdateCustomPriceParams): Promise<TransactionSignature> {
    const { mint, price, expo, conf } = params;
    const program = await this._loadProgram();
    const [config] = this.getConfigPda(mint);
    const [customPriceFeed] = this.getCustomPriceFeedPda(mint);

    return program.methods
      .updateCustomPrice(
        new BN(price.toString()),
        expo,
        new BN(conf.toString())
      )
      .accounts({
        authority: this.provider.wallet.publicKey,
        config,
        sssMint: mint,
        customPriceFeed,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc({ commitment: 'confirmed' });
  }

  /**
   * Set the oracle type and feed address on a `StablecoinConfig`.
   *
   * Calls `set_oracle_config` on the SSS token program.
   * Authority-only. Requires timelock when `admin_timelock_delay > 0`.
   *
   * @param params  `{ mint, oracleType, oracleFeed }`
   * @returns       Transaction signature.
   */
  async setOracleConfig(params: SetOracleConfigParams): Promise<TransactionSignature> {
    const { mint, oracleType, oracleFeed } = params;
    const program = await this._loadProgram();
    const [config] = this.getConfigPda(mint);

    return program.methods
      .setOracleConfig(oracleType, oracleFeed)
      .accounts({
        authority: this.provider.wallet.publicKey,
        config,
        mint,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc({ commitment: 'confirmed' });
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
    this._program = new AnchorProgram({ ...idl as any, address: this.programId.toBase58() }, this.provider) as any;
    return this._program;
  }
}

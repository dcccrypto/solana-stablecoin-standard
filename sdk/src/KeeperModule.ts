import { PublicKey, TransactionSignature } from '@solana/web3.js';
import { AnchorProvider } from '@coral-xyz/anchor';

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Parameters for `addAuthorizedKeeper`.
 */
export interface AddAuthorizedKeeperParams {
  /** The stablecoin mint (used to derive the config PDA). */
  mint: PublicKey;
  /** Pubkey of the keeper to whitelist. */
  keeper: PublicKey;
}

/**
 * Parameters for `removeAuthorizedKeeper`.
 */
export interface RemoveAuthorizedKeeperParams {
  /** The stablecoin mint (used to derive the config PDA). */
  mint: PublicKey;
  /** Pubkey of the keeper to remove from the whitelist. */
  keeper: PublicKey;
}

/**
 * Parameters for `migrateConfig`.
 */
export interface MigrateConfigParams {
  /** The stablecoin mint. */
  mint: PublicKey;
}

// ─── KeeperModule ─────────────────────────────────────────────────────────────

/**
 * KeeperModule — SDK client for keeper whitelist and config migration
 * operations on the SSS token program (BUG-015, SSS-122).
 *
 * Wraps `add_authorized_keeper`, `remove_authorized_keeper`, and
 * `migrate_config` Anchor instructions.
 *
 * ## Keeper Whitelist (BUG-015)
 * The stability-fee keeper whitelist controls which pubkeys are authorised
 * to call keeper-gated instructions (e.g. collect stability fee).
 *
 * ## Config Migration (SSS-122)
 * `migrateConfig` migrates a `StablecoinConfig` PDA from v0 → current schema.
 * The call is idempotent — safe to call on already-migrated configs. Required
 * before `mint`/`burn`/`redeem` on configs created by a pre-SSS-122 build.
 *
 * @example
 * ```ts
 * import { KeeperModule } from '@sss/sdk';
 *
 * const keeper = new KeeperModule(provider, programId);
 *
 * // Add a keeper to the whitelist
 * await keeper.addAuthorizedKeeper({ mint, keeper: keeperPubkey });
 *
 * // Remove a keeper
 * await keeper.removeAuthorizedKeeper({ mint, keeper: keeperPubkey });
 *
 * // Migrate a legacy config
 * await keeper.migrateConfig({ mint });
 * ```
 */
export class KeeperModule {
  private readonly provider: AnchorProvider;
  private readonly programId: PublicKey;

  static readonly CONFIG_SEED = Buffer.from('stablecoin-config');

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
      [KeeperModule.CONFIG_SEED, mint.toBuffer()],
      this.programId
    );
  }

  // ─── Writes ──────────────────────────────────────────────────────────────

  /**
   * Add a keeper pubkey to the stability-fee keeper whitelist.
   *
   * Calls `add_authorized_keeper` on the SSS token program (BUG-015).
   * Authority-only.
   *
   * @param params  `{ mint, keeper }`
   * @returns       Transaction signature.
   */
  async addAuthorizedKeeper(params: AddAuthorizedKeeperParams): Promise<TransactionSignature> {
    const { mint, keeper } = params;
    const program = await this._loadProgram();
    const [config] = this.getConfigPda(mint);

    return program.methods
      .addAuthorizedKeeper(keeper)
      .accounts({
        authority: this.provider.wallet.publicKey,
        config,
      })
      .rpc({ commitment: 'confirmed' });
  }

  /**
   * Remove a keeper pubkey from the stability-fee keeper whitelist.
   *
   * Calls `remove_authorized_keeper` on the SSS token program (BUG-015).
   * Authority-only.
   *
   * @param params  `{ mint, keeper }`
   * @returns       Transaction signature.
   */
  async removeAuthorizedKeeper(params: RemoveAuthorizedKeeperParams): Promise<TransactionSignature> {
    const { mint, keeper } = params;
    const program = await this._loadProgram();
    const [config] = this.getConfigPda(mint);

    return program.methods
      .removeAuthorizedKeeper(keeper)
      .accounts({
        authority: this.provider.wallet.publicKey,
        config,
      })
      .rpc({ commitment: 'confirmed' });
  }

  /**
   * Migrate a `StablecoinConfig` PDA from v0 → current schema (SSS-122).
   *
   * Idempotent — safe to call on already-migrated configs.
   * Required before `mint`/`burn`/`redeem` on configs created by a
   * pre-SSS-122 build.
   *
   * Only the stablecoin authority may trigger migration.
   *
   * @param params  `{ mint }`
   * @returns       Transaction signature.
   */
  async migrateConfig(params: MigrateConfigParams): Promise<TransactionSignature> {
    const { mint } = params;
    const program = await this._loadProgram();
    const [config] = this.getConfigPda(mint);

    return program.methods
      .migrateConfig()
      .accounts({
        authority: this.provider.wallet.publicKey,
        mint,
        config,
        systemProgram: PublicKey.default,
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

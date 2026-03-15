import { PublicKey, TransactionSignature } from '@solana/web3.js';
import { AnchorProvider, BN } from '@coral-xyz/anchor';

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Bit flag for the circuit-breaker feature.
 *
 * When this flag is set in `StablecoinConfig.feature_flags`, all
 * mint and burn operations are halted until the flag is cleared.
 *
 * Matches `FLAG_CIRCUIT_BREAKER` in the Anchor program (bit 0 = 0x01).
 *
 * @example
 * ```ts
 * const active = featureFlags.isFeatureFlagSet(mint, FLAG_CIRCUIT_BREAKER);
 * ```
 */
export const FLAG_CIRCUIT_BREAKER = 1n << 0n; // 0x01

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Parameters for `setFeatureFlag` and `clearFeatureFlag`.
 */
export interface FeatureFlagParams {
  /** The stablecoin mint whose config will be updated. */
  mint: PublicKey;
  /** The feature flag bit to set or clear (e.g. `FLAG_CIRCUIT_BREAKER`). */
  flag: bigint;
}

// ─── FeatureFlagsModule ───────────────────────────────────────────────────────

/**
 * FeatureFlagsModule — SDK client for the SSS feature-flags system (SSS-059).
 *
 * Wraps `set_feature_flag`, `clear_feature_flag` anchor instructions and
 * provides a pure client-side `isFeatureFlagSet` helper that reads
 * `StablecoinConfig.feature_flags` from on-chain data.
 *
 * **Circuit-breaker pattern**: set `FLAG_CIRCUIT_BREAKER` to halt all
 * mint/burn operations without pausing the whole token; clear it to resume.
 *
 * @example
 * ```ts
 * import { FeatureFlagsModule, FLAG_CIRCUIT_BREAKER } from '@sss/sdk';
 *
 * const ff = new FeatureFlagsModule(provider, programId);
 *
 * // Enable circuit breaker
 * await ff.setFeatureFlag({ mint, flag: FLAG_CIRCUIT_BREAKER });
 *
 * // Check status
 * const active = await ff.isFeatureFlagSet(mint, FLAG_CIRCUIT_BREAKER);
 * console.log('Circuit breaker active:', active);
 *
 * // Resume operations
 * await ff.clearFeatureFlag({ mint, flag: FLAG_CIRCUIT_BREAKER });
 * ```
 */
export class FeatureFlagsModule {
  private readonly provider: AnchorProvider;
  private readonly programId: PublicKey;

  static readonly CONFIG_SEED = Buffer.from('stablecoin-config');

  /**
   * @param provider   Anchor provider (wallet must be the admin authority to
   *                   call set/clear).
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
      [FeatureFlagsModule.CONFIG_SEED, mint.toBuffer()],
      this.programId
    );
  }

  // ─── Writes ──────────────────────────────────────────────────────────────

  /**
   * Set a feature flag bit on the `StablecoinConfig` for this mint.
   *
   * Calls the `set_feature_flag` instruction on the SSS token program.
   * The wallet in `provider` must be the current admin authority.
   *
   * @param params  `{ mint, flag }` — which mint and which flag bit.
   * @returns       Transaction signature.
   * @throws        If the signer is not the admin authority.
   */
  async setFeatureFlag(params: FeatureFlagParams): Promise<TransactionSignature> {
    const { mint, flag } = params;
    const program = await this._loadProgram();
    const [config] = this.getConfigPda(mint);

    return program.methods
      .setFeatureFlag(new BN(flag.toString()))
      .accounts({
        authority: this.provider.wallet.publicKey,
        mint,
        config,
      })
      .rpc({ commitment: 'confirmed' });
  }

  /**
   * Clear a feature flag bit on the `StablecoinConfig` for this mint.
   *
   * Calls the `clear_feature_flag` instruction on the SSS token program.
   * The wallet in `provider` must be the current admin authority.
   *
   * @param params  `{ mint, flag }` — which mint and which flag bit.
   * @returns       Transaction signature.
   * @throws        If the signer is not the admin authority.
   */
  async clearFeatureFlag(params: FeatureFlagParams): Promise<TransactionSignature> {
    const { mint, flag } = params;
    const program = await this._loadProgram();
    const [config] = this.getConfigPda(mint);

    return program.methods
      .clearFeatureFlag(new BN(flag.toString()))
      .accounts({
        authority: this.provider.wallet.publicKey,
        mint,
        config,
      })
      .rpc({ commitment: 'confirmed' });
  }

  // ─── Reads ───────────────────────────────────────────────────────────────

  /**
   * Check whether a specific feature flag bit is set for the given mint.
   *
   * Reads `StablecoinConfig.feature_flags` by parsing the raw on-chain
   * account data.  Does **not** require an IDL — works with the raw
   * account layout.
   *
   * `StablecoinConfig` layout (after discriminator):
   * ```
   * [0..8]   discriminator
   * [8..40]  mint          (Pubkey, 32 bytes)
   * [40..72] authority     (Pubkey, 32 bytes)
   * [72..104] comp_authority (Pubkey, 32 bytes)
   * [104..136] pending_authority (Pubkey, 32 bytes)
   * [136..168] pending_comp_authority (Pubkey, 32 bytes)
   * [168..169] preset        (u8, 1 byte)
   * [169..177] feature_flags (u64, 8 bytes LE)
   * ...
   * ```
   *
   * @param mint  The stablecoin mint to inspect.
   * @param flag  The flag bit to test (e.g. `FLAG_CIRCUIT_BREAKER`).
   * @returns     `true` if the flag is set, `false` if not or if the account
   *              doesn't exist yet.
   */
  async isFeatureFlagSet(mint: PublicKey, flag: bigint): Promise<boolean> {
    const [pda] = this.getConfigPda(mint);
    const accountInfo = await this.provider.connection.getAccountInfo(pda);
    if (!accountInfo) return false;

    const flags = this._readFeatureFlags(accountInfo.data);
    return (flags & flag) !== 0n;
  }

  /**
   * Read the raw `feature_flags` u64 from the `StablecoinConfig` for the
   * given mint.  Returns `0n` if the account does not exist.
   *
   * @param mint  The stablecoin mint to inspect.
   */
  async getFeatureFlags(mint: PublicKey): Promise<bigint> {
    const [pda] = this.getConfigPda(mint);
    const accountInfo = await this.provider.connection.getAccountInfo(pda);
    if (!accountInfo) return 0n;
    return this._readFeatureFlags(accountInfo.data);
  }

  // ─── Internals ───────────────────────────────────────────────────────────

  /**
   * Parse `feature_flags` from raw `StablecoinConfig` account data.
   *
   * Layout offsets (see `isFeatureFlagSet` JSDoc for full layout):
   * - discriminator: 8 bytes
   * - 5× Pubkey: 5 × 32 = 160 bytes  → offset 8
   * - preset (u8): 1 byte            → offset 168
   * - feature_flags (u64 LE): 8 bytes → offset 169
   *
   * @internal
   */
  private _readFeatureFlags(data: Buffer): bigint {
    const FEATURE_FLAGS_OFFSET = 8 + 5 * 32 + 1; // 169
    if (data.length < FEATURE_FLAGS_OFFSET + 8) return 0n;
    return data.readBigUInt64LE(FEATURE_FLAGS_OFFSET);
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

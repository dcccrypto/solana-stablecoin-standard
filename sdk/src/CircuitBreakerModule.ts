import { PublicKey, TransactionSignature } from '@solana/web3.js';
import { AnchorProvider, BN } from '@coral-xyz/anchor';

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Bit flag for the circuit-breaker feature (on-chain canonical value: bit 0).
 *
 * When this flag is set in `StablecoinConfig.feature_flags`, all mint and burn
 * operations are halted until the flag is cleared.
 *
 * Matches `FLAG_CIRCUIT_BREAKER` in the Anchor program (bit 0 = 0x01) per
 * `programs/sss-token/src/state.rs`.
 *
 * Note: `FeatureFlagsModule` exports a legacy `FLAG_CIRCUIT_BREAKER` constant
 * at bit 7 (0x80) for backwards compatibility. Use this module for the correct
 * on-chain bit.
 *
 * @example
 * ```ts
 * import { CircuitBreakerModule, FLAG_CIRCUIT_BREAKER_V2 } from '@sss/sdk';
 *
 * const cb = new CircuitBreakerModule(provider, programId);
 * await cb.trigger({ mint });        // halt operations
 * const active = await cb.isTriggered(mint);
 * await cb.release({ mint });        // resume operations
 * ```
 */
export const FLAG_CIRCUIT_BREAKER_V2 = 1n << 0n; // 0x01

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Parameters for `trigger` and `release`.
 */
export interface CircuitBreakerParams {
  /** The stablecoin mint to activate/deactivate the circuit breaker for. */
  mint: PublicKey;
}

/**
 * Current circuit-breaker state for a mint.
 */
export interface CircuitBreakerState {
  /** Whether the circuit breaker is currently active (mint/burn halted). */
  triggered: boolean;
  /** Raw feature_flags bitmask from StablecoinConfig. */
  flags: bigint;
}

// ─── CircuitBreakerModule ────────────────────────────────────────────────────

/**
 * CircuitBreakerModule — SDK client for the SSS circuit-breaker feature (bit 0).
 *
 * Wraps the `set_feature_flag` and `clear_feature_flag` Anchor instructions
 * to enable/disable the circuit breaker. When triggered, all mint and burn
 * operations are rejected by the on-chain program.
 *
 * @example
 * ```ts
 * import { CircuitBreakerModule } from '@sss/sdk';
 *
 * const cb = new CircuitBreakerModule(provider, programId);
 *
 * // Halt operations
 * await cb.trigger({ mint });
 *
 * // Check state
 * const { triggered, flags } = await cb.getState(mint);
 * console.log('Circuit breaker active:', triggered);
 *
 * // Resume operations
 * await cb.release({ mint });
 * ```
 */
export class CircuitBreakerModule {
  private readonly provider: AnchorProvider;
  private readonly programId: PublicKey;

  static readonly CONFIG_SEED = Buffer.from('stablecoin-config');

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
      [CircuitBreakerModule.CONFIG_SEED, mint.toBuffer()],
      this.programId
    );
  }

  // ─── Writes ──────────────────────────────────────────────────────────────

  /**
   * Trigger the circuit breaker for the given mint.
   *
   * Sets `FLAG_CIRCUIT_BREAKER_V2` on `StablecoinConfig.feature_flags`.
   * The wallet in `provider` must be the current admin authority.
   *
   * @param params  `{ mint }` — the stablecoin mint to halt.
   * @returns       Transaction signature.
   */
  async trigger(params: CircuitBreakerParams): Promise<TransactionSignature> {
    const { mint } = params;
    const program = await this._loadProgram();
    const [config] = this.getConfigPda(mint);

    return program.methods
      .setFeatureFlag(new BN(FLAG_CIRCUIT_BREAKER_V2.toString()))
      .accounts({
        authority: this.provider.wallet.publicKey,
        mint,
        config,
      })
      .rpc({ commitment: 'confirmed' });
  }

  /**
   * Release the circuit breaker for the given mint.
   *
   * Clears `FLAG_CIRCUIT_BREAKER_V2` from `StablecoinConfig.feature_flags`.
   * The wallet in `provider` must be the current admin authority.
   *
   * @param params  `{ mint }` — the stablecoin mint to resume.
   * @returns       Transaction signature.
   */
  async release(params: CircuitBreakerParams): Promise<TransactionSignature> {
    const { mint } = params;
    const program = await this._loadProgram();
    const [config] = this.getConfigPda(mint);

    return program.methods
      .clearFeatureFlag(new BN(FLAG_CIRCUIT_BREAKER_V2.toString()))
      .accounts({
        authority: this.provider.wallet.publicKey,
        mint,
        config,
      })
      .rpc({ commitment: 'confirmed' });
  }

  // ─── Reads ───────────────────────────────────────────────────────────────

  /**
   * Check whether the circuit breaker is currently active for the given mint.
   *
   * Reads `StablecoinConfig.feature_flags` from on-chain data without an IDL.
   *
   * @param mint  The stablecoin mint to inspect.
   * @returns     `true` if the circuit breaker is triggered, `false` otherwise.
   */
  async isTriggered(mint: PublicKey): Promise<boolean> {
    const [pda] = this.getConfigPda(mint);
    const accountInfo = await this.provider.connection.getAccountInfo(pda);
    if (!accountInfo) return false;
    const flags = this._readFeatureFlags(accountInfo.data);
    return (flags & FLAG_CIRCUIT_BREAKER_V2) !== 0n;
  }

  /**
   * Get the full circuit-breaker state for the given mint.
   *
   * @param mint  The stablecoin mint to inspect.
   * @returns     `{ triggered, flags }` — breaker state and raw flags bitmask.
   */
  async getState(mint: PublicKey): Promise<CircuitBreakerState> {
    const [pda] = this.getConfigPda(mint);
    const accountInfo = await this.provider.connection.getAccountInfo(pda);
    if (!accountInfo) return { triggered: false, flags: 0n };
    const flags = this._readFeatureFlags(accountInfo.data);
    return {
      triggered: (flags & FLAG_CIRCUIT_BREAKER_V2) !== 0n,
      flags,
    };
  }

  // ─── Internals ───────────────────────────────────────────────────────────

  /**
   * Parse `feature_flags` (u64 LE) from raw `StablecoinConfig` account data.
   *
   * Canonical `StablecoinConfig` field layout (from `programs/sss-token/src/state.rs`):
   * ```
   * [0..8]    discriminator
   * [8..40]   mint                        (Pubkey, 32 bytes)
   * [40..72]  authority                   (Pubkey, 32 bytes)
   * [72..104] compliance_authority        (Pubkey, 32 bytes)
   * [104]     preset                      (u8, 1 byte)
   * [105]     paused                      (bool, 1 byte)
   * [106..114] total_minted               (u64, 8 bytes)
   * [114..122] total_burned               (u64, 8 bytes)
   * [122..154] transfer_hook_program      (Pubkey, 32 bytes)
   * [154..186] collateral_mint            (Pubkey, 32 bytes)
   * [186..218] reserve_vault              (Pubkey, 32 bytes)
   * [218..226] total_collateral           (u64, 8 bytes)
   * [226..234] max_supply                 (u64, 8 bytes)
   * [234..266] pending_authority          (Pubkey, 32 bytes)
   * [266..298] pending_compliance_authority (Pubkey, 32 bytes)
   * [298..306] feature_flags              (u64 LE)  ← CANONICAL OFFSET
   * ```
   * @internal
   */
  private _readFeatureFlags(data: Buffer): bigint {
    // disc(8) + mint(32) + authority(32) + compliance_authority(32) +
    // preset(1) + paused(1) + total_minted(8) + total_burned(8) +
    // transfer_hook_program(32) + collateral_mint(32) + reserve_vault(32) +
    // total_collateral(8) + max_supply(8) + pending_authority(32) +
    // pending_compliance_authority(32) = 298
    const FEATURE_FLAGS_OFFSET = 298;
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

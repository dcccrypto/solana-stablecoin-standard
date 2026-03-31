import { PublicKey, TransactionSignature } from '@solana/web3.js';
import { AnchorProvider, BN } from '@coral-xyz/anchor';

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Bit flag for the spend-policy feature (bit 1 = 0x02).
 *
 * When this flag is set in `StablecoinConfig.feature_flags`, each token
 * transfer is checked against `max_transfer_amount`. Transfers exceeding the
 * configured limit are rejected.
 *
 * Matches `FLAG_SPEND_POLICY` in the Anchor program (bit 1 = 0x02) per
 * `programs/sss-token/src/state.rs`.
 *
 * @example
 * ```ts
 * import { SpendPolicyModule, FLAG_SPEND_POLICY } from '@sss/sdk';
 *
 * const sp = new SpendPolicyModule(provider, programId);
 * await sp.setSpendLimit({ mint, maxAmount: 1_000_000n });
 * const active = await sp.isActive(mint);
 * const limit = await sp.getMaxTransferAmount(mint);
 * await sp.clearSpendLimit({ mint });
 * ```
 */
export const FLAG_SPEND_POLICY = 1n << 1n; // 0x02

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Parameters for `setSpendLimit`.
 */
export interface SpendPolicyParams {
  /** The stablecoin mint to configure the spend limit for. */
  mint: PublicKey;
  /**
   * Maximum number of token base units allowed per transfer.
   * Must be > 0. Atomically enables FLAG_SPEND_POLICY.
   */
  maxAmount: bigint;
}

/**
 * Parameters for `clearSpendLimit`.
 */
export interface ClearSpendLimitParams {
  /** The stablecoin mint to clear the spend limit for. */
  mint: PublicKey;
}

// ─── SpendPolicyModule ────────────────────────────────────────────────────────

/**
 * SpendPolicyModule — SDK client for the SSS spend-policy feature (SSS-062).
 *
 * Wraps `set_spend_limit` and `clear_spend_limit` Anchor instructions and
 * provides pure read helpers that inspect `StablecoinConfig` raw account data.
 *
 * When FLAG_SPEND_POLICY is active, the transfer hook enforces the per-tx cap
 * stored in `StablecoinConfig.max_transfer_amount`.
 *
 * @example
 * ```ts
 * import { SpendPolicyModule } from '@sss/sdk';
 *
 * const sp = new SpendPolicyModule(provider, programId);
 *
 * // Set 1 000 token limit (6-decimal: 1 000 * 10^6 = 1_000_000_000)
 * await sp.setSpendLimit({ mint, maxAmount: 1_000_000_000n });
 *
 * // Check if active
 * const active = await sp.isActive(mint);
 *
 * // Read current limit
 * const limit = await sp.getMaxTransferAmount(mint);
 *
 * // Clear the policy
 * await sp.clearSpendLimit({ mint });
 * ```
 */
export class SpendPolicyModule {
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
      [SpendPolicyModule.CONFIG_SEED, mint.toBuffer()],
      this.programId
    );
  }

  // ─── Writes ──────────────────────────────────────────────────────────────

  /**
   * Set the per-transfer spend limit and enable FLAG_SPEND_POLICY.
   *
   * Calls the `set_spend_limit` instruction. The limit is set atomically with
   * the flag so the program is never in a half-configured state.
   *
   * @param params  `{ mint, maxAmount }` — mint and max base-units per transfer.
   * @returns       Transaction signature.
   * @throws        If `maxAmount` is 0 or signer is not the admin authority.
   */
  async setSpendLimit(params: SpendPolicyParams): Promise<TransactionSignature> {
    const { mint, maxAmount } = params;
    const program = await this._loadProgram();
    const [config] = this.getConfigPda(mint);

    return program.methods
      .setSpendLimit(new BN(maxAmount.toString()))
      .accounts({
        authority: this.provider.wallet.publicKey,
        config,
        mint,
      })
      .rpc({ commitment: 'confirmed' });
  }

  /**
   * Clear the per-transfer spend limit and disable FLAG_SPEND_POLICY.
   *
   * Calls the `clear_spend_limit` instruction. Resets `max_transfer_amount`
   * to 0 and clears the flag.
   *
   * @param params  `{ mint }` — the stablecoin mint to clear.
   * @returns       Transaction signature.
   */
  async clearSpendLimit(params: ClearSpendLimitParams): Promise<TransactionSignature> {
    const { mint } = params;
    const program = await this._loadProgram();
    const [config] = this.getConfigPda(mint);

    return program.methods
      .clearSpendLimit()
      .accounts({
        authority: this.provider.wallet.publicKey,
        config,
        mint,
      })
      .rpc({ commitment: 'confirmed' });
  }

  // ─── Reads ───────────────────────────────────────────────────────────────

  /**
   * Check whether the spend policy is currently active for the given mint.
   *
   * Reads `StablecoinConfig.feature_flags` from raw on-chain account data.
   *
   * @param mint  The stablecoin mint to inspect.
   * @returns     `true` if FLAG_SPEND_POLICY (bit 1) is set, `false` otherwise.
   */
  async isActive(mint: PublicKey): Promise<boolean> {
    const [pda] = this.getConfigPda(mint);
    const accountInfo = await this.provider.connection.getAccountInfo(pda);
    if (!accountInfo) return false;
    const flags = this._readFeatureFlags(accountInfo.data);
    return (flags & FLAG_SPEND_POLICY) !== 0n;
  }

  /**
   * Read the current `max_transfer_amount` from `StablecoinConfig`.
   *
   * Returns `0n` if the account does not exist, the data is too short, or no
   * limit has been set.
   *
   * @param mint  The stablecoin mint to inspect.
   * @returns     Max base-units per transfer as bigint (0n = unlimited / unset).
   */
  async getMaxTransferAmount(mint: PublicKey): Promise<bigint> {
    const [pda] = this.getConfigPda(mint);
    const accountInfo = await this.provider.connection.getAccountInfo(pda);
    if (!accountInfo) return 0n;
    return this._readMaxTransferAmount(accountInfo.data);
  }

  // ─── Internals ───────────────────────────────────────────────────────────

  /**
   * `StablecoinConfig` canonical raw layout (from `programs/sss-token/src/state.rs`):
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
   * [306..314] max_transfer_amount        (u64 LE)  ← CANONICAL OFFSET
   * ```
   * @internal
   */
  private _readFeatureFlags(data: Buffer): bigint {
    // disc(8) + mint(32) + authority(32) + compliance_authority(32) +
    // preset(1) + paused(1) + total_minted(8) + total_burned(8) +
    // transfer_hook_program(32) + collateral_mint(32) + reserve_vault(32) +
    // total_collateral(8) + max_supply(8) + pending_authority(32) +
    // pending_compliance_authority(32) = 298
    const OFFSET = 298;
    if (data.length < OFFSET + 8) return 0n;
    return data.readBigUInt64LE(OFFSET);
  }

  /** @internal */
  private _readMaxTransferAmount(data: Buffer): bigint {
    // Immediately after feature_flags (298 + 8 = 306)
    const OFFSET = 306;
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
    this._program = new AnchorProgram(idl as any, this.provider) as any;
    return this._program;
  }
}

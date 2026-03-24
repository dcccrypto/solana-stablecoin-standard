import { PublicKey, TransactionSignature } from '@solana/web3.js';
import { AnchorProvider, BN } from '@coral-xyz/anchor';
import { SSSError } from './error';

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Operation kind: no pending operation.
 * SSS-085: matches `ADMIN_OP_NONE` in the Anchor program.
 */
export const ADMIN_OP_NONE = 0;

/**
 * Operation kind: transfer authority to a new pubkey.
 * SSS-085: matches `ADMIN_OP_TRANSFER_AUTHORITY` in the Anchor program.
 */
export const ADMIN_OP_TRANSFER_AUTHORITY = 1;

/**
 * Operation kind: set one or more feature-flag bits.
 * SSS-085: matches `ADMIN_OP_SET_FEATURE_FLAG` in the Anchor program.
 */
export const ADMIN_OP_SET_FEATURE_FLAG = 2;

/**
 * Operation kind: clear one or more feature-flag bits.
 * SSS-085: matches `ADMIN_OP_CLEAR_FEATURE_FLAG` in the Anchor program.
 */
export const ADMIN_OP_CLEAR_FEATURE_FLAG = 3;

/**
 * Default minimum timelock delay in slots (432 000 slots ≈ 2 Solana epochs ≈ 2 days).
 * SSS-085: matches `DEFAULT_ADMIN_TIMELOCK_DELAY` in the Anchor program.
 */
export const DEFAULT_ADMIN_TIMELOCK_DELAY = 432_000n;

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Admin operation kind discriminant.
 */
export type AdminOpKind =
  | typeof ADMIN_OP_NONE
  | typeof ADMIN_OP_TRANSFER_AUTHORITY
  | typeof ADMIN_OP_SET_FEATURE_FLAG
  | typeof ADMIN_OP_CLEAR_FEATURE_FLAG;

/**
 * Parameters for `proposeTimelockOp`.
 */
export interface ProposeTimelockOpParams {
  /** The stablecoin mint whose config will be updated. */
  mint: PublicKey;
  /**
   * The operation kind:
   * - `ADMIN_OP_TRANSFER_AUTHORITY` (1) — set `target` to the new authority.
   * - `ADMIN_OP_SET_FEATURE_FLAG` (2) — set `param` to the flag bits to enable.
   * - `ADMIN_OP_CLEAR_FEATURE_FLAG` (3) — set `param` to the flag bits to clear.
   */
  opKind: AdminOpKind;
  /**
   * Generic u64 parameter.
   * Used as flag bits for `ADMIN_OP_SET_FEATURE_FLAG` / `ADMIN_OP_CLEAR_FEATURE_FLAG`.
   * Pass `0n` for `ADMIN_OP_TRANSFER_AUTHORITY`.
   */
  param: bigint;
  /**
   * Target pubkey for `ADMIN_OP_TRANSFER_AUTHORITY`.
   * Pass `PublicKey.default` for flag operations.
   */
  target: PublicKey;
}

/**
 * Parameters for `executeTimelockOp` and `cancelTimelockOp`.
 * Both instructions only require the mint to derive the config PDA.
 */
export interface TimelockOpMintParams {
  /** The stablecoin mint. */
  mint: PublicKey;
}

/**
 * Parameters for `setPythFeed`.
 */
export interface SetPythFeedParams {
  /** The stablecoin mint. */
  mint: PublicKey;
  /**
   * The expected Pyth price feed pubkey.
   * After setting, `cdp_borrow_stable` and `cdp_liquidate` will reject any
   * price-feed account that does not match this key (SSS-085 Fix 1).
   */
  feed: PublicKey;
}

/**
 * Decoded pending admin timelock operation, as read from `StablecoinConfig`.
 */
export interface PendingTimelockOp {
  /** Operation kind discriminant (see `ADMIN_OP_*` constants). */
  opKind: AdminOpKind;
  /** Flag bits or 0 depending on `opKind`. */
  param: bigint;
  /** Target pubkey for authority transfer, or default pubkey otherwise. */
  target: PublicKey;
  /** The on-chain slot at which this operation becomes executable. */
  matureSlot: bigint;
  /** Whether there is an active pending operation (opKind !== ADMIN_OP_NONE). */
  isPending: boolean;
}

// ─── Module ───────────────────────────────────────────────────────────────────

/**
 * SDK module for SSS-085 Admin Timelock operations.
 *
 * Critical single-authority admin operations (authority transfer, feature-flag
 * changes) are protected by a mandatory on-chain delay (default ≈ 2 days).
 * This prevents a compromised key from instantly draining the protocol.
 *
 * **Lifecycle**
 * 1. Authority calls `proposeTimelockOp` — stores op + mature slot on-chain.
 * 2. After `matureSlot` is reached, authority calls `executeTimelockOp`.
 * 3. Authority may call `cancelTimelockOp` at any time before execution.
 *
 * @example
 * ```ts
 * import { AdminTimelockModule, ADMIN_OP_TRANSFER_AUTHORITY } from './AdminTimelockModule';
 *
 * const timelock = new AdminTimelockModule(provider, program);
 *
 * // Propose transferring authority to a new key (will mature ~2 days later)
 * await timelock.proposeTimelockOp({
 *   mint,
 *   opKind: ADMIN_OP_TRANSFER_AUTHORITY,
 *   param: 0n,
 *   target: newAuthority,
 * });
 *
 * // Later, once the timelock matures
 * await timelock.executeTimelockOp({ mint });
 * ```
 */
export class AdminTimelockModule {
  constructor(
    private readonly provider: AnchorProvider,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private readonly program: any,
  ) {}

  /**
   * Propose a timelocked admin operation.
   *
   * Overwrites any existing pending operation (only one pending op at a time).
   * The operation will mature after `config.admin_timelock_delay` slots
   * (default: {@link DEFAULT_ADMIN_TIMELOCK_DELAY}).
   *
   * @returns Transaction signature.
   * @throws {SSSError} If `opKind` is `ADMIN_OP_NONE` (0) — a no-op proposal
   *   locks out all admin operations for ~2 days without doing anything useful.
   * @throws If `opKind` is not one of the three valid operation kinds.
   */
  async proposeTimelockOp(params: ProposeTimelockOpParams): Promise<TransactionSignature> {
    const { mint, opKind, param, target } = params;

    // F-2 guard: ADMIN_OP_NONE (0) must never be proposed. It creates a pending
    // no-op that blocks all other admin operations for the full timelock delay
    // (~2 days) without any observable effect. This is a denial-of-service
    // vector — an attacker (or misconfigured caller) can grief the protocol by
    // repeatedly proposing ADMIN_OP_NONE ops.
    if (opKind === ADMIN_OP_NONE) {
      throw new SSSError(
        'proposeTimelockOp: opKind must not be ADMIN_OP_NONE (0). ' +
        'Use ADMIN_OP_TRANSFER_AUTHORITY (1), ADMIN_OP_SET_FEATURE_FLAG (2), ' +
        'or ADMIN_OP_CLEAR_FEATURE_FLAG (3).'
      );
    }

    return this.program.methods
      .proposeTimelockOp(opKind, new BN(param.toString()), target)
      .accounts({
        authority: this.provider.wallet.publicKey,
        mint,
      })
      .rpc();
  }

  /**
   * Execute the pending timelocked admin operation.
   *
   * Requires that `clock.slot >= config.admin_op_mature_slot`.
   * Clears the pending operation on success.
   *
   * @returns Transaction signature.
   * @throws `TimelockNotMature` if the delay has not elapsed.
   * @throws `NoTimelockPending` if no operation is pending.
   */
  async executeTimelockOp(params: TimelockOpMintParams): Promise<TransactionSignature> {
    return this.program.methods
      .executeTimelockOp()
      .accounts({
        authority: this.provider.wallet.publicKey,
        mint: params.mint,
      })
      .rpc();
  }

  /**
   * Cancel the pending timelocked admin operation.
   * Safe to call at any time before execution.
   *
   * @returns Transaction signature.
   * @throws `NoTimelockPending` if no operation is pending.
   */
  async cancelTimelockOp(params: TimelockOpMintParams): Promise<TransactionSignature> {
    return this.program.methods
      .cancelTimelockOp()
      .accounts({
        authority: this.provider.wallet.publicKey,
        mint: params.mint,
      })
      .rpc();
  }

  /**
   * Register the expected Pyth price feed for an SSS-3 stablecoin (SSS-085 Fix 1).
   *
   * After setting, `cdp_borrow_stable` and `cdp_liquidate` will reject any
   * price-feed account that does not match `feed`, blocking price-feed
   * substitution attacks.
   *
   * @returns Transaction signature.
   */
  async setPythFeed(params: SetPythFeedParams): Promise<TransactionSignature> {
    return this.program.methods
      .setPythFeed(params.feed)
      .accounts({
        authority: this.provider.wallet.publicKey,
        mint: params.mint,
      })
      .rpc();
  }

  /**
   * Read the pending timelock operation from an already-fetched config account.
   *
   * @param config — Decoded `StablecoinConfig` account data.
   * @returns A structured {@link PendingTimelockOp}.
   *
   * @example
   * ```ts
   * const config = await program.account.stablecoinConfig.fetch(configPda);
   * const pending = timelock.decodePendingOp(config);
   * if (pending.isPending) {
   *   console.log('matures at slot', pending.matureSlot);
   * }
   * ```
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  decodePendingOp(config: any): PendingTimelockOp {
    const opKind = config.adminOpKind as AdminOpKind;
    return {
      opKind,
      param: BigInt(config.adminOpParam?.toString() ?? '0'),
      target: config.adminOpTarget as PublicKey,
      matureSlot: BigInt(config.adminOpMatureSlot?.toString() ?? '0'),
      isPending: opKind !== ADMIN_OP_NONE,
    };
  }
}

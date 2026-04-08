import { PublicKey, TransactionSignature } from '@solana/web3.js';
import { AnchorProvider, BN } from '@coral-xyz/anchor';

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Bit flag for the Redemption Queue feature (SSS).
 *
 * When this flag is set in `StablecoinConfig.feature_flags`, the redemption
 * queue is active.  Users can enqueue stable-token redemptions, and keepers
 * process them in strict FIFO order after the mandatory delay.
 *
 * Matches `FLAG_REDEMPTION_QUEUE` in the Anchor program (bit 23 = 0x800000).
 *
 * @example
 * ```ts
 * const active = featureFlags.isFeatureFlagSet(mint, FLAG_REDEMPTION_QUEUE);
 * ```
 */
export const FLAG_REDEMPTION_QUEUE = 1n << 23n; // 0x800000

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Parameters for `initRedemptionQueue`.
 */
export interface InitRedemptionQueueParams {
  /** The stablecoin mint. */
  mint: PublicKey;
}

/**
 * Parameters for `enqueueRedemption`.
 */
export interface EnqueueRedemptionParams {
  /** The stablecoin mint. */
  mint: PublicKey;
  /** Amount of stable tokens to redeem (base units). */
  amount: BN | number;
  /** User's stable-token ATA that will be debited. */
  userStableAta: PublicKey;
  /** The stable-token mint (SPL Token-2022). */
  stableMint: PublicKey;
  /** SPL Token program ID (Token-2022 or legacy). */
  tokenProgram: PublicKey;
}

/**
 * Parameters for `processRedemption`.
 */
export interface ProcessRedemptionParams {
  /** The stablecoin mint. */
  mint: PublicKey;
  /** The queue index (u64) of the entry to process. */
  queueIndex: BN | number;
  /** Reserve vault token account (collateral source). */
  reserveVault: PublicKey;
  /** Authority that signs the collateral transfer out of the reserve vault. */
  reserveVaultAuthority: PublicKey;
  /** User's collateral ATA that will receive the payout. */
  userCollateralAta: PublicKey;
  /** The stable-token mint (must be writable for burning). */
  stableMint: PublicKey;
  /** The collateral mint. */
  collateralMint: PublicKey;
  /** SPL Token program ID. */
  tokenProgram: PublicKey;
}

/**
 * Parameters for `cancelRedemption`.
 */
export interface CancelRedemptionParams {
  /** The stablecoin mint. */
  mint: PublicKey;
  /** The queue index (u64) of the entry to cancel. */
  queueIndex: BN | number;
  /** User's stable-token ATA that will receive the refund. */
  userStableAta: PublicKey;
  /** The stable-token mint. */
  stableMint: PublicKey;
  /** SPL Token program ID. */
  tokenProgram: PublicKey;
}

/**
 * Parameters for `updateRedemptionQueue`.
 */
export interface UpdateRedemptionQueueParams {
  /** The stablecoin mint. */
  mint: PublicKey;
  /** Override the minimum delay (in slots) before a queued entry may be processed. */
  minDelaySlots?: BN | number | null;
  /** Override the maximum queue depth. */
  maxQueueDepth?: BN | number | null;
  /** Override the per-slot redemption cap in basis points. */
  maxRedemptionPerSlotBps?: number | null;
  /** Override the keeper reward in lamports. */
  keeperRewardLamports?: BN | number | null;
}

/**
 * Parameters for `compactRedemptionHead`.
 */
export interface CompactRedemptionHeadParams {
  /** The stablecoin mint. */
  mint: PublicKey;
  /** The queue index of the cancelled/fulfilled head entry to skip. */
  headIndex: BN | number;
}

// ─── RedemptionQueueModule ────────────────────────────────────────────────────

/**
 * RedemptionQueueModule — SDK client for the SSS Redemption Queue system.
 *
 * Wraps the following Anchor instructions:
 * - `init_redemption_queue`   — Authority initialises the queue PDA.
 * - `enqueue_redemption`      — User locks stable tokens into a per-entry escrow.
 * - `process_redemption`      — Keeper processes a queued entry after min_delay_slots.
 * - `cancel_redemption`       — Owner cancels their pending redemption entry.
 * - `update_redemption_queue` — Authority updates queue parameters.
 * - `compact_redemption_head` — Permissionless: advance queue head past cancelled entries.
 *
 * ## Workflow
 * 1. Admin calls `initRedemptionQueue` once (requires `FLAG_REDEMPTION_QUEUE` set).
 * 2. Users call `enqueueRedemption` to lock stable tokens and join the queue.
 * 3. After `min_delay_slots`, a keeper calls `processRedemption` for each entry.
 * 4. Users may call `cancelRedemption` to reclaim their stable tokens.
 * 5. If a head entry is cancelled/fulfilled and blocking the queue, anyone can
 *    call `compactRedemptionHead` to advance the pointer.
 *
 * @example
 * ```ts
 * import { RedemptionQueueModule, FLAG_REDEMPTION_QUEUE } from '@sss/sdk';
 *
 * const rq = new RedemptionQueueModule(provider, programId);
 *
 * // 1. Init (admin)
 * await rq.initRedemptionQueue({ mint });
 *
 * // 2. User enqueues
 * await rq.enqueueRedemption({ mint, amount: new BN(1_000_000), userStableAta, stableMint, tokenProgram });
 *
 * // 3. Keeper processes (after delay)
 * await rq.processRedemption({ mint, queueIndex: new BN(0), reserveVault, reserveVaultAuthority, userCollateralAta, stableMint, collateralMint, tokenProgram });
 *
 * // 4. Compact stale head (permissionless)
 * await rq.compactRedemptionHead({ mint, headIndex: new BN(0) });
 * ```
 */
export class RedemptionQueueModule {
  private readonly provider: AnchorProvider;
  private readonly programId: PublicKey;

  static readonly CONFIG_SEED = Buffer.from('stablecoin-config');
  static readonly REDEMPTION_QUEUE_SEED = Buffer.from('redemption-queue');
  static readonly REDEMPTION_ENTRY_SEED = Buffer.from('redemption-entry');
  static readonly QUEUE_ESCROW_SEED = Buffer.from('queue-escrow');

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
   */
  getConfigPda(mint: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [RedemptionQueueModule.CONFIG_SEED, mint.toBuffer()],
      this.programId
    );
  }

  /**
   * Derive the `RedemptionQueue` PDA for the given mint.
   *
   * Seeds: `[b"redemption-queue", config_pubkey]`
   */
  getRedemptionQueuePda(mint: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [RedemptionQueueModule.REDEMPTION_QUEUE_SEED, mint.toBuffer()],
      this.programId
    );
  }

  /**
   * Derive a `RedemptionEntry` PDA for a specific queue index.
   *
   * Seeds: `[b"redemption-entry", config_pubkey, queue_index.to_le_bytes()]`
   */
  getRedemptionEntryPda(mint: PublicKey, queueIndex: BN | number): [PublicKey, number] {
    const idxBuf = Buffer.alloc(8);
    idxBuf.writeBigUInt64LE(BigInt(queueIndex.toString()), 0);
    return PublicKey.findProgramAddressSync(
      [RedemptionQueueModule.REDEMPTION_ENTRY_SEED, mint.toBuffer(), idxBuf],
      this.programId
    );
  }

  /**
   * Derive the per-entry escrow token account PDA for a specific queue index.
   *
   * Seeds: `[b"queue-escrow", config_pubkey, queue_index.to_le_bytes()]`
   */
  getEscrowStablePda(mint: PublicKey, queueIndex: BN | number): [PublicKey, number] {
    const idxBuf = Buffer.alloc(8);
    idxBuf.writeBigUInt64LE(BigInt(queueIndex.toString()), 0);
    return PublicKey.findProgramAddressSync(
      [RedemptionQueueModule.QUEUE_ESCROW_SEED, mint.toBuffer(), idxBuf],
      this.programId
    );
  }

  // ─── Writes ──────────────────────────────────────────────────────────────

  /**
   * Initialise the `RedemptionQueue` PDA for this mint.
   *
   * Calls `init_redemption_queue` on the SSS token program.
   * The wallet in `provider` must be the admin authority of the
   * `StablecoinConfig`.  Requires `FLAG_REDEMPTION_QUEUE` to be set first.
   *
   * @param params  `{ mint }`
   * @returns       Transaction signature.
   */
  async initRedemptionQueue(params: InitRedemptionQueueParams): Promise<TransactionSignature> {
    const { mint } = params;
    const program = await this._loadProgram();
    const [config] = this.getConfigPda(mint);
    const [redemptionQueue] = this.getRedemptionQueuePda(mint);

    return program.methods
      .initRedemptionQueue()
      .accounts({
        authority: this.provider.wallet.publicKey,
        config,
        redemptionQueue,
        systemProgram: PublicKey.default,
      })
      .rpc({ commitment: 'confirmed' });
  }

  /**
   * Enqueue a redemption request.
   *
   * Caller locks `amount` stable tokens into a per-entry escrow and records
   * the slot for front-run protection.  Calls `enqueue_redemption`.
   *
   * @param params  `{ mint, amount, userStableAta, stableMint, tokenProgram }`
   * @returns       Transaction signature.
   */
  async enqueueRedemption(params: EnqueueRedemptionParams): Promise<TransactionSignature> {
    const { mint, amount, userStableAta, stableMint, tokenProgram } = params;
    const program = await this._loadProgram();
    const [config] = this.getConfigPda(mint);
    const [redemptionQueue] = this.getRedemptionQueuePda(mint);

    // escrow_stable and redemption_entry PDAs are derived from queue_tail
    // on-chain (via account constraint), so we pass them as PDAs derived
    // from queue_tail at call time — Anchor resolves them automatically
    // when accounts are passed by key.  We pass the PDA keys directly so
    // the client signs the correct transaction.
    const SLOT_HASHES = new PublicKey('SysvarS1otHashes111111111111111111111111111');

    return program.methods
      .enqueueRedemption(new BN(amount.toString()))
      .accounts({
        user: this.provider.wallet.publicKey,
        config,
        redemptionQueue,
        userStableAta,
        stableMint,
        slotHashes: SLOT_HASHES,
        tokenProgram,
        systemProgram: PublicKey.default,
      })
      .rpc({ commitment: 'confirmed' });
  }

  /**
   * Process a queued redemption entry.
   *
   * Keeper calls this after `min_delay_slots` have elapsed.  Releases
   * collateral to the redeemer and pays the keeper reward in lamports.
   * Calls `process_redemption`.
   *
   * @param params  Full set of accounts required by the instruction.
   * @returns       Transaction signature.
   */
  async processRedemption(params: ProcessRedemptionParams): Promise<TransactionSignature> {
    const {
      mint,
      queueIndex,
      reserveVault,
      reserveVaultAuthority,
      userCollateralAta,
      stableMint,
      collateralMint,
      tokenProgram,
    } = params;
    const program = await this._loadProgram();
    const [config] = this.getConfigPda(mint);
    const [redemptionQueue] = this.getRedemptionQueuePda(mint);
    const [redemptionEntry] = this.getRedemptionEntryPda(mint, queueIndex);
    const [escrowStable] = this.getEscrowStablePda(mint, queueIndex);

    return program.methods
      .processRedemption(new BN(queueIndex.toString()))
      .accounts({
        keeper: this.provider.wallet.publicKey,
        config,
        redemptionQueue,
        redemptionEntry,
        escrowStable,
        reserveVault,
        reserveVaultAuthority,
        userCollateralAta,
        stableMint,
        collateralMint,
        tokenProgram,
        systemProgram: PublicKey.default,
      })
      .rpc({ commitment: 'confirmed' });
  }

  /**
   * Cancel a pending redemption entry.
   *
   * Only the original redeemer (owner) may cancel.  Returns locked stable
   * tokens to the caller.  Calls `cancel_redemption`.
   *
   * @param params  `{ mint, queueIndex, userStableAta, stableMint, tokenProgram }`
   * @returns       Transaction signature.
   */
  async cancelRedemption(params: CancelRedemptionParams): Promise<TransactionSignature> {
    const { mint, queueIndex, userStableAta, stableMint, tokenProgram } = params;
    const program = await this._loadProgram();
    const [config] = this.getConfigPda(mint);
    const [redemptionQueue] = this.getRedemptionQueuePda(mint);
    const [redemptionEntry] = this.getRedemptionEntryPda(mint, queueIndex);
    const [escrowStable] = this.getEscrowStablePda(mint, queueIndex);

    return program.methods
      .cancelRedemption(new BN(queueIndex.toString()))
      .accounts({
        owner: this.provider.wallet.publicKey,
        config,
        redemptionQueue,
        redemptionEntry,
        escrowStable,
        userStableAta,
        stableMint,
        tokenProgram,
      })
      .rpc({ commitment: 'confirmed' });
  }

  /**
   * Update `RedemptionQueue` parameters (authority-only).
   *
   * All fields are `Option<T>`: pass `null` or omit to leave unchanged.
   * Calls `update_redemption_queue`.
   *
   * @param params  `{ mint, minDelaySlots?, maxQueueDepth?, maxRedemptionPerSlotBps?, keeperRewardLamports? }`
   * @returns       Transaction signature.
   */
  async updateRedemptionQueue(params: UpdateRedemptionQueueParams): Promise<TransactionSignature> {
    const {
      mint,
      minDelaySlots = null,
      maxQueueDepth = null,
      maxRedemptionPerSlotBps = null,
      keeperRewardLamports = null,
    } = params;
    const program = await this._loadProgram();
    const [config] = this.getConfigPda(mint);
    const [redemptionQueue] = this.getRedemptionQueuePda(mint);

    return program.methods
      .updateRedemptionQueue(
        minDelaySlots != null ? new BN(minDelaySlots.toString()) : null,
        maxQueueDepth != null ? new BN(maxQueueDepth.toString()) : null,
        maxRedemptionPerSlotBps ?? null,
        keeperRewardLamports != null ? new BN(keeperRewardLamports.toString()) : null
      )
      .accounts({
        authority: this.provider.wallet.publicKey,
        config,
        redemptionQueue,
      })
      .rpc({ commitment: 'confirmed' });
  }

  /**
   * Advance the queue head past a cancelled or fulfilled entry.
   *
   * Permissionless — any caller (keeper) may call this to unblock the strict-FIFO
   * queue when the head entry has been cancelled or already fulfilled.
   * Calls `compact_redemption_head`.
   *
   * @param params  `{ mint, headIndex }`
   * @returns       Transaction signature.
   */
  async compactRedemptionHead(params: CompactRedemptionHeadParams): Promise<TransactionSignature> {
    const { mint, headIndex } = params;
    const program = await this._loadProgram();
    const [config] = this.getConfigPda(mint);
    const [redemptionQueue] = this.getRedemptionQueuePda(mint);
    const [headEntry] = this.getRedemptionEntryPda(mint, headIndex);

    return program.methods
      .compactRedemptionHead(new BN(headIndex.toString()))
      .accounts({
        caller: this.provider.wallet.publicKey,
        config,
        redemptionQueue,
        headEntry,
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
    this._program = new AnchorProgram(
      { ...idl as any, address: this.programId.toBase58() },
      this.provider
    ) as any;
    return this._program;
  }
}

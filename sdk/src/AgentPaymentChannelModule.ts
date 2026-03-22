/**
 * SSS-111: Agent Payment Channel (APC) TypeScript SDK Module
 *
 * Wraps the on-chain `open_channel`, `submit_work_proof`, `propose_settle`,
 * `countersign_settle`, `dispute`, and `force_close` instructions for the
 * Agent Payment Channel primitive (SSS-111).
 *
 * PaymentChannel PDA seeds: [b"apc-channel", config, channel_id_le8]
 *
 * The APC is a bilateral payment channel between two agents:
 * - **Opener** (typically the Hirer/Agent A): deposits stablecoins and
 *   opens the channel.
 * - **Counterparty** (typically the Worker/Agent B): accepts the channel,
 *   submits work proofs, and initiates settlement.
 *
 * Channels settle cooperatively (both sign) or unilaterally after a timeout
 * (force_close). Disputes may be raised by either party.
 *
 * @example
 * ```ts
 * import { AgentPaymentChannelModule, DisputePolicy, ApcProofType } from '@sss/sdk';
 *
 * const apc = new AgentPaymentChannelModule(provider, programId);
 *
 * const { channelId, txSig } = await apc.openChannel({
 *   mint,
 *   counterparty: agentBPubkey,
 *   deposit: new BN(0),
 *   disputePolicy: DisputePolicy.TimeoutFallback,
 *   timeoutSlots: new BN(500),
 * });
 *
 * const txSig2 = await apc.submitWorkProof(channelId, {
 *   mint,
 *   taskHash: sha256('summarize X'),
 *   outputHash: sha256('summary text'),
 *   proofType: ApcProofType.HashProof,
 * });
 * ```
 */

import {
  PublicKey,
  TransactionInstruction,
  Transaction,
  TransactionSignature,
  SystemProgram,
} from '@solana/web3.js';
import { AnchorProvider, BN } from '@coral-xyz/anchor';
import { TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';

// ─── Constants ────────────────────────────────────────────────────────────────

/** PDA seed for PaymentChannel accounts. */
export const APC_CHANNEL_SEED = Buffer.from('apc-channel');

/** PDA seed for StablecoinConfig (shared with PBS module). */
export const APC_CONFIG_SEED = Buffer.from('stablecoin-config');

// ─── Anchor discriminators ────────────────────────────────────────────────────
// SHA-256("global:<instruction_name>")[0..8]

const DISC_OPEN_CHANNEL        = Buffer.from([0x5b, 0x2d, 0xfd, 0x47, 0x8c, 0xa6, 0x6b, 0x6d]);
const DISC_SUBMIT_WORK_PROOF   = Buffer.from([0x39, 0x92, 0x7a, 0x26, 0x2f, 0x36, 0x8d, 0xc1]);
const DISC_PROPOSE_SETTLE      = Buffer.from([0x88, 0xd8, 0x00, 0x00, 0x81, 0x97, 0x73, 0x95]);
const DISC_COUNTERSIGN_SETTLE  = Buffer.from([0xdd, 0x55, 0x99, 0xc6, 0x61, 0x90, 0xcd, 0x4f]);
const DISC_DISPUTE             = Buffer.from([0xd8, 0x5c, 0x80, 0x92, 0xca, 0x55, 0x87, 0x49]);
const DISC_FORCE_CLOSE         = Buffer.from([0x47, 0x01, 0x06, 0x40, 0x0f, 0xc8, 0xfe, 0xea]);

// ─── Enums ────────────────────────────────────────────────────────────────────

/**
 * Dispute resolution policy for a payment channel.
 *
 * - `TimeoutFallback` — if the counterparty does not countersign within
 *   `timeout_slots`, the opener may force-close and receive back their deposit.
 * - `MajorityOracle` — a 2-of-3 oracle committee adjudicates the dispute.
 * - `ArbitratorKey` — a named arbitrator pubkey resolves the dispute.
 */
export enum DisputePolicy {
  TimeoutFallback  = 0,
  MajorityOracle   = 1,
  ArbitratorKey    = 2,
}

/**
 * Proof type submitted by the worker to verify task completion.
 *
 * - `HashProof` — SHA-256 hash of output matches `task_hash`. Simple, fast.
 * - `ZkSnarkProof` — ZK-SNARK output hash verified on-chain (future).
 * - `OracleAttestation` — A registered oracle attests to task completion.
 */
export enum ApcProofType {
  HashProof         = 0,
  ZkSnarkProof      = 1,
  OracleAttestation = 2,
}

/**
 * Lifecycle status of a PaymentChannel.
 */
export enum ChannelStatus {
  Open        = 0,
  PendingSettle = 1,
  Settled     = 2,
  Disputed    = 3,
  ForceClosed = 4,
}

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * On-chain PaymentChannel account state.
 */
export interface PaymentChannel {
  /** Config PDA this channel belongs to. */
  config: PublicKey;
  /** Opener's public key (typically the hirer/Agent A). */
  opener: PublicKey;
  /** Counterparty's public key (typically the worker/Agent B). */
  counterparty: PublicKey;
  /** SSS stablecoin mint. */
  stableMint: PublicKey;
  /** Opener's deposit (may be 0 for fee-only channels). */
  deposit: bigint;
  /** Amount the opener has agreed to pay upon settlement. */
  settleAmount: bigint;
  /** Dispute resolution policy. */
  disputePolicy: DisputePolicy;
  /** Number of slots before the opener may force-close. */
  timeoutSlots: bigint;
  /** Slot when `proposeSettle` was called (0 if not yet proposed). */
  settleProposedAt: bigint;
  /** Hash of the submitted work output (0 if none yet). */
  lastOutputHash: Uint8Array;
  /** Proof type of the last submitted work proof. */
  lastProofType: ApcProofType;
  /** Monotonic channel id (unique per config). */
  channelId: bigint;
  /** Current channel lifecycle status. */
  status: ChannelStatus;
  /** Whether the opener has signed the settlement. */
  openerSigned: boolean;
  /** Whether the counterparty has signed the settlement. */
  counterpartySigned: boolean;
  /** PDA bump seed. */
  bump: number;
}

/**
 * Parameters for {@link AgentPaymentChannelModule.openChannel}.
 */
export interface OpenChannelParams {
  /** SSS stablecoin mint. */
  mint: PublicKey;
  /** Counterparty (worker) public key. */
  counterparty: PublicKey;
  /** Initial deposit from opener (may be 0 for fee-only channels). */
  deposit: BN;
  /** Dispute resolution policy. */
  disputePolicy: DisputePolicy;
  /** Slots before opener may force-close after a settle proposal. */
  timeoutSlots: BN;
  /** Unique channel id (u64, caller-managed for uniqueness). */
  channelId: BN;
  /** Opener's token account (source of deposit). Defaults to ATA. */
  openerTokenAccount?: PublicKey;
  /** Channel escrow token account (owned by channel PDA, pre-created). */
  escrowTokenAccount?: PublicKey;
  /** Token program (default: TOKEN_2022_PROGRAM_ID). */
  tokenProgram?: PublicKey;
  /** Optional arbitrator pubkey (only relevant for DisputePolicy.ArbitratorKey). */
  arbitrator?: PublicKey;
}

/**
 * Return value of {@link AgentPaymentChannelModule.openChannel}.
 */
export interface OpenChannelResult {
  /** Channel id identifying this channel. */
  channelId: BN;
  /** Transaction signature. */
  txSig: TransactionSignature;
}

/**
 * Parameters for {@link AgentPaymentChannelModule.submitWorkProof}.
 */
export interface SubmitWorkProofParams {
  /** SSS stablecoin mint. */
  mint: PublicKey;
  /** Config PDA (optional — derived from mint if omitted). */
  config?: PublicKey;
  /** 32-byte hash of the task specification (e.g. sha256 of task description). */
  taskHash: Uint8Array | Buffer;
  /** 32-byte hash of the output (e.g. sha256 of result). */
  outputHash: Uint8Array | Buffer;
  /** Proof type indicating how verification should proceed. */
  proofType: ApcProofType;
}

/**
 * Parameters for {@link AgentPaymentChannelModule.proposeSettle}.
 */
export interface ProposeSettleParams {
  /** SSS stablecoin mint. */
  mint: PublicKey;
  /** Config PDA (optional). */
  config?: PublicKey;
  /** Amount the counterparty proposes to receive. */
  amount: BN;
  /** Escrow token account (if deposit > 0). */
  escrowTokenAccount?: PublicKey;
  /** Token program (default: TOKEN_2022_PROGRAM_ID). */
  tokenProgram?: PublicKey;
}

/**
 * Parameters for {@link AgentPaymentChannelModule.countersignSettle}.
 */
export interface CountersignSettleParams {
  /** SSS stablecoin mint. */
  mint: PublicKey;
  /** Config PDA (optional). */
  config?: PublicKey;
  /** Opener's token account (receives opener's portion). */
  openerTokenAccount?: PublicKey;
  /** Counterparty's token account (receives counterparty's portion). */
  counterpartyTokenAccount?: PublicKey;
  /** Escrow token account (source of funds). */
  escrowTokenAccount?: PublicKey;
  /** Token program (default: TOKEN_2022_PROGRAM_ID). */
  tokenProgram?: PublicKey;
}

/**
 * Parameters for {@link AgentPaymentChannelModule.dispute}.
 */
export interface DisputeParams {
  /** SSS stablecoin mint. */
  mint: PublicKey;
  /** Config PDA (optional). */
  config?: PublicKey;
  /** 32-byte hash of evidence supporting the dispute. */
  evidenceHash: Uint8Array | Buffer;
}

/**
 * Parameters for {@link AgentPaymentChannelModule.forceClose}.
 */
export interface ForceCloseParams {
  /** SSS stablecoin mint. */
  mint: PublicKey;
  /** Config PDA (optional). */
  config?: PublicKey;
  /** Opener's token account (receives full deposit refund on force close). */
  openerTokenAccount?: PublicKey;
  /** Escrow token account (source of funds). */
  escrowTokenAccount?: PublicKey;
  /** Token program (default: TOKEN_2022_PROGRAM_ID). */
  tokenProgram?: PublicKey;
}

// ─── PDA helpers ──────────────────────────────────────────────────────────────

/**
 * Derive the `StablecoinConfig` PDA for a given mint.
 * Seeds: `[b"stablecoin-config", mint]`
 */
export function deriveApcConfigPda(mint: PublicKey, programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [APC_CONFIG_SEED, mint.toBuffer()],
    programId,
  );
}

/**
 * Derive the `PaymentChannel` PDA for a given config + channel id.
 * Seeds: `[b"apc-channel", config, channel_id_le8]`
 */
export function deriveChannelPda(
  config: PublicKey,
  channelId: BN,
  programId: PublicKey,
): [PublicKey, number] {
  const idBuf = Buffer.alloc(8);
  idBuf.writeBigUInt64LE(BigInt(channelId.toString()));
  return PublicKey.findProgramAddressSync(
    [APC_CHANNEL_SEED, config.toBuffer(), idBuf],
    programId,
  );
}

// ─── AgentPaymentChannelModule ────────────────────────────────────────────────

/**
 * SDK wrapper for the SSS-111 Agent Payment Channel on-chain program.
 *
 * An APC enables two agents to transact off-chain trust-minimally:
 * the opener deposits stablecoins, the worker submits work proofs, and
 * settlement flows based on cooperative signing or a timeout + dispute policy.
 */
export class AgentPaymentChannelModule {
  constructor(
    public readonly provider: AnchorProvider,
    public readonly programId: PublicKey,
  ) {}

  // ─── Write: openChannel ────────────────────────────────────────────────

  /**
   * Open a new agent payment channel.
   *
   * Creates a `PaymentChannel` PDA and optionally transfers `deposit` tokens
   * into the channel escrow (useful for pre-funding worker compensation).
   * A zero-deposit channel is valid — settlement may pull from PBS instead.
   *
   * @param params - See {@link OpenChannelParams}.
   * @returns `{ channelId, txSig }`.
   */
  async openChannel(params: OpenChannelParams): Promise<OpenChannelResult> {
    const {
      mint,
      counterparty,
      deposit,
      disputePolicy,
      timeoutSlots,
      channelId,
      tokenProgram = TOKEN_2022_PROGRAM_ID,
    } = params;

    // SSS-114 M-001: reject zero-address counterparty — a channel with a
    // zero pubkey counterparty can never be settled cooperatively.
    if (counterparty.equals(PublicKey.default)) {
      throw new Error('counterparty must be a non-zero public key');
    }

    const [configPda] = deriveApcConfigPda(mint, this.programId);
    const [channelPda] = deriveChannelPda(configPda, channelId, this.programId);
    const opener = this.provider.wallet.publicKey;

    // OpenChannelParams ABI:
    //   deposit: u64          [8]
    //   dispute_policy: u8    [1]
    //   timeout_slots: u64    [8]
    //   channel_id: u64       [8]
    //   arbitrator: Pubkey    [32]  (zero pubkey if not used)
    // Total: 8 (disc) + 8 + 1 + 8 + 8 + 32 = 65

    const arbitrator = params.arbitrator ?? PublicKey.default;

    const data = Buffer.alloc(65);
    DISC_OPEN_CHANNEL.copy(data, 0);
    data.writeBigUInt64LE(BigInt(deposit.toString()), 8);
    data.writeUInt8(disputePolicy, 16);
    data.writeBigUInt64LE(BigInt(timeoutSlots.toString()), 17);
    data.writeBigUInt64LE(BigInt(channelId.toString()), 25);
    arbitrator.toBuffer().copy(data, 33);

    const keys: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[] = [
      { pubkey: opener, isSigner: true, isWritable: true },                    // opener
      { pubkey: configPda, isSigner: false, isWritable: false },               // config
      { pubkey: mint, isSigner: false, isWritable: false },                    // stable_mint
      { pubkey: channelPda, isSigner: false, isWritable: true },               // channel (init)
      { pubkey: counterparty, isSigner: false, isWritable: false },            // counterparty
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // system_program
    ];

    // Append token accounts only if a deposit is being made
    if (!deposit.isZero()) {
      const openerTokenAccount =
        params.openerTokenAccount ??
        (await this._deriveAta(mint, opener, tokenProgram));
      const escrowTokenAccount =
        params.escrowTokenAccount ??
        (await this._deriveAta(mint, channelPda, tokenProgram));

      keys.push(
        { pubkey: openerTokenAccount, isSigner: false, isWritable: true },
        { pubkey: escrowTokenAccount, isSigner: false, isWritable: true },
        { pubkey: tokenProgram, isSigner: false, isWritable: false },
      );
    }

    const ix = new TransactionInstruction({ programId: this.programId, keys, data });
    const tx = new Transaction().add(ix);
    const txSig = await this.provider.sendAndConfirm(tx, []);
    return { channelId, txSig };
  }

  // ─── Write: submitWorkProof ────────────────────────────────────────────

  /**
   * Submit a work proof for a channel task.
   *
   * The worker (counterparty) records the `taskHash` and `outputHash` on-chain,
   * enabling the opener to verify work before calling `proposeSettle`.
   *
   * Only the channel counterparty may call this. The `outputHash` must match
   * whatever the opener expects (agreed off-chain before task start).
   *
   * @param channelId - The channel id.
   * @param params    - Task and output hashes, proof type, accounts.
   * @returns Transaction signature.
   */
  async submitWorkProof(channelId: BN, params: SubmitWorkProofParams): Promise<TransactionSignature> {
    const { mint, taskHash, outputHash, proofType } = params;

    if (taskHash.length !== 32) throw new Error('taskHash must be 32 bytes');
    if (outputHash.length !== 32) throw new Error('outputHash must be 32 bytes');

    const [configPda] = deriveApcConfigPda(mint, this.programId);
    const config = params.config ?? configPda;
    const [channelPda] = deriveChannelPda(config, channelId, this.programId);

    // SubmitWorkProof params ABI:
    //   task_hash: [u8;32]    [32]
    //   output_hash: [u8;32]  [32]
    //   proof_type: u8        [1]
    // Total: 8 (disc) + 32 + 32 + 1 = 73

    const data = Buffer.alloc(73);
    DISC_SUBMIT_WORK_PROOF.copy(data, 0);
    Buffer.from(taskHash).copy(data, 8);
    Buffer.from(outputHash).copy(data, 40);
    data.writeUInt8(proofType, 72);

    const ix = new TransactionInstruction({
      programId: this.programId,
      keys: [
        { pubkey: this.provider.wallet.publicKey, isSigner: true, isWritable: false }, // counterparty
        { pubkey: channelPda, isSigner: false, isWritable: true },                     // channel
        { pubkey: mint, isSigner: false, isWritable: false },                          // stable_mint
      ],
      data,
    });

    const tx = new Transaction().add(ix);
    return this.provider.sendAndConfirm(tx, []);
  }

  // ─── Write: proposeSettle ──────────────────────────────────────────────

  /**
   * Propose a settlement amount for the channel.
   *
   * Either party may call this to initiate settlement. Sets `settle_amount`
   * and `settle_proposed_at`, records the proposer's signature, and transitions
   * to `PendingSettle`.
   *
   * The counterparty should call `countersignSettle` to complete cooperative
   * settlement. If they don't respond within `timeout_slots`, the opener may
   * call `forceClose`.
   *
   * @param channelId - The channel id.
   * @param params    - Amount and accounts.
   * @returns Transaction signature.
   */
  async proposeSettle(channelId: BN, params: ProposeSettleParams): Promise<TransactionSignature> {
    const { mint, amount } = params;

    const [configPda] = deriveApcConfigPda(mint, this.programId);
    const config = params.config ?? configPda;
    const [channelPda] = deriveChannelPda(config, channelId, this.programId);

    // ProposeSettle params ABI:
    //   amount: u64 [8]
    // Total: 8 (disc) + 8 = 16

    const data = Buffer.alloc(16);
    DISC_PROPOSE_SETTLE.copy(data, 0);
    data.writeBigUInt64LE(BigInt(amount.toString()), 8);

    const ix = new TransactionInstruction({
      programId: this.programId,
      keys: [
        { pubkey: this.provider.wallet.publicKey, isSigner: true, isWritable: false }, // proposer (opener or counterparty)
        { pubkey: channelPda, isSigner: false, isWritable: true },                     // channel
        { pubkey: mint, isSigner: false, isWritable: false },                          // stable_mint
      ],
      data,
    });

    const tx = new Transaction().add(ix);
    return this.provider.sendAndConfirm(tx, []);
  }

  // ─── Write: countersignSettle ──────────────────────────────────────────

  /**
   * Countersign a settlement proposal and execute token transfers.
   *
   * When both parties have signed, the channel transitions to `Settled` and
   * tokens are distributed: `settle_amount` to counterparty, remainder to opener.
   *
   * @param channelId - The channel id.
   * @param params    - Token accounts for distribution.
   * @returns Transaction signature.
   */
  async countersignSettle(
    channelId: BN,
    params: CountersignSettleParams,
  ): Promise<TransactionSignature> {
    const {
      mint,
      tokenProgram = TOKEN_2022_PROGRAM_ID,
    } = params;

    const [configPda] = deriveApcConfigPda(mint, this.programId);
    const config = params.config ?? configPda;
    const [channelPda] = deriveChannelPda(config, channelId, this.programId);
    const signer = this.provider.wallet.publicKey;

    const openerTokenAccount =
      params.openerTokenAccount ?? (await this._deriveAta(mint, signer, tokenProgram));
    const counterpartyTokenAccount =
      params.counterpartyTokenAccount ?? (await this._deriveAta(mint, signer, tokenProgram));
    const escrowTokenAccount =
      params.escrowTokenAccount ?? (await this._deriveAta(mint, channelPda, tokenProgram));

    // CountersignSettle has no extra params; only discriminator.
    const data = Buffer.alloc(8);
    DISC_COUNTERSIGN_SETTLE.copy(data, 0);

    const ix = new TransactionInstruction({
      programId: this.programId,
      keys: [
        { pubkey: signer, isSigner: true, isWritable: false },                         // countersigner
        { pubkey: channelPda, isSigner: false, isWritable: true },                     // channel
        { pubkey: mint, isSigner: false, isWritable: false },                          // stable_mint
        { pubkey: escrowTokenAccount, isSigner: false, isWritable: true },             // escrow_token_account
        { pubkey: openerTokenAccount, isSigner: false, isWritable: true },             // opener_token_account
        { pubkey: counterpartyTokenAccount, isSigner: false, isWritable: true },       // counterparty_token_account
        { pubkey: tokenProgram, isSigner: false, isWritable: false },                  // token_program
      ],
      data,
    });

    const tx = new Transaction().add(ix);
    return this.provider.sendAndConfirm(tx, []);
  }

  // ─── Write: dispute ────────────────────────────────────────────────────

  /**
   * Raise a dispute on a channel.
   *
   * Either party may call this to halt settlement and trigger dispute resolution.
   * Submits a 32-byte `evidenceHash` (e.g. sha256 of off-chain evidence).
   * The channel transitions to `Disputed`.
   *
   * Resolution depends on `dispute_policy`:
   * - `TimeoutFallback` — opener receives full refund after `timeout_slots`.
   * - `MajorityOracle` — oracle committee adjudicates.
   * - `ArbitratorKey` — named arbitrator signs resolution.
   *
   * @param channelId - The channel id.
   * @param params    - Evidence hash and accounts.
   * @returns Transaction signature.
   */
  async dispute(channelId: BN, params: DisputeParams): Promise<TransactionSignature> {
    const { mint, evidenceHash } = params;

    if (evidenceHash.length !== 32) throw new Error('evidenceHash must be 32 bytes');

    const [configPda] = deriveApcConfigPda(mint, this.programId);
    const config = params.config ?? configPda;
    const [channelPda] = deriveChannelPda(config, channelId, this.programId);

    // Dispute params ABI:
    //   evidence_hash: [u8;32] [32]
    // Total: 8 (disc) + 32 = 40

    const data = Buffer.alloc(40);
    DISC_DISPUTE.copy(data, 0);
    Buffer.from(evidenceHash).copy(data, 8);

    const ix = new TransactionInstruction({
      programId: this.programId,
      keys: [
        { pubkey: this.provider.wallet.publicKey, isSigner: true, isWritable: false }, // disputer
        { pubkey: channelPda, isSigner: false, isWritable: true },                     // channel
        { pubkey: mint, isSigner: false, isWritable: false },                          // stable_mint
      ],
      data,
    });

    const tx = new Transaction().add(ix);
    return this.provider.sendAndConfirm(tx, []);
  }

  // ─── Write: forceClose ────────────────────────────────────────────────

  /**
   * Force-close a channel after the settle timeout has elapsed.
   *
   * Only the opener may call this, and only when:
   * - Channel is in `PendingSettle` AND
   * - `clock.slot >= settle_proposed_at + timeout_slots`
   *
   * On force-close, the opener receives the full escrow balance back.
   *
   * @param channelId - The channel id.
   * @param params    - Token accounts.
   * @returns Transaction signature.
   */
  async forceClose(channelId: BN, params: ForceCloseParams): Promise<TransactionSignature> {
    const {
      mint,
      tokenProgram = TOKEN_2022_PROGRAM_ID,
    } = params;

    const [configPda] = deriveApcConfigPda(mint, this.programId);
    const config = params.config ?? configPda;
    const [channelPda] = deriveChannelPda(config, channelId, this.programId);
    const opener = this.provider.wallet.publicKey;

    const openerTokenAccount =
      params.openerTokenAccount ?? (await this._deriveAta(mint, opener, tokenProgram));
    const escrowTokenAccount =
      params.escrowTokenAccount ?? (await this._deriveAta(mint, channelPda, tokenProgram));

    // ForceClose has no extra params; only discriminator.
    const data = Buffer.alloc(8);
    DISC_FORCE_CLOSE.copy(data, 0);

    const ix = new TransactionInstruction({
      programId: this.programId,
      keys: [
        { pubkey: opener, isSigner: true, isWritable: false },                         // opener
        { pubkey: channelPda, isSigner: false, isWritable: true },                     // channel
        { pubkey: mint, isSigner: false, isWritable: false },                          // stable_mint
        { pubkey: escrowTokenAccount, isSigner: false, isWritable: true },             // escrow_token_account
        { pubkey: openerTokenAccount, isSigner: false, isWritable: true },             // opener_token_account
        { pubkey: tokenProgram, isSigner: false, isWritable: false },                  // token_program
      ],
      data,
    });

    const tx = new Transaction().add(ix);
    return this.provider.sendAndConfirm(tx, []);
  }

  // ─── Read: getChannel ────────────────────────────────────────────────

  /**
   * Fetch and decode a `PaymentChannel` account from on-chain state.
   *
   * @param mint      - The stablecoin mint.
   * @param channelId - The channel id.
   * @returns Decoded {@link PaymentChannel}.
   * @throws When the channel account is not found.
   */
  async getChannel(mint: PublicKey, channelId: BN): Promise<PaymentChannel> {
    const [configPda] = deriveApcConfigPda(mint, this.programId);
    const [channelPda] = deriveChannelPda(configPda, channelId, this.programId);

    const accountInfo = await this.provider.connection.getAccountInfo(channelPda);
    if (!accountInfo) {
      throw new Error(
        `PaymentChannel not found for channelId ${channelId.toString()} ` +
        `(PDA: ${channelPda.toBase58()})`,
      );
    }

    return AgentPaymentChannelModule.decodeChannel(accountInfo.data);
  }

  /**
   * Check whether the timeout for force-close has elapsed.
   *
   * @param channel     - Decoded channel state.
   * @param currentSlot - Current Solana slot (from `connection.getSlot()`).
   * @returns `true` if the channel is past its timeout and opener may force-close.
   */
  isForceCloseEligible(channel: PaymentChannel, currentSlot: bigint): boolean {
    if (channel.status !== ChannelStatus.PendingSettle) return false;
    return currentSlot >= channel.settleProposedAt + channel.timeoutSlots;
  }

  /**
   * Check whether a channel is in a terminal state (no further mutations).
   * Terminal = `Settled` or `ForceClosed`.
   */
  isTerminal(channel: PaymentChannel): boolean {
    return (
      channel.status === ChannelStatus.Settled ||
      channel.status === ChannelStatus.ForceClosed
    );
  }

  // ─── PDA helpers (public) ───────────────────────────────────────────────

  /** Derive the `StablecoinConfig` PDA for a mint. */
  configPda(mint: PublicKey): [PublicKey, number] {
    return deriveApcConfigPda(mint, this.programId);
  }

  /** Derive the `PaymentChannel` PDA for a config + channel id. */
  channelPda(config: PublicKey, channelId: BN): [PublicKey, number] {
    return deriveChannelPda(config, channelId, this.programId);
  }

  // ─── Static decode helper ───────────────────────────────────────────────

  /**
   * Decode raw account bytes into a {@link PaymentChannel}.
   *
   * PaymentChannel layout (after 8-byte Anchor discriminator):
   *   config:              Pubkey   [32]
   *   opener:              Pubkey   [32]
   *   counterparty:        Pubkey   [32]
   *   stable_mint:         Pubkey   [32]
   *   deposit:             u64      [8]
   *   settle_amount:       u64      [8]
   *   dispute_policy:      u8       [1]
   *   timeout_slots:       u64      [8]
   *   settle_proposed_at:  u64      [8]
   *   last_output_hash:    [u8;32]  [32]
   *   last_proof_type:     u8       [1]
   *   channel_id:          u64      [8]
   *   status:              u8       [1]
   *   opener_signed:       bool     [1]
   *   counterparty_signed: bool     [1]
   *   bump:                u8       [1]
   *   Total: 8 + 4*32 + 4*8 + 32 + 6 = 8 + 128 + 32 + 32 + 14 = 214
   */
  static decodeChannel(data: Buffer): PaymentChannel {
    let offset = 8; // skip discriminator

    const config       = new PublicKey(data.slice(offset, offset + 32)); offset += 32;
    const opener       = new PublicKey(data.slice(offset, offset + 32)); offset += 32;
    const counterparty = new PublicKey(data.slice(offset, offset + 32)); offset += 32;
    const stableMint   = new PublicKey(data.slice(offset, offset + 32)); offset += 32;

    const deposit           = data.readBigUInt64LE(offset); offset += 8;
    const settleAmount      = data.readBigUInt64LE(offset); offset += 8;
    const disputePolicy     = data.readUInt8(offset) as DisputePolicy; offset += 1;
    const timeoutSlots      = data.readBigUInt64LE(offset); offset += 8;
    const settleProposedAt  = data.readBigUInt64LE(offset); offset += 8;

    const lastOutputHash    = new Uint8Array(data.slice(offset, offset + 32)); offset += 32;
    const lastProofType     = data.readUInt8(offset) as ApcProofType; offset += 1;
    const channelId         = data.readBigUInt64LE(offset); offset += 8;
    const status            = data.readUInt8(offset) as ChannelStatus; offset += 1;
    const openerSigned      = data.readUInt8(offset) === 1; offset += 1;
    const counterpartySigned = data.readUInt8(offset) === 1; offset += 1;
    const bump              = data.readUInt8(offset);

    return {
      config,
      opener,
      counterparty,
      stableMint,
      deposit,
      settleAmount,
      disputePolicy,
      timeoutSlots,
      settleProposedAt,
      lastOutputHash,
      lastProofType,
      channelId,
      status,
      openerSigned,
      counterpartySigned,
      bump,
    };
  }

  // ─── Private helpers ────────────────────────────────────────────────────

  private async _deriveAta(
    mint: PublicKey,
    owner: PublicKey,
    tokenProgram: PublicKey,
  ): Promise<PublicKey> {
    const ATA_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe1bsX');
    const [ata] = PublicKey.findProgramAddressSync(
      [owner.toBuffer(), tokenProgram.toBuffer(), mint.toBuffer()],
      ATA_PROGRAM_ID,
    );
    return ata;
  }
}

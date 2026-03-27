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

/** PDA seed for ProposedSettlement account. Seeds: [b"apc-settle", channel_pda]. */
export const APC_SETTLE_SEED = Buffer.from('apc-settle');

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
  /** Channel initiator/opener public key (required to derive channel PDA). Defaults to signer. */
  initiator?: PublicKey;
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
  /** Channel initiator/opener public key (required to derive channel PDA). Defaults to signer. */
  initiator?: PublicKey;
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
  /** Channel initiator/opener public key (required to derive channel PDA). Defaults to signer. */
  initiator?: PublicKey;
  /** Settlement amount (must match the proposed_settlement.amount on-chain). Defaults to 0. */
  amount?: number;
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
  /** Channel initiator/opener public key (required to derive channel PDA). Defaults to signer. */
  initiator?: PublicKey;
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
  /** Channel initiator/opener public key (required to derive channel PDA). Defaults to signer. */
  initiator?: PublicKey;
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
  initiator: PublicKey,
  channelId: BN,
  programId: PublicKey,
): [PublicKey, number] {
  // On-chain seeds: [b"apc-channel", initiator.key(), channel_id.to_le_bytes()]
  const idBuf = Buffer.alloc(8);
  idBuf.writeBigUInt64LE(BigInt(channelId.toString()));
  return PublicKey.findProgramAddressSync(
    [APC_CHANNEL_SEED, initiator.toBuffer(), idBuf],
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
    const opener = this.provider.wallet.publicKey;
    // On-chain seeds: [b"apc-channel", initiator, channel_id] — use opener (initiator) not configPda
    const [channelPda] = deriveChannelPda(opener, channelId, this.programId);

    // OpenChannelParams ABI (Anchor-serialized, matches Rust struct field order):
    //   counterparty: Pubkey  [32]  — stored in params, not as a separate account
    //   deposit: u64          [8]
    //   channel_id: u64       [8]
    //   dispute_policy: u8    [1]
    //   timeout_slots: u64    [8]
    // Total: 8 (disc) + 32 + 8 + 8 + 1 + 8 = 65

    const data = Buffer.alloc(65);
    DISC_OPEN_CHANNEL.copy(data, 0);
    counterparty.toBuffer().copy(data, 8);                             // counterparty: Pubkey
    data.writeBigUInt64LE(BigInt(deposit.toString()), 40);             // deposit: u64
    data.writeBigUInt64LE(BigInt(channelId.toString()), 48);           // channel_id: u64
    data.writeUInt8(disputePolicy, 56);                                // dispute_policy: u8
    data.writeBigUInt64LE(BigInt(timeoutSlots.toString()), 57);        // timeout_slots: u64

    // On-chain OpenChannel always requires escrow_token_account and initiator_token_account
    const openerTokenAccount =
      params.openerTokenAccount ??
      (await this._deriveAta(mint, opener, tokenProgram));
    const escrowTokenAccount =
      params.escrowTokenAccount ??
      (await this._deriveAta(mint, channelPda, tokenProgram));

    const keys: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[] = [
      { pubkey: opener, isSigner: true, isWritable: true },                    // initiator
      { pubkey: configPda, isSigner: false, isWritable: false },               // config
      { pubkey: mint, isSigner: false, isWritable: false },                    // stable_mint
      { pubkey: channelPda, isSigner: false, isWritable: true },               // channel (init)
      { pubkey: escrowTokenAccount, isSigner: false, isWritable: true },       // escrow_token_account
      { pubkey: openerTokenAccount, isSigner: false, isWritable: true },       // initiator_token_account
      { pubkey: tokenProgram, isSigner: false, isWritable: false },            // token_program
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // system_program
    ];

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

    // Channel PDA uses initiator pubkey as seed (not configPda)
    const initiator = params.initiator ?? this.provider.wallet.publicKey;
    const [channelPda] = deriveChannelPda(initiator, channelId, this.programId);

    // SubmitWorkProof ABI: disc(8) + _channel_id(8) + task_hash(32) + output_hash(32) + proof_type(1) = 81
    // On-chain accounts: [submitter, channel] — NO mint account
    const data = Buffer.alloc(81);
    DISC_SUBMIT_WORK_PROOF.copy(data, 0);
    data.writeBigUInt64LE(BigInt(channelId.toString()), 8); // _channel_id
    Buffer.from(taskHash).copy(data, 16);
    Buffer.from(outputHash).copy(data, 48);
    data.writeUInt8(proofType, 80);

    const ix = new TransactionInstruction({
      programId: this.programId,
      keys: [
        { pubkey: this.provider.wallet.publicKey, isSigner: true, isWritable: false }, // submitter
        { pubkey: channelPda, isSigner: false, isWritable: true },                     // channel
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

    // Channel PDA uses initiator pubkey as seed (not configPda)
    const initiator = params.initiator ?? this.provider.wallet.publicKey;
    const [channelPda] = deriveChannelPda(initiator, channelId, this.programId);

    // Derive the proposed_settlement PDA: [b"apc-settle", channel_pda]
    const [proposedSettlementPda] = PublicKey.findProgramAddressSync(
      [APC_SETTLE_SEED, channelPda.toBuffer()],
      this.programId,
    );

    // ProposeSettle ABI: disc(8) + _channel_id(8) + amount(8) = 24
    // On-chain accounts: [proposer(mut), channel(mut), proposed_settlement(init,mut), system_program]
    const data = Buffer.alloc(24);
    DISC_PROPOSE_SETTLE.copy(data, 0);
    data.writeBigUInt64LE(BigInt(channelId.toString()), 8); // _channel_id
    data.writeBigUInt64LE(BigInt(amount.toString()), 16);   // amount

    const ix = new TransactionInstruction({
      programId: this.programId,
      keys: [
        { pubkey: this.provider.wallet.publicKey, isSigner: true, isWritable: true },  // proposer
        { pubkey: channelPda, isSigner: false, isWritable: true },                     // channel
        { pubkey: proposedSettlementPda, isSigner: false, isWritable: true },          // proposed_settlement (init)
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },       // system_program
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

    const signer = this.provider.wallet.publicKey;
    // Channel PDA uses initiator pubkey as seed (not configPda)
    const initiator = params.initiator ?? signer;
    const [channelPda] = deriveChannelPda(initiator, channelId, this.programId);

    // Derive the proposed_settlement PDA
    const [proposedSettlementPda] = PublicKey.findProgramAddressSync(
      [APC_SETTLE_SEED, channelPda.toBuffer()],
      this.programId,
    );

    const openerTokenAccount =
      params.openerTokenAccount ?? (await this._deriveAta(mint, initiator, tokenProgram));
    const counterpartyTokenAccount =
      params.counterpartyTokenAccount ?? (await this._deriveAta(mint, signer, tokenProgram));
    const escrowTokenAccount =
      params.escrowTokenAccount ?? (await this._deriveAta(mint, channelPda, tokenProgram));

    // CountersignSettle ABI: disc(8) + _channel_id(8) + amount(8) = 24
    // On-chain accounts: [countersigner(mut), channel(mut), proposed_settlement(mut,close=countersigner),
    //                     stable_mint, escrow_token_account(mut), counterparty_token_account(mut),
    //                     initiator_token_account(mut), token_program]
    // Note: amount must match proposed_settlement.amount
    const amount = params.amount ?? 0;
    const data = Buffer.alloc(24);
    DISC_COUNTERSIGN_SETTLE.copy(data, 0);
    data.writeBigUInt64LE(BigInt(channelId.toString()), 8); // _channel_id
    data.writeBigUInt64LE(BigInt(amount.toString()), 16);   // amount

    const ix = new TransactionInstruction({
      programId: this.programId,
      keys: [
        { pubkey: signer, isSigner: true, isWritable: true },                          // countersigner
        { pubkey: channelPda, isSigner: false, isWritable: true },                     // channel
        { pubkey: proposedSettlementPda, isSigner: false, isWritable: true },          // proposed_settlement (close=countersigner)
        { pubkey: mint, isSigner: false, isWritable: false },                          // stable_mint
        { pubkey: escrowTokenAccount, isSigner: false, isWritable: true },             // escrow_token_account
        { pubkey: counterpartyTokenAccount, isSigner: false, isWritable: true },       // counterparty_token_account
        { pubkey: openerTokenAccount, isSigner: false, isWritable: true },             // initiator_token_account
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

    // Channel PDA uses initiator pubkey as seed (not configPda)
    const initiator = params.initiator ?? this.provider.wallet.publicKey;
    const [channelPda] = deriveChannelPda(initiator, channelId, this.programId);

    // Dispute ABI: disc(8) + _channel_id(8) + evidence_hash(32) = 48
    // On-chain accounts: [disputer, channel] — NO mint account
    const data = Buffer.alloc(48);
    DISC_DISPUTE.copy(data, 0);
    data.writeBigUInt64LE(BigInt(channelId.toString()), 8); // _channel_id
    Buffer.from(evidenceHash).copy(data, 16);

    const ix = new TransactionInstruction({
      programId: this.programId,
      keys: [
        { pubkey: this.provider.wallet.publicKey, isSigner: true, isWritable: false }, // disputer
        { pubkey: channelPda, isSigner: false, isWritable: true },                     // channel
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

    const opener = this.provider.wallet.publicKey;
    // Channel PDA uses initiator pubkey as seed (not configPda)
    const initiator = params.initiator ?? opener;
    const [channelPda] = deriveChannelPda(initiator, channelId, this.programId);

    const openerTokenAccount =
      params.openerTokenAccount ?? (await this._deriveAta(mint, opener, tokenProgram));
    const escrowTokenAccount =
      params.escrowTokenAccount ?? (await this._deriveAta(mint, channelPda, tokenProgram));

    // ForceClose ABI: disc(8) + _channel_id(8) = 16
    // On-chain accounts: [initiator, channel(mut), stable_mint, escrow_token_account(mut),
    //                     initiator_token_account(mut), token_program]
    const data = Buffer.alloc(16);
    DISC_FORCE_CLOSE.copy(data, 0);
    data.writeBigUInt64LE(BigInt(channelId.toString()), 8); // _channel_id

    const ix = new TransactionInstruction({
      programId: this.programId,
      keys: [
        { pubkey: opener, isSigner: true, isWritable: false },                         // initiator
        { pubkey: channelPda, isSigner: false, isWritable: true },                     // channel
        { pubkey: mint, isSigner: false, isWritable: false },                          // stable_mint
        { pubkey: escrowTokenAccount, isSigner: false, isWritable: true },             // escrow_token_account
        { pubkey: openerTokenAccount, isSigner: false, isWritable: true },             // initiator_token_account
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
  async getChannel(mint: PublicKey, channelId: BN, initiator?: PublicKey): Promise<PaymentChannel> {
    const opener = initiator ?? this.provider.wallet.publicKey;
    const [channelPda] = deriveChannelPda(opener, channelId, this.programId);

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

  /** Derive the `PaymentChannel` PDA for an initiator + channel id. */
  channelPda(initiator: PublicKey, channelId: BN): [PublicKey, number] {
    return deriveChannelPda(initiator, channelId, this.programId);
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

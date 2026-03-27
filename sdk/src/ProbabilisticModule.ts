/**
 * SSS-111: Probabilistic Balance Standard (PBS) TypeScript SDK Module
 *
 * Wraps the on-chain `commit_probabilistic`, `prove_and_resolve`,
 * `partial_resolve`, and `expire_and_refund` instructions introduced in
 * SSS-109.
 *
 * ProbabilisticVault PDA seeds: [b"pbs-vault", config, commitment_id_le8]
 * Feature flag: FLAG_PROBABILISTIC_MONEY (1 << 20) must be set on StablecoinConfig.
 *
 * @example
 * ```ts
 * import { ProbabilisticModule } from '@sss/sdk';
 * import { createHash } from 'crypto';
 *
 * const pbs = new ProbabilisticModule(provider, programId);
 * const conditionHash = createHash('sha256').update('task: summarize X').digest();
 *
 * const { commitmentId, txSig } = await pbs.commitProbabilistic({
 *   amount: new BN(10_000_000),  // 10 USDC (6 decimals)
 *   conditionHash,
 *   expirySlot: new BN(currentSlot + 1000),
 *   claimant: agentBPubkey,
 * });
 *
 * // Later — claimant proves and releases funds:
 * const txSig2 = await pbs.proveAndResolve(commitmentId, conditionHash);
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

/** Bit flag for the probabilistic money feature (bit 6 = 0x40). */
export const FLAG_PROBABILISTIC_MONEY = 1n << 20n; // 0x100000 — matches FLAG_PROBABILISTIC_MONEY in state.rs (bit 20)

/** PDA seed for ProbabilisticVault accounts. */
export const PBS_VAULT_SEED = Buffer.from('pbs-vault');

/** PDA seed for StablecoinConfig (shared with other modules). */
export const PBS_CONFIG_SEED = Buffer.from('stablecoin-config');

// ─── Anchor discriminators ────────────────────────────────────────────────────
// SHA-256("global:<instruction_name>")[0..8]

const DISC_COMMIT_PROBABILISTIC = Buffer.from([0x73, 0xd6, 0x78, 0xd4, 0x71, 0x95, 0x76, 0xf2]);
const DISC_PROVE_AND_RESOLVE     = Buffer.from([0x1f, 0x67, 0xa9, 0xb8, 0x5d, 0xdc, 0x33, 0x65]);
const DISC_PARTIAL_RESOLVE       = Buffer.from([0xc4, 0x95, 0x70, 0xd2, 0xab, 0xc2, 0x7d, 0x85]);
const DISC_EXPIRE_AND_REFUND     = Buffer.from([0x81, 0x82, 0x5b, 0xe0, 0xde, 0xe6, 0xb7, 0x86]);

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Lifecycle status of a ProbabilisticVault.
 * Mirrors `VaultStatus` in the Anchor program.
 */
export enum VaultStatus {
  Pending           = 0,
  Resolved          = 1,
  Expired           = 2,
  PartiallyResolved = 3,
}

/**
 * On-chain ProbabilisticVault account state.
 */
export interface ProbabilisticVault {
  /** Config PDA this vault belongs to. */
  config: PublicKey;
  /** Issuer who locked the funds. */
  issuer: PublicKey;
  /** Claimant authorised to receive funds on proof. */
  claimant: PublicKey;
  /** SSS stablecoin mint. */
  stableMint: PublicKey;
  /** Total tokens committed into escrow. */
  committedAmount: bigint;
  /** Amount released so far (sum of all partial + full releases). */
  resolvedAmount: bigint;
  /** SHA-256 / oracle hash the proof must match (32 bytes). */
  conditionHash: Uint8Array;
  /** Slot after which `expireAndRefund` is allowed. */
  expirySlot: bigint;
  /** Monotonic commitment id (caller-provided, unique per config). */
  commitmentId: bigint;
  /** Current vault lifecycle status. */
  status: VaultStatus;
  /** PDA bump seed. */
  bump: number;
}

/**
 * Parameters for {@link ProbabilisticModule.commitProbabilistic}.
 */
export interface CommitProbabilisticParams {
  /** SSS stablecoin mint. */
  mint: PublicKey;
  /** Amount in native token units (> 0). */
  amount: BN;
  /**
   * SHA-256 hash of the condition the claimant must prove (32 bytes).
   * Computed client-side before calling; must match the proof submitted later.
   */
  conditionHash: Uint8Array | Buffer;
  /** Slot after which the commitment can be expired and refunded. Must be > current slot. */
  expirySlot: BN;
  /**
   * Claimant's public key — the only wallet permitted to call `proveAndResolve`
   * or `partialResolve`.
   */
  claimant: PublicKey;
  /**
   * Issuer's token account (source of funds).
   * Defaults to the provider wallet's associated token account for `mint`.
   */
  issuerTokenAccount?: PublicKey;
  /**
   * Escrow token account (owned by the vault PDA, pre-created by client).
   * Pass an existing ATA or create one with `createEscrowTokenAccount()`.
   */
  escrowTokenAccount: PublicKey;
  /**
   * Commitment id — a u64 unique per config.
   * Caller is responsible for uniqueness; use `Date.now()` or a counter.
   */
  commitmentId: BN;
  /** Token program for the stablecoin mint (default: TOKEN_2022_PROGRAM_ID). */
  tokenProgram?: PublicKey;
}

/**
 * Return value of {@link ProbabilisticModule.commitProbabilistic}.
 */
export interface CommitResult {
  /** The commitment id identifying this vault (same as `params.commitmentId`). */
  commitmentId: BN;
  /** Transaction signature. */
  txSig: TransactionSignature;
}

/**
 * Parameters for {@link ProbabilisticModule.proveAndResolve}.
 */
export interface ProveAndResolveParams {
  /** SSS stablecoin mint. */
  mint: PublicKey;
  /** Commitment id (from `CommitResult.commitmentId`). */
  commitmentId: BN;
  /** Config PDA (derive with `deriveConfigPda` or pass directly). */
  config?: PublicKey;
  /** Escrow token account (owned by the vault PDA). */
  escrowTokenAccount: PublicKey;
  /** Claimant's token account (receives the released funds). */
  claimantTokenAccount: PublicKey;
  /** Token program (default: TOKEN_2022_PROGRAM_ID). */
  tokenProgram?: PublicKey;
}

/**
 * Parameters for {@link ProbabilisticModule.partialResolve}.
 */
export interface PartialResolveParams {
  /** SSS stablecoin mint. */
  mint: PublicKey;
  /** Commitment id. */
  commitmentId: BN;
  /** Config PDA. */
  config?: PublicKey;
  /** Amount to release to the claimant (in native units). Remainder goes to issuer. */
  amount: BN;
  /** Escrow token account (owned by vault PDA). */
  escrowTokenAccount: PublicKey;
  /** Claimant's token account. */
  claimantTokenAccount: PublicKey;
  /** Issuer's token account (receives remainder). */
  issuerTokenAccount: PublicKey;
  /** Token program (default: TOKEN_2022_PROGRAM_ID). */
  tokenProgram?: PublicKey;
}

/**
 * Parameters for {@link ProbabilisticModule.expireAndRefund}.
 */
export interface ExpireAndRefundParams {
  /** SSS stablecoin mint. */
  mint: PublicKey;
  /** Commitment id. */
  commitmentId: BN;
  /** Config PDA. */
  config?: PublicKey;
  /** Escrow token account (owned by vault PDA). */
  escrowTokenAccount: PublicKey;
  /** Issuer's token account (receives refund). */
  issuerTokenAccount: PublicKey;
  /** Token program (default: TOKEN_2022_PROGRAM_ID). */
  tokenProgram?: PublicKey;
}

// ─── PDA helpers ──────────────────────────────────────────────────────────────

/**
 * Derive the `StablecoinConfig` PDA for a given mint.
 *
 * Seeds: `[b"stablecoin-config", mint]`
 */
export function derivePbsConfigPda(mint: PublicKey, programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [PBS_CONFIG_SEED, mint.toBuffer()],
    programId,
  );
}

/**
 * Derive the `ProbabilisticVault` PDA for a given config + commitment id.
 *
 * Seeds: `[b"pbs-vault", config, commitment_id_le8]`
 */
export function derivePbsVaultPda(
  config: PublicKey,
  commitmentId: BN,
  programId: PublicKey,
): [PublicKey, number] {
  const idBuf = Buffer.alloc(8);
  idBuf.writeBigUInt64LE(BigInt(commitmentId.toString()));
  return PublicKey.findProgramAddressSync(
    [PBS_VAULT_SEED, config.toBuffer(), idBuf],
    programId,
  );
}

// ─── ProbabilisticModule ──────────────────────────────────────────────────────

/**
 * SDK wrapper for the SSS-109 Probabilistic Balance Standard on-chain program.
 *
 * Requires the `FLAG_PROBABILISTIC_MONEY` feature flag (`1 << 20`) to be set
 * on the `StablecoinConfig` PDA at initialize time.
 */
export class ProbabilisticModule {
  constructor(
    public readonly provider: AnchorProvider,
    public readonly programId: PublicKey,
  ) {}

  // ─── Write: commitProbabilistic ─────────────────────────────────────────

  /**
   * Lock stablecoin tokens in a `ProbabilisticVault` PDA conditioned on a
   * hash-based proof.
   *
   * The issuer transfers `amount` tokens from `issuerTokenAccount` to
   * `escrowTokenAccount` (owned by the vault PDA). The claimant can later call
   * `proveAndResolve` to release the full amount, `partialResolve` for a
   * partial release, or anyone can call `expireAndRefund` after `expirySlot`.
   *
   * @param params - See {@link CommitProbabilisticParams}.
   * @returns `{ commitmentId, txSig }` — the commitment id and transaction sig.
   * @throws When `amount` is zero.
   * @throws When `expirySlot` is not in the future.
   * @throws When `conditionHash` is not 32 bytes.
   */
  async commitProbabilistic(params: CommitProbabilisticParams): Promise<CommitResult> {
    const {
      mint,
      amount,
      conditionHash,
      expirySlot,
      claimant,
      commitmentId,
      escrowTokenAccount,
      tokenProgram = TOKEN_2022_PROGRAM_ID,
    } = params;

    if (amount.lten(0)) throw new Error('amount must be > 0');
    if (conditionHash.length !== 32) throw new Error('conditionHash must be 32 bytes');
    // SSS-114 M-002: guard against obviously invalid expirySlot values.
    // The on-chain program enforces expiry_slot > clock.slot, but catching it
    // here gives a clear SDK error instead of an opaque program revert.
    // TIP: fetch the current slot first:
    //   const slot = await provider.connection.getSlot();
    //   expirySlot = new BN(slot + 1000);
    if (expirySlot.lten(0)) throw new Error('expirySlot must be a positive slot number (must be > current on-chain slot)');

    const [configPda] = derivePbsConfigPda(mint, this.programId);
    const [vaultPda] = derivePbsVaultPda(configPda, commitmentId, this.programId);

    const issuerTokenAccount =
      params.issuerTokenAccount ??
      (await this._getAssociatedTokenAddress(mint, this.provider.wallet.publicKey, tokenProgram));

    // CommitProbabilisticParams ABI:
    //   amount: u64 (8 bytes LE)
    //   condition_hash: [u8; 32]
    //   expiry_slot: u64 (8 bytes LE)
    //   commitment_id: u64 (8 bytes LE)
    //   claimant: Pubkey (32 bytes)
    // Total param bytes: 8 + 32 + 8 + 8 + 32 = 88
    // Total IX data: 8 (discriminator) + 88 = 96

    const data = Buffer.alloc(96);
    DISC_COMMIT_PROBABILISTIC.copy(data, 0);
    data.writeBigUInt64LE(BigInt(amount.toString()), 8);
    Buffer.from(conditionHash).copy(data, 16);
    data.writeBigUInt64LE(BigInt(expirySlot.toString()), 48);
    data.writeBigUInt64LE(BigInt(commitmentId.toString()), 56);
    claimant.toBuffer().copy(data, 64);

    const ix = new TransactionInstruction({
      programId: this.programId,
      keys: [
        { pubkey: this.provider.wallet.publicKey, isSigner: true, isWritable: true }, // issuer
        { pubkey: configPda, isSigner: false, isWritable: false },                    // config
        { pubkey: mint, isSigner: false, isWritable: false },                         // stable_mint
        { pubkey: vaultPda, isSigner: false, isWritable: true },                      // vault (init)
        { pubkey: escrowTokenAccount, isSigner: false, isWritable: true },            // escrow_token_account
        { pubkey: issuerTokenAccount, isSigner: false, isWritable: true },            // issuer_token_account
        { pubkey: tokenProgram, isSigner: false, isWritable: false },                 // token_program
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },      // system_program
      ],
      data,
    });

    const tx = new Transaction().add(ix);
    const txSig = await this.provider.sendAndConfirm(tx, []);
    return { commitmentId, txSig };
  }

  // ─── Write: proveAndResolve ─────────────────────────────────────────────

  /**
   * Release the full vault balance to the claimant upon proof submission.
   *
   * Only the claimant (matching `vault.claimant`) may call this. The
   * `proofHash` must equal `vault.condition_hash` or the transaction reverts
   * with `ProofHashMismatch`.
   *
   * @param commitmentId        - The commitment id from `commitProbabilistic`.
   * @param proofHash           - 32-byte proof matching the condition hash.
   * @param params              - Additional account params.
   * @returns Transaction signature.
   * @throws When `proofHash` is not 32 bytes.
   */
  async proveAndResolve(
    proofHash: Uint8Array | Buffer,
    params: ProveAndResolveParams,
  ): Promise<TransactionSignature> {
    const {
      mint,
      commitmentId,
      escrowTokenAccount,
      claimantTokenAccount,
      tokenProgram = TOKEN_2022_PROGRAM_ID,
    } = params;

    if (proofHash.length !== 32) throw new Error('proofHash must be 32 bytes');

    const [configPda] = derivePbsConfigPda(mint, this.programId);
    const config = params.config ?? configPda;
    const [vaultPda] = derivePbsVaultPda(config, commitmentId, this.programId);

    // ProveAndResolve params ABI: proof_hash: [u8; 32]
    // Total: 8 (disc) + 32 = 40

    const data = Buffer.alloc(40);
    DISC_PROVE_AND_RESOLVE.copy(data, 0);
    Buffer.from(proofHash).copy(data, 8);

    const ix = new TransactionInstruction({
      programId: this.programId,
      keys: [
        { pubkey: this.provider.wallet.publicKey, isSigner: true, isWritable: false }, // claimant
        { pubkey: vaultPda, isSigner: false, isWritable: true },                       // vault
        { pubkey: mint, isSigner: false, isWritable: false },                          // stable_mint
        { pubkey: escrowTokenAccount, isSigner: false, isWritable: true },             // escrow_token_account
        { pubkey: claimantTokenAccount, isSigner: false, isWritable: true },           // claimant_token_account
        { pubkey: tokenProgram, isSigner: false, isWritable: false },                  // token_program
      ],
      data,
    });

    const tx = new Transaction().add(ix);
    return this.provider.sendAndConfirm(tx, []);
  }

  // ─── Write: partialResolve ──────────────────────────────────────────────

  /**
   * Partially release funds to the claimant; return the remainder to the issuer.
   *
   * Useful when the claimant delivered partial work and the issuer agrees to a
   * proportional payment. The vault transitions to `PartiallyResolved`.
   *
   * @param proofHash - 32-byte proof matching `vault.condition_hash`.
   * @param params    - Amounts and accounts.
   * @returns Transaction signature.
   * @throws When `amount` is zero or exceeds vault balance.
   */
  async partialResolve(
    proofHash: Uint8Array | Buffer,
    params: PartialResolveParams,
  ): Promise<TransactionSignature> {
    const {
      mint,
      commitmentId,
      amount,
      escrowTokenAccount,
      claimantTokenAccount,
      issuerTokenAccount,
      tokenProgram = TOKEN_2022_PROGRAM_ID,
    } = params;

    if (proofHash.length !== 32) throw new Error('proofHash must be 32 bytes');
    if (amount.lten(0)) throw new Error('amount must be > 0');

    const [configPda] = derivePbsConfigPda(mint, this.programId);
    const config = params.config ?? configPda;
    const [vaultPda] = derivePbsVaultPda(config, commitmentId, this.programId);

    // PartialResolve params ABI:
    //   amount: u64 (8 bytes LE)
    //   proof_hash: [u8; 32]
    // Total: 8 (disc) + 8 + 32 = 48

    const data = Buffer.alloc(48);
    DISC_PARTIAL_RESOLVE.copy(data, 0);
    data.writeBigUInt64LE(BigInt(amount.toString()), 8);
    Buffer.from(proofHash).copy(data, 16);

    const ix = new TransactionInstruction({
      programId: this.programId,
      keys: [
        { pubkey: this.provider.wallet.publicKey, isSigner: true, isWritable: false }, // claimant
        { pubkey: vaultPda, isSigner: false, isWritable: true },                       // vault
        { pubkey: mint, isSigner: false, isWritable: false },                          // stable_mint
        { pubkey: escrowTokenAccount, isSigner: false, isWritable: true },             // escrow_token_account
        { pubkey: claimantTokenAccount, isSigner: false, isWritable: true },           // claimant_token_account
        { pubkey: issuerTokenAccount, isSigner: false, isWritable: true },             // issuer_token_account
        { pubkey: tokenProgram, isSigner: false, isWritable: false },                  // token_program
      ],
      data,
    });

    const tx = new Transaction().add(ix);
    return this.provider.sendAndConfirm(tx, []);
  }

  // ─── Write: expireAndRefund ─────────────────────────────────────────────

  /**
   * Refund the issuer after the vault has passed its expiry slot.
   *
   * Permissionless — anyone may call this once `clock.slot >= vault.expiry_slot`.
   * If the escrow is already empty (e.g. all funds were partially resolved), the
   * vault is simply marked `Expired`.
   *
   * @param params - Accounts and expiry details.
   * @returns Transaction signature.
   */
  async expireAndRefund(params: ExpireAndRefundParams): Promise<TransactionSignature> {
    const {
      mint,
      commitmentId,
      escrowTokenAccount,
      issuerTokenAccount,
      tokenProgram = TOKEN_2022_PROGRAM_ID,
    } = params;

    const [configPda] = derivePbsConfigPda(mint, this.programId);
    const config = params.config ?? configPda;
    const [vaultPda] = derivePbsVaultPda(config, commitmentId, this.programId);

    // ExpireAndRefund has no extra params; only discriminator in data.
    const data = Buffer.alloc(8);
    DISC_EXPIRE_AND_REFUND.copy(data, 0);

    const ix = new TransactionInstruction({
      programId: this.programId,
      keys: [
        { pubkey: this.provider.wallet.publicKey, isSigner: true, isWritable: false }, // caller (permissionless)
        { pubkey: vaultPda, isSigner: false, isWritable: true },                       // vault
        { pubkey: mint, isSigner: false, isWritable: false },                          // stable_mint
        { pubkey: escrowTokenAccount, isSigner: false, isWritable: true },             // escrow_token_account
        { pubkey: issuerTokenAccount, isSigner: false, isWritable: true },             // issuer_token_account
        { pubkey: tokenProgram, isSigner: false, isWritable: false },                  // token_program
      ],
      data,
    });

    const tx = new Transaction().add(ix);
    return this.provider.sendAndConfirm(tx, []);
  }

  // ─── Read: getCommitment ────────────────────────────────────────────────

  /**
   * Fetch and decode a `ProbabilisticVault` account from on-chain.
   *
   * Returns the full decoded vault state, including remaining balance,
   * condition hash, status, and expiry slot.
   *
   * @param mint         - The stablecoin mint.
   * @param commitmentId - The commitment id.
   * @returns Decoded {@link ProbabilisticVault}.
   * @throws When the vault account is not found.
   */
  async getCommitment(mint: PublicKey, commitmentId: BN): Promise<ProbabilisticVault> {
    const [configPda] = derivePbsConfigPda(mint, this.programId);
    const [vaultPda] = derivePbsVaultPda(configPda, commitmentId, this.programId);

    const accountInfo = await this.provider.connection.getAccountInfo(vaultPda);
    if (!accountInfo) {
      throw new Error(
        `ProbabilisticVault not found for commitmentId ${commitmentId.toString()} ` +
        `(PDA: ${vaultPda.toBase58()})`,
      );
    }

    return ProbabilisticModule.decodeVault(accountInfo.data);
  }

  /**
   * Compute the remaining unlocked amount in a vault.
   * Off-chain replica of `ProbabilisticVault::remaining()`.
   *
   * @param vault - Decoded vault state.
   * @returns `committedAmount - resolvedAmount`.
   */
  remainingAmount(vault: ProbabilisticVault): bigint {
    return vault.committedAmount > vault.resolvedAmount
      ? vault.committedAmount - vault.resolvedAmount
      : 0n;
  }

  /**
   * Returns `true` when the vault is in a terminal state (no further mutations).
   * Terminal = `Resolved` or `Expired`.
   */
  isTerminal(vault: ProbabilisticVault): boolean {
    return vault.status === VaultStatus.Resolved || vault.status === VaultStatus.Expired;
  }

  // ─── PDA helpers (public) ───────────────────────────────────────────────

  /** Derive the `StablecoinConfig` PDA for a mint. */
  configPda(mint: PublicKey): [PublicKey, number] {
    return derivePbsConfigPda(mint, this.programId);
  }

  /** Derive the `ProbabilisticVault` PDA for a config + commitment id. */
  vaultPda(config: PublicKey, commitmentId: BN): [PublicKey, number] {
    return derivePbsVaultPda(config, commitmentId, this.programId);
  }

  // ─── Static decode helper ───────────────────────────────────────────────

  /**
   * Decode raw account bytes into a {@link ProbabilisticVault}.
   *
   * ProbabilisticVault layout (after 8-byte Anchor discriminator):
   *   config:           Pubkey  [32]
   *   issuer:           Pubkey  [32]
   *   claimant:         Pubkey  [32]
   *   stable_mint:      Pubkey  [32]
   *   committed_amount: u64     [8]
   *   resolved_amount:  u64     [8]
   *   condition_hash:   [u8;32] [32]
   *   expiry_slot:      u64     [8]
   *   commitment_id:    u64     [8]
   *   status:           u8      [1]
   *   bump:             u8      [1]
   *   Total: 8 + 32*4 + 8*4 + 32 + 2 = 8 + 128 + 32 + 32 + 2 = 202
   */
  static decodeVault(data: Buffer): ProbabilisticVault {
    let offset = 8; // skip discriminator

    const config     = new PublicKey(data.slice(offset, offset + 32)); offset += 32;
    const issuer     = new PublicKey(data.slice(offset, offset + 32)); offset += 32;
    const claimant   = new PublicKey(data.slice(offset, offset + 32)); offset += 32;
    const stableMint = new PublicKey(data.slice(offset, offset + 32)); offset += 32;

    const committedAmount = data.readBigUInt64LE(offset); offset += 8;
    const resolvedAmount  = data.readBigUInt64LE(offset); offset += 8;

    const conditionHash = new Uint8Array(data.slice(offset, offset + 32)); offset += 32;

    const expirySlot    = data.readBigUInt64LE(offset); offset += 8;
    const commitmentId  = data.readBigUInt64LE(offset); offset += 8;

    const status = data.readUInt8(offset) as VaultStatus; offset += 1;
    const bump   = data.readUInt8(offset);

    return {
      config,
      issuer,
      claimant,
      stableMint,
      committedAmount,
      resolvedAmount,
      conditionHash,
      expirySlot,
      commitmentId,
      status,
      bump,
    };
  }

  // ─── Private helpers ────────────────────────────────────────────────────

  /**
   * Derive an associated token address for a wallet + mint, using the given
   * token program.  Avoids a full @solana/spl-token import by computing it
   * manually via findProgramAddressSync.
   */
  private async _getAssociatedTokenAddress(
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

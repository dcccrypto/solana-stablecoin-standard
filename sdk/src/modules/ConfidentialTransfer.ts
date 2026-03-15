/**
 * ConfidentialTransfer Module — SSS Direction 5
 *
 * TypeScript stubs for Token-2022 Confidential Transfer extension wrappers.
 * Amounts are hidden using ElGamal encryption on-chain; auditors can decrypt
 * balances using a shared auditor key. ZK proofs (range + validity) are
 * verified on-chain via the ZK Token Proof program.
 *
 * References:
 *  - SPL Token-2022 ConfidentialTransfer extension
 *  - ZK Token SDK (zk-token-sdk crate)
 *  - spl_token_2022::extension::confidential_transfer
 *
 * @module ConfidentialTransfer
 */

import { PublicKey, TransactionInstruction } from '@solana/web3.js';

// ---------------------------------------------------------------------------
// Key types
// ---------------------------------------------------------------------------

/**
 * ElGamal public key (32 bytes, Ristretto255 point).
 * Used to encrypt balances on-chain.
 */
export type ElGamalPubkey = Uint8Array; // 32 bytes

/**
 * ElGamal secret key (32 bytes scalar).
 * Used by the account owner or auditor to decrypt balances.
 */
export type ElGamalSecretKey = Uint8Array; // 32 bytes

/**
 * ElGamal keypair for a token account or auditor.
 */
export interface ElGamalKeypair {
  publicKey: ElGamalPubkey;
  secretKey: ElGamalSecretKey;
}

/**
 * AES-128-GCM symmetric key (16 bytes).
 * Used to encrypt the decryptable balance in the token account extension data.
 */
export type AesKey = Uint8Array; // 16 bytes

// ---------------------------------------------------------------------------
// Encrypted amount
// ---------------------------------------------------------------------------

/**
 * An ElGamal-encrypted amount.
 * Ciphertext = (C_lo, C_hi) where each is a Pedersen commitment.
 * lo covers bits 0–15, hi covers bits 16–47.
 */
export interface EncryptedAmount {
  /** Low bits ciphertext (32 bytes) */
  ciphertextLo: Uint8Array;
  /** High bits ciphertext (32 bytes) */
  ciphertextHi: Uint8Array;
}

/**
 * AES-GCM encrypted "decryptable balance" stored in the token account.
 * The owner can decrypt this quickly without a ZK proof.
 */
export interface DecryptableBalance {
  /** AES-128-GCM ciphertext of the balance (12-byte nonce || 16-byte tag prepended) */
  ciphertext: Uint8Array; // 36 bytes typical
}

// ---------------------------------------------------------------------------
// ZK proof types
// ---------------------------------------------------------------------------

/**
 * Zero-knowledge range proof that an encrypted amount is in [0, 2^48).
 * Verified by the ZK Token Proof program on-chain.
 */
export interface RangeProof {
  /** Serialized range proof bytes (Bulletproof) */
  proof: Uint8Array;
}

/**
 * Zero-knowledge ciphertext validity proof.
 * Proves that a ciphertext encrypts the same value under two different keys.
 */
export interface CiphertextValidityProof {
  proof: Uint8Array;
}

/**
 * Combined ZK proof context for a confidential transfer.
 */
export interface TransferProofContext {
  rangeProof: RangeProof;
  ciphertextValidityProof: CiphertextValidityProof;
  /** New source balance encrypted under source ElGamal key */
  newSourceCiphertext: EncryptedAmount;
  /** Transfer amount encrypted under destination ElGamal key */
  destinationCiphertext: EncryptedAmount;
  /** Transfer amount encrypted under auditor ElGamal key (for compliance) */
  auditorCiphertext?: EncryptedAmount;
}

// ---------------------------------------------------------------------------
// Extension account shape
// ---------------------------------------------------------------------------

/**
 * On-chain `ConfidentialTransferMint` extension data stored in the mint account.
 * Configured by the mint authority at initialization.
 */
export interface ConfidentialTransferMintExtension {
  /** Authority that can modify CT configuration */
  authority: PublicKey;
  /** ElGamal public key of the designated auditor */
  auditorElGamalPubkey: ElGamalPubkey;
  /** Whether auto-approve is enabled (all new accounts auto-approved) */
  autoApproveNewAccounts: boolean;
}

/**
 * Per-token-account confidential transfer state.
 */
export interface ConfidentialTransferAccountExtension {
  /** True if this account is approved for confidential transfers */
  approved: boolean;
  /** Account's ElGamal public key */
  elGamalPubkey: ElGamalPubkey;
  /** Pending balance (incoming transfers not yet applied) */
  pendingBalance: EncryptedAmount;
  /** Available balance (after applying pending) */
  availableBalance: EncryptedAmount;
  /** AES-encrypted "decryptable balance" for fast owner queries */
  decryptableAvailableBalance: DecryptableBalance;
  /** Withheld fee amount (Token-2022 transfer fee integration) */
  withheldAmount: EncryptedAmount;
}

// ---------------------------------------------------------------------------
// Instruction params
// ---------------------------------------------------------------------------

/**
 * Parameters for `encrypt_amount` (off-chain utility).
 * Encrypts a plaintext amount under a recipient's ElGamal public key.
 */
export interface EncryptAmountParams {
  /** Plaintext amount (base units, max 2^48 - 1) */
  amount: bigint;
  /** Recipient's ElGamal public key */
  recipientPubkey: ElGamalPubkey;
  /** Optional: also encrypt for auditor */
  auditorPubkey?: ElGamalPubkey;
}

/**
 * Parameters for `decrypt_with_auditor_key` (off-chain utility).
 * Decrypts a ciphertext using the auditor's ElGamal secret key.
 */
export interface DecryptWithAuditorKeyParams {
  /** Encrypted amount to decrypt */
  encryptedAmount: EncryptedAmount;
  /** Auditor's ElGamal secret key */
  auditorSecretKey: ElGamalSecretKey;
}

/**
 * Parameters for `apply_pending_balance`.
 * Token account owner applies their pending balance to available.
 */
export interface ApplyPendingBalanceParams {
  /** Token account to update */
  tokenAccount: PublicKey;
  /** Owner signer */
  owner: PublicKey;
  /** New decryptable available balance (AES-encrypted) */
  newDecryptableAvailableBalance: DecryptableBalance;
  /** Expected pending balance credit counter */
  expectedPendingBalanceCreditCounter: bigint;
}

/**
 * Parameters for `configure_account`.
 * Approves a token account for confidential transfers.
 */
export interface ConfigureAccountParams {
  /** Token account to configure */
  tokenAccount: PublicKey;
  /** Mint with ConfidentialTransfer extension */
  mint: PublicKey;
  /** Account owner signer */
  owner: PublicKey;
  /** Owner's ElGamal public key */
  elGamalPubkey: ElGamalPubkey;
  /** Initial decryptable zero balance */
  decryptableZeroBalance: DecryptableBalance;
}

// ---------------------------------------------------------------------------
// Module stub
// ---------------------------------------------------------------------------

/**
 * ConfidentialTransfer — stub interface for the SSS Direction 5 SDK module.
 *
 * Wraps the Token-2022 ConfidentialTransfer extension with ergonomic helpers
 * for key generation, encryption, decryption, and ZK proof building.
 *
 * @example
 * ```ts
 * const ct = new ConfidentialTransfer(connection, mint, programId);
 * const keypair = ct.generateElGamalKeypair();
 * const { ciphertext } = await ct.encryptAmount({ amount: 1_000_000n, recipientPubkey: keypair.publicKey });
 * const decrypted = await ct.decryptWithAuditorKey({ encryptedAmount: ciphertext, auditorSecretKey });
 * ```
 */
export interface IConfidentialTransfer {
  /**
   * Generate a fresh ElGamal keypair for a token account or auditor.
   */
  generateElGamalKeypair(): ElGamalKeypair;

  /**
   * Generate a fresh AES-128 key for the decryptable balance.
   */
  generateAesKey(): AesKey;

  /**
   * Encrypt a plaintext amount under one or two ElGamal public keys.
   * Returns the encrypted amount(s) and an AES-encrypted decryptable balance.
   */
  encryptAmount(params: EncryptAmountParams): Promise<{
    recipientCiphertext: EncryptedAmount;
    auditorCiphertext?: EncryptedAmount;
    decryptableBalance: DecryptableBalance;
  }>;

  /**
   * Decrypt an encrypted amount using the auditor's ElGamal secret key.
   * Used for compliance auditing without revealing the owner's secret.
   */
  decryptWithAuditorKey(params: DecryptWithAuditorKeyParams): Promise<bigint>;

  /**
   * Build a `configure_account` instruction to enroll a token account.
   */
  configureAccount(params: ConfigureAccountParams): Promise<TransactionInstruction>;

  /**
   * Build an `apply_pending_balance` instruction.
   */
  applyPendingBalance(params: ApplyPendingBalanceParams): Promise<TransactionInstruction>;

  /**
   * Fetch the ConfidentialTransferMint extension data from a mint account.
   */
  fetchMintExtension(mint: PublicKey): Promise<ConfidentialTransferMintExtension | null>;

  /**
   * Fetch the ConfidentialTransferAccount extension data from a token account.
   */
  fetchAccountExtension(
    tokenAccount: PublicKey,
  ): Promise<ConfidentialTransferAccountExtension | null>;
}

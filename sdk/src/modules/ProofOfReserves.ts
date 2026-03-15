/**
 * ProofOfReserves Module — SSS Direction 1
 *
 * TypeScript stubs for on-chain Merkle-tree-based reserve attestation.
 * Issuers publish a Merkle root; any holder can verify their balance
 * is included in the attested total.
 *
 * @module ProofOfReserves
 */

import { PublicKey, TransactionInstruction } from '@solana/web3.js';

// ---------------------------------------------------------------------------
// Leaf encoding
// ---------------------------------------------------------------------------

/**
 * A single depositor leaf: H(address || balance_le_u64).
 * Both on-chain (Rust) and off-chain (TS) must use this canonical format.
 */
export interface MerkleLeaf {
  /** Depositor public key */
  address: PublicKey;
  /** Balance in base units (little-endian u64 when hashed) */
  balance: bigint;
}

// ---------------------------------------------------------------------------
// Account types
// ---------------------------------------------------------------------------

/**
 * On-chain `ReserveMerkleRoot` PDA (seeds: ["merkle-root", epoch]).
 * 80 bytes: root[32] + epoch[8] + total_supply[8] + timestamp[8].
 */
export interface ReserveMerkleRootAccount {
  /** SHA-256 Merkle root of all depositor leaves */
  root: Uint8Array; // 32 bytes
  /** Epoch this root covers (monotonically increasing) */
  epoch: bigint;
  /** Total supply attested at this epoch */
  totalSupply: bigint;
  /** Unix timestamp (seconds) when root was set */
  timestamp: bigint;
}

// ---------------------------------------------------------------------------
// Instruction params
// ---------------------------------------------------------------------------

/**
 * Parameters for `update_merkle_root`.
 * Called by the issuer authority to publish a new root each epoch.
 */
export interface SubmitMerkleProofParams {
  /** New 32-byte Merkle root */
  root: Uint8Array;
  /** Total reserve supply captured in this root */
  totalSupply: bigint;
  /** Epoch number (must be > current on-chain epoch) */
  epoch: bigint;
  /** Issuer authority signer */
  authority: PublicKey;
  /** Stablecoin mint (used to derive the PDA) */
  mint: PublicKey;
}

/**
 * Parameters for `verify_inclusion`.
 * Callable by anyone; succeeds if the leaf is correctly included in the root.
 */
export interface VerifyInclusionParams {
  /** Merkle proof: array of 32-byte sibling hashes from leaf to root */
  proof: Uint8Array[]; // each entry 32 bytes
  /** Leaf index (0-based) in the tree */
  leafIndex: bigint;
  /** Depositor address being verified */
  address: PublicKey;
  /** Claimed balance */
  balance: bigint;
  /** Stablecoin mint (used to derive the root PDA) */
  mint: PublicKey;
}

// ---------------------------------------------------------------------------
// Return types
// ---------------------------------------------------------------------------

/** Result of a `verify_inclusion` check */
export interface InclusionVerificationResult {
  /** True if the proof is valid and the leaf is in the root */
  verified: boolean;
  /** Epoch of the root that was checked */
  epoch: bigint;
  /** Root hash that was used */
  root: Uint8Array;
}

// ---------------------------------------------------------------------------
// Module stub
// ---------------------------------------------------------------------------

/**
 * ProofOfReserves — stub interface for the SSS Direction 1 SDK module.
 *
 * Implementations will wrap the on-chain program instructions and provide
 * an off-chain Merkle tree builder that matches the canonical leaf format.
 *
 * @example
 * ```ts
 * const por = new ProofOfReserves(connection, programId);
 * const ix = await por.submitMerkleProof({ root, totalSupply, epoch, authority, mint });
 * const result = await por.verifyInclusion({ proof, leafIndex, address, balance, mint });
 * ```
 */
export interface IProofOfReserves {
  /**
   * Build a `update_merkle_root` instruction.
   * The issuer signs and sends this each epoch to attest reserves.
   */
  submitMerkleProof(params: SubmitMerkleProofParams): Promise<TransactionInstruction>;

  /**
   * Verify a depositor's inclusion in the on-chain Merkle root.
   * Reads the current `ReserveMerkleRoot` PDA and recomputes the path.
   */
  verifyInclusion(params: VerifyInclusionParams): Promise<InclusionVerificationResult>;

  /**
   * Fetch the current on-chain `ReserveMerkleRoot` PDA for a mint.
   */
  fetchMerkleRoot(mint: PublicKey, epoch: bigint): Promise<ReserveMerkleRootAccount | null>;
}

// ---------------------------------------------------------------------------
// PDA helpers
// ---------------------------------------------------------------------------

/**
 * Derive the `ReserveMerkleRoot` PDA for a given mint + epoch.
 *
 * Seeds: ["merkle-root", mint, epoch_le_u64]
 */
export async function findReserveMerkleRootPda(
  mint: PublicKey,
  epoch: bigint,
  programId: PublicKey,
): Promise<[PublicKey, number]> {
  const epochBuf = Buffer.alloc(8);
  epochBuf.writeBigUInt64LE(epoch);
  return PublicKey.findProgramAddressSync(
    [Buffer.from('merkle-root'), mint.toBuffer(), epochBuf],
    programId,
  );
}

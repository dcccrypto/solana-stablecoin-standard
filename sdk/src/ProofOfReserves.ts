import { Connection, PublicKey } from '@solana/web3.js';
import { createHash } from 'crypto';

// ─── Types ───────────────────────────────────────────────────────────────────

/** The type of proof backing the reserves snapshot. */
export type ProofType = 'merkle' | 'oracle' | 'manual';

/** A snapshot of on-chain reserve proof data returned by the backend. */
export interface ReservesProof {
  /** Hex-encoded Merkle root committing to all reserve leaves. */
  merkleRoot: string;
  /** Total token supply at the time of verification (base units). */
  totalSupply: bigint;
  /** Solana slot at which the proof was last verified. */
  lastVerifiedSlot: bigint;
  /** Mechanism used to generate the proof. */
  proofType: ProofType;
}

/**
 * A Merkle proof for a single leaf.
 *
 * The leaf value and sibling hashes are hex strings.
 * `indices` controls the direction at each level:
 *   - `false` = sibling is on the right
 *   - `true`  = sibling is on the left
 */
export interface MerkleProof {
  /** Hex-encoded leaf hash being proven. */
  leaf: string;
  /** Ordered array of sibling hashes from leaf up to root. */
  siblings: string[];
  /** Direction bits (false = sibling right, true = sibling left). */
  indices: boolean[];
}

// ─── Internal API shape ───────────────────────────────────────────────────────

interface ReservesProofApiResponse {
  success: boolean;
  data: {
    merkle_root: string;
    total_supply: string | number;
    last_verified_slot: string | number;
    proof_type: ProofType;
  } | null;
  error: string | null;
}

// ─── ProofOfReserves ──────────────────────────────────────────────────────────

/**
 * ProofOfReserves — SSS direction 1.
 *
 * Provides helpers to:
 * 1. Fetch a reserves proof from the SSS backend (`fetchReservesProof`).
 * 2. Verify a Merkle inclusion proof client-side (`verifyMerkleProof`).
 *
 * @example
 * ```ts
 * const por = new ProofOfReserves('http://localhost:8080', 'sss_apikey');
 * const mint = new PublicKey('...');
 * const connection = new Connection('https://api.devnet.solana.com');
 *
 * const proof = await por.fetchReservesProof(mint, connection);
 * console.log('Merkle root:', proof.merkleRoot);
 * ```
 */
export class ProofOfReserves {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  /**
   * @param baseUrl  Base URL of the SSS backend (e.g. "http://localhost:8080").
   * @param apiKey   API key sent in the `X-Api-Key` header.
   */
  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.apiKey = apiKey;
  }

  /**
   * Fetch a reserves proof for the given mint from the SSS backend.
   *
   * Calls `GET /api/reserves/proof?mint=<base58>`.
   *
   * @param mint       The token mint whose reserves are being queried.
   * @param _connection Solana connection (reserved for future on-chain validation).
   * @returns          A `ReservesProof` snapshot.
   * @throws           `Error` when the backend returns a non-OK response or
   *                   reports `success: false`.
   */
  async fetchReservesProof(
    mint: PublicKey,
    _connection: Connection
  ): Promise<ReservesProof> {
    const url = `${this.baseUrl}/api/reserves/proof?mint=${mint.toBase58()}`;
    const res = await fetch(url, {
      headers: {
        'X-Api-Key': this.apiKey,
        'Content-Type': 'application/json',
      },
    });

    let envelope: ReservesProofApiResponse;
    try {
      envelope = (await res.json()) as ReservesProofApiResponse;
    } catch {
      throw new Error(
        `Unexpected non-JSON response from /api/reserves/proof (HTTP ${res.status})`
      );
    }

    if (!res.ok || !envelope.success || !envelope.data) {
      throw new Error(
        envelope.error ?? `fetchReservesProof failed with HTTP ${res.status}`
      );
    }

    const d = envelope.data;
    return {
      merkleRoot: d.merkle_root,
      totalSupply: BigInt(d.total_supply),
      lastVerifiedSlot: BigInt(d.last_verified_slot),
      proofType: d.proof_type,
    };
  }

  /**
   * Verify a Merkle inclusion proof against a known root.
   *
   * Uses double-SHA256 (`SHA256(SHA256(data))`) at each level, consistent
   * with Bitcoin-style Merkle trees.  Each hash input concatenates
   * `[left, right]` in little-endian byte order.
   *
   * @param proof  The `MerkleProof` to verify.
   * @param root   Hex-encoded expected Merkle root.
   * @returns      `true` if the proof is valid; `false` otherwise.
   */
  verifyMerkleProof(proof: MerkleProof, root: string): boolean {
    if (proof.siblings.length !== proof.indices.length) return false;

    try {
      let current = Buffer.from(proof.leaf, 'hex');

      for (let i = 0; i < proof.siblings.length; i++) {
        const sibling = Buffer.from(proof.siblings[i], 'hex');
        const siblingIsLeft = proof.indices[i];

        const combined = siblingIsLeft
          ? Buffer.concat([sibling, current])
          : Buffer.concat([current, sibling]);

        // Double-SHA256
        const first = createHash('sha256').update(combined).digest();
        current = createHash('sha256').update(first).digest();
      }

      return current.toString('hex') === root.toLowerCase();
    } catch {
      return false;
    }
  }
}

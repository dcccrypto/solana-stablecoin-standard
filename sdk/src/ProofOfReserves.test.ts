import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'crypto';
import { Connection, PublicKey } from '@solana/web3.js';
import { ProofOfReserves, type ReservesProof, type MerkleProof } from './ProofOfReserves';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Double-SHA256 identical to the one in ProofOfReserves.verifyMerkleProof. */
function dsha256(buf: Buffer): Buffer {
  return createHash('sha256')
    .update(createHash('sha256').update(buf).digest())
    .digest();
}

/** Build a minimal 2-leaf Merkle tree and return root + proof for leaf0. */
function buildTwoLeafTree(leaf0Hex: string, leaf1Hex: string) {
  const leaf0 = Buffer.from(leaf0Hex, 'hex');
  const leaf1 = Buffer.from(leaf1Hex, 'hex');
  const root = dsha256(Buffer.concat([leaf0, leaf1]));
  const proof: MerkleProof = {
    leaf: leaf0Hex,
    siblings: [leaf1Hex],
    indices: [false], // sibling (leaf1) is on the right
  };
  return { root: root.toString('hex'), proof };
}

// ─── fetchReservesProof ───────────────────────────────────────────────────────

describe('ProofOfReserves.fetchReservesProof', () => {
  const MINT = new PublicKey('So11111111111111111111111111111111111111112');
  const CONNECTION = {} as Connection; // not used in unit tests
  const BASE_URL = 'http://localhost:8080';
  const API_KEY = 'sss_testkey';

  const MOCK_RESPONSE = {
    success: true,
    data: {
      merkle_root: 'aabbccdd00112233aabbccdd00112233aabbccdd00112233aabbccdd00112233',
      total_supply: '1000000000',
      last_verified_slot: '987654321',
      proof_type: 'merkle' as const,
    },
    error: null,
  };

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('returns a parsed ReservesProof on success', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => MOCK_RESPONSE,
    } as Response);

    const por = new ProofOfReserves(BASE_URL, API_KEY);
    const result: ReservesProof = await por.fetchReservesProof(MINT, CONNECTION);

    expect(result.merkleRoot).toBe(MOCK_RESPONSE.data.merkle_root);
    expect(result.totalSupply).toBe(1_000_000_000n);
    expect(result.lastVerifiedSlot).toBe(987_654_321n);
    expect(result.proofType).toBe('merkle');
  });

  it('calls the correct URL with mint and api key', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => MOCK_RESPONSE,
    } as Response);

    const por = new ProofOfReserves(BASE_URL, API_KEY);
    await por.fetchReservesProof(MINT, CONNECTION);

    expect(fetch).toHaveBeenCalledWith(
      `${BASE_URL}/api/reserves/proof?mint=${MINT.toBase58()}`,
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-Api-Key': API_KEY }),
      })
    );
  });

  it('throws when the backend returns success=false', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ success: false, data: null, error: 'Mint not found' }),
    } as Response);

    const por = new ProofOfReserves(BASE_URL, API_KEY);
    await expect(por.fetchReservesProof(MINT, CONNECTION)).rejects.toThrow('Mint not found');
  });

  it('throws when the backend returns non-JSON', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => { throw new SyntaxError('Unexpected token'); },
    } as unknown as Response);

    const por = new ProofOfReserves(BASE_URL, API_KEY);
    await expect(por.fetchReservesProof(MINT, CONNECTION)).rejects.toThrow(
      /non-JSON response/
    );
  });

  it('strips trailing slash from baseUrl', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => MOCK_RESPONSE,
    } as Response);

    const por = new ProofOfReserves(`${BASE_URL}/`, API_KEY);
    await por.fetchReservesProof(MINT, CONNECTION);

    const [calledUrl] = vi.mocked(fetch).mock.calls[0] as [string, ...unknown[]];
    expect(calledUrl).not.toContain('//api/reserves');
  });
});

// ─── verifyMerkleProof ────────────────────────────────────────────────────────

describe('ProofOfReserves.verifyMerkleProof', () => {
  const por = new ProofOfReserves('http://localhost:8080', 'key');

  // Pre-computed leaves (32 bytes each of deterministic content)
  const LEAF_0 = createHash('sha256').update('leaf0').digest().toString('hex');
  const LEAF_1 = createHash('sha256').update('leaf1').digest().toString('hex');
  const LEAF_2 = createHash('sha256').update('leaf2').digest().toString('hex');
  const LEAF_3 = createHash('sha256').update('leaf3').digest().toString('hex');

  it('returns true for a valid 2-leaf proof (sibling on right)', () => {
    const { root, proof } = buildTwoLeafTree(LEAF_0, LEAF_1);
    expect(por.verifyMerkleProof(proof, root)).toBe(true);
  });

  it('returns true for a valid 2-leaf proof (sibling on left)', () => {
    const leaf0 = Buffer.from(LEAF_0, 'hex');
    const leaf1 = Buffer.from(LEAF_1, 'hex');
    const root = dsha256(Buffer.concat([leaf0, leaf1]));
    const proof: MerkleProof = {
      leaf: LEAF_1,
      siblings: [LEAF_0],
      indices: [true], // sibling (leaf0) is on the left
    };
    expect(por.verifyMerkleProof(proof, root.toString('hex'))).toBe(true);
  });

  it('returns false when the root does not match', () => {
    const { proof } = buildTwoLeafTree(LEAF_0, LEAF_1);
    const wrongRoot = 'a'.repeat(64);
    expect(por.verifyMerkleProof(proof, wrongRoot)).toBe(false);
  });

  it('returns false when the leaf is tampered with', () => {
    const { root, proof } = buildTwoLeafTree(LEAF_0, LEAF_1);
    const tamperedProof: MerkleProof = { ...proof, leaf: LEAF_2 };
    expect(por.verifyMerkleProof(tamperedProof, root)).toBe(false);
  });

  it('returns false when a sibling hash is tampered with', () => {
    const { root, proof } = buildTwoLeafTree(LEAF_0, LEAF_1);
    const tamperedProof: MerkleProof = { ...proof, siblings: [LEAF_2] };
    expect(por.verifyMerkleProof(tamperedProof, root)).toBe(false);
  });

  it('returns false when siblings and indices arrays have different lengths', () => {
    const proof: MerkleProof = {
      leaf: LEAF_0,
      siblings: [LEAF_1, LEAF_2],
      indices: [false], // mismatched length
    };
    expect(por.verifyMerkleProof(proof, 'a'.repeat(64))).toBe(false);
  });

  it('returns true for a single-leaf tree (no siblings)', () => {
    // A single-leaf "tree" has root == leaf itself (no hashing needed at root level)
    // With zero siblings the loop doesn't run; current = leaf, root must equal leaf
    const proof: MerkleProof = { leaf: LEAF_0, siblings: [], indices: [] };
    expect(por.verifyMerkleProof(proof, LEAF_0)).toBe(true);
  });

  it('returns false for a single-leaf tree with wrong root', () => {
    const proof: MerkleProof = { leaf: LEAF_0, siblings: [], indices: [] };
    expect(por.verifyMerkleProof(proof, LEAF_1)).toBe(false);
  });

  it('handles a 4-leaf tree correctly', () => {
    // Build tree: level0 = [L0,L1,L2,L3]; level1 = [H01, H23]; root = H(H01,H23)
    const l0 = Buffer.from(LEAF_0, 'hex');
    const l1 = Buffer.from(LEAF_1, 'hex');
    const l2 = Buffer.from(LEAF_2, 'hex');
    const l3 = Buffer.from(LEAF_3, 'hex');
    const h01 = dsha256(Buffer.concat([l0, l1]));
    const h23 = dsha256(Buffer.concat([l2, l3]));
    const root = dsha256(Buffer.concat([h01, h23]));

    // Proof for LEAF_2: sibling=LEAF_3 (right), then sibling=h01 (left)
    const proof: MerkleProof = {
      leaf: LEAF_2,
      siblings: [LEAF_3, h01.toString('hex')],
      indices: [false, true], // LEAF_3 right at level0, h01 left at level1
    };
    expect(por.verifyMerkleProof(proof, root.toString('hex'))).toBe(true);
  });

  it('returns false for invalid hex input', () => {
    const proof: MerkleProof = {
      leaf: 'not-valid-hex!!',
      siblings: [],
      indices: [],
    };
    expect(por.verifyMerkleProof(proof, 'notvalid')).toBe(false);
  });
});

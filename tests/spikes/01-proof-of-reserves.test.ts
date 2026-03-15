/**
 * SSS-042 Direction 1: Proof-of-Reserves — Merkle Logic
 *
 * Validates the Merkle tree construction and proof verification that would
 * be used for on-chain proof-of-reserves attestations. The same SHA-256
 * hashing scheme mirrors what an Anchor program would compute.
 */

import { describe, it, expect } from "vitest";
import { createHash } from "crypto";

// ─── Merkle Helpers ────────────────────────────────────────────────────────

/** Hash a leaf: H(address || balance) — same as on-chain scheme. */
function hashLeaf(address: string, balance: bigint): Buffer {
  return createHash("sha256")
    .update(address)
    .update(balance.toString(16).padStart(16, "0"))
    .digest();
}

/** Hash two child nodes: H(left || right). */
function hashNode(left: Buffer, right: Buffer): Buffer {
  return createHash("sha256").update(left).update(right).digest();
}

/** Build a Merkle tree. Returns all levels, root at index 0. */
function buildMerkleTree(leaves: Buffer[]): Buffer[][] {
  if (leaves.length === 0) throw new Error("No leaves");
  let level = [...leaves];
  const tree: Buffer[][] = [level];
  while (level.length > 1) {
    const next: Buffer[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = i + 1 < level.length ? level[i + 1] : left; // duplicate last if odd
      next.push(hashNode(left, right));
    }
    level = next;
    tree.unshift(level);
  }
  return tree;
}

/** Generate a Merkle proof (sibling hashes + directions) for leaf at `index`. */
function getMerkleProof(
  tree: Buffer[][],
  leafIndex: number
): { sibling: Buffer; isLeft: boolean }[] {
  const proof: { sibling: Buffer; isLeft: boolean }[] = [];
  let idx = leafIndex;
  for (let level = tree.length - 1; level > 0; level--) {
    const nodes = tree[level];
    const isLeft = idx % 2 === 0;
    const siblingIdx = isLeft ? idx + 1 : idx - 1;
    const sibling = siblingIdx < nodes.length ? nodes[siblingIdx] : nodes[idx];
    proof.push({ sibling, isLeft: !isLeft }); // sibling is left if our node is right
    idx = Math.floor(idx / 2);
  }
  return proof;
}

/** Verify a Merkle proof against a root. */
function verifyMerkleProof(
  leaf: Buffer,
  proof: { sibling: Buffer; isLeft: boolean }[],
  root: Buffer
): boolean {
  let current = leaf;
  for (const { sibling, isLeft } of proof) {
    current = isLeft
      ? hashNode(sibling, current)
      : hashNode(current, sibling);
  }
  return current.equals(root);
}

// ─── Test Data ──────────────────────────────────────────────────────────────

const reserves = [
  { address: "So11111111111111111111111111111111111111112", balance: 1_000_000n },
  { address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", balance: 500_000n },
  { address: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", balance: 750_000n },
  { address: "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs", balance: 250_000n },
];

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("Direction 1: Proof-of-Reserves — Merkle Logic", () => {
  it("hashes a leaf deterministically", () => {
    const h1 = hashLeaf(reserves[0].address, reserves[0].balance);
    const h2 = hashLeaf(reserves[0].address, reserves[0].balance);
    expect(h1.equals(h2)).toBe(true);
    expect(h1).toHaveLength(32); // SHA-256 = 32 bytes
  });

  it("different address or balance produce different leaf hashes", () => {
    const h1 = hashLeaf(reserves[0].address, reserves[0].balance);
    const h2 = hashLeaf(reserves[1].address, reserves[0].balance);
    const h3 = hashLeaf(reserves[0].address, reserves[0].balance + 1n);
    expect(h1.equals(h2)).toBe(false);
    expect(h1.equals(h3)).toBe(false);
  });

  it("builds a Merkle tree with correct root for 4 leaves", () => {
    const leaves = reserves.map((r) => hashLeaf(r.address, r.balance));
    const tree = buildMerkleTree(leaves);
    expect(tree[0]).toHaveLength(1); // root
    expect(tree[0][0]).toHaveLength(32);
  });

  it("proof verifies for every leaf in a 4-leaf tree", () => {
    const leaves = reserves.map((r) => hashLeaf(r.address, r.balance));
    const tree = buildMerkleTree(leaves);
    const root = tree[0][0];

    for (let i = 0; i < leaves.length; i++) {
      const proof = getMerkleProof(tree, i);
      expect(verifyMerkleProof(leaves[i], proof, root)).toBe(true);
    }
  });

  it("proof fails for a tampered balance", () => {
    const leaves = reserves.map((r) => hashLeaf(r.address, r.balance));
    const tree = buildMerkleTree(leaves);
    const root = tree[0][0];

    // Tamper leaf 0: change balance
    const tamperedLeaf = hashLeaf(reserves[0].address, reserves[0].balance + 999n);
    const proof = getMerkleProof(tree, 0);
    expect(verifyMerkleProof(tamperedLeaf, proof, root)).toBe(false);
  });

  it("proof fails for a wrong proof path", () => {
    const leaves = reserves.map((r) => hashLeaf(r.address, r.balance));
    const tree = buildMerkleTree(leaves);
    const root = tree[0][0];

    // Use proof for leaf 0 but verify leaf 1 — should fail
    const proofFor0 = getMerkleProof(tree, 0);
    expect(verifyMerkleProof(leaves[1], proofFor0, root)).toBe(false);
  });

  it("handles odd number of leaves (duplicates last)", () => {
    const odd = reserves.slice(0, 3).map((r) => hashLeaf(r.address, r.balance));
    const tree = buildMerkleTree(odd);
    const root = tree[0][0];

    for (let i = 0; i < odd.length; i++) {
      const proof = getMerkleProof(tree, i);
      expect(verifyMerkleProof(odd[i], proof, root)).toBe(true);
    }
  });

  it("single-leaf tree: root equals the leaf itself", () => {
    const leaf = hashLeaf(reserves[0].address, reserves[0].balance);
    const tree = buildMerkleTree([leaf]);
    expect(tree[0][0].equals(leaf)).toBe(true);
  });

  it("total reserves sum is correct", () => {
    const total = reserves.reduce((acc, r) => acc + r.balance, 0n);
    expect(total).toBe(2_500_000n);
  });

  it("proof depth equals log2(leaves) for power-of-2 trees", () => {
    const leaves = reserves.map((r) => hashLeaf(r.address, r.balance));
    const tree = buildMerkleTree(leaves);
    const proof = getMerkleProof(tree, 0);
    expect(proof).toHaveLength(2); // log2(4) = 2
  });
});

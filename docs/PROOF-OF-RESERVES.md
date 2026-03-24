# Proof of Reserves

> **Direction 1 — Supply Snapshot**  
> A cryptographic commitment to the total token supply, anchored to an on-chain Solana slot and verifiable by anyone without trusting the backend.

---

## What Is Proof of Reserves?

Proof of Reserves (PoR) is a mechanism that lets a stablecoin issuer prove that the tokens in circulation are backed by real reserves — without requiring users to trust a centralised API response.

The SSS implementation works in three steps:

1. **Snapshot** — The backend reads the token's `totalSupply` from Solana devnet via JSON-RPC.
2. **Commitment** — It derives a Merkle root by double-SHA-256 hashing the supply value, producing a short fingerprint that uniquely identifies that supply at that slot.
3. **Verification** — Anyone can reproduce the Merkle root from the supply value and check it matches the published root — no backend needed.

### Why It Matters

| Without PoR | With PoR |
|---|---|
| Users must trust the issuer's dashboard | Users can verify reserves independently |
| Supply figures can be silently inflated | Any mismatch is immediately detectable |
| Auditors need database access | Auditors only need the Merkle root + supply |

---

## How It Works

### Merkle Root Construction

For the `supply_snapshot` proof type, the Merkle root is derived as follows:

```
supply_le8  = totalSupply encoded as 8-byte little-endian
leaf        = SHA-256(supply_le8)
root        = SHA-256(leaf)
```

This is a single-leaf Merkle tree — straightforward to compute and verify. The same algorithm is used by both the Rust backend and the TypeScript SDK, so proofs produced by one can be verified by the other.

### On-Chain Data Sources

The backend queries Solana's JSON-RPC for two values:

| RPC Method | Data Retrieved |
|---|---|
| `getTokenSupply` | `totalSupply` (base units, u64) |
| `getSlot` | `lastVerifiedSlot` — the slot at snapshot time |

The slot ties the proof to a specific point in blockchain history, making replays detectable.

---

## Using the SDK

### Installation

```bash
npm install @stbr/sss-token
```

### Quick Start

```typescript
import { ProofOfReserves } from '@stbr/sss-token';
import { Connection, PublicKey } from '@solana/web3.js';

const por = new ProofOfReserves(
  'http://localhost:8080',   // SSS backend URL
  'your-api-key'             // X-Api-Key header value
);

const mint = new PublicKey('TokenMintAddressHere11111111111111111111111');
const connection = new Connection('https://api.devnet.solana.com');

// Fetch a reserves proof
const proof = await por.fetchReservesProof(mint, connection);

console.log('Merkle root:        ', proof.merkleRoot);
console.log('Total supply:       ', proof.totalSupply.toString(), 'base units');
console.log('Last verified slot: ', proof.lastVerifiedSlot.toString());
console.log('Proof type:         ', proof.proofType);
```

### Verifying a Merkle Proof

```typescript
import { ProofOfReserves, MerkleProof } from '@stbr/sss-token';

const por = new ProofOfReserves('http://localhost:8080', 'your-api-key');

// A Merkle inclusion proof for a single leaf
const merkleProof: MerkleProof = {
  leaf: 'a1b2c3...',       // hex-encoded leaf hash
  siblings: ['d4e5f6...'], // sibling hashes from leaf → root
  indices: [false],         // false = sibling is on the right
};

const expectedRoot = 'the-known-merkle-root-hex';
const isValid = por.verifyMerkleProof(merkleProof, expectedRoot);

console.log('Proof valid:', isValid); // true or false
```

### SDK Types

```typescript
/** The mechanism used to generate the proof. */
type ProofType = 'merkle' | 'oracle' | 'manual';

/** A snapshot of on-chain reserve proof data. */
interface ReservesProof {
  merkleRoot: string;          // hex-encoded Merkle root
  totalSupply: bigint;         // total supply in base units
  lastVerifiedSlot: bigint;    // Solana slot at snapshot time
  proofType: ProofType;        // 'supply_snapshot' for direction 1
}

/** A Merkle inclusion proof for a single leaf. */
interface MerkleProof {
  leaf: string;        // hex-encoded leaf hash
  siblings: string[];  // ordered sibling hashes, leaf → root
  indices: boolean[];  // false = sibling right, true = sibling left
}
```

---

## API Reference

### `GET /api/reserves/proof`

Fetch a Proof-of-Reserves snapshot for a given SPL token mint.

**Query Parameters**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `mint` | string (base58) | ✅ | The SPL token mint address |
| `holder` | string (base58) | ❌ | Optional holder address (echoed back; reserved for future use) |

**Authentication**

Include your API key in the request header:

```
X-Api-Key: your-api-key
```

**Example Request**

```bash
curl -H "X-Api-Key: your-api-key" \
  "http://localhost:8080/api/reserves/proof?mint=TokenMintAddressHere11111111111111111111111"
```

**Example Response**

```json
{
  "success": true,
  "data": {
    "merkle_root": "a3f2e1d4c5b6a7980123456789abcdef0123456789abcdef0123456789abcdef01",
    "total_supply": "1000000000000",
    "last_verified_slot": "312456789",
    "proof_type": "supply_snapshot"
  },
  "error": null
}
```

**Response Fields**

| Field | Type | Description |
|---|---|---|
| `merkle_root` | string (hex) | Double-SHA-256 commitment to the total supply |
| `total_supply` | string (u64) | Token supply in base units at snapshot time |
| `last_verified_slot` | string (u64) | Solana slot when the snapshot was taken |
| `proof_type` | string | `"supply_snapshot"` for direction 1 |

**Error Responses**

| HTTP Status | Cause |
|---|---|
| 400 | Invalid or missing `mint` parameter |
| 401 | Missing or invalid API key |
| 500 | Upstream Solana RPC error |

---

## Manual Verification

You can reproduce and verify the Merkle root yourself without any SDK or backend:

### Step 1 — Get the total supply

```bash
curl -s https://api.devnet.solana.com \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc":"2.0","id":1,
    "method":"getTokenSupply",
    "params":["TokenMintAddressHere11111111111111111111111"]
  }' | jq '.result.value.amount'
```

### Step 2 — Compute the Merkle root

With the total supply (e.g. `1000000000000`), compute the root in Python:

```python
import struct, hashlib

total_supply = 1_000_000_000_000  # paste your value here

# Encode as 8-byte little-endian
supply_le8 = struct.pack('<Q', total_supply)

# Double-SHA-256
leaf = hashlib.sha256(supply_le8).digest()
root = hashlib.sha256(leaf).digest()

print('Merkle root:', root.hex())
```

Or in Node.js:

```js
const { createHash } = require('crypto');

const totalSupply = 1_000_000_000_000n;

// 8-byte little-endian buffer
const buf = Buffer.allocUnsafe(8);
buf.writeBigUInt64LE(totalSupply);

const leaf = createHash('sha256').update(buf).digest();
const root = createHash('sha256').update(leaf).digest();

console.log('Merkle root:', root.toString('hex'));
```

### Step 3 — Compare

The root you computed should exactly match the `merkle_root` returned by the API. If they differ, the backend is reporting incorrect data.

---

## Limitations & Roadmap

The current implementation (direction 1) is a **supply snapshot** — a single-leaf Merkle tree over the total supply. Future directions will extend this to:

| Direction | Description |
|---|---|
| 1 (current) | Single-leaf supply snapshot — total supply committed to Merkle root |
| 2 | Multi-leaf balance tree — individual holder balances as leaves |
| 3 | Oracle-attested proof — external price/reserve oracle feeds |
| 4 | ZK inclusion proofs — holder balance proven without revealing total supply |

**Current limitations to be aware of:**
- The `holder` query parameter is accepted but not used to filter the proof.
- The snapshot reflects devnet state; mainnet support is forthcoming.
- The proof covers total supply only, not individual reserve wallet balances.
- **Reserve composition is self-reported, not machine-verified.** The PoR proof commits to the on-chain `totalSupply` — it does not verify what assets back that supply. An issuer supplies the reserve breakdown (e.g. "100% USD cash") separately; the protocol has no mechanism to verify this claim on-chain. Users relying on reserve composition figures should require off-chain auditor attestations in addition to the PoR Merkle proof. Direction 3 (oracle-attested proof) is planned to address this gap, but is not yet implemented.

---

## Related Documentation

- [API Reference](api.md) — Full REST API reference
- [Authentication](authentication.md) — API key management
- [Architecture](ARCHITECTURE.md) — Three-layer system design
- [Formal Verification](formal-verification.md) — Kani mathematical proofs
- [Preset: SSS-3 Trustless](SSS-3.md) — Collateral-backed stablecoin design

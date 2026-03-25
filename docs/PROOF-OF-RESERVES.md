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

---

---

## On-Chain Enforcement — FLAG_POR_HALT_ON_BREACH (BUG-008 / AUDIT-G6 / AUDIT-H4)

> **Fixed in commit `d1b011c`** — Previously, `FLAG_POR_HALT_ON_BREACH` (bit 16) was defined in `state.rs` but never read by `mint.rs` or `cpi_mint.rs`. Setting the flag had zero effect on minting. This section documents the corrected behaviour.

### ProofOfReserves PDA

An on-chain attestation record holds the latest reserve ratio submitted by an authorised oracle/keeper.

**Seeds:** `[b"proof-of-reserves", mint]`

| Field | Type | Description |
|---|---|---|
| `mint` | `Pubkey` | The stablecoin mint this record belongs to |
| `last_attestation_slot` | `u64` | Slot when the most recent attestation was submitted |
| `last_verified_ratio_bps` | `u64` | Attested reserve ratio in basis points (e.g. `10_000` = 100% backed) |
| `attester` | `Pubkey` | Authority allowed to submit attestations |
| `bump` | `u8` | PDA bump seed |

### Instructions

#### `init_proof_of_reserves(attester: Pubkey)`

Called by the stablecoin authority to create the `ProofOfReserves` PDA for a mint. Must be done before enabling `FLAG_POR_HALT_ON_BREACH`.

**Accounts:**

| Account | Role |
|---|---|
| `payer` | Pays for account creation |
| `authority` | Stablecoin config authority (signer) |
| `config` | `StablecoinConfig` PDA — validates authority |
| `mint` | The stablecoin mint |
| `proof_of_reserves` | New PDA (init, seeds = `[b"proof-of-reserves", mint]`) |
| `system_program` | — |

```typescript
await program.methods
  .initProofOfReserves(attesterKeypair.publicKey)
  .accounts({ payer, authority, config, mint, proofOfReserves })
  .rpc();
```

#### `attest_proof_of_reserves(verified_ratio_bps: u64)`

Submitted by the designated attester (oracle / keeper) to update the on-chain reserve ratio.

**Accounts:**

| Account | Role |
|---|---|
| `attester` | Authorised attester (signer) |
| `mint` | The stablecoin mint |
| `proof_of_reserves` | Existing PDA (mutable) |

```typescript
const ratioBps = BigInt(9_800); // 98% backed

await program.methods
  .attestProofOfReserves(ratioBps)
  .accounts({ attester, mint, proofOfReserves })
  .rpc();
```

### Mint Enforcement Logic

When `FLAG_POR_HALT_ON_BREACH` is set in `StablecoinConfig.feature_flags`, every call to `mint` or `cpi_mint` **must** pass the `ProofOfReserves` PDA as `remaining_accounts[0]`. The instruction enforces three checks in order:

1. **PDA key verification** — `remaining_accounts[0].key()` must match the expected PDA derived from `seeds = [b"proof-of-reserves", mint]`. Fake accounts are rejected.
2. **Attestation present** — `por.last_attestation_slot > 0`. Returns `PoRNotAttested` if never attested.
3. **Ratio check** — `por.last_verified_ratio_bps >= config.min_reserve_ratio_bps`. If below threshold, emits `MintHaltedByPoRBreach` and returns `PoRBreachHaltsMinting`.

> **Special case:** `min_reserve_ratio_bps = 0` disables the ratio check — the flag then only requires a fresh attestation to exist, not a minimum ratio. This is not recommended in production.

```typescript
import { FLAG_POR_HALT_ON_BREACH } from '@stbr/sss-token';

// Minting with PoR breach halt enabled
const [porPda] = PublicKey.findProgramAddressSync(
  [Buffer.from('proof-of-reserves'), mint.toBuffer()],
  program.programId,
);

await program.methods
  .mint(new BN(amount))
  .accounts({ authority, config, minterInfo, mint, tokenAccount, tokenProgram })
  .remainingAccounts([{ pubkey: porPda, isWritable: false, isSigner: false }])
  .rpc();
```

### New Errors

| Error | Code | Description |
|---|---|---|
| `PoRNotAttested` | `SssError` | `remaining_accounts[0]` has `last_attestation_slot == 0` — attestation never submitted |
| `PoRBreachHaltsMinting` | `SssError` | `last_verified_ratio_bps < min_reserve_ratio_bps` — minting blocked |

### MintHaltedByPoRBreach Event

Emitted on every `PoRBreachHaltsMinting` rejection to enable keeper/monitoring alerting.

| Field | Type | Description |
|---|---|---|
| `mint` | `Pubkey` | Stablecoin mint that was blocked |
| `current_ratio_bps` | `u64` | Reserve ratio at time of attempted mint |
| `min_ratio_bps` | `u64` | Configured minimum ratio |
| `last_attestation_slot` | `u64` | Slot of the last on-chain attestation |
| `attempted_amount` | `u64` | Amount that was attempted to be minted |

```typescript
// Monitor breach events
program.addEventListener('MintHaltedByPoRBreach', (event) => {
  console.error(
    `MINT HALTED: mint=${event.mint.toBase58()} ` +
    `ratio=${event.currentRatioBps}bps (min=${event.minRatioBps}bps) ` +
    `slot=${event.lastAttestationSlot} attempted=${event.attemptedAmount}`
  );
  // Trigger pager alert / Discord notification
});
```

### Recommended Setup

```typescript
// 1. Set minimum reserve ratio on the config (e.g. 95%)
await program.methods
  .updateConfig({ minReserveRatioBps: 9_500 })
  .accounts({ authority, config, mint })
  .rpc();

// 2. Initialise the PoR PDA with a trusted attester
await program.methods
  .initProofOfReserves(attester.publicKey)
  .accounts({ payer, authority, config, mint, proofOfReserves })
  .rpc();

// 3. Submit an initial attestation before enabling the flag
await program.methods
  .attestProofOfReserves(new BN(10_000)) // 100% initially
  .accounts({ attester, mint, proofOfReserves })
  .rpc();

// 4. Enable the flag
await program.methods
  .setFeatureFlags(FLAG_POR_HALT_ON_BREACH)
  .accounts({ authority, config, mint })
  .rpc();
```

---

## Related Documentation

- [API Reference](api.md) — Full REST API reference
- [Authentication](authentication.md) — API key management
- [Architecture](ARCHITECTURE.md) — Three-layer system design
- [Formal Verification](formal-verification.md) — Kani mathematical proofs
- [Preset: SSS-3 Trustless](SSS-3.md) — Collateral-backed stablecoin design
- [Supply Cap & PoR Halt](SUPPLY-CAP-POR-HALT.md) — SSS-145 full feature reference

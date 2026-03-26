# ZK Credentials — SSS-129

> **Feature flag:** `FLAG_ZK_CREDENTIALS` (bit 10, `0x400`)
> **Backend routes:** `/api/zk-credentials/*`
> **On-chain PDAs:** `CredentialRegistry`, `CredentialRecord`

---

## Overview

SSS-129 adds selective-disclosure ZK credential gating to the stablecoin program.  
Users prove they satisfy a compliance requirement — not sanctioned, KYC-passed, or accredited investor — without revealing which specific credential they hold or any identity details.

The architecture uses:
1. **CredentialRegistry PDA** — per-mint, per-type registry of the authorised credential issuer and current Merkle root of valid credentials.
2. **`verify_zk_credential` instruction** — user submits a Groth16 proof that their wallet is a leaf in the credential Merkle tree. The on-chain verifier validates the proof; on success it writes a `CredentialRecord` PDA with an expiry.
3. **Transfer hook** — can optionally check `CredentialRecord` is present and non-expired before allowing restricted operations when `FLAG_ZK_CREDENTIALS` is set.

The backend indexes `CredentialRecord` PDA events and exposes query/verify REST endpoints.

---

## Credential Types

| Value | On-chain u8 | Description |
|---|---|---|
| `not_sanctioned` | `0` | User is not on any OFAC/sanctions list |
| `kyc_passed` | `1` | User has passed KYC with an authorised issuer |
| `accredited_investor` | `2` | User is an accredited investor |

---

## Feature Flag

```rust
pub const FLAG_ZK_CREDENTIALS: u64 = 1 << 10; // 0x400
```

When set in `StablecoinConfig.feature_flags`, the program gates compliance-sensitive instructions behind a valid `CredentialRecord` for the required credential type.

---

## On-Chain PDAs

### `CredentialRegistry`

Stores issuer authority and current Merkle root for a (mint, credential_type) pair.

**PDA seeds:** `["credential-registry", sss_mint, credential_type_byte]`

| Field | Rust type | Description |
|---|---|---|
| `sss_mint` | `Pubkey` | Stablecoin mint |
| `credential_type` | `u8` | Credential type enum value |
| `issuer_pubkey` | `Pubkey` | Authorised credential issuer |
| `merkle_root` | `[u8; 32]` | Merkle root of valid credential leaves |
| `proof_expiry_seconds` | `u64` | Validity window for submitted proofs |
| `bump` | `u8` | PDA bump seed |

### `CredentialRecord`

Per-user compliance record. Created/refreshed when a user submits a valid ZK proof.

**PDA seeds:** `["credential-record", sss_mint, user_pubkey, credential_type_byte]`

| Field | Rust type | Description |
|---|---|---|
| `sss_mint` | `Pubkey` | Stablecoin mint |
| `user` | `Pubkey` | User wallet |
| `credential_type` | `u8` | Credential type |
| `issuer_pubkey` | `Pubkey` | Issuer who signed the credential |
| `verified_at` | `i64` | Unix timestamp of proof acceptance |
| `expires_at` | `i64` | Unix timestamp of record expiry |
| `bump` | `u8` | PDA bump seed |

---

## Instructions

### `init_credential_registry`

Create the `CredentialRegistry` PDA for a (mint, credential_type) pair.

**Authority:** admin authority.

| Parameter | Type | Description |
|---|---|---|
| `credential_type` | `u8` | Credential type (0–2) |
| `issuer_pubkey` | `Pubkey` | Authorised issuer |
| `merkle_root` | `[u8; 32]` | Initial Merkle root |
| `proof_expiry_seconds` | `u64` | Proof validity window (default: 2592000) |

### `update_credential_registry`

Update the `merkle_root` (and optionally `issuer_pubkey`, `proof_expiry_seconds`) when the credential list changes.

**Authority:** admin authority.

### `verify_zk_credential`

Submit a Groth16 ZK proof. The on-chain verifier checks the proof against the registered `merkle_root` and `issuer_pubkey`. On success, writes/refreshes the `CredentialRecord` PDA.

| Parameter | Type | Description |
|---|---|---|
| `proof` | `[u8; 256]` | Groth16 proof bytes |
| `credential_type` | `u8` | Credential type being proved |
| `public_inputs` | `[u8; 64]` | ABI-encoded public inputs |

**Errors:**

| Error | Cause |
|---|---|
| `SssError::ZkCredentialsNotEnabled` | `FLAG_ZK_CREDENTIALS` not set |
| `SssError::CredentialRegistryNotFound` | Registry PDA not initialised for this type |
| `SssError::InvalidZkProof` | Proof failed verification against Merkle root |

---

## Backend REST API

All routes require API key authentication (`X-Api-Key` header).

### `GET /api/zk-credentials/records`

List indexed `CredentialRecord` entries.

**Query params:**

| Param | Type | Description |
|---|---|---|
| `user` | string | Filter by user wallet (base58) |
| `mint` | string | Filter by mint (base58) |
| `credential_type` | string | Filter by type (not_sanctioned / kyc_passed / accredited_investor) |
| `valid_only` | bool | Only return non-expired records |
| `limit` | u32 | Max results (default 100, max 1000) |

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "mint": "base58mint",
      "user": "base58user",
      "credential_type": "kyc_passed",
      "issuer_pubkey": "base58issuer",
      "verified_at": 1711234567,
      "expires_at": 1713826567,
      "is_valid": true,
      "tx_signature": "5Jx...",
      "slot": 295001234,
      "created_at": "2026-03-24T02:34:00Z"
    }
  ]
}
```

---

### `POST /api/zk-credentials/submit`

Index a submitted ZK proof (called by the off-chain relayer after on-chain verification).

**Request body:**
```json
{
  "mint": "base58mint",
  "user": "base58user",
  "credential_type": "not_sanctioned",
  "issuer_pubkey": "base58issuer",
  "proof_data": "ab12cd34...",
  "public_inputs": "0000...",
  "proof_expiry_seconds": 2592000,
  "tx_signature": "5Jx...",
  "slot": 295001234
}
```

`proof_data` must be a non-empty hex string (512 chars = 256 bytes for Groth16).

**Response:** `CredentialRecord` object wrapped in `ApiResponse`.

---

### `POST /api/zk-credentials/verify`

Check whether a user currently holds a valid credential for a given type and mint.

**Request body:**
```json
{
  "mint": "base58mint",
  "user": "base58user",
  "credential_type": "kyc_passed"
}
```

**Response:**
```json
{
  "is_valid": true,
  "record": { /* CredentialRecord or null */ },
  "message": "User is compliant — credential expires at 2026-04-23T02:34:00Z"
}
```

---

### `GET /api/zk-credentials/registry`

List `CredentialRegistry` entries.

**Query params:** `mint`, `credential_type` (optional filters).

---

### `POST /api/zk-credentials/registry`

Upsert a `CredentialRegistry` entry (admin op, called when on-chain registry is initialised or Merkle root rotated).

**Request body:**
```json
{
  "mint": "base58mint",
  "credential_type": "not_sanctioned",
  "issuer_pubkey": "base58issuer",
  "merkle_root": "a3f2b1c4...",
  "proof_expiry_seconds": 86400
}
```

`merkle_root` must be exactly 64 hex characters (32 bytes).

---

## Security Considerations

### Zero-knowledge property
The Groth16 proof reveals only that the user's wallet is a leaf in the credential Merkle tree — it does not reveal *which* leaf or any identifying information. Issuers rotate the Merkle root when credentials are revoked; users must re-submit proofs after a root rotation.

### Proof expiry
Set `proof_expiry_seconds` conservatively. The default of 30 days (2592000s) balances regulatory freshness requirements against user friction. Corporate or high-risk use cases should use shorter windows (e.g. 24 hours).

### Transfer Hook PDA Derivation — Owner, Not Delegate (BUG-036 / Audit C-3, MEDIUM — fixed `cba65fc`)

Prior to this fix, the transfer hook derived the `VerificationRecord` PDA using the **transfer authority** (account index 3, which is the delegate for delegated transfers). This allowed a sender with no `VerificationRecord` to delegate to a verified party and bypass ZK compliance entirely.

**Fix:** The PDA is now derived from `src_owner` — the token account owner read from bytes 32..64 of the source token account — consistent with how blacklist and sanctions checks are keyed. Both `initialize_extra_account_meta_list` and `migrate_hook_extra_accounts` use `Seed::AccountData { account_index: 0, data_index: 32, length: 32 }`.

**Client impact:** No change to how `VerificationRecord` is created. The hook always resolves the PDA from the token account owner. Integrators who were relying on delegated-transfer ZK compliance bypass (the old, incorrect behaviour) must ensure the actual token owner has a valid `CredentialRecord`.

### Wallet-bound records
`CredentialRecord` is keyed by `(mint, user_pubkey, credential_type)` where `user_pubkey` is the **token account owner**, not a delegate. Users who rotate wallets must re-submit proofs from their new key. There is no cross-wallet identity linking on-chain by design.

### Merkle root rotation
When an issuer rotates the Merkle root (e.g. to add/revoke credentials), existing `CredentialRecord` PDAs remain valid until their `expires_at`. For immediate revocation, set a very short expiry window.

### Verifier trust
The `issuer_pubkey` registered in `CredentialRegistry` is the root of trust for all proofs of that credential type. Only audited, formally-verified issuers should be registered.

---

## See Also

- [`on-chain-sdk-zk.md`](./on-chain-sdk-zk.md) — `ZkComplianceModule` (SSS-076, FLAG_ZK_COMPLIANCE)
- [`SANCTIONS-ORACLE.md`](./SANCTIONS-ORACLE.md) — pluggable OFAC/sanctions screening (SSS-128)
- [`TRAVEL-RULE.md`](./TRAVEL-RULE.md) — Travel Rule compliance hooks (SSS-127)
- [`feature-flags.md`](./feature-flags.md) — full flag constants table

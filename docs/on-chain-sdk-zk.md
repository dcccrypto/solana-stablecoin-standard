# SSS — On-Chain SDK: ZkComplianceModule

> **Class:** `ZkComplianceModule` (`sdk/src/ZkComplianceModule.ts`)
> **Added:** SSS-076 | **Feature flag:** `FLAG_ZK_COMPLIANCE` (bit 4, `0x10`)
> **Anchor instruction:** `init_zk_compliance` / `submit_zk_proof` (SSS-075/076)

---

## Overview

`ZkComplianceModule` lets stablecoin issuers require users to hold a valid
zero-knowledge compliance proof before being authorised to perform restricted
operations.  When `FLAG_ZK_COMPLIANCE` is set in `StablecoinConfig.feature_flags`,
the program gates sensitive instructions behind a `ZkVerificationRecord` PDA
that is written by an on-chain verifier after validating a submitted ZK proof.

The module stores configuration in a `ZkComplianceConfig` PDA (verifier key
and proof expiry window) and per-user compliance status in individual
`ZkVerificationRecord` PDAs.  Proof format (Groth16 or Plonk) is determined by
the registered verifier key.

### Workflow

1. Admin calls `enableZkCompliance` — creates the `ZkComplianceConfig` PDA
   and atomically sets `FLAG_ZK_COMPLIANCE`.
2. Users call `submitZkProof` with serialised proof bytes — the on-chain
   verifier validates the proof and writes/updates their `ZkVerificationRecord`.
3. Application logic calls `verifyComplianceStatus` to check whether a user's
   record is present and non-expired before allowing restricted operations.
4. Admin calls `disableZkCompliance` to clear the flag (PDA preserved).
5. To re-enable without re-initialising, call `setFeatureFlag` via
   `FeatureFlagsModule` (not `enableZkCompliance` — that will fail if the PDA
   already exists).

---

## `FLAG_ZK_COMPLIANCE`

```typescript
export const FLAG_ZK_COMPLIANCE = 1n << 4n; // 0x10
```

**Anchor constant:**

```rust
pub const FLAG_ZK_COMPLIANCE: u64 = 1 << 4; // 0x10
```

| Property | Value |
|---|---|
| Bit position | 4 |
| Hex value | `0x10` |
| BigInt literal | `16n` |

When set in `StablecoinConfig.feature_flags`, the program requires a valid
`ZkVerificationRecord` for the transacting user before allowing any
compliance-gated operation.

---

## Import

```typescript
import {
  ZkComplianceModule,
  FLAG_ZK_COMPLIANCE,
  type ZkComplianceState,
  type ZkVerificationRecord,
  type EnableZkComplianceParams,
  type DisableZkComplianceParams,
  type SubmitZkProofParams,
  type VerifyComplianceStatusParams,
} from '@sss/sdk';
```

---

## Instantiation

```typescript
import { AnchorProvider } from '@coral-xyz/anchor';
import { ZkComplianceModule } from '@sss/sdk';

const zk = new ZkComplianceModule(provider, programId);
```

| Parameter | Type | Description |
|---|---|---|
| `provider` | `AnchorProvider` | Anchor provider; wallet must be admin authority for write ops. |
| `programId` | `PublicKey` | Deployed SSS token program ID. |

---

## PDA Helpers

### `getConfigPda(mint)`

Derive the `StablecoinConfig` PDA for the given mint.

```typescript
getConfigPda(mint: PublicKey): [PublicKey, number]
```

Seeds: `["stablecoin-config", mint]`

### `getZkCompliancePda(mint)`

Derive the `ZkComplianceConfig` PDA for the given mint.

```typescript
getZkCompliancePda(mint: PublicKey): [PublicKey, number]
```

Seeds: `["zk-compliance", mint]`

### `getVerificationRecordPda(mint, user)`

Derive the per-user `ZkVerificationRecord` PDA.

```typescript
getVerificationRecordPda(mint: PublicKey, user: PublicKey): [PublicKey, number]
```

Seeds: `["zk-verification", mint, user]`

---

## Methods

### `enableZkCompliance(params)`

Create the `ZkComplianceConfig` PDA and set `FLAG_ZK_COMPLIANCE`.

```typescript
enableZkCompliance(params: EnableZkComplianceParams): Promise<TransactionSignature>
```

Wraps the `init_zk_compliance` Anchor instruction.  Sets the verifier key and
proof expiry window atomically.

**Authority required:** admin authority.

> Fails if the `ZkComplianceConfig` PDA already exists.  To re-enable after
> disabling, call `setFeatureFlag({ mint, flag: FLAG_ZK_COMPLIANCE })` via
> `FeatureFlagsModule` instead.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `mint` | `PublicKey` | ✓ | Stablecoin mint. |
| `verifierKey` | `PublicKey` | ✓ | On-chain verifier program or key used to validate ZK proofs. |
| `proofExpirySeconds` | `number` | | Seconds before a `ZkVerificationRecord` expires. Default: `2592000` (30 days). |

**Example:**

```typescript
const verifierKey = new PublicKey('<VERIFIER_PROGRAM_ID>');

const sig = await zk.enableZkCompliance({
  mint,
  verifierKey,
  proofExpirySeconds: 86_400, // 1 day
});
console.log('ZK compliance enabled:', sig);
```

**Errors:**

| Error | Cause |
|---|---|
| `SssError::Unauthorized` | Signer is not the admin authority. |
| `SssError::ZkComplianceAlreadyInitialised` | `ZkComplianceConfig` PDA already exists. |

---

### `disableZkCompliance(params)`

Clear `FLAG_ZK_COMPLIANCE` for this mint.

```typescript
disableZkCompliance(params: DisableZkComplianceParams): Promise<TransactionSignature>
```

Wraps `clear_feature_flag` with `FLAG_ZK_COMPLIANCE`.  The `ZkComplianceConfig`
PDA is **not** closed — the verifier key and expiry settings are preserved for
re-enabling later.

**Authority required:** admin authority.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `mint` | `PublicKey` | ✓ | Stablecoin mint. |

**Example:**

```typescript
const sig = await zk.disableZkCompliance({ mint });
console.log('ZK compliance disabled:', sig);
```

**Errors:**

| Error | Cause |
|---|---|
| `SssError::Unauthorized` | Signer is not the admin authority. |

---

### `submitZkProof(params)`

Submit a zero-knowledge compliance proof for a user.

```typescript
submitZkProof(params: SubmitZkProofParams): Promise<TransactionSignature>
```

Wraps `submit_zk_proof` — the on-chain verifier validates the proof against
the registered `verifierKey` and writes (or refreshes) the
`ZkVerificationRecord` PDA for the user.  Requires `FLAG_ZK_COMPLIANCE` to be
active.  The `user` defaults to the provider wallet if not specified.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `mint` | `PublicKey` | ✓ | Stablecoin mint. |
| `proofData` | `Uint8Array` | ✓ | Serialised ZK proof bytes (Groth16 or Plonk; format determined by verifier). |
| `user` | `PublicKey` | | User whose compliance is being proven. Defaults to provider wallet. |
| `publicInputs` | `Uint8Array` | | ABI-encoded public inputs for the proof. Defaults to empty. |

**Example:**

```typescript
// Generate or retrieve proof bytes from your ZK prover
const proofBytes = new Uint8Array([/* Groth16 proof bytes */]);
const publicInputs = new Uint8Array([/* encoded public inputs */]);

const sig = await zk.submitZkProof({
  mint,
  proofData: proofBytes,
  publicInputs,
});
console.log('ZK proof submitted:', sig);
```

**Errors:**

| Error | Cause |
|---|---|
| `SssError::ZkComplianceNotEnabled` | `FLAG_ZK_COMPLIANCE` is not set. |
| `SssError::InvalidZkProof` | Proof failed on-chain verification. |

---

### `verifyComplianceStatus(params)`

Check whether a user's compliance record is valid.

```typescript
verifyComplianceStatus(params: VerifyComplianceStatusParams): Promise<ZkVerificationRecord | null>
```

Fetches the `ZkVerificationRecord` PDA and returns it if present and
non-expired.  Returns `null` if the user has no record or it has expired.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `mint` | `PublicKey` | ✓ | Stablecoin mint. |
| `user` | `PublicKey` | | User to check. Defaults to provider wallet. |

**Example:**

```typescript
const record = await zk.verifyComplianceStatus({ mint, user: userPublicKey });
if (record?.isValid) {
  console.log('Compliant — expires at:', new Date(record.expiresAt * 1000));
} else {
  console.log('Not compliant — proof required.');
}
```

---

### `fetchZkComplianceState(mint)`

Fetch and decode the `ZkComplianceConfig` PDA from on-chain.

```typescript
fetchZkComplianceState(mint: PublicKey): Promise<ZkComplianceState | null>
```

Returns `null` if the account has not been initialised yet.

**Example:**

```typescript
const state = await zk.fetchZkComplianceState(mint);
if (state) {
  console.log('Verifier key:', state.verifierKey.toBase58());
  console.log('Proof expiry (seconds):', state.proofExpirySeconds);
} else {
  console.log('ZkComplianceConfig not initialised.');
}
```

---

### `fetchVerificationRecord(mint, user?)`

Fetch and decode a `ZkVerificationRecord` for a specific user.

```typescript
fetchVerificationRecord(mint: PublicKey, user?: PublicKey): Promise<ZkVerificationRecord | null>
```

Returns `null` if the user has not submitted a proof yet.  The `isValid` field
is computed client-side from `expiresAt` vs current clock.

**Example:**

```typescript
const record = await zk.fetchVerificationRecord(mint, userPublicKey);
if (record) {
  console.log('Verified at:', new Date(record.verifiedAt * 1000));
  console.log('Expires at:', new Date(record.expiresAt * 1000));
  console.log('Is valid:', record.isValid);
}
```

---

### `isZkComplianceEnabled(mint)`

Check whether `FLAG_ZK_COMPLIANCE` is currently set for a mint.

```typescript
isZkComplianceEnabled(mint: PublicKey): Promise<boolean>
```

Reads `StablecoinConfig.feature_flags` on-chain.  Returns `false` if the
config account does not exist.

**Example:**

```typescript
const enabled = await zk.isZkComplianceEnabled(mint);
console.log('ZK compliance active:', enabled);
```

---

## `ZkComplianceState` Account Layout

The `ZkComplianceConfig` PDA stores the following fields:

| Field | Rust type | TS type | Description |
|---|---|---|---|
| `sss_mint` | `Pubkey` | `PublicKey` | Stablecoin mint this config belongs to. |
| `verifier_key` | `Pubkey` | `PublicKey` | On-chain verifier program/key for proof validation. |
| `proof_expiry_seconds` | `u64` | `number` | Proof validity window in seconds (default 30 days). |
| `bump` | `u8` | `number` | PDA bump seed. |

**PDA seeds:** `["zk-compliance", sss_mint]`

```typescript
export interface ZkComplianceState {
  sssMint: PublicKey;
  verifierKey: PublicKey;
  proofExpirySeconds: number;
  bump: number;
}
```

---

## `ZkVerificationRecord` Account Layout

Per-user compliance record. Created/refreshed by `submit_zk_proof`.

| Field | Rust type | TS type | Description |
|---|---|---|---|
| `sss_mint` | `Pubkey` | `PublicKey` | Stablecoin mint this record belongs to. |
| `user` | `Pubkey` | `PublicKey` | The user whose compliance was verified. |
| `verified_at` | `i64` | `number` | Unix timestamp when proof was accepted (seconds). |
| `expires_at` | `i64` | `number` | Unix timestamp when this record expires (seconds). |
| `is_valid` | `bool` (computed) | `boolean` | Client-side: `expiresAt > Date.now() / 1000`. |
| `bump` | `u8` | `number` | PDA bump seed. |

**PDA seeds:** `["zk-verification", sss_mint, user]`

```typescript
export interface ZkVerificationRecord {
  sssMint: PublicKey;
  user: PublicKey;
  verifiedAt: number;
  expiresAt: number;
  isValid: boolean;   // computed client-side
  bump: number;
}
```

---

## Error Codes

| Error | Description |
|---|---|
| `SssError::Unauthorized` | Signer is not the admin authority. |
| `SssError::ZkComplianceAlreadyInitialised` | `init_zk_compliance` called when `ZkComplianceConfig` PDA already exists. |
| `SssError::ZkComplianceNotEnabled` | `submit_zk_proof` called without `FLAG_ZK_COMPLIANCE` set. |
| `SssError::InvalidZkProof` | Submitted proof failed on-chain verification. |

---

## TypeScript End-to-End Example

```typescript
import { AnchorProvider } from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';
import {
  ZkComplianceModule,
  FLAG_ZK_COMPLIANCE,
} from '@sss/sdk';

// Known verifier program (mainnet placeholder)
const VERIFIER_PROGRAM = new PublicKey('<GROTH16_VERIFIER_PROGRAM_ID>');

async function main(
  provider: AnchorProvider,
  programId: PublicKey,
  mint: PublicKey,
  userWallet: PublicKey,
) {
  const zk = new ZkComplianceModule(provider, programId);

  // 1. Enable — creates ZkComplianceConfig PDA, sets FLAG_ZK_COMPLIANCE
  const enableSig = await zk.enableZkCompliance({
    mint,
    verifierKey: VERIFIER_PROGRAM,
    proofExpirySeconds: 86_400, // 24-hour proofs
  });
  console.log('Enabled:', enableSig);

  // 2. Confirm flag is set
  const active = await zk.isZkComplianceEnabled(mint);
  console.log('Active:', active); // → true

  // 3. Inspect config
  const state = await zk.fetchZkComplianceState(mint);
  console.log('Verifier key:', state?.verifierKey.toBase58());
  console.log('Expiry window (s):', state?.proofExpirySeconds);

  // 4. User submits their ZK proof (obtained from off-chain prover)
  const proofBytes = new Uint8Array([/* serialised Groth16 bytes */]);
  const publicInputs = new Uint8Array([/* ABI-encoded inputs */]);

  const proofSig = await zk.submitZkProof({
    mint,
    user: userWallet,
    proofData: proofBytes,
    publicInputs,
  });
  console.log('Proof submitted:', proofSig);

  // 5. Check compliance status
  const record = await zk.verifyComplianceStatus({ mint, user: userWallet });
  if (record?.isValid) {
    console.log('User is compliant until:', new Date(record.expiresAt * 1000));
  } else {
    console.log('User is NOT compliant — proof required.');
  }

  // 6. Fetch raw record
  const raw = await zk.fetchVerificationRecord(mint, userWallet);
  console.log('Verified at:', new Date((raw?.verifiedAt ?? 0) * 1000));

  // 7. Disable (PDA preserved, can re-enable later)
  const disableSig = await zk.disableZkCompliance({ mint });
  console.log('Disabled:', disableSig);

  // 8. Re-enable without re-creating PDA (use FeatureFlagsModule)
  // await ff.setFeatureFlag({ mint, flag: FLAG_ZK_COMPLIANCE });
}
```

---

## Security Considerations

### Verifier key trust

The `verifierKey` registered at `enableZkCompliance` is the single root of
trust for all proof validation.  Use an audited, formally verified on-chain
verifier.  Changing the verifier key requires disabling and re-enabling the
module (new `init_zk_compliance` call, which requires closing the old PDA
manually first — or calling `set_feature_flag` to re-enable with the original
verifier key).

### Proof expiry

Set `proofExpirySeconds` conservatively.  A very long window (e.g. 1 year)
reduces resubmission friction but increases the risk of a user's compliance
status becoming stale (regulatory change, revocation, etc.).  24–30 days is a
reasonable starting point for most use cases.

### User identity

`ZkVerificationRecord` is keyed by `(mint, user_pubkey)`.  Users who rotate
wallets must re-submit proofs from their new key.  There is no cross-wallet
identity linking on-chain by design.

### Re-enable flow

After calling `disableZkCompliance`, existing `ZkVerificationRecord` PDAs
remain on-chain.  If the feature is re-enabled with the same verifier key via
`set_feature_flag`, those records are still valid (subject to expiry).  If
re-enabled with a **different** verifier key (new `init_zk_compliance` after
closing the old PDA), all prior records should be treated as stale regardless
of `expiresAt`.

---

## See Also

- [`feature-flags.md`](./feature-flags.md) — full flag constants table and `FeatureFlagsModule`
- [`on-chain-sdk-admin.md`](./on-chain-sdk-admin.md) — admin authority, pause/unpause
- [`on-chain-sdk-dao.md`](./on-chain-sdk-dao.md) — DAO committee governance (FLAG_DAO_COMMITTEE)
- [`on-chain-sdk-yield.md`](./on-chain-sdk-yield.md) — yield-bearing collateral (FLAG_YIELD_COLLATERAL)

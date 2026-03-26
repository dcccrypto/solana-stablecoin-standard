# SSS — On-Chain SDK: Admin & Governance Methods

> **Class:** `SolanaStablecoin` (`sdk/src/SolanaStablecoin.ts`)
> **Scope:** Pause/unpause, minter management, authority transfer

---

## Overview

`SolanaStablecoin` exposes a set of admin and governance methods that control the operational state of a deployed stablecoin. These methods are restricted to callers holding the **admin authority** (or, for compliance-authority transfers, the **compliance authority**).

| Method | Caller | Description |
|---|---|---|
| [`pause()`](#pause) | Admin authority | Halt all minting |
| [`unpause()`](#unpause) | Admin authority | Resume minting |
| [`updateMinter()`](#updateminter) | Admin authority | Register or update a minter cap |
| [`revokeMinter()`](#revokeminter) | Admin authority | Remove a minter |
| [`updateRoles()`](#updateroles) | Admin authority | One-step authority transfer *(deprecated)* |
| [`proposeAuthority()`](#proposeauthority) | Admin authority | Step 1 of two-step authority transfer |
| [`acceptAuthority()`](#acceptauthority) | Pending admin | Step 2: accept admin authority |
| [`acceptComplianceAuthority()`](#acceptcomplianceauthority) | Pending compliance | Step 2: accept compliance authority |

For core lifecycle methods (create, load, mintTo, burnFrom, freeze/thaw), see [on-chain-sdk-core.md](./on-chain-sdk-core.md).
For collateral and reserve vault methods (SSS-3), see [on-chain-sdk-authority-collateral.md](./on-chain-sdk-authority-collateral.md).
For timelocked admin operations (authority transfer, feature-flag changes, Pyth feed registration) added by SSS-085/SSS-086, see [on-chain-sdk-admin-timelock.md](./on-chain-sdk-admin-timelock.md).

---

## Import

```typescript
import { SolanaStablecoin } from '@stbr/sss-token';
```

Assume `stablecoin` is a loaded `SolanaStablecoin` instance throughout this document:

```typescript
const stablecoin = await SolanaStablecoin.load(provider, mintPublicKey);
```

---

## `pause()`

Pause the stablecoin, disabling all minting until `unpause()` is called.

**Authority required:** admin authority (stored in `SssConfig.authority`).

```typescript
pause(): Promise<TransactionSignature>
```

**Returns:** `Promise<TransactionSignature>` — transaction signature at `confirmed` commitment.

**Example:**

```typescript
const sig = await stablecoin.pause();
console.log('Paused:', sig);
```

**Errors:**

| Error | Cause |
|---|---|
| `Unauthorized` | Caller is not the admin authority |
| `AlreadyPaused` | Stablecoin is already paused |

---

## `unpause()`

Unpause the stablecoin, re-enabling minting.

**Authority required:** admin authority.

```typescript
unpause(): Promise<TransactionSignature>
```

**Returns:** `Promise<TransactionSignature>`

**Example:**

```typescript
const sig = await stablecoin.unpause();
console.log('Unpaused:', sig);
```

**Errors:**

| Error | Cause |
|---|---|
| `Unauthorized` | Caller is not the admin authority |
| `NotPaused` | Stablecoin is not currently paused |

---

## `updateMinter()`

Register a new minter or update an existing minter's mint cap.

**Authority required:** admin authority.

```typescript
updateMinter(params: UpdateMinterParams): Promise<TransactionSignature>
```

**Parameters:**

| Field | Type | Description |
|---|---|---|
| `minter` | `PublicKey` | Public key to authorize as a minter |
| `cap` | `bigint` | Maximum tokens (base units) this minter may mint in total. `0n` = unlimited |

**Behaviour:**
- If the minter PDA does not exist, it is created (rent paid by the caller).
- If the minter PDA already exists, the cap is updated in-place.
- `cap` is cumulative: it limits the total ever minted by this minter, not per-call.

**Example:**

```typescript
import { PublicKey } from '@solana/web3.js';

const minterKey = new PublicKey('MinterPublicKey11111111111111111111111111111');

// Authorize with a 1,000,000 USDS cap (6 decimals → 1_000_000_000_000 base units)
const sig = await stablecoin.updateMinter({
  minter: minterKey,
  cap: 1_000_000_000_000n,
});

// Unlimited cap
const sigUnlimited = await stablecoin.updateMinter({
  minter: minterKey,
  cap: 0n,
});
```

**Errors:**

| Error | Cause |
|---|---|
| `Unauthorized` | Caller is not the admin authority |

---

## `revokeMinter()`

Revoke a minter's authorization. Closes the minter PDA and returns rent to the caller.

**Authority required:** admin authority.

```typescript
revokeMinter(params: RevokeMinterParams): Promise<TransactionSignature>
```

**Parameters:**

| Field | Type | Description |
|---|---|---|
| `minter` | `PublicKey` | Public key of the minter to revoke |

**Behaviour:**
- The `MinterInfo` PDA is closed on-chain; the minter can no longer call `mintTo`.
- Rent lamports are returned to the admin authority wallet.

**Example:**

```typescript
const sig = await stablecoin.revokeMinter({
  minter: minterKey,
});
```

**Errors:**

| Error | Cause |
|---|---|
| `Unauthorized` | Caller is not the admin authority |
| `AccountNotInitialized` | The minter PDA does not exist |

---

## `updateRoles()`

> ⚠️ **Deprecated for admin authority transfer.** For production use, prefer the timelocked flow: [`proposeTimelockOp()`](./on-chain-sdk-admin-timelock.md) + [`executeTimelockOp()`](./on-chain-sdk-admin-timelock.md).
>
> 🚫 **Blocked for compliance authority (BUG-019).** Passing `newComplianceAuthority` **always** throws `ComplianceAuthorityRequiresTimelock`. Compliance authority transfers must use `proposeTimelockOp` with `opKind = ADMIN_OP_TRANSFER_COMPLIANCE_AUTHORITY` (op_kind=10) and a minimum 432 000-slot (~48 h) delay. See [on-chain-sdk-admin-timelock.md](./on-chain-sdk-admin-timelock.md).

Transfer the admin authority to a new keypair in a single transaction. Compliance authority transfer via this method is permanently blocked.

**Authority required:** admin authority.

```typescript
updateRoles(params: UpdateRolesParams): Promise<TransactionSignature>
```

**Parameters:**

| Field | Type | Description |
|---|---|---|
| `newAuthority` | `PublicKey?` | New admin authority. Omit to leave unchanged |
| `newComplianceAuthority` | `PublicKey?` | **Permanently blocked** — always throws `ComplianceAuthorityRequiresTimelock`. Use the timelock flow (op_kind=10) instead |

**Example:**

```typescript
// Admin authority change only — compliance authority is blocked in this method
const sig = await stablecoin.updateRoles({
  newAuthority: newAdminKeypair.publicKey,
});
```

**Errors:**

| Error | Cause |
|---|---|
| `Unauthorized` | Caller is not the admin authority |
| `ComplianceAuthorityRequiresTimelock` | `newComplianceAuthority` was provided — always blocked; use `proposeTimelockOp` (op_kind=10) |

---

## Two-Step Authority Transfer

The recommended pattern for transferring authority uses two transactions so the incoming party must explicitly accept — preventing accidental loss of control.

### `proposeAuthority()`

Step 1: propose a new **admin** authority. Stores the candidate in `pending_authority` on the config PDA.

> ⚠️ **Compliance authority is no longer accepted here (BUG-019).** Calling with `isCompliance = true` will be rejected on-chain with `ComplianceAuthorityRequiresTimelock`. Use [`proposeTimelockOp()`](./on-chain-sdk-admin-timelock.md) with `opKind = ADMIN_OP_TRANSFER_COMPLIANCE_AUTHORITY` (op_kind=10) instead.

**Authority required:** admin authority.

```typescript
proposeAuthority(
  params: ProposeAuthorityParams,
  isCompliance?: boolean
): Promise<TransactionSignature>
```

**Parameters:**

| Field | Type | Description |
|---|---|---|
| `params.proposed` | `PublicKey` | The proposed new admin authority public key |
| `isCompliance` | `boolean` | **Always pass `false` (or omit).** Passing `true` throws `ComplianceAuthorityRequiresTimelock` — use the timelock flow instead |

**Events emitted:** `AuthorityProposed`

**Example:**

```typescript
// Propose a new admin authority
const sig = await stablecoin.proposeAuthority({
  proposed: newAdminKeypair.publicKey,
});

// ❌ Do NOT use isCompliance=true — blocked since BUG-019.
// Use proposeTimelockOp({ opKind: ADMIN_OP_TRANSFER_COMPLIANCE_AUTHORITY, ... }) instead.
```

---

### `acceptAuthority()`

Step 2: the pending admin authority accepts the transfer. Must be called by the wallet set as `pending_authority`.

```typescript
acceptAuthority(): Promise<TransactionSignature>
```

**Events emitted:** `AuthorityAccepted` (with `is_compliance = false`)

**Example:**

```typescript
// Called by newAdminKeypair's provider
const stablecoinAsNewAdmin = await SolanaStablecoin.load(newAdminProvider, mintPublicKey);
const sig = await stablecoinAsNewAdmin.acceptAuthority();
```

**Errors:**

| Error | Cause |
|---|---|
| `Unauthorized` | Caller is not `pending_authority` |
| `NoPendingAuthority` | No authority transfer is pending |

---

### `acceptComplianceAuthority()`

Step 2: the pending compliance authority accepts the transfer. Must be called by the wallet set as `pending_compliance_authority`.

```typescript
acceptComplianceAuthority(): Promise<TransactionSignature>
```

**Events emitted:** `AuthorityAccepted` (with `is_compliance = true`)

**Example:**

```typescript
const stablecoinAsNewCompliance = await SolanaStablecoin.load(
  newComplianceProvider,
  mintPublicKey,
);
const sig = await stablecoinAsNewCompliance.acceptComplianceAuthority();
```

**Errors:**

| Error | Cause |
|---|---|
| `Unauthorized` | Caller is not `pending_compliance_authority` |
| `NoPendingAuthority` | No compliance authority transfer is pending |

---

## Types Reference

```typescript
interface UpdateMinterParams {
  minter: PublicKey;
  cap: bigint;       // 0n = unlimited
}

interface RevokeMinterParams {
  minter: PublicKey;
}

interface UpdateRolesParams {
  newAuthority?: PublicKey;
  newComplianceAuthority?: PublicKey;
}

interface ProposeAuthorityParams {
  proposed: PublicKey;
}
```

---

## Authority Model

```
Admin Authority
├── pause() / unpause()
├── updateMinter() / revokeMinter()
├── updateRoles(newAuthority)      ← deprecated one-step (admin only)
└── proposeAuthority(isCompliance=false)
    └── acceptAuthority()          ← called by pending admin

Compliance Authority Transfer (BUG-019: always via timelock)
└── proposeTimelockOp({ opKind: ADMIN_OP_TRANSFER_COMPLIANCE_AUTHORITY (10),
                        param: 0n, target: newComplianceKey })
    └── executeTimelockOp()        ← after min 432 000-slot (~48 h) delay
        └── acceptComplianceAuthority() ← called by pending compliance
```

> **BUG-019:** `updateRoles(newComplianceAuthority)` and `proposeAuthority(_, true)` both permanently return `ComplianceAuthorityRequiresTimelock`. The only valid path is `proposeTimelockOp` (op_kind=10) with `max(admin_timelock_delay, 432_000)` slot delay — see [on-chain-sdk-admin-timelock.md](./on-chain-sdk-admin-timelock.md).

The `SssConfig.authority` and `SssConfig.complianceAuthority` fields on the config PDA always reflect the **current** (accepted) authorities. `pending_authority` and `pending_compliance_authority` are only set during an in-flight transfer and revert to the default public key once accepted.

---

## End-to-End Example: Rotate Admin Authority

```typescript
import { SolanaStablecoin } from '@stbr/sss-token';
import { Keypair } from '@solana/web3.js';

const oldAdmin: AnchorProvider = /* ... current admin provider */;
const newAdmin: AnchorProvider = /* ... incoming admin provider */;
const mintPk = new PublicKey('...your mint...');

// Step 1 — current admin proposes the new admin
const stablecoin = await SolanaStablecoin.load(oldAdmin, mintPk);
await stablecoin.proposeAuthority({ proposed: newAdmin.wallet.publicKey });

// Step 2 — new admin accepts
const stablecoinNew = await SolanaStablecoin.load(newAdmin, mintPk);
await stablecoinNew.acceptAuthority();

console.log('Admin authority transferred successfully.');
```

---

## Related Docs

- [on-chain-sdk-core.md](./on-chain-sdk-core.md) — create, load, mintTo, burnFrom, freeze/thaw
- [on-chain-sdk-authority-collateral.md](./on-chain-sdk-authority-collateral.md) — SSS-3 collateral & redemption
- [on-chain-sdk-cdp.md](./on-chain-sdk-cdp.md) — CDP borrowing and collateral management
- [on-chain-sdk-cpi.md](./on-chain-sdk-cpi.md) — CPI composability
- [compliance-module.md](./compliance-module.md) — SSS-2 blacklist & freeze via ComplianceModule

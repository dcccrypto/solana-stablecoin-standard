# SSS — Feature Flags Reference

> **SDK class:** `FeatureFlagsModule` (`sdk/src/FeatureFlagsModule.ts`)
> **Added:** SSS-059 | **Updated:** SSS-060, SSS-065 (FLAG_SPEND_POLICY — SSS-063)

---

## Overview

The SSS feature-flags system lets operators toggle on-chain behaviour for a
specific stablecoin mint without redeploying the token program.  Flags are
stored as a **`u64` bitmask** in `StablecoinConfig.feature_flags`.

Each bit is an independent boolean switch.  Setting a flag activates the
corresponding behaviour; clearing it deactivates it.

---

## Flag Constants

| Constant | Bit | Hex | Description |
|---|---|---|---|
| `FLAG_CIRCUIT_BREAKER` | 0 | `0x01` | Halts all mint and burn operations for the token until cleared. |
| `FLAG_SPEND_POLICY` | 1 | `0x02` | Enforces a per-transaction transfer cap (`max_transfer_amount`). Enabled atomically by `set_spend_limit`. |

> **Reserved bits:** bits 2–63 are reserved for future protocol flags.
> Do not set them directly.

---

### `FLAG_CIRCUIT_BREAKER`

```typescript
export const FLAG_CIRCUIT_BREAKER = 1n << 0n; // 0x01
```

**Anchor constant:**
```rust
pub const FLAG_CIRCUIT_BREAKER: u64 = 1 << 0; // 0x01
```

When `FLAG_CIRCUIT_BREAKER` is set in `StablecoinConfig.feature_flags`:

- The token program **rejects** all `mintTo` and `burnFrom` instructions with
  `SssError::CircuitBreakerActive`.
- `pause()` / `unpause()` continue to work normally (they are orthogonal).
- Transfer and freeze instructions are **not** affected.
- The flag persists until explicitly cleared by the admin authority.

**Use case:** emergency halt in response to an exploit or regulatory event,
without a full pause (which also freezes governance operations).

---

### `FLAG_SPEND_POLICY`

```typescript
export const FLAG_SPEND_POLICY = 1n << 1n; // 0x02
```

**Anchor constant:**
```rust
pub const FLAG_SPEND_POLICY: u64 = 1 << 1; // 0x02
```

When `FLAG_SPEND_POLICY` is set in `StablecoinConfig.feature_flags`:

- Every transfer instruction checks `transfer_amount <= config.max_transfer_amount`.
- Transfers exceeding the cap are rejected with `SssError::SpendLimitExceeded`.
- The cap is set atomically when calling `set_spend_limit` — the flag is never
  left set with `max_transfer_amount == 0`.
- Clearing is done via `clear_spend_limit`, which zeros `max_transfer_amount`
  and clears the flag atomically.

**Use case:** regulatory spend controls or rate-limiting per transaction for
compliance-sensitive token issuers (SSS-2 / SSS-3 presets).

> **Note:** `FLAG_SPEND_POLICY` is managed via the dedicated `set_spend_limit` /
> `clear_spend_limit` instructions (not `set_feature_flag` / `clear_feature_flag`).
> Setting it directly via `set_feature_flag` without configuring
> `max_transfer_amount` first will leave the policy in an unconfigured state.

---

## Error Codes

| Error | Code | Description |
|---|---|---|
| `SssError::CircuitBreakerActive` | — | Returned on `mintTo` / `burnFrom` when `FLAG_CIRCUIT_BREAKER` is set. |
| `SssError::SpendLimitExceeded` | — | Returned by transfer-hook when transfer amount > `max_transfer_amount`. |
| `SssError::SpendPolicyNotConfigured` | — | Returned by `set_spend_limit` when `max_amount` is 0. |
| `SssError::Unauthorized` | — | Signer is not the admin authority for any flag write. |

---

## Import

```typescript
import {
  FeatureFlagsModule,
  FLAG_CIRCUIT_BREAKER,
} from '@stbr/sss-token';
// or, from the SDK source directly:
import {
  FeatureFlagsModule,
  FLAG_CIRCUIT_BREAKER,
} from '@sss/sdk';
```

---

## Instantiation

```typescript
import { AnchorProvider } from '@coral-xyz/anchor';
import { FeatureFlagsModule } from '@sss/sdk';

const ff = new FeatureFlagsModule(provider, programId);
```

| Parameter | Type | Description |
|---|---|---|
| `provider` | `AnchorProvider` | Anchor provider; wallet must be admin authority for writes. |
| `programId` | `PublicKey` | Deployed SSS token program ID. |

---

## Methods

### `setFeatureFlag(params)`

Set a feature-flag bit on the `StablecoinConfig` for the given mint.

```typescript
await ff.setFeatureFlag({ mint, flag: FLAG_CIRCUIT_BREAKER });
```

Calls the `set_feature_flag` Anchor instruction.
The connected wallet **must be the admin authority**.

> **Note for `FLAG_SPEND_POLICY`:** use `set_spend_limit` (see below) rather
> than `setFeatureFlag` to ensure `max_transfer_amount` is configured atomically.

| Parameter | Type | Description |
|---|---|---|
| `mint` | `PublicKey` | Stablecoin mint address. |
| `flag` | `bigint` | Flag constant (e.g. `FLAG_CIRCUIT_BREAKER`). |

**Returns:** `Promise<TransactionSignature>`

**Errors:**
- `SssError::Unauthorized` — signer is not the admin authority.

---

### `clearFeatureFlag(params)`

Clear a feature-flag bit, reverting the associated behaviour.

```typescript
await ff.clearFeatureFlag({ mint, flag: FLAG_CIRCUIT_BREAKER });
```

Calls the `clear_feature_flag` Anchor instruction.
The connected wallet **must be the admin authority**.

> **Note for `FLAG_SPEND_POLICY`:** use `clear_spend_limit` (see below) to
> zero `max_transfer_amount` atomically alongside clearing the flag.

| Parameter | Type | Description |
|---|---|---|
| `mint` | `PublicKey` | Stablecoin mint address. |
| `flag` | `bigint` | Flag constant to clear. |

**Returns:** `Promise<TransactionSignature>`

---

### `isFeatureFlagSet(mint, flag)`

Check whether a specific flag is active for the given mint.  Pure read —
does **not** require a transaction.

```typescript
const active = await ff.isFeatureFlagSet(mint, FLAG_CIRCUIT_BREAKER);
console.log('Circuit breaker active:', active);
```

Reads `StablecoinConfig.feature_flags` directly from raw account data
without an IDL.  Returns `false` if the config account does not exist yet.

| Parameter | Type | Description |
|---|---|---|
| `mint` | `PublicKey` | Stablecoin mint to inspect. |
| `flag` | `bigint` | Flag bit to test. |

**Returns:** `Promise<boolean>`

---

### `getFeatureFlags(mint)`

Read the full `feature_flags` bitmask for the given mint.  Returns `0n` if
the config account does not exist.

```typescript
const flags = await ff.getFeatureFlags(mint);
console.log('Raw feature flags:', flags.toString(16)); // e.g. "03"
```

**Returns:** `Promise<bigint>`

---

### `getConfigPda(mint)`

Derive the `StablecoinConfig` PDA for the given mint.

```typescript
const [configPda, bump] = ff.getConfigPda(mint);
```

Seeds: `["stablecoin-config", mint]` on `programId`.

**Returns:** `[PublicKey, number]`

---

## Spend Policy Methods (via Anchor program directly)

`FLAG_SPEND_POLICY` is managed through dedicated instructions that keep
the flag and `max_transfer_amount` in sync atomically.

### `set_spend_limit` (Anchor instruction)

Set the per-transaction transfer cap and atomically enable `FLAG_SPEND_POLICY`.

```typescript
import { BN } from '@coral-xyz/anchor';

const program = new Program(idl, provider);
const [config] = PublicKey.findProgramAddressSync(
  [Buffer.from('stablecoin-config'), mint.toBuffer()],
  programId
);

// Set cap to 10,000 tokens (with 6 decimals = 10_000_000_000 raw)
await program.methods
  .setSpendLimit(new BN(10_000_000_000))
  .accounts({ authority: provider.wallet.publicKey, mint, config })
  .rpc({ commitment: 'confirmed' });
```

| Parameter | Type | Description |
|---|---|---|
| `max_amount` | `u64` | Maximum tokens per transfer (raw units). Must be > 0. |

**Errors:**
- `SssError::SpendPolicyNotConfigured` — `max_amount` is 0.
- `SssError::Unauthorized` — signer is not the admin authority.

---

### `clear_spend_limit` (Anchor instruction)

Remove the spend cap and atomically clear `FLAG_SPEND_POLICY`.

```typescript
await program.methods
  .clearSpendLimit()
  .accounts({ authority: provider.wallet.publicKey, mint, config })
  .rpc({ commitment: 'confirmed' });
```

**Returns:** `Promise<TransactionSignature>`

---

## Circuit-Breaker Workflow

### Activating the circuit breaker

```typescript
import { FeatureFlagsModule, FLAG_CIRCUIT_BREAKER } from '@sss/sdk';
import { AnchorProvider } from '@coral-xyz/anchor';

// Provider wallet = admin authority
const ff = new FeatureFlagsModule(provider, programId);

// 1. Halt all minting/burning
const sig = await ff.setFeatureFlag({ mint, flag: FLAG_CIRCUIT_BREAKER });
console.log('Circuit breaker set:', sig);

// 2. Confirm it is active
const active = await ff.isFeatureFlagSet(mint, FLAG_CIRCUIT_BREAKER);
console.assert(active === true);
```

### Lifting the circuit breaker

```typescript
// After incident resolution
const sig = await ff.clearFeatureFlag({ mint, flag: FLAG_CIRCUIT_BREAKER });
console.log('Circuit breaker cleared:', sig);

const active = await ff.isFeatureFlagSet(mint, FLAG_CIRCUIT_BREAKER);
console.assert(active === false);
```

---

## Spend Policy Workflow

### Enabling a spend limit

```typescript
import { Program } from '@coral-xyz/anchor';
import { BN } from '@coral-xyz/anchor';

const program = new Program(idl, provider);
const [config] = PublicKey.findProgramAddressSync(
  [Buffer.from('stablecoin-config'), mint.toBuffer()],
  programId
);

// Cap transfers at 500 tokens (6 decimals = 500_000_000 raw)
await program.methods
  .setSpendLimit(new BN(500_000_000))
  .accounts({ authority: provider.wallet.publicKey, mint, config })
  .rpc({ commitment: 'confirmed' });

// Verify the flag is now set
const ff = new FeatureFlagsModule(provider, programId);
const spendPolicyActive = await ff.isFeatureFlagSet(mint, FLAG_SPEND_POLICY);
console.assert(spendPolicyActive === true);
```

### Removing the spend limit

```typescript
await program.methods
  .clearSpendLimit()
  .accounts({ authority: provider.wallet.publicKey, mint, config })
  .rpc({ commitment: 'confirmed' });

const spendPolicyActive = await ff.isFeatureFlagSet(mint, FLAG_SPEND_POLICY);
console.assert(spendPolicyActive === false);
```

### Checking both flags

```typescript
const flags = await ff.getFeatureFlags(mint);
const circuitBreakerOn = (flags & FLAG_CIRCUIT_BREAKER) !== 0n;
const spendPolicyOn    = (flags & FLAG_SPEND_POLICY) !== 0n;

console.log(`Circuit breaker: ${circuitBreakerOn}`);
console.log(`Spend policy:    ${spendPolicyOn}`);
console.log(`Raw bitmask:     0x${flags.toString(16).padStart(16, '0')}`);
```

---

## On-Chain Account Layout

`StablecoinConfig` raw data offsets (for the reader implemented in
`_readFeatureFlags`).  **Updated for SSS-063** which added `max_transfer_amount`
and reordered the tail fields.

| Offset | Size | Field |
|---|---|---|
| 0 | 8 | Anchor discriminator |
| 8 | 32 | `mint` (Pubkey) |
| 40 | 32 | `authority` (Pubkey) |
| 72 | 32 | `compliance_authority` (Pubkey) |
| 104 | 1 | `preset` (u8) |
| 105 | 1 | `paused` (bool) |
| 106 | 8 | `total_minted` (u64 LE) |
| 114 | 8 | `total_burned` (u64 LE) |
| 122 | 32 | `transfer_hook_program` (Pubkey) |
| 154 | 32 | `collateral_mint` (Pubkey) |
| 186 | 32 | `reserve_vault` (Pubkey) |
| 218 | 8 | `total_collateral` (u64 LE) |
| 226 | 8 | `max_supply` (u64 LE) |
| 234 | 32 | `pending_authority` (Pubkey) |
| 266 | 32 | `pending_compliance_authority` (Pubkey) |
| **298** | **8** | **`feature_flags` (u64 LE)** |
| **306** | **8** | **`max_transfer_amount` (u64 LE)** |
| 314 | 1 | `bump` (u8) |

The `feature_flags` field is read as little-endian `u64`.
The `max_transfer_amount` field is non-zero only when `FLAG_SPEND_POLICY` is active.

---

## CLI Usage (sss-cli)

```bash
# Set circuit breaker
sss-cli feature-flags set \
  --mint <MINT_ADDRESS> \
  --flag circuit-breaker \
  --keypair /path/to/admin-keypair.json

# Clear circuit breaker
sss-cli feature-flags clear \
  --mint <MINT_ADDRESS> \
  --flag circuit-breaker \
  --keypair /path/to/admin-keypair.json

# Query flag status
sss-cli feature-flags status --mint <MINT_ADDRESS>

# Set spend limit (500 tokens with 6 decimals)
sss-cli spend-policy set \
  --mint <MINT_ADDRESS> \
  --max-amount 500000000 \
  --keypair /path/to/admin-keypair.json

# Clear spend limit
sss-cli spend-policy clear \
  --mint <MINT_ADDRESS> \
  --keypair /path/to/admin-keypair.json
```

---

## Related Docs

- [on-chain-sdk-admin.md](./on-chain-sdk-admin.md) — pause/unpause, minter management, authority transfer
- [on-chain-sdk-core.md](./on-chain-sdk-core.md) — mintTo, burnFrom, freeze/thaw
- [SSS-3.md](./SSS-3.md) — protocol specification

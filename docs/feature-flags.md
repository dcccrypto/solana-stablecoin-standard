# SSS — Feature Flags Reference

> **SDK class:** `FeatureFlagsModule` (`sdk/src/FeatureFlagsModule.ts`)
> **Added:** SSS-059

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
| `FLAG_CIRCUIT_BREAKER` | 7 | `0x80` | Halts all mint and burn operations for the token until cleared. |

> **Reserved bits:** bits 0–6 and 8–63 are reserved for future protocol flags.
> Do not set them directly.

### `FLAG_CIRCUIT_BREAKER`

```typescript
export const FLAG_CIRCUIT_BREAKER = 1n << 7n; // 0x80
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
console.log('Raw feature flags:', flags.toString(16)); // e.g. "80"
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

## On-Chain Account Layout

`StablecoinConfig` raw data offsets (for the reader implemented in
`_readFeatureFlags`):

| Offset | Size | Field |
|---|---|---|
| 0 | 8 | Anchor discriminator |
| 8 | 32 | `mint` (Pubkey) |
| 40 | 32 | `authority` (Pubkey) |
| 72 | 32 | `comp_authority` (Pubkey) |
| 104 | 32 | `pending_authority` (Pubkey) |
| 136 | 32 | `pending_comp_authority` (Pubkey) |
| 168 | 1 | `preset` (u8) |
| **169** | **8** | **`feature_flags` (u64 LE)** |

The `feature_flags` field is read as little-endian `u64`.

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
```

---

## Related Docs

- [on-chain-sdk-admin.md](./on-chain-sdk-admin.md) — pause/unpause, minter management, authority transfer
- [on-chain-sdk-core.md](./on-chain-sdk-core.md) — mintTo, burnFrom, freeze/thaw
- [SSS-3.md](./SSS-3.md) — protocol specification

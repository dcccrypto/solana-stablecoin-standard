# SSS — On-Chain SDK: CPI Composability Module

> **Module:** `CpiModule` (`sdk/src/CpiModule.ts`)
> **Added:** SSS-056 (Direction 3 — CPI Composability Standard, see SSS-055 for the Anchor program)

---

## Overview

`CpiModule` is the TypeScript SDK wrapper for the **CPI Composability Standard** introduced in SSS-055/SSS-056. It allows external Solana programs to mint and burn SSS tokens via **versioned CPI entrypoints** (`cpi_mint` / `cpi_burn`) instead of calling the raw `mint` / `burn` instructions directly.

The key guarantee: callers **pin to a known interface version**. If the on-chain interface is deprecated or has been bumped to a breaking new version, the transaction fails on-chain with an explicit error rather than silently misbehaving.

---

## Installation

```bash
npm install @stbr/sss-token
```

---

## Imports

```typescript
import {
  CpiModule,
  CURRENT_INTERFACE_VERSION,
  getInterfaceVersionPda,
} from '@stbr/sss-token';
import type {
  InterfaceVersionInfo,
  CpiMintParams,
  CpiBurnParams,
  UpdateInterfaceVersionParams,
} from '@stbr/sss-token';
import { AnchorProvider, Wallet } from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
```

---

## Setup

```typescript
const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
const wallet = new Wallet(Keypair.fromSecretKey(/* your key bytes */));
const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' });

const mint = new PublicKey('YOUR_SSS_MINT_ADDRESS');
const cpi = new CpiModule(provider, mint);
```

The third constructor argument (`programId`) defaults to `SSS_TOKEN_PROGRAM_ID` and only needs to be overridden in local tests.

---

## Constants

| Constant | Value | Description |
|---|---|---|
| `CURRENT_INTERFACE_VERSION` | `1` | The live interface version (SSS-055 initial release). Always pass this unless intentionally testing error paths. |

---

## Types

### `InterfaceVersionInfo`

Decoded form of the on-chain `InterfaceVersion` PDA.

| Field | Type | Description |
|---|---|---|
| `mint` | `PublicKey` | The SSS mint this interface applies to |
| `version` | `number` | Current interface version (callers should pin to `CURRENT_INTERFACE_VERSION`) |
| `active` | `boolean` | `false` means the protocol is deprecated — stop CPI calls |
| `namespace` | `Uint8Array` | 32-byte namespace; discriminators follow `sha256("global:<ix>")[..8]` |
| `bump` | `number` | PDA bump seed |

### `CpiMintParams`

| Field | Type | Required | Description |
|---|---|---|---|
| `amount` | `bigint` | ✓ | Base units to mint (e.g. `1_000_000n` = 1.0 with 6 decimals) |
| `recipient` | `PublicKey` | ✓ | Recipient's SSS Token-2022 token account |
| `requiredVersion` | `number?` | — | Defaults to `CURRENT_INTERFACE_VERSION` |
| `tokenProgram` | `PublicKey?` | — | Defaults to `TOKEN_2022_PROGRAM_ID` |

### `CpiBurnParams`

| Field | Type | Required | Description |
|---|---|---|---|
| `amount` | `bigint` | ✓ | Base units to burn |
| `source` | `PublicKey` | ✓ | Minter's SSS token account (must be owned by provider wallet) |
| `requiredVersion` | `number?` | — | Defaults to `CURRENT_INTERFACE_VERSION` |
| `tokenProgram` | `PublicKey?` | — | Defaults to `TOKEN_2022_PROGRAM_ID` |

### `UpdateInterfaceVersionParams`

| Field | Type | Description |
|---|---|---|
| `newVersion` | `number?` | Bump the version number after a breaking interface change |
| `active` | `boolean?` | Set to `false` to deprecate the interface |

---

## Methods

### `cpi.cpiMint(params: CpiMintParams)`

Call the standardized `cpi_mint` entrypoint.

- Validates the `InterfaceVersion` PDA on-chain before minting.
- The provider wallet must be a registered minter with sufficient mint cap.
- **Returns:** `Promise<TransactionSignature>`
- **Throws:** `InterfaceDeprecated` | `InterfaceVersionMismatch` | `Unauthorized` | `ExceedsMintCap`

```typescript
const sig = await cpi.cpiMint({
  amount: 1_000_000n,       // 1.0 token (6 decimals)
  recipient: userTokenAccount,
});
console.log('Minted via CPI:', sig);
```

---

### `cpi.cpiBurn(params: CpiBurnParams)`

Call the standardized `cpi_burn` entrypoint.

- Validates the `InterfaceVersion` PDA on-chain before burning.
- The provider wallet must be a registered minter; the `source` account must be owned by the minter.
- **Returns:** `Promise<TransactionSignature>`
- **Throws:** `InterfaceDeprecated` | `InterfaceVersionMismatch` | `Unauthorized`

```typescript
const sig = await cpi.cpiBurn({
  amount: 500_000n,         // 0.5 token
  source: minterTokenAccount,
});
console.log('Burned via CPI:', sig);
```

---

### `cpi.initInterfaceVersion()`

**Authority only.** One-time initialization of the `InterfaceVersion` PDA.

Must be called by the stablecoin authority before external programs can use `cpiMint` or `cpiBurn`. Sets `version = 1`, `active = true`.

- **Returns:** `Promise<TransactionSignature>`

```typescript
// Called once, by the stablecoin authority
const sig = await cpi.initInterfaceVersion();
```

---

### `cpi.updateInterfaceVersion(params: UpdateInterfaceVersionParams)`

**Authority only.** Update the `InterfaceVersion` PDA.

Use to bump the version after a breaking interface change, or to deprecate the interface when migrating to a new program. Omit a field to leave it unchanged.

- **Returns:** `Promise<TransactionSignature>`

```typescript
// Bump to version 2 after a breaking change
await cpi.updateInterfaceVersion({ newVersion: 2 });

// Deprecate the interface (halt all future CPI calls)
await cpi.updateInterfaceVersion({ active: false });
```

---

### `cpi.fetchInterfaceVersion(connection: Connection)`

Fetch and decode the on-chain `InterfaceVersion` PDA.

Returns `null` if the PDA has not been initialized yet (authority has not called `initInterfaceVersion`).

- **Returns:** `Promise<InterfaceVersionInfo | null>`

```typescript
const iv = await cpi.fetchInterfaceVersion(connection);
if (!iv) {
  console.log('Interface not initialized');
} else {
  console.log(`Version: ${iv.version}, Active: ${iv.active}`);
}
```

---

### `cpi.isSssProgramCompatible(connection, expectedVersion?)`

Convenience check before constructing a CPI call.

Returns `true` if:
1. The `InterfaceVersion` PDA exists
2. `active` is `true` (interface not deprecated)
3. `version` matches `expectedVersion` (default: `CURRENT_INTERFACE_VERSION`)

- **Returns:** `Promise<boolean>`

```typescript
const ok = await cpi.isSssProgramCompatible(connection);
if (!ok) {
  throw new Error('SSS program interface incompatible — upgrade your client');
}
```

---

## PDA Helpers (standalone)

These are exported at the module level and can be used without instantiating `CpiModule`.

### `getInterfaceVersionPda(mint, programId?)`

Derive the `InterfaceVersion` PDA for a given SSS mint.

Seeds: `["interface-version", mint]`

```typescript
import { getInterfaceVersionPda } from '@stbr/sss-token';

const [ivPda, bump] = getInterfaceVersionPda(mint);
```

---

## Instance PDA Helpers

`CpiModule` also exposes PDA derivation methods on the instance:

| Method | Returns | Description |
|---|---|---|
| `cpi.getInterfaceVersionPda()` | `[PublicKey, number]` | InterfaceVersion PDA + bump |
| `cpi.getConfigPda()` | `PublicKey` | StablecoinConfig PDA |
| `cpi.getMinterInfoPda(minter?)` | `PublicKey` | MinterInfo PDA (defaults to provider wallet) |

---

## End-to-End Example

```typescript
import { CpiModule, CURRENT_INTERFACE_VERSION } from '@stbr/sss-token';
import { AnchorProvider, Wallet } from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';

const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
const wallet = new Wallet(Keypair.fromSecretKey(authorityKey));
const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' });

const mint = new PublicKey('YOUR_SSS_MINT');
const cpi = new CpiModule(provider, mint);

// Step 1: Authority initializes the interface (one-time)
await cpi.initInterfaceVersion();

// Step 2: Check compatibility before issuing CPIs
const ok = await cpi.isSssProgramCompatible(connection);
if (!ok) throw new Error('Interface incompatible');

// Step 3: Mint tokens via the standardized CPI entrypoint
const mintSig = await cpi.cpiMint({
  amount: 10_000_000n,    // 10.0 USDS
  recipient: recipientTokenAccount,
});

// Step 4: Burn tokens via the standardized CPI entrypoint
const burnSig = await cpi.cpiBurn({
  amount: 5_000_000n,     // 5.0 USDS
  source: minterTokenAccount,
});
```

---

## Error Reference

Errors thrown by `cpiMint` / `cpiBurn` originate from the on-chain program (SSS-055):

| Error | Cause |
|---|---|
| `InterfaceVersionMismatch` | `requiredVersion` doesn't match the PDA's current version |
| `InterfaceDeprecated` | The PDA's `active` flag is `false` |
| `Unauthorized` | The provider wallet is not a registered minter |
| `ExceedsMintCap` | The mint amount exceeds the minter's authorized cap |

---

## See Also

- [on-chain-sdk-core.md](./on-chain-sdk-core.md) — Core `SolanaStablecoin` methods (mint, burn, freeze)
- [on-chain-sdk-authority-collateral.md](./on-chain-sdk-authority-collateral.md) — Authority/collateral management
- [TECH-SPIKE-DIRECTIONS.md](./TECH-SPIKE-DIRECTIONS.md) — Direction 3: CPI Composability rationale
- SSS-055 — Anchor program implementing `cpi_mint`, `cpi_burn`, `init_interface_version`
- SSS-056 — This SDK module

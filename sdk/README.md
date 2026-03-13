# `sss-token-sdk`

TypeScript SDK for the **Solana Stablecoin Standard** (SSS). Deploy, manage, and interact with SSS-1 and SSS-2 stablecoins programmatically.

---

## Table of contents

- [Install](#install)
- [Quick start](#quick-start)
- [API overview](#api-overview)
- [Deploying a new stablecoin](#deploying-a-new-stablecoin)
- [Loading an existing stablecoin](#loading-an-existing-stablecoin)
- [Token operations](#token-operations)
- [Read operations](#read-operations)
- [Compliance / blacklist (SSS-2)](#compliance--blacklist-sss-2)
- [Full API reference](#full-api-reference)

---

## Install

```bash
npm install sss-token-sdk @solana/web3.js @solana/spl-token
```

Or from source (this repo):

```bash
cd sdk
npm install
npm run build
```

---

## Quick start

```typescript
import { Connection, Keypair } from "@solana/web3.js";
import { SolanaStablecoin, Presets } from "sss-token-sdk";

const connection = new Connection("https://api.devnet.solana.com", "confirmed");
const authority = Keypair.generate(); // or load from file

// Deploy a new SSS-1 stablecoin
const stablecoin = await SolanaStablecoin.create(connection, {
  preset: Presets.SSS_1,
  name: "My Dollar",
  symbol: "MUSD",
  decimals: 6,
  authority,
});

console.log("Mint:", stablecoin.mint.toBase58());

// Mint tokens
const recipient = Keypair.generate();
const sig = await stablecoin.mintTokens({
  recipient: recipient.publicKey,
  amount: 1_000_000n, // 1 token with 6 decimals
  minter: authority,
});

// Check supply
const supply = await stablecoin.getSupply();
console.log("Supply:", supply.uiAmount); // 1
```

---

## API overview

```
SolanaStablecoin
├── create(connection, opts)        Deploy a new mint
├── load(connection, opts)          Connect to existing mint
│
├── mintTokens(opts)                Mint tokens to recipient
├── burn(opts)                      Burn tokens
├── freeze(opts)                    Freeze a token account
├── thaw(opts)                      Thaw a frozen token account
├── pause(authority)                Pause the mint (Pausable ext.)
├── unpause(authority)              Unpause the mint
├── setAuthority(opts)              Change an on-chain authority
│
├── getSupply()                     Total supply (raw + UI)
├── getBalance(wallet)              Balance of a wallet
├── getStatus()                     Mint status snapshot
├── getAuditLog(limit?)             Recent transactions
│
└── compliance                      SSS-2 blacklist operations
    ├── blacklistAdd(wallet, admin)
    ├── blacklistRemove(wallet, admin)
    ├── isBlacklisted(wallet)
    ├── initializeHook(admin)
    ├── getConfigPda()
    ├── getBlacklistPda(wallet)
    └── getExtraAccountMetasPda()
```

---

## Deploying a new stablecoin

### SSS-1 (basic metadata)

```typescript
import { SolanaStablecoin, Presets } from "sss-token-sdk";

const stablecoin = await SolanaStablecoin.create(connection, {
  preset: Presets.SSS_1,
  name: "My Dollar",
  symbol: "MUSD",
  decimals: 6,
  authority: adminKeypair,
});
```

This creates a Token-2022 mint with:
- MetadataPointer extension (on-mint name/symbol/uri)
- Mint authority = `adminKeypair`
- Freeze authority = `adminKeypair` (override with `freezeAuthority`)

### SSS-2 (with blacklist transfer hook)

```typescript
import { PublicKey } from "@solana/web3.js";
import { SolanaStablecoin, Presets } from "sss-token-sdk";

const hookProgramId = new PublicKey("84rPjkmmoP3oYZVxjtL2rdcT6hC5Rts6N5XzJTFcJEk6");

const stablecoin = await SolanaStablecoin.create(connection, {
  preset: Presets.SSS_2,
  name: "Compliant Dollar",
  symbol: "CUSD",
  decimals: 6,
  authority: adminKeypair,
  extensions: {
    transferHook: {
      programId: hookProgramId,
      admin: adminKeypair, // optional, defaults to authority
    },
  },
});
```

This does everything SSS-1 does, plus:
- Adds the TransferHook extension pointing at `hookProgramId`
- Initializes the blacklist hook's Config and ExtraAccountMetaList PDAs

### Custom extensions

```typescript
const stablecoin = await SolanaStablecoin.create(connection, {
  name: "Custom Stable",
  symbol: "CUST",
  authority: adminKeypair,
  freezeAuthority: separateFreezeKeypair,
  metadataAuthority: separateMetadataKeypair.publicKey,
  extensions: {
    metadata: true,          // default
    permanentDelegate: true, // opt-in (not yet deployed at mint time,
                             // but reserves the extension slot)
    transferHook: {
      programId: myHookProgram,
    },
  },
});
```

---

## Loading an existing stablecoin

If the mint is already deployed, use `load`:

```typescript
const stablecoin = SolanaStablecoin.load(connection, {
  mint: new PublicKey("7NDka..."),
});
```

For SSS-2 blacklist operations, also pass the hook program ID:

```typescript
const stablecoin = SolanaStablecoin.load(connection, {
  mint: new PublicKey("7NDka..."),
  transferHookProgramId: new PublicKey("84rPj..."),
});
```

By default `tokenProgramId` is `TOKEN_2022_PROGRAM_ID`. Override for legacy SPL Token mints:

```typescript
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

const stablecoin = SolanaStablecoin.load(connection, {
  mint: new PublicKey("..."),
  tokenProgramId: TOKEN_PROGRAM_ID,
});
```

---

## Token operations

All write operations return a **transaction signature** (`string`).

### Mint tokens

```typescript
const sig = await stablecoin.mintTokens({
  recipient: recipientWallet,     // PublicKey
  amount: 5_000_000n,             // bigint, raw units
  minter: mintAuthorityKeypair,   // Keypair, signs + pays
});
```

Creates the recipient's ATA if it doesn't exist.

### Burn tokens

```typescript
const sig = await stablecoin.burn({
  amount: 1_000_000n,
  owner: tokenHolderKeypair,
  // tokenAccount: optionalSpecificTokenAccount,
});
```

Burns from the owner's ATA by default.

### Freeze / Thaw

```typescript
await stablecoin.freeze({
  tokenAccount: recipientAta,
  freezeAuthority: freezeKeypair,
});

await stablecoin.thaw({
  tokenAccount: recipientAta,
  freezeAuthority: freezeKeypair,
});
```

### Pause / Unpause

Requires the Token-2022 Pausable extension on the mint.

```typescript
await stablecoin.pause(pauseAuthorityKeypair);
await stablecoin.unpause(pauseAuthorityKeypair);
```

### Set authority

Change an on-chain authority (mint, freeze, metadata, pause, permanent-delegate).

```typescript
await stablecoin.setAuthority({
  type: "freeze",
  currentAuthority: oldFreezeKeypair,
  newAuthority: newFreezePublicKey, // or null to revoke
});
```

---

## Read operations

Read operations send **no transactions**; they only query on-chain state.

### Get supply

```typescript
const supply = await stablecoin.getSupply();
// { raw: 10000000n, uiAmount: 10, decimals: 6 }
```

### Get balance

```typescript
const balance = await stablecoin.getBalance(walletPublicKey);
// { raw: 5000000n, uiAmount: 5, ata: PublicKey, exists: true }
```

### Get status

```typescript
const status = await stablecoin.getStatus();
// { mint, supply, mintAuthority, freezeAuthority }
```

### Audit log

```typescript
const log = await stablecoin.getAuditLog(50);
for (const entry of log) {
  console.log(entry.signature, entry.blockTime, entry.err);
}
```

---

## Compliance / blacklist (SSS-2)

The `compliance` property is available when a `transferHookProgramId` is configured (either via `create` with SSS-2 or via `load` with the ID).

```typescript
if (!stablecoin.compliance) {
  throw new Error("Not an SSS-2 stablecoin");
}
```

### Add to blacklist

```typescript
const sig = await stablecoin.compliance.blacklistAdd(
  walletToBlock,      // PublicKey
  blacklistAdmin,     // Keypair
);
```

### Remove from blacklist

```typescript
const sig = await stablecoin.compliance.blacklistRemove(
  walletToUnblock,
  blacklistAdmin,
);
```

### Check blacklist status

```typescript
const status = await stablecoin.compliance.isBlacklisted(walletPublicKey);
// { wallet, pda, blocked: true }
```

This is read-only -- no transaction is sent.

### PDA helpers

For building custom transactions or debugging:

```typescript
stablecoin.compliance.getConfigPda();
stablecoin.compliance.getBlacklistPda(wallet);
stablecoin.compliance.getExtraAccountMetasPda();
```

---

## Full API reference

### `SolanaStablecoin`

| Property | Type | Description |
|----------|------|-------------|
| `connection` | `Connection` | Solana RPC connection. |
| `mint` | `PublicKey` | On-chain mint address. |
| `tokenProgramId` | `PublicKey` | Token program (TOKEN_2022 or legacy). |
| `compliance` | `Compliance \| null` | Blacklist operations (SSS-2 only). |

### `CreateOptions`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `preset` | `Presets` | `SSS_1` | SSS profile. |
| `name` | `string` | required | Token name. |
| `symbol` | `string` | required | Ticker symbol. |
| `decimals` | `number` | `6` | Decimal places. |
| `uri` | `string` | `""` | Metadata URI. |
| `authority` | `Keypair` | required | Main authority (payer, mint auth). |
| `freezeAuthority` | `Keypair \| PublicKey` | `authority` | Freeze authority. |
| `metadataAuthority` | `Keypair \| PublicKey` | `authority` | Metadata authority. |
| `extensions` | `ExtensionsConfig` | see below | Extensions to enable. |

### `ExtensionsConfig`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `metadata` | `boolean` | `true` | On-mint metadata. |
| `pausable` | `boolean` | `false` | Pausable extension. |
| `permanentDelegate` | `boolean` | `false` | Permanent delegate. |
| `transferHook` | `boolean \| TransferHookConfig` | `false` | Transfer hook. `true` requires a config. |

### `TransferHookConfig`

| Field | Type | Description |
|-------|------|-------------|
| `programId` | `PublicKey` | Hook program ID. |
| `admin` | `Keypair?` | Blacklist admin. Defaults to `authority`. |

### `LoadOptions`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `mint` | `PublicKey` | required | Mint address. |
| `tokenProgramId` | `PublicKey` | `TOKEN_2022_PROGRAM_ID` | Token program. |
| `transferHookProgramId` | `PublicKey?` | `null` | Hook program (for compliance). |

### Return types

| Type | Fields |
|------|--------|
| `SupplyInfo` | `raw: bigint`, `uiAmount: number`, `decimals: number` |
| `BalanceInfo` | `raw: bigint`, `uiAmount: number`, `ata: PublicKey`, `exists: boolean` |
| `TokenStatus` | `mint: PublicKey`, `supply: SupplyInfo`, `mintAuthority`, `freezeAuthority` |
| `AuditLogEntry` | `signature: string`, `slot: number`, `err: unknown`, `blockTime: Date \| null` |
| `BlacklistStatus` | `wallet: PublicKey`, `pda: PublicKey`, `blocked: boolean` |

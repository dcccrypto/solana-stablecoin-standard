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
console.log("Supply:", supply.uiAmountString); // "1.000000"
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
├── transfer(opts)                  Transfer with hook support (SSS-2)
├── freeze(opts)                    Freeze a token account
├── thaw(opts)                      Thaw a frozen token account
├── seize(opts)                     Seize tokens (burn+mint, permanent delegate)
├── pause(authority)                Pause the mint (Pausable ext.)
├── unpause(authority)              Unpause the mint
├── setAuthority(opts)              Change an on-chain authority
│
├── refresh()                       Reload cached state from chain
├── getState()                      Return last cached state
├── getSupply()                     Total supply (raw + UI)
├── getBalance(wallet)              Balance of a wallet
├── getStatus()                     Mint status snapshot
├── getAuditLog(limit?)             Recent transactions
│
├── buildMintTransaction(...)       Unsigned mint tx (wallet adapter)
├── buildBurnTransaction(...)       Unsigned burn tx
├── buildTransferTransaction(...)   Unsigned transfer tx
├── buildFreezeTransaction(...)     Unsigned freeze tx
├── buildThawTransaction(...)       Unsigned thaw tx
├── buildSeizeTransaction(...)      Unsigned seize tx (async — checks ATA)
├── buildSetAuthorityTransaction(.) Unsigned set-authority tx
│
├── batchMint(minter, recipients[]) Batch mint to multiple recipients
├── batchFreeze(authority, atas[])  Batch freeze (returns unsigned tx)
├── batchThaw(authority, atas[])    Batch thaw (returns unsigned tx)
│
├── compliance                      SSS-2 blacklist operations
│   ├── blacklistAdd(wallet, admin, reason?)
│   ├── blacklistRemove(wallet, admin)
│   ├── closeBlacklistEntry(wallet, admin)
│   ├── isBlacklisted(wallet)
│   ├── transferAdmin(newAdmin, currentAdmin)
│   ├── acceptAdmin(newAdminKeypair)
│   ├── initializeHook(admin)
│   ├── getConfigPda()
│   ├── getBlacklistPda(wallet)
│   └── getExtraAccountMetasPda()
│
└── core                            SSS-Core program (RBAC, quotas)
    ├── initialize(authority, preset, supplyCap?)
    ├── grantRole(authority, grantee, role)
    ├── revokeRole(authority, grantee, role)
    ├── setMinterQuota(authority, minter, quota)
    ├── mintTokens(minter, recipientAta, amount)
    ├── burnTokens(burner, burnerAta, amount)
    ├── burnFrom(burner, targetAta, amount)        # NEW — burn from any account
    ├── updateMetadata(authority, field, value)     # NEW — update name/symbol/uri
    ├── setCompliance(authority, enabled)           # NEW — toggle compliance
    ├── pause(pauser) / unpause(pauser)
    ├── freezeAccount(freezer, ata) / thawAccount(freezer, ata)
    ├── seize(seizer, targetAta, treasuryAta, amount)
    ├── transferAuthority(authority, new) / acceptAuthority(new)
    ├── fetchConfig() / fetchMinterInfo(minter)
    ├── refresh() / getState()
    └── getRolePda(grantee, role) / getMinterInfoPda(minter)
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

### Auto-init SSS-Core

When `ssCoreProgramId` is provided in `CreateOptions`, `create()` automatically initializes the SSS-Core `StablecoinConfig` PDA after deploying the mint. For SSS-2 preset, `compliance_enabled` is set to `true` automatically.

```typescript
const coreProgramId = new PublicKey("4ZFzYcNVDSew79hSAVRdtDuMqe9g4vYh7CFvitPSy5DD");

const stablecoin = await SolanaStablecoin.create(connection, {
  preset: Presets.SSS_2,
  name: "Full Stack Dollar",
  symbol: "FSUSD",
  decimals: 6,
  authority: adminKeypair,
  ssCoreProgramId: coreProgramId,     // triggers auto-init
  supplyCap: 1_000_000_000_000n,      // optional supply cap
  extensions: {
    transferHook: {
      programId: hookProgramId,
    },
  },
});

// stablecoin.core is immediately available
console.log("Core state:", stablecoin.core.getState());
```

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

For SSS-Core RBAC operations, also pass the core program ID:

```typescript
const stablecoin = SolanaStablecoin.load(connection, {
  mint: new PublicKey("7NDka..."),
  ssCoreProgramId: new PublicKey("Abc1..."),
});
// stablecoin.core is now available
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

### Seize (Permanent Delegate)

Seize tokens from a frozen account using burn+mint (requires permanent delegate + freeze authority):

```typescript
const ata = getAssociatedTokenAddressSync(stablecoin.mint, targetWallet, false, stablecoin.tokenProgramId);
await stablecoin.seize({
  targetTokenAccount: ata,
  treasury: treasuryPubkey,
  amount: 1_000_000n,
  authority: adminKeypair,
});
```

Executes atomically: thaw → burn → mint to treasury → re-freeze.

### Transfer (SSS-2)

For SSS-2 tokens, use `transfer()` to automatically resolve extra accounts for the hook:

```typescript
await stablecoin.transfer({
  owner: senderKeypair,
  destination: recipientPublicKey,
  amount: 1_000_000n,
  decimals: 6,
});
```

### Build unsigned transactions (wallet adapter)

For browser environments where the wallet signs:

```typescript
const tx = await stablecoin.buildMintTransaction(payerPubkey, recipientPubkey, 1_000_000n);
const tx2 = await stablecoin.buildTransferTransaction(ownerPubkey, destPubkey, 500_000n, 6);
const tx3 = stablecoin.buildBurnTransaction(ownerPubkey, 250_000n);
const tx4 = stablecoin.buildFreezeTransaction(tokenAccount, freezeAuthority);
const tx5 = stablecoin.buildThawTransaction(tokenAccount, freezeAuthority);
const tx6 = await stablecoin.buildSeizeTransaction(authority, targetAta, treasury, 100_000n);
// Sign with wallet adapter, then send
```

### Batch operations

Bundle multiple operations into a single transaction:

```typescript
// Batch mint to multiple recipients in one tx
const sig = await stablecoin.batchMint(minterKeypair, [
  { recipient: wallet1, amount: 1_000_000n },
  { recipient: wallet2, amount: 2_000_000n },
]);

// Batch freeze (returns unsigned Transaction for wallet adapter)
const freezeTx = stablecoin.batchFreeze(authorityPubkey, [ata1, ata2, ata3]);

// Batch thaw
const thawTx = stablecoin.batchThaw(authorityPubkey, [ata1, ata2, ata3]);
```

---

## Read operations

Read operations send **no transactions**; they only query on-chain state.

### Get supply

```typescript
const supply = await stablecoin.getSupply();
// { raw: 10000000n, uiAmount: 10, uiAmountString: "10.000000", decimals: 6 }
```

> **Precision note**: `uiAmount` is a JavaScript `number` and loses precision for amounts > 2^53 (~9B tokens at 6 decimals). Always use `uiAmountString` for display and `raw` for arithmetic. `uiAmount` is **deprecated** and will be removed in a future major version.

### Get balance

```typescript
const balance = await stablecoin.getBalance(walletPublicKey);
// { raw: 5000000n, uiAmount: 5, uiAmountString: "5.000000", ata: PublicKey, exists: true }
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
  "OFAC SDN",         // reason (optional)
);
```

### Remove from blacklist

```typescript
const sig = await stablecoin.compliance.blacklistRemove(
  walletToUnblock,
  blacklistAdmin,
);
```

### Close blacklist entry (reclaim rent)

```typescript
const sig = await stablecoin.compliance.closeBlacklistEntry(
  wallet,           // must be unblocked first
  blacklistAdmin,
);
```

### Check blacklist status

```typescript
const status = await stablecoin.compliance.isBlacklisted(walletPublicKey);
// { wallet, pda, blocked: true }
```

This is read-only -- no transaction is sent. Missing PDAs (wallet never blacklisted) return `blocked: false`.

### Two-step admin transfer

```typescript
// Current admin nominates new admin
await stablecoin.compliance.transferAdmin(newAdminPubkey, currentAdmin);

// New admin accepts
await stablecoin.compliance.acceptAdmin(newAdminKeypair);
```

### PDA helpers

Standalone exports for custom transaction building:

```typescript
import { getConfigAddress, getBlacklistAddress, getExtraAccountMetasAddress } from "sss-token-sdk";

const [configPda, bump] = getConfigAddress(mint, hookProgramId);
const [blacklistPda] = getBlacklistAddress(mint, wallet, hookProgramId);
```

Instance helpers:

```typescript
stablecoin.compliance.getConfigPda();
stablecoin.compliance.getBlacklistPda(wallet);
stablecoin.compliance.getExtraAccountMetasPda();
```

---

## SSS-Core program (RBAC, quotas, seize)

The `core` property is available when a `ssCoreProgramId` is configured via `load`. It provides on-chain RBAC, per-minter quotas, supply caps, and protocol-level pause.

```typescript
const stablecoin = SolanaStablecoin.load(connection, {
  mint: mintPubkey,
  ssCoreProgramId: coreProgramId,
});

if (!stablecoin.core) throw new Error("No core program configured");
```

### Initialize

```typescript
await stablecoin.core.initialize(authority, 0 /* preset */, 1_000_000_000n /* supply cap */);
```

### Role management

```typescript
import { ROLE_MINTER, ROLE_BURNER, ROLE_FREEZER, ROLE_PAUSER, ROLE_SEIZER } from "sss-token-sdk";

await stablecoin.core.grantRole(authority, minterPubkey, ROLE_MINTER);
await stablecoin.core.setMinterQuota(authority, minterPubkey, 500_000_000n);
await stablecoin.core.revokeRole(authority, minterPubkey, ROLE_MINTER);
```

### RBAC-gated operations

```typescript
// Pass recipientBlacklistEntry when compliance is enabled; omit for SSS-1
await stablecoin.core.mintTokens(minterKeypair, recipientAta, 100_000n, recipientBlacklistEntryPda);
await stablecoin.core.burnTokens(burnerKeypair, burnerAta, 50_000n);
await stablecoin.core.burnFrom(burnerKeypair, targetAta, 50_000n); // burn from any account
await stablecoin.core.freezeAccount(freezerKeypair, targetAta);
await stablecoin.core.thawAccount(freezerKeypair, targetAta);
await stablecoin.core.seize(seizerKeypair, targetAta, treasuryAta, 100_000n);
await stablecoin.core.pause(pauserKeypair);
await stablecoin.core.unpause(pauserKeypair);
```

### Update metadata

Update on-mint metadata fields (name, symbol, uri) via the authority:

```typescript
await stablecoin.core.updateMetadata(authorityKeypair, "name", "New Token Name");
await stablecoin.core.updateMetadata(authorityKeypair, "symbol", "NTOK");
await stablecoin.core.updateMetadata(authorityKeypair, "uri", "https://example.com/metadata.json");
```

### Toggle compliance

Enable or disable compliance enforcement (blacklist checks on mint):

```typescript
await stablecoin.core.setCompliance(authorityKeypair, true);  // enable
await stablecoin.core.setCompliance(authorityKeypair, false); // disable
```

### Burn from (permanent delegate)

Unlike `burnTokens` (burns from the burner's own ATA), `burnFrom` uses the permanent delegate to burn from **any** holder's account. Requires `ROLE_BURNER`.

```typescript
await stablecoin.core.burnFrom(burnerKeypair, targetAta, 100_000n);
```

### State caching

```typescript
await stablecoin.core.refresh();
const config = stablecoin.core.getState();
// { authority, pendingAuthority, mint, transferHookProgram, preset, paused, complianceEnabled,
//   totalMinted, totalBurned, totalSeized, supplyCap, bump }

const minterInfo = await stablecoin.core.fetchMinterInfo(minterPubkey);
// { config, minter, quota, totalMinted, isActive, bump }
```

### Two-step authority transfer

```typescript
await stablecoin.core.transferAuthority(currentAdmin, newAdminPubkey);
await stablecoin.core.acceptAuthority(newAdminKeypair);
```

### PDA helpers

Standalone exports:

```typescript
import { getSssConfigAddress, getRoleAddress, getMinterInfoAddress } from "sss-token-sdk";

const [configPda] = getSssConfigAddress(mint, coreProgramId);
const [rolePda] = getRoleAddress(configPda, grantee, ROLE_MINTER, coreProgramId);
const [minterPda] = getMinterInfoAddress(configPda, minter, coreProgramId);
```

Instance helpers:

```typescript
stablecoin.core.getRolePda(grantee, ROLE_MINTER);
stablecoin.core.getMinterInfoPda(minter);
```

---

## Refresh / getState (vault standard pattern)

Cache on-chain state to avoid redundant RPC calls:

```typescript
await stablecoin.refresh(); // fetches mint info + core config
const state = stablecoin.getState();
// { mint, supply: SupplyInfo, mintAuthority, freezeAuthority }
```

If `core` is configured, `refresh()` also updates `stablecoin.core.getState()`.

---

## Full API reference

### `SolanaStablecoin`

| Property | Type | Description |
|----------|------|-------------|
| `connection` | `Connection` | Solana RPC connection. |
| `mint` | `PublicKey` | On-chain mint address. |
| `tokenProgramId` | `PublicKey` | Token program (TOKEN_2022 or legacy). |
| `compliance` | `Compliance \| null` | Blacklist operations (SSS-2 only). |
| `core` | `SssCoreClient \| null` | RBAC / quotas / seize (SSS-Core). |

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
| `ssCoreProgramId` | `PublicKey?` | `null` | When set, auto-initializes SSS-Core config PDA after deployment. |
| `supplyCap` | `bigint?` | `null` | Optional supply cap for SSS-Core (requires `ssCoreProgramId`). |

### `ExtensionsConfig`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `metadata` | `boolean` | `true` | On-mint metadata. |
| `pausable` | `boolean` | `false` | Pausable extension. |
| `permanentDelegate` | `boolean` | `false` | Permanent delegate. |
| `transferHook` | `boolean \| TransferHookConfig` | `false` | Transfer hook. `true` requires a config. |
| `defaultAccountStateFrozen` | `boolean` | `false` | DefaultAccountState extension — new token accounts are created frozen. |

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
| `ssCoreProgramId` | `PublicKey?` | `null` | SSS-Core program (for RBAC). |

### Return types

| Type | Fields |
|------|--------|
| `SupplyInfo` | `raw: bigint`, `uiAmount: number`, `uiAmountString: string`, `decimals: number` |
| `BalanceInfo` | `raw: bigint`, `uiAmount: number`, `uiAmountString: string`, `ata: PublicKey`, `exists: boolean` |
| `TokenStatus` | `mint: PublicKey`, `supply: SupplyInfo`, `mintAuthority`, `freezeAuthority` |
| `AuditLogEntry` | `signature: string`, `slot: number`, `err: unknown`, `blockTime: Date \| null` |
| `BlacklistStatus` | `wallet: PublicKey`, `pda: PublicKey`, `blocked: boolean`, `reason?: string` |

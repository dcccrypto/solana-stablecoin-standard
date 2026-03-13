# SDK Reference

The `sss-token-sdk` package provides a TypeScript API for deploying and managing Solana Stablecoin Standard tokens. It works in Node.js and in the browser (when paired with a wallet adapter).

## Installation

```bash
npm install sss-token-sdk @solana/web3.js @solana/spl-token
```

## Presets

The `Presets` enum defines the two compliance levels:

```typescript
import { Presets } from "sss-token-sdk";

Presets.SSS_1  // "sss-1" — minimal stablecoin (metadata only)
Presets.SSS_2  // "sss-2" — compliant stablecoin (metadata + transfer hook blacklist)
```

### SSS-1 Deployment

```typescript
import { Connection, Keypair } from "@solana/web3.js";
import { SolanaStablecoin, Presets } from "sss-token-sdk";

const connection = new Connection("https://api.devnet.solana.com", "confirmed");
const authority = Keypair.fromSecretKey(/* your secret key */);

const stable = await SolanaStablecoin.create(connection, {
  preset: Presets.SSS_1,
  name: "US Dollar Stablecoin",
  symbol: "USDS",
  decimals: 6,
  authority,
});

console.log("Mint deployed:", stable.mint.toBase58());
console.log("Compliance:", stable.compliance); // null for SSS-1
```

### SSS-2 Deployment

SSS-2 requires a deployed blacklist transfer hook program.

```typescript
import { PublicKey } from "@solana/web3.js";

const hookProgramId = new PublicKey("84rPjkmmoP3oYZVxjtL2rdcT6hC5Rts6N5XzJTFcJEk6");

const compliant = await SolanaStablecoin.create(connection, {
  preset: Presets.SSS_2,
  name: "Regulated Dollar",
  symbol: "RGUSD",
  decimals: 6,
  authority,
  extensions: {
    transferHook: {
      programId: hookProgramId,
      admin: authority, // optional, defaults to authority
    },
  },
});

console.log("Compliance module:", compliant.compliance); // Compliance instance
```

### Custom Configuration

You can skip presets entirely and configure extensions individually:

```typescript
const custom = await SolanaStablecoin.create(connection, {
  name: "Custom Stable",
  symbol: "CUSD",
  decimals: 9,
  authority,
  freezeAuthority: separateFreezeKeypair,
  metadataAuthority: metadataKeypair.publicKey,
  uri: "https://example.com/metadata.json",
  extensions: {
    metadata: true,           // default: true
    pausable: false,          // default: false
    permanentDelegate: false, // default: false
    transferHook: false,      // default: false
  },
});
```

## Loading an Existing Mint

```typescript
const stable = SolanaStablecoin.load(connection, {
  mint: new PublicKey("7NDka..."),
  tokenProgramId: TOKEN_2022_PROGRAM_ID,         // optional, defaults to Token-2022
  transferHookProgramId: new PublicKey("84rPj..."), // optional, enables compliance
});
```

## Token Operations

All write operations return a transaction signature string.

### Mint Tokens

```typescript
const sig = await stable.mintTokens({
  recipient: new PublicKey("Dkvvh..."),
  amount: 1_000_000n,  // raw units (1 USDS with 6 decimals)
  minter: authority,    // must be the mint authority
});
```

The ATA is created automatically if it doesn't exist.

### Burn Tokens

```typescript
const sig = await stable.burn({
  amount: 500_000n,
  owner: authority,       // burns from owner's ATA
  // tokenAccount: ...,   // optional: burn from a specific account
});
```

### Freeze / Thaw

```typescript
const ata = getAssociatedTokenAddressSync(stable.mint, wallet, false, stable.tokenProgramId);

await stable.freeze({ tokenAccount: ata, freezeAuthority: authority });
await stable.thaw({ tokenAccount: ata, freezeAuthority: authority });
```

### Pause / Unpause

Requires the Pausable extension to be enabled on the mint.

```typescript
await stable.pause(authority);
await stable.unpause(authority);
```

### Set Authority

```typescript
await stable.setAuthority({
  type: "freeze",                        // see AuthorityKind
  currentAuthority: authority,
  newAuthority: newFreezeKeypair.publicKey, // or null to revoke
});
```

Supported `AuthorityKind` values: `"mint"`, `"freeze"`, `"metadata"`, `"metadata-pointer"`, `"pause"`, `"permanent-delegate"`, `"close-mint"`, `"interest-rate"`.

## Read Operations

### Supply

```typescript
const supply = await stable.getSupply();
// { raw: 1000000n, uiAmount: 1.0, decimals: 6 }
```

### Balance

```typescript
const balance = await stable.getBalance(walletPubkey);
// { raw: 500000n, uiAmount: 0.5, ata: PublicKey, exists: true }
```

### Status

```typescript
const status = await stable.getStatus();
// { mint: PublicKey, supply: SupplyInfo, mintAuthority: PublicKey|null, freezeAuthority: PublicKey|null }
```

### Audit Log

```typescript
const log = await stable.getAuditLog(50);
// Array of { signature, slot, err, blockTime: Date|null }
```

## Compliance Module (SSS-2)

The `compliance` property is `null` for SSS-1 tokens and a `Compliance` instance for SSS-2.

### Initialize Hook

Called automatically during `SolanaStablecoin.create()` for SSS-2. If you need to do it manually:

```typescript
await stable.compliance.initializeHook(adminKeypair);
```

This creates the Config PDA and ExtraAccountMetaList PDA on-chain.

### Blacklist Operations

```typescript
// Add to blacklist
await stable.compliance.blacklistAdd(walletPubkey, adminKeypair);

// Remove from blacklist
await stable.compliance.blacklistRemove(walletPubkey, adminKeypair);

// Check status (read-only, no signing needed)
const status = await stable.compliance.isBlacklisted(walletPubkey);
// { wallet: PublicKey, pda: PublicKey, blocked: boolean }
```

### PDA Helpers

```typescript
const configPda = stable.compliance.getConfigPda();
const blacklistPda = stable.compliance.getBlacklistPda(walletPubkey);
const extraMetasPda = stable.compliance.getExtraAccountMetasPda();
```

## Type Reference

```typescript
interface CreateOptions {
  preset?: Presets;
  name: string;
  symbol: string;
  decimals?: number;              // default: 6
  uri?: string;
  authority: Keypair;
  freezeAuthority?: Keypair | PublicKey;
  metadataAuthority?: Keypair | PublicKey;
  extensions?: ExtensionsConfig;
}

interface LoadOptions {
  mint: PublicKey;
  tokenProgramId?: PublicKey;     // default: TOKEN_2022_PROGRAM_ID
  transferHookProgramId?: PublicKey;
}

interface MintOptions      { recipient: PublicKey; amount: bigint; minter: Keypair; }
interface BurnOptions      { amount: bigint; owner: Keypair; tokenAccount?: PublicKey; }
interface FreezeOptions    { tokenAccount: PublicKey; freezeAuthority: Keypair; }
interface ThawOptions      { tokenAccount: PublicKey; freezeAuthority: Keypair; }
interface SetAuthorityOptions { type: AuthorityKind; currentAuthority: Keypair; newAuthority: PublicKey | null; }
interface SupplyInfo       { raw: bigint; uiAmount: number; decimals: number; }
interface BalanceInfo      { raw: bigint; uiAmount: number; ata: PublicKey; exists: boolean; }
interface TokenStatus      { mint: PublicKey; supply: SupplyInfo; mintAuthority: PublicKey | null; freezeAuthority: PublicKey | null; }
interface AuditLogEntry    { signature: string; slot: number; err: unknown; blockTime: Date | null; }
interface BlacklistStatus  { wallet: PublicKey; pda: PublicKey; blocked: boolean; }
```

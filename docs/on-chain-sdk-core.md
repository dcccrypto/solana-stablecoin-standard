# SSS — On-Chain SDK: Core Methods

> **Class:** `SolanaStablecoin` (`sdk/src/SolanaStablecoin.ts`)

---

## Overview

`SolanaStablecoin` is the primary TypeScript entry point for interacting with a deployed `sss-token` program on Solana. It wraps all on-chain operations — minting, burning, account freezing, supply queries — and exposes them as typed async methods that resolve to a `TransactionSignature`.

This document covers the **core lifecycle methods**: creating a stablecoin, loading an existing one, minting, burning, freezing/thawing, and querying supply. For admin and governance methods (`pause`, `unpause`, `updateMinter`, `revokeMinter`, `updateRoles`), see [on-chain-sdk-admin.md](./on-chain-sdk-admin.md).

All methods:
- Require a configured `AnchorProvider` with a funded wallet
- Return `Promise<TransactionSignature>` at `confirmed` commitment
- Use **Token-2022** (`TOKEN_2022_PROGRAM_ID`) for all SPL token operations

---

## Installation

```bash
npm install @stbr/sss-token
```

---

## Imports

```typescript
import { SolanaStablecoin, SSS_TOKEN_PROGRAM_ID, SSS_TRANSFER_HOOK_PROGRAM_ID } from '@stbr/sss-token';
import { AnchorProvider, Wallet } from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
```

---

## Setup

### Provider

All SDK methods require an `AnchorProvider`. The provider supplies the connection and the signer wallet.

```typescript
const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
const wallet = new Wallet(Keypair.fromSecretKey(/* your key bytes */));
const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' });
```

---

## Creating a Stablecoin

### `SolanaStablecoin.create(provider, config, options?)`

Creates and initialises a new stablecoin mint on-chain. This is the primary entry point for launching a new token.

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `provider` | `AnchorProvider` | Anchor provider (connection + signer) |
| `config` | `SssConfig` | Stablecoin configuration (see below) |
| `options.programId` | `PublicKey?` | Override the sss-token program ID (defaults to devnet/localnet ID) |

**`SssConfig` fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `preset` | `'SSS-1' \| 'SSS-2' \| 'SSS-3'` | ✓ | Token standard preset |
| `name` | `string` | ✓ | Token name (e.g. `"USD Stable"`) |
| `symbol` | `string` | ✓ | Token symbol (e.g. `"USDS"`) |
| `decimals` | `number` | | Token decimals (default: `6`) |
| `uri` | `string` | | Metadata URI |
| `transferHookProgram` | `PublicKey` | SSS-2 only | Transfer hook program ID for compliance enforcement |
| `collateralMint` | `PublicKey \| null` | SSS-3 only | Mint of the collateral token (e.g. USDC mint address) |
| `reserveVault` | `PublicKey \| null` | SSS-3 only | Reserve vault token account address (PDA-owned) |
| `squads_multisig` | `PublicKey` | SSS-3 only (required) | Squads multisig pubkey for upgrade/admin authority — **must be non-default** (see SSS-147A) |
| `maxSupply` | `bigint \| null` | SSS-3 only (required) | Hard supply cap in base units — **must be > 0** (see SSS-147B) |

> **⚠️ SSS-147A enforcement (on-chain):** For the **SSS-3 preset**, `initialize` rejects if `squads_multisig` is `null`, `undefined`, or `PublicKey.default()` (all-zero key). The program returns `RequiresSquadsForSSS3` in this case. `FLAG_SQUADS_AUTHORITY` is automatically set when a valid pubkey is provided.
>
> **⚠️ SSS-147B enforcement (on-chain):** For the **SSS-3 preset**, `initialize` rejects if `maxSupply` is `0n` or omitted. The program returns `RequiresMaxSupplyForSSS3`.

**Returns:** `Promise<SolanaStablecoin>`

**Example — SSS-1 (minimal preset):**

```typescript
const stablecoin = await SolanaStablecoin.create(provider, {
  preset: 'SSS-1',
  name: 'My Stable',
  symbol: 'MST',
  decimals: 6,
});

console.log('Mint address:', stablecoin.mint.toBase58());
console.log('Config PDA:', stablecoin.configPda.toBase58());
```

**Example — SSS-2 (compliant preset with transfer hook):**

```typescript
const stablecoin = await SolanaStablecoin.create(provider, {
  preset: 'SSS-2',
  name: 'USD Stable',
  symbol: 'USDS',
  decimals: 6,
  transferHookProgram: SSS_TRANSFER_HOOK_PROGRAM_ID,
});
```

**Example — SSS-3 (reserve-backed, trust-minimized preset):**

```typescript
import { PublicKey } from '@solana/web3.js';

// SSS-147A: squads_multisig is REQUIRED for SSS-3. Omitting it or passing
// PublicKey.default() will throw RequiresSquadsForSSS3 on-chain.
const SQUADS_MULTISIG = new PublicKey('SQDSxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');

// SSS-147B: maxSupply is REQUIRED for SSS-3 (> 0). Omitting it or passing 0n
// will throw RequiresMaxSupplyForSSS3 on-chain.
const MAX_SUPPLY = 100_000_000_000_000n; // 100 million USDR (6 decimals)

const stablecoin = await SolanaStablecoin.create(provider, {
  preset: 'SSS-3',
  name: 'USD Reserve',
  symbol: 'USDR',
  decimals: 6,
  collateralMint: USDC_MINT,
  reserveVault: reserveVaultPda,
  squads_multisig: SQUADS_MULTISIG,
  maxSupply: MAX_SUPPLY,
});

console.log('Mint address:', stablecoin.mint.toBase58());
// FLAG_SQUADS_AUTHORITY is auto-set; all admin ops now require Squads approval.
```

---

## Loading an Existing Stablecoin

### `SolanaStablecoin.load(provider, mint, config, options?)`

Loads an already-deployed stablecoin by its mint address. Use this when you know the mint public key and want to interact with an existing token.

**Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `provider` | `AnchorProvider` | Anchor provider |
| `mint` | `PublicKey` | The mint public key of the existing stablecoin |
| `config` | `SssConfig` | Configuration describing the stablecoin |
| `options.programId` | `PublicKey?` | Override program ID |

**Returns:** `Promise<SolanaStablecoin>`

**Example:**

```typescript
const mintAddress = new PublicKey('AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat');

const stablecoin = await SolanaStablecoin.load(provider, mintAddress, {
  preset: 'SSS-1',
  name: 'My Stable',
  symbol: 'MST',
});
```

---

## Instance Properties

Once created or loaded, `SolanaStablecoin` exposes:

| Property | Type | Description |
|----------|------|-------------|
| `provider` | `AnchorProvider` | The provider used to construct this instance |
| `mint` | `PublicKey` | The Token-2022 mint address |
| `config` | `SssConfig` | The stablecoin configuration |
| `configPda` | `PublicKey` | The on-chain config PDA (`[b"stablecoin-config", mint]`) |

---

## Minting

### `mintTo(params)`

Mints tokens to a recipient, creating their Associated Token Account (ATA) if it does not yet exist. The provider wallet must be authorised as a minter (see [on-chain-sdk-admin.md](./on-chain-sdk-admin.md#updateminterparams) for registration).

**Parameters (`MintParams`):**

| Field | Type | Description |
|-------|------|-------------|
| `mint` | `PublicKey` | The stablecoin mint |
| `amount` | `bigint` | Amount in base units (e.g. `1_000_000n` = 1 token at 6 decimals) |
| `recipient` | `PublicKey` | Recipient wallet public key |

**Returns:** `Promise<TransactionSignature>`

**Example:**

```typescript
const sig = await stablecoin.mintTo({
  mint: stablecoin.mint,
  amount: 1_000_000n,        // 1 USDS (6 decimals)
  recipient: recipientKey,
});
console.log('Mint tx:', sig);
```

**Notes:**
- `getOrCreateAssociatedTokenAccount` is called automatically; the payer is the provider wallet.
- Minting to a frozen ATA will fail with a `TokenAccountFrozen` error.
- Minting while the protocol is paused returns `MintPaused` (on-chain error).
- Minting beyond the authorised cap returns `MintCapExceeded` (on-chain error).

---

## Burning

### `burnFrom(params)`

Burns tokens from a source token account. The provider wallet must be the owner of the source account.

**Parameters (`BurnParams`):**

| Field | Type | Description |
|-------|------|-------------|
| `mint` | `PublicKey` | The stablecoin mint |
| `amount` | `bigint` | Amount in base units to burn |
| `source` | `PublicKey` | Token account address to burn from (not wallet address) |

**Returns:** `Promise<TransactionSignature>`

**Example:**

```typescript
// source is the ATA, not the wallet
const sourceAta = getAssociatedTokenAddressSync(stablecoin.mint, walletKey, false, TOKEN_2022_PROGRAM_ID);

const sig = await stablecoin.burnFrom({
  mint: stablecoin.mint,
  amount: 500_000n,    // 0.5 USDS
  source: sourceAta,
});
console.log('Burn tx:', sig);
```

> **Note:** Pass the token account address (ATA), not the wallet address. Use `getAssociatedTokenAddressSync` from `@solana/spl-token` to derive it.

---

## Compliance: Freeze / Thaw

Freezing and thawing are compliance actions performed by the freeze authority (set during `initialize`). A frozen account cannot send or receive tokens.

### `freeze(params)`

Freezes a token account, blocking transfers in and out.

**Parameters (`FreezeParams`):**

| Field | Type | Description |
|-------|------|-------------|
| `mint` | `PublicKey` | The stablecoin mint |
| `targetTokenAccount` | `PublicKey` | The token account to freeze |

**Returns:** `Promise<TransactionSignature>`

**Example:**

```typescript
const sig = await stablecoin.freeze({
  mint: stablecoin.mint,
  targetTokenAccount: suspiciousAta,
});
console.log('Freeze tx:', sig);
```

---

### `thaw(params)`

Thaws a previously frozen token account, restoring normal transfer ability.

**Parameters:** Same as `freeze` — `FreezeParams`.

**Returns:** `Promise<TransactionSignature>`

**Example:**

```typescript
const sig = await stablecoin.thaw({
  mint: stablecoin.mint,
  targetTokenAccount: rehabilitatedAta,
});
console.log('Thaw tx:', sig);
```

---

## Supply Query

### `getTotalSupply()`

Returns the current supply figures for this mint. As of **SSS-016**, supply data is read from the on-chain **`StablecoinConfig` PDA** — the same account that `mintTo()` and `burnFrom()` update transactionally. This gives accurate cumulative `totalMinted` and `totalBurned` figures rather than just the net Token-2022 balance.

Falls back to the raw Token-2022 mint supply (with `totalBurned: 0n`) if the config account does not yet exist (e.g. unit-test environments where the program has not been initialised).

**Returns:**

```typescript
Promise<{
  totalMinted: bigint;
  totalBurned: bigint;
  circulatingSupply: bigint;
}>
```

| Field | Description |
|-------|-------------|
| `totalMinted` | Cumulative tokens minted, tracked on-chain in `StablecoinConfig.total_minted` |
| `totalBurned` | Cumulative tokens burned, tracked on-chain in `StablecoinConfig.total_burned` |
| `circulatingSupply` | `totalMinted - totalBurned` — net circulating supply |

**Example:**

```typescript
const { totalMinted, totalBurned, circulatingSupply } = await stablecoin.getTotalSupply();
console.log(`Minted: ${Number(totalMinted) / 1e6} USDS`);
console.log(`Burned: ${Number(totalBurned) / 1e6} USDS`);
console.log(`Circulating: ${Number(circulatingSupply) / 1e6} USDS`);
```

> **Note:** `totalMinted` and `totalBurned` reflect the cumulative history recorded by the `sss-token` program — they are monotonically increasing. `circulatingSupply` is the net figure. If the `StablecoinConfig` PDA is absent (pre-SSS-016 deploys or test environments), the method falls back to the Token-2022 mint supply as `circulatingSupply` with `totalBurned: 0n`.

---

## PDA Helpers

These static helpers derive on-chain addresses deterministically. They are synchronous and require no network call.

### `SolanaStablecoin.getConfigPda(mint, programId?)`

Derives the config PDA for a given mint. The config PDA stores the on-chain stablecoin state (preset, authority, paused flag, etc.).

**Seeds:** `[b"stablecoin-config", mint]`

```typescript
const [configPda, bump] = SolanaStablecoin.getConfigPda(mint);
// programId defaults to SSS_TOKEN_PROGRAM_ID
```

### `SolanaStablecoin.getMinterPda(configPda, minter, programId?)`

Derives the minter PDA for a given config PDA and minter authority.

**Seeds:** `[b"minter-info", configPda, minterAuthority]`

```typescript
const [minterPda, bump] = SolanaStablecoin.getMinterPda(configPda, minterKey);
```

---

## Program Constants

```typescript
import { SSS_TOKEN_PROGRAM_ID, SSS_TRANSFER_HOOK_PROGRAM_ID } from '@stbr/sss-token';
```

| Constant | Value | Description |
|----------|-------|-------------|
| `SSS_TOKEN_PROGRAM_ID` | `AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat` | `sss-token` program (devnet + localnet) |
| `SSS_TRANSFER_HOOK_PROGRAM_ID` | `phAtzRyRUJGpMC3ftAtWzoaX7UkghRe9x5KTig8jPQp` | Transfer hook program (SSS-2 only) |

---

## Error Handling

All methods throw a standard `Error` on failure. On-chain errors from the `sss-token` program include:

| Error | Cause |
|-------|-------|
| `MintCapExceeded` | Minter has reached their authorised cap |
| `MintPaused` | Protocol is currently paused (`pause()` was called) |
| `Unauthorized` | Caller is not the admin or freeze authority |
| `TokenAccountFrozen` | Target ATA is frozen |

```typescript
try {
  await stablecoin.mintTo({ mint: stablecoin.mint, amount: 1_000_000n, recipient });
} catch (err) {
  console.error('Mint failed:', (err as Error).message);
}
```

---

## Related

- [On-Chain SDK: Admin & Governance Methods](./on-chain-sdk-admin.md) — `pause`, `unpause`, `updateMinter`, `revokeMinter`, `updateRoles`
- [Transfer Hook Program](./transfer-hook.md) — SSS-2 compliance enforcement
- [SDK & CLI](./sdk-cli.md) — REST-based `SSSClient` for the axum backend
- [Anchor Program Tests](./anchor-program-testing.md) — End-to-end test coverage

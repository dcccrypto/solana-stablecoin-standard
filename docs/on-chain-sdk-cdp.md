# SSS — On-Chain SDK: CDP Module

> **Module:** `CdpModule` (`sdk/src/CdpModule.ts`)
> **Added:** SSS-051 / SSS-052 (Direction 2 — Multi-Collateral CDP, see SSS-049 for the Anchor program)

---

## Overview

`CdpModule` is the TypeScript SDK wrapper for the **Multi-Collateral CDP (Collateral Debt Position) system** introduced in SSS-049/SSS-051. It lets users deposit SPL token collateral and borrow SSS-3 stablecoins against it, subject to a 150% minimum collateral ratio enforced on-chain via Pyth oracle prices.

Key guarantees:
- **Collateral isolation:** each (user, collateral mint) pair has its own `CollateralVault` PDA
- **Oracle-gated borrowing:** `cdp_borrow_stable` reads a Pyth price feed on-chain; under-collateralised borrows are rejected
- **Pyth feed pinning (SSS-085):** admins can call `AdminTimelockModule.setPythFeed()` to lock the expected price-feed pubkey; once set, both `cdp_borrow_stable` and `cdp_liquidate` reject any feed account that does not match, blocking price-feed substitution attacks (FINDING-006)
- **Liquidation slippage protection (SSS-085):** `cdp_liquidate` accepts a `min_collateral_amount` parameter; pass `0` for no slippage check (backward compatible)
- **Single collateral per position:** one `CdpPosition` PDA per user; the collateral mint is locked at first borrow

---

## Installation

```bash
npm install @stbr/sss-token
```

---

## Quick Start

```ts
import { Connection, Keypair } from '@solana/web3.js';
import { AnchorProvider, Wallet } from '@coral-xyz/anchor';
import { CdpModule } from '@stbr/sss-token';

const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
const provider   = new AnchorProvider(connection, new Wallet(keypair), {});
const cdp        = new CdpModule(provider, sssMint);

// 1. Deposit collateral
await cdp.depositCollateral({
  collateralMint,
  amount: 5_000_000_000n,       // 5 SOL (lamports)
  userCollateralAccount,
  vaultTokenAccount,
});

// 2. Borrow stablecoins (≥ 150% collateral ratio required)
await cdp.borrowStable({
  collateralMint,
  amount: 1_000_000n,           // 1 USDC-equivalent
  userSssAccount,
  pythPriceFeed,
});

// 3. Inspect position health
const pos = await cdp.fetchCdpPosition(wallet.publicKey, connection, pythFeeds);
console.log(`Health factor: ${pos.healthFactor.toFixed(2)}`);
```

---

## Constructor

```ts
new CdpModule(
  provider:  AnchorProvider,
  sssMint:   PublicKey,
  programId: PublicKey = SSS_TOKEN_PROGRAM_ID,
)
```

| Parameter | Type | Description |
|---|---|---|
| `provider` | `AnchorProvider` | Anchor provider (includes wallet + connection) |
| `sssMint` | `PublicKey` | The SSS-3 stablecoin mint |
| `programId` | `PublicKey` | On-chain program ID (defaults to deployed SSS program) |

---

## Methods

### `depositCollateral`

```ts
async depositCollateral(params: DepositCollateralParams): Promise<TransactionSignature>
```

Deposits SPL token collateral into the user's `CollateralVault` PDA. Creates the vault on first deposit for this collateral mint.

**Params — `DepositCollateralParams`**

| Field | Type | Description |
|---|---|---|
| `collateralMint` | `PublicKey` | SPL token mint of the collateral to deposit |
| `amount` | `bigint` | Amount in collateral token's native units (base units) |
| `userCollateralAccount` | `PublicKey` | Sender's token account for the collateral |
| `vaultTokenAccount` | `PublicKey` | Token account owned by the `CollateralVault` PDA |
| `collateralTokenProgram` | `PublicKey?` | Token program for collateral mint (default: `TOKEN_PROGRAM_ID`) |

> **Note:** The SSS-3 mint is derived internally from `this.sssMint` (set at construction) and does not need to be passed here.

**Example**

```ts
await cdp.depositCollateral({
  collateralMint: SOL_MINT,
  amount: 2_000_000_000n,   // 2 SOL
  userCollateralAccount: userWSOLAccount,
  vaultTokenAccount: wsolVaultTokenAccount,
});
```

---

### `borrowStable`

```ts
async borrowStable(params: BorrowStableParams): Promise<TransactionSignature>
```

Borrows SSS-3 stablecoins against deposited collateral. The on-chain program reads a Pyth price feed and rejects the transaction if the resulting collateral ratio would fall below 150%.

Creates the `CdpPosition` PDA on first borrow (single collateral mint locked at this point).

**Params — `BorrowStableParams`**

| Field | Type | Description |
|---|---|---|
| `collateralMint` | `PublicKey` | Collateral mint to borrow against |
| `amount` | `bigint` | SSS tokens to borrow (base units, 6 decimals) |
| `userSssAccount` | `PublicKey` | Recipient token account for minted stablecoins |
| `pythPriceFeed` | `PublicKey` | Pyth price feed account for collateral / USD |
| `collateralTokenProgram` | `PublicKey?` | Token program for collateral (default: `TOKEN_2022_PROGRAM_ID`) |

> **Note:** The SSS-3 mint is derived internally from `this.sssMint` (set at construction) and does not need to be passed here.

**Example**

```ts
const SOL_USD_PYTH = new PublicKey('J83w4HKfqxwcq3BEMMkPFSppX3gqekLyLJBexebFVkix');

await cdp.borrowStable({
  collateralMint: SOL_MINT,
  amount: 500_000n,          // 0.5 USDC-equivalent
  userSssAccount,
  pythPriceFeed: SOL_USD_PYTH,
});
```

> **Note:** The collateral mint is locked at first borrow. Attempting to borrow again against a different collateral mint will be rejected on-chain.

---

### `repayStable`

```ts
async repayStable(params: RepayStableParams): Promise<TransactionSignature>
```

Burns SSS-3 stablecoins to repay debt. Collateral is released proportionally from the vault back to the user.

**Params — `RepayStableParams`**

| Field | Type | Description |
|---|---|---|
| `collateralMint` | `PublicKey` | Collateral mint associated with the debt |
| `amount` | `bigint` | SSS tokens to repay (base units) |
| `userSssAccount` | `PublicKey` | User's token account to burn from |
| `vaultTokenAccount` | `PublicKey` | Vault's token account that holds collateral |
| `userCollateralAccount` | `PublicKey` | User's token account to receive released collateral |
| `collateralTokenProgram` | `PublicKey?` | Token program for collateral (default: `TOKEN_PROGRAM_ID`) |

> **Note:** The SSS-3 mint is derived internally from `this.sssMint` (set at construction) and does not need to be passed here.

**Example**

```ts
await cdp.repayStable({
  collateralMint: SOL_MINT,
  amount: 250_000n,          // repay 0.25 USDC-equivalent
  userSssAccount,
  vaultTokenAccount: wsolVaultTokenAccount,
  userCollateralAccount: userWSOLAccount,
});
```

---

### `getPosition`

```ts
async getPosition(
  wallet:               PublicKey,
  connection:           Connection,
  collateralMints?:     PublicKey[],
  collateralUsdPrices?: Map<string, number>,
): Promise<CdpPosition>
```

Fetches the on-chain `CdpPosition` and all `CollateralVault` PDAs for a wallet. Health metrics are computed client-side from the optional price map.

> **Prefer `fetchCdpPosition`** for production use — it auto-discovers vaults and pulls live Pyth prices in one call.

**Parameters**

| Parameter | Type | Description |
|---|---|---|
| `wallet` | `PublicKey` | Wallet to query |
| `connection` | `Connection` | Solana RPC connection |
| `collateralMints` | `PublicKey[]?` | Mints to check vaults for. If omitted, collateral entries are empty; when debt is also 0, `ratio` and `healthFactor` are `Infinity`; when debt > 0 they are `0`. |
| `collateralUsdPrices` | `Map<string, number>?` | Mint (base58) → USD price **per whole token unit** (e.g. `200` for $200/SOL). The SDK divides `deposited` by 1e6 before multiplying by this price. |

---

### `fetchCdpPosition`

```ts
async fetchCdpPosition(
  wallet:     PublicKey,
  connection: Connection,
  pythFeeds?: Map<string, PublicKey>,
): Promise<CdpPosition>
```

Full position fetch with automatic vault discovery and live Pyth oracle prices. Recommended over `getPosition` for most use cases.

**Parameters**

| Parameter | Type | Description |
|---|---|---|
| `wallet` | `PublicKey` | Wallet to query |
| `connection` | `Connection` | Solana RPC connection |
| `pythFeeds` | `Map<string, PublicKey>?` | Collateral mint (base58) → Pyth price feed `PublicKey` |

**Example**

```ts
const pythFeeds = new Map([
  [SOL_MINT.toBase58(), SOL_USD_PYTH_FEED],
]);

const pos = await cdp.fetchCdpPosition(
  wallet.publicKey,
  connection,
  pythFeeds,
);

console.log(`Debt:          ${pos.debtUsdc} USDC`);
console.log(`Health factor: ${pos.healthFactor.toFixed(2)}`);
console.log(`Liq. price:    $${pos.liquidationPrice.toFixed(2)}`);
```

---

### `fetchCollateralTypes`

```ts
async fetchCollateralTypes(
  connection: Connection,
  pythFeeds?: Map<string, PublicKey>,
): Promise<CollateralType[]>
```

Enumerates all distinct collateral mints currently in use across all CDP positions by scanning `CollateralVault` PDAs on-chain. Mirrors the `GET /api/cdp/collateral-types` backend endpoint.

**Parameters**

| Parameter | Type | Description |
|---|---|---|
| `connection` | `Connection` | Solana RPC connection |
| `pythFeeds` | `Map<string, PublicKey>?` | Optional price feeds for each collateral mint |

**Example**

```ts
const types = await cdp.fetchCollateralTypes(connection, pythFeeds);
for (const ct of types) {
  console.log(`${ct.mint.toBase58()}: ${ct.activeVaults} vaults, $${ct.usdPrice}`);
}
```

---

## PDA Utilities

```ts
cdp.getCollateralVaultPda(user: PublicKey, collateralMint: PublicKey): PublicKey
cdp.getCdpPositionPda(user: PublicKey): PublicKey
```

Derives on-chain PDA addresses client-side for use in manual account queries or transaction construction.

| Method | Seeds |
|---|---|
| `getCollateralVaultPda` | `["cdp-collateral-vault", sssMint, user, collateralMint]` |
| `getCdpPositionPda` | `["cdp-position", sssMint, user]` |

---

## Types

### `CdpPosition`

```ts
interface CdpPosition {
  owner:            PublicKey;
  collateral:       CollateralEntry[];
  debtUsdc:         number;         // outstanding debt in USDC-equivalent (6 dec)
  ratio:            number;         // collateral value / debt; Infinity when debt = 0
  healthFactor:     number;         // collateral_usd / (debt_usd × 1.2); < 1 = liquidatable
  liquidationPrice: number;         // USD price at which position becomes liquidatable
}
```

| Field | Description |
|---|---|
| `debtUsdc` | Outstanding SSS debt in human-readable USDC-equivalent |
| `ratio` | `totalCollateralUsd / debtUsdc`; minimum safe value is 1.5 (150%) |
| `healthFactor` | `totalCollateralUsd / (debtUsdc × 1.2)`; position liquidatable when `< 1.0` |
| `liquidationPrice` | Spot price (USD) at which the first collateral entry reaches the liquidation threshold |

### `CollateralEntry`

```ts
interface CollateralEntry {
  mint:               PublicKey;
  deposited:          bigint;       // native units deposited in vault
  vaultPda:           PublicKey;
  vaultTokenAccount:  PublicKey;
}
```

### `CollateralType`

```ts
interface CollateralType {
  mint:           PublicKey;
  activeVaults:   number;
  totalDeposited: bigint;
  usdPrice?:      number;
  pythPriceFeed?: PublicKey;
}
```

---

## Risk Parameters

| Parameter | Value |
|---|---|
| Minimum collateral ratio | 150% (15,000 bps) |
| Liquidation threshold | 120% (12,000 bps) |
| SSS decimals | 6 |

Positions with a collateral ratio below 150% cannot open new borrows. Positions whose collateral ratio falls below 120% become liquidatable.

---

## Error Reference

Errors originate from the on-chain Anchor program. Common causes:

| Error | Cause |
|---|---|
| `InsufficientCollateral` | Resulting collateral ratio would be < 150% after borrow |
| `CollateralMintLocked` | Borrow attempted with a different collateral mint than the locked one |
| `InvalidPythFeed` | Pyth price feed account doesn't match expected collateral mint |
| `StaleOraclePrice` | Pyth price is too old (confidence interval exceeded) |
| `SlippageExceeded` | `cdp_liquidate` seized collateral is less than `min_collateral_amount` (SSS-085 Fix 5; pass `0` to disable) |
| `PositionNotFound` | On-chain instruction attempted on a wallet with no open CDP position (e.g. `repayStable` before any borrow). Note: `getPosition` and `fetchCdpPosition` do **not** throw this — they return an empty `CdpPosition` when no account is found. |

---

## Backend API Counterparts

The CDP system also exposes REST endpoints (see [`api.md`](./api.md)):

| Endpoint | SDK equivalent |
|---|---|
| `GET /api/cdp/position/:wallet` | `cdp.fetchCdpPosition(wallet, connection, pythFeeds)` |
| `GET /api/cdp/collateral-types` | `cdp.fetchCollateralTypes(connection, pythFeeds)` |
| `POST /api/cdp/simulate` | client-side: compute ratio from `CollateralType.usdPrice` |

---

## End-to-End Example

```ts
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { AnchorProvider, Wallet } from '@coral-xyz/anchor';
import { CdpModule } from '@stbr/sss-token';

const SOL_MINT     = new PublicKey('So11111111111111111111111111111111111111112');
const SOL_USD_PYTH = new PublicKey('J83w4HKfqxwcq3BEMMkPFSppX3gqekLyLJBexebFVkix');

async function main() {
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  const provider   = new AnchorProvider(connection, new Wallet(keypair), {});
  const cdp        = new CdpModule(provider, SSS_MINT);

  // Deposit 5 SOL of collateral
  await cdp.depositCollateral({
    collateralMint:       SOL_MINT,
    amount:               5_000_000_000n,  // 5 SOL in lamports
    userCollateralAccount: userWSOLAccount,
    vaultTokenAccount:    wsolVaultTokenAccount,
  });

  // Borrow 500 USDC-equivalent (≈ 50% utilisation at $200/SOL = 1000 USD collateral)
  await cdp.borrowStable({
    collateralMint: SOL_MINT,
    amount:         500_000_000n,    // 500 USDC
    userSssAccount: userSSSAccount,
    pythPriceFeed:  SOL_USD_PYTH,
  });

  // Monitor position
  const pythFeeds = new Map([[SOL_MINT.toBase58(), SOL_USD_PYTH]]);
  const pos = await cdp.fetchCdpPosition(keypair.publicKey, connection, pythFeeds);

  console.log(`Debt:          ${pos.debtUsdc} USDC`);          // 500
  console.log(`Ratio:         ${(pos.ratio * 100).toFixed(1)}%`); // ~200%
  console.log(`Health factor: ${pos.healthFactor.toFixed(2)}`); // ~1.67
  console.log(`Liq. price:    $${pos.liquidationPrice.toFixed(2)}`);

  // Repay 250 USDC
  await cdp.repayStable({
    collateralMint:       SOL_MINT,
    amount:               250_000_000n,
    userSssAccount:       userSSSAccount,
    vaultTokenAccount:    wsolVaultTokenAccount,
    userCollateralAccount: userWSOLAccount,
  });
}

main().catch(console.error);
```

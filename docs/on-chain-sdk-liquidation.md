# SSS — On-Chain SDK: MultiCollateralLiquidationModule

> **Module:** `MultiCollateralLiquidationModule` (`sdk/src/MultiCollateralLiquidationModule.ts`)
> **Added:** SSS-100 (Anchor program) / SSS-101 (SDK)

---

## Overview

`MultiCollateralLiquidationModule` is the TypeScript SDK wrapper for the SSS-100 multi-collateral liquidation engine. It extends `cdp_liquidate` with:

- **Per-collateral configuration** — optional `CollateralConfig` PDA overrides the global liquidation threshold (120%) and bonus (5%) on a per-mint basis
- **Partial liquidation** — liquidators may repay only enough debt to restore a position to the liquidation threshold rather than always burning the full debt
- **`CollateralLiquidated` on-chain event** — emitted for every liquidation (full and partial) with collateral mint, seized amounts, pre-liquidation ratio, partial flag, and applied bonus
- **Pure math helpers** — `calcLiquidationAmount` computes how much debt to burn and collateral to seize without hitting the network
- **`fetchLiquidatableCDPs`** — scans all on-chain `CdpPosition` accounts and returns those that are currently liquidatable

For a general CDP overview and deposit/borrow/repay operations, see [`on-chain-sdk-cdp.md`](./on-chain-sdk-cdp.md).

---

## Installation

```bash
npm install @stbr/sss-token
```

---

## Quick Start

```ts
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { AnchorProvider, Program, Wallet } from '@coral-xyz/anchor';
import { MultiCollateralLiquidationModule } from '@stbr/sss-token';

const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
const provider   = new AnchorProvider(connection, new Wallet(keypair), {});
const program    = new Program(idl, SSS_PROGRAM_ID, provider);
const mod        = new MultiCollateralLiquidationModule(program, provider);

// 1. Find liquidatable positions
const priceFeedMap = {
  [SOL_MINT.toBase58()]: 180,   // $180 / SOL
  [USDC_MINT.toBase58()]: 1.0,  // $1 / USDC
};

const liquidatable = await mod.fetchLiquidatableCDPs(SSS_MINT, priceFeedMap);

// 2. Liquidate the worst position (full liquidation)
const target = liquidatable[0];
const sig = await mod.liquidate({
  sssMint:            SSS_MINT,
  cdpOwner:           target.owner,
  collateralMint:     target.collateralMint,
  pythPriceFeed:      SOL_USD_PYTH_FEED,
  minCollateralAmount: 0n,   // no slippage guard
});
console.log('Liquidated:', sig);
```

---

## API Reference

### Constructor

```ts
new MultiCollateralLiquidationModule(program: Program, provider: AnchorProvider)
```

| Parameter | Type | Description |
|---|---|---|
| `program` | `Program` | Anchor program instance loaded with the SSS IDL |
| `provider` | `AnchorProvider` | Anchor provider; `provider.wallet.publicKey` is used as the liquidator |

---

### `fetchLiquidatableCDPs`

```ts
async fetchLiquidatableCDPs(
  sssMint:      PublicKey,
  priceFeedMap: Record<string, number>,
): Promise<LiquidatableCDP[]>
```

Scans all `CdpPosition` accounts for `sssMint` on-chain and returns those whose current collateral-to-debt ratio is below the liquidation threshold (12,000 bps = 120%).

**Parameters**

| Parameter | Type | Description |
|---|---|---|
| `sssMint` | `PublicKey` | The SSS-3 stablecoin mint |
| `priceFeedMap` | `Record<string, number>` | Collateral mint base58 → USD price per whole token (e.g. `{"So1...": 180}`) |

**Returns:** `LiquidatableCDP[]` sorted by health (most underwater first).

**Example**

```ts
const positions = await mod.fetchLiquidatableCDPs(SSS_MINT, {
  [SOL_MINT.toBase58()]: 175,
});

for (const p of positions) {
  console.log(
    `${p.owner.toBase58()} — ratio ${p.currentRatioBps} bps, debt ${p.totalDebt}`
  );
}
```

---

### `liquidate`

```ts
async liquidate(params: LiquidateParams): Promise<TransactionSignature>
```

Submits a `cdp_liquidate` instruction on behalf of the connected wallet (liquidator).

Pass `partialDebtAmount` to trigger a partial liquidation (SSS-100); omit it for a full liquidation.

**Parameters (`LiquidateParams`)**

| Field | Type | Required | Description |
|---|---|---|---|
| `sssMint` | `PublicKey` | ✓ | SSS-3 stablecoin mint |
| `cdpOwner` | `PublicKey` | ✓ | Owner of the position being liquidated |
| `collateralMint` | `PublicKey` | ✓ | Collateral mint to seize |
| `pythPriceFeed` | `PublicKey` | ✓ | Pyth price feed account for the collateral mint |
| `minCollateralAmount` | `bigint` | ✓ | Minimum collateral tokens to receive; `0n` disables slippage protection |
| `partialDebtAmount` | `bigint?` | — | SSS-100: burn only this many SSS tokens (must restore ratio to ≥ threshold). Omit for full liquidation |
| `collateralIsToken2022` | `boolean?` | — | `true` if the collateral mint uses Token-2022 (default: `false`) |
| `liquidatorSssAccount` | `PublicKey?` | — | Override derived SSS ATA for the liquidator |
| `liquidatorCollateralAccount` | `PublicKey?` | — | Override derived collateral ATA for the liquidator |

**Returns:** transaction signature `string`.

**Full liquidation example**

```ts
const sig = await mod.liquidate({
  sssMint:             SSS_MINT,
  cdpOwner:            victimWallet,
  collateralMint:      SOL_MINT,
  pythPriceFeed:       SOL_USD_PYTH_FEED,
  minCollateralAmount: 4_800_000_000n,  // expect ≥ 4.8 SOL (slippage guard)
});
```

**Partial liquidation example**

```ts
// Restore position to health by burning only 250 SSS
const sig = await mod.liquidate({
  sssMint:             SSS_MINT,
  cdpOwner:            victimWallet,
  collateralMint:      SOL_MINT,
  pythPriceFeed:       SOL_USD_PYTH_FEED,
  minCollateralAmount: 0n,
  partialDebtAmount:   250_000_000n,    // 250 SSS (6 decimals)
});
```

---

### `calcLiquidationAmount`

```ts
calcLiquidationAmount(params: CalcLiquidationParams): LiquidationAmountResult
```

Pure client-side math helper — no RPC calls. Use to preview how much debt will be burned and how much collateral will be seized before sending a transaction.

**Parameters (`CalcLiquidationParams`)**

| Field | Type | Description |
|---|---|---|
| `totalDebtUnits` | `bigint` | Outstanding debt in SSS base units (6 decimals) |
| `collateralUnits` | `bigint` | Deposited collateral in collateral native units |
| `collateralPriceUsd` | `number` | USD price per whole collateral token unit |
| `collateralDecimals` | `number` | Decimals of the collateral mint |
| `sssDecimals` | `number` | Decimals of the SSS mint (usually 6) |
| `liquidationBonusBps` | `number?` | Bonus in bps (default: `500` = 5%). Use per-collateral value from `CollateralConfig` when available |
| `partialLiquidation` | `boolean?` | `true` to compute a partial liquidation (restores to 150% ratio) |

**Returns (`LiquidationAmountResult`)**

| Field | Type | Description |
|---|---|---|
| `debtToBurn` | `bigint` | SSS tokens to burn |
| `collateralSeized` | `bigint` | Collateral tokens the liquidator receives (includes bonus) |
| `liquidationBonus` | `bigint` | Bonus portion of seized collateral |
| `partialCollateralSeized` | `bigint` | Same as `collateralSeized` when `partialLiquidation=true` |
| `currentRatioBps` | `number` | Current collateral-to-debt ratio in basis points |
| `isLiquidatable` | `boolean` | Whether the position is below the liquidation threshold |

**Example**

```ts
import { calcLiquidationAmount } from '@stbr/sss-token';

const result = calcLiquidationAmount({
  totalDebtUnits:    500_000_000n,  // 500 SSS
  collateralUnits:   5_000_000_000n, // 5 SOL (lamports)
  collateralPriceUsd: 100,           // $100 / SOL — position underwater at 120% threshold
  collateralDecimals: 9,
  sssDecimals:        6,
});

console.log('Debt to burn:       ', result.debtToBurn);         // 500_000_000n
console.log('Collateral seized:  ', result.collateralSeized);   // 5_250_000_000n (5% bonus)
console.log('Is liquidatable:    ', result.isLiquidatable);     // true
console.log('Ratio (bps):        ', result.currentRatioBps);    // ~10_000
```

---

## PDA Helpers

All helpers are exported as standalone functions and also available on the module instance.

```ts
import {
  deriveCdpPositionPda,
  deriveCollateralVaultPda,
  deriveCollateralConfigPda,
  deriveStablecoinConfigPda,
} from '@stbr/sss-token';
```

| Function | Seeds | Returns |
|---|---|---|
| `deriveCdpPositionPda(sssMint, owner, programId)` | `["cdp-position", sssMint, owner]` | `[PublicKey, bump]` |
| `deriveCollateralVaultPda(sssMint, owner, collateralMint, programId)` | `["cdp-collateral-vault", sssMint, owner, collateralMint]` | `[PublicKey, bump]` |
| `deriveCollateralConfigPda(sssMint, collateralMint, programId)` | `["collateral-config", sssMint, collateralMint]` | `[PublicKey, bump]` |
| `deriveStablecoinConfigPda(sssMint, programId)` | `["stablecoin-config", sssMint]` | `[PublicKey, bump]` |

---

## Types

### `LiquidatableCDP`

```ts
interface LiquidatableCDP {
  cdpPositionPda:       PublicKey;   // On-chain CDP position PDA
  owner:                PublicKey;   // Owner of the undercollateralised position
  sssMint:              PublicKey;   // SSS-3 stablecoin mint
  collateralMint:       PublicKey;   // Collateral locked in this position
  debtAmount:           bigint;      // Outstanding principal (SSS base units)
  accruedFees:          bigint;      // Accrued stability fees (SSS base units)
  totalDebt:            bigint;      // debtAmount + accruedFees
  collateralDeposited:  bigint;      // Deposited collateral (native units)
  collateralPriceUsd:   number;      // USD price of 1 whole collateral unit
  currentRatioBps:      number;      // Current collateral ratio in bps
  isLiquidatable:       boolean;     // true when currentRatioBps < 12,000
  maxPartialCollateral: bigint;      // Max collateral seizable in a partial liquidation
}
```

---

## On-Chain: `CollateralConfig` PDA (SSS-100)

`CollateralConfig` is an optional PDA (`["collateral-config", sssMint, collateralMint]`) that admins can initialise to customise liquidation behaviour per collateral mint.

| Field | Type | Description |
|---|---|---|
| `sss_mint` | `Pubkey` | The SSS-3 stablecoin mint this config applies to |
| `collateral_mint` | `Pubkey` | The collateral mint this config applies to |
| `liquidation_threshold_bps` | `u16` | Override threshold in bps (e.g. `11000` = 110%) |
| `liquidation_bonus_bps` | `u16` | Override bonus in bps (e.g. `700` = 7%) |
| `bump` | `u8` | PDA bump |

When `CollateralConfig` is absent from the `cdp_liquidate` accounts, the program falls back to:
- threshold: **12,000 bps (120%)**
- bonus: **500 bps (5%)**

---

## On-Chain: `CollateralLiquidated` Event (SSS-100)

The program emits a `CollateralLiquidated` event on every successful liquidation call.

```rust
pub struct CollateralLiquidated {
  pub mint:             Pubkey,   // SSS-3 stablecoin mint
  pub collateral_mint:  Pubkey,   // Collateral mint seized
  pub cdp_owner:        Pubkey,   // Owner of the liquidated position
  pub liquidator:       Pubkey,   // Wallet that called cdp_liquidate
  pub debt_burned:      u64,      // SSS tokens burned
  pub collateral_seized: u64,     // Collateral tokens transferred to liquidator
  pub ratio_before_bps: u64,      // Collateral ratio before liquidation (bps)
  pub partial:          bool,     // true if this was a partial liquidation
  pub bonus_bps:        u16,      // Liquidation bonus applied (bps)
}
```

Subscribe to events using Anchor's `program.addEventListener`:

```ts
program.addEventListener('CollateralLiquidated', (event, slot) => {
  console.log(
    `[slot ${slot}] ${event.partial ? 'Partial' : 'Full'} liquidation — ` +
    `burned ${event.debtBurned} SSS, seized ${event.collateralSeized} collateral, ` +
    `bonus ${event.bonusBps} bps`
  );
});
```

---

## Risk Parameters

| Parameter | Default | Override via |
|---|---|---|
| Liquidation threshold | 120% (12,000 bps) | `CollateralConfig.liquidation_threshold_bps` |
| Liquidation bonus | 5% (500 bps) | `CollateralConfig.liquidation_bonus_bps` |
| Minimum collateral ratio (borrow) | 150% (15,000 bps) | — |
| Post-partial-liquidation target | ≥ liquidation threshold | — |

---

## Error Reference

| Error | Cause |
|---|---|
| `CdpNotLiquidatable` | Position collateral ratio is at or above the liquidation threshold |
| `SlippageExceeded` | Seized collateral is less than `minCollateralAmount` (pass `0n` to disable) |
| `PartialLiquidationInsufficientRepay` | `partialDebtAmount` is too small — post-liquidation ratio would still be below the liquidation threshold |
| `InvalidAmount` | `partialDebtAmount` exceeds the position's total debt |
| `StalePriceFeed` | Pyth price is older than `max_oracle_age_secs` (default 60 s) |
| `OracleConfidenceTooWide` | Pyth confidence interval exceeds `max_oracle_conf_bps` |
| `UnexpectedPriceFeed` | Price feed account does not match the pinned feed in `StablecoinConfig` (SSS-085) |
| `WrongCollateralMint` | `CollateralConfig` PDA collateral mint does not match the instruction's collateral mint |

---

## Related

- [`on-chain-sdk-cdp.md`](./on-chain-sdk-cdp.md) — deposit, borrow, repay
- [`on-chain-sdk-core.md`](./on-chain-sdk-core.md) — stablecoin config, minting, burning
- [`on-chain-sdk-oracle-params.md`](./on-chain-sdk-oracle-params.md) — oracle staleness and confidence config
- [`on-chain-sdk-admin-timelock.md`](./on-chain-sdk-admin-timelock.md) — admin ops including `setPythFeed`

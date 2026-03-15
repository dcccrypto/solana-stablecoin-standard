# Multi-Collateral CDP (Direction 2)

> **SSS-049 / SSS-050 / SSS-051** — Anchor program, backend REST API, and TypeScript SDK module for collateral-debt positions.

## Overview

The SSS-3 CDP system lets users lock SPL token collateral and borrow SSS-3 stablecoins against it. Collateral ratio is enforced on-chain using live Pyth price feeds; under-collateralised positions can be liquidated.

Supported collateral types at launch:

| Asset | Mint | Liq. Threshold | Min Ratio |
|---|---|---|---|
| SOL (wrapped) | `So1111…112` | 80% | 150% |
| BTC (wrapped) | `9n4nbM…eJ9E` | 80% | 150% |
| ETH (wrapped) | `2FpyTw…Ve1r` | 80% | 150% |

---

## On-Chain Program (Anchor)

### PDAs

| Account | Seeds | Description |
|---|---|---|
| `CdpPosition` | `["cdp-position", sss_mint, user]` | Tracks total debt per user |
| `CollateralVault` | `["cdp-collateral-vault", sss_mint, user, collateral_mint]` | Tracks deposited amount per collateral type |

### Instructions

#### `cdp_deposit_collateral`
Transfer collateral tokens from the user's ATA into the vault.

```
Accounts: user, config, sss_mint, collateral_mint,
          collateral_vault (PDA, init if needed), vault_token_account,
          user_collateral_account, token_program, system_program
Arg: amount: u64
```

#### `cdp_borrow_stable`
Mint SSS-3 tokens to the user, enforcing ≥150% collateral ratio.

```
Accounts: user, config, sss_mint, collateral_mint,
          collateral_vault, cdp_position (PDA, init if needed),
          user_sss_account, pyth_price_feed,
          token_program, system_program
Arg: amount: u64
```

Borrow ceiling: `floor(collateral_usd × 10^sss_decimals × 10000 / 15000 / 10^6)`

#### `cdp_repay_stable`
Burn SSS-3 tokens and release collateral proportionally.

```
Accounts: user, config, sss_mint, collateral_mint,
          collateral_vault, cdp_position, user_sss_account,
          vault_token_account, user_collateral_account,
          sss_token_program, collateral_token_program
Arg: amount: u64
```

#### `cdp_liquidate` *(keeper call)*
Fully closes an under-collateralised position: burns all debt and seizes all collateral.

---

## CDP Health Metrics

```
health_factor     = (collateral_usd × liquidation_threshold) / debt_usd
liquidation_price = debt_usd / (collateral_amount × liquidation_threshold)
max_borrowable    = collateral_usd × liquidation_threshold
is_liquidatable   = collateral_ratio < min_collateral_ratio
```

A position is **safe** when `health_factor ≥ 1`. At `health_factor < 1` any keeper may liquidate it.

---

## REST API (SSS-050)

Base URL: `http://localhost:3000`

### `GET /api/cdp/collateral-types`
Returns all supported collateral assets with live Pyth prices.

**Response**
```json
{
  "success": true,
  "data": {
    "collateral_types": [
      {
        "name": "Solana",
        "mint": "So11111111111111111111111111111111111111112",
        "price_usd": 142.57,
        "liquidation_threshold": 0.80,
        "min_collateral_ratio": 1.50
      }
    ]
  }
}
```

### `GET /api/cdp/position/:wallet`
Returns the CDP snapshot for a wallet (SOL collateral, live price).

**Response**
```json
{
  "success": true,
  "data": {
    "wallet": "YourWalletPubkey…",
    "collateral_mint": "So11111111111111111111111111111111111111112",
    "collateral_amount": 5.3,
    "collateral_usd": 755.62,
    "debt_usd": 200.00,
    "collateral_ratio": 3.778,
    "health_factor": 3.022,
    "liquidation_price": 47.17,
    "max_borrowable_usd": 604.50,
    "is_liquidatable": false
  }
}
```

### `POST /api/cdp/simulate`
Preview a borrow outcome before submitting a transaction.

**Request**
```json
{
  "collateral_mint": "So11111111111111111111111111111111111111112",
  "collateral_amount": 10.0,
  "borrow_amount": 500.0
}
```

**Response** — same shape as `/position` plus `would_be_valid: bool`.

---

## TypeScript SDK (SSS-051 — `CdpModule`)

```ts
import { CdpModule } from '@sss/sdk';

const cdp = new CdpModule(provider, sssMint);
```

### `depositCollateral(params)`

```ts
await cdp.depositCollateral({
  sssMint,
  collateralMint,
  amount: 5_000_000n,           // 5 SOL in lamports
  userCollateralAccount,
  vaultTokenAccount,
});
```

### `borrowStable(params)`

```ts
await cdp.borrowStable({
  sssMint,
  collateralMint,
  amount: 200_000_000n,         // 200 SSS (6 decimals)
  userSssAccount,
  pythPriceFeed,                // Pyth SOL/USD feed account
});
```

### `repayStable(params)`

```ts
await cdp.repayStable({
  sssMint,
  collateralMint,
  amount: 100_000_000n,
  userSssAccount,
  vaultTokenAccount,
  userCollateralAccount,
});
```

### `getPosition(wallet, connection, collateralMints, prices?)`

Reads on-chain `CdpPosition` and `CollateralVault` accounts; computes health metrics client-side.

```ts
const priceMap = new Map([
  [collateralMint.toBase58(), 142.57],
]);

const pos = await cdp.getPosition(wallet, connection, [collateralMint], priceMap);
// pos.healthFactor, pos.ratio, pos.liquidationPrice, pos.debtUsdc
```

Returns `{ owner, collateral[], debtUsdc, ratio, healthFactor, liquidationPrice }`.  
All metrics are `Infinity` / `0` when debt is zero.

### PDA helpers

```ts
const vaultPda   = cdp.getCollateralVaultPda(user, collateralMint);
const positionPda = cdp.getCdpPositionPda(user);
```

---

## Typical Flow

1. User calls `depositCollateral` to lock SOL/BTC/ETH in a vault PDA.
2. User calls `borrowStable` — program checks Pyth price and mints SSS-3 if ratio ≥ 150%.
3. User holds SSS-3 stablecoins; collateral is locked until debt is repaid.
4. User calls `repayStable` — tokens are burned and collateral released pro-rata.
5. If price drops and `health_factor < 1`, any keeper may call `cdp_liquidate`.

---

## Related

- [SSS-3 Preset](./SSS-3.md)
- [On-chain SDK: authority & collateral](./on-chain-sdk-authority-collateral.md)
- [Proof of Reserves](./PROOF-OF-RESERVES.md)
- [Backend API reference](./api.md)

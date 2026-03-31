# On-Chain SDK — CustomOracleModule

> **Introduced:** PR #336 — `fix/sdk-anchor-audit-fixes` (merged 2026-03-31)
> **References:** SSS-119 (oracle abstraction)

---

## Overview

`CustomOracleModule` wraps the three Anchor instructions that manage a
**Custom oracle** price feed on SSS-3 stablecoins.  It is used when
`oracle_type = 2` is selected in `StablecoinConfig` (see
[ORACLE-ABSTRACTION.md](ORACLE-ABSTRACTION.md) for full oracle type docs).

| Method | Instruction | Auth |
|---|---|---|
| `initCustomPriceFeed` | `init_custom_price_feed` | stablecoin authority |
| `updateCustomPrice` | `update_custom_price` | stablecoin authority |
| `setOracleConfig` | `set_oracle_config` | stablecoin authority |

---

## Installation

```ts
import { CustomOracleModule } from '@sss/sdk';

const oracle = new CustomOracleModule(provider, programId);
```

---

## PDAs

### `getConfigPda(mint)` → `[PublicKey, number]`

Seeds: `[b"stablecoin-config", mint]`

### `getCustomPriceFeedPda(mint)` → `[PublicKey, number]`

Seeds: `[b"custom-price-feed", mint]`

---

## Workflow

1. Call `initCustomPriceFeed` once to create the `CustomPriceFeed` PDA.
2. Call `setOracleConfig` to switch the stablecoin to `oracle_type = 2` and
   point it at the PDA.
3. Call `updateCustomPrice` on each price-update cycle.

---

## Methods

### `initCustomPriceFeed(params)` → `Promise<TransactionSignature>`

Create the `CustomPriceFeed` PDA on-chain. Must be called before
`updateCustomPrice` or any CDP borrow using `oracle_type = 2`.
Authority-only. No-op if PDA already exists.

**Params**

| Field | Type | Description |
|---|---|---|
| `mint` | `PublicKey` | SSS-3 stablecoin mint. |

**Accounts (auto-derived)**

| Account | Description |
|---|---|
| `authority` | Wallet / stablecoin authority (signer). |
| `config` | `StablecoinConfig` PDA. |
| `sssMint` | Stablecoin mint. |
| `customPriceFeed` | `CustomPriceFeed` PDA — `[b"custom-price-feed", sssMint]`. |
| `tokenProgram` | Token-2022 program. |
| `systemProgram` | System program. |

```ts
await oracle.initCustomPriceFeed({ mint });
```

---

### `updateCustomPrice(params)` → `Promise<TransactionSignature>`

Publish a new price to the `CustomPriceFeed` PDA.  Authority-only.

The on-chain price is stored as `price × 10^expo`. For example, a USD price
of $1.00 with 8 decimal places: `price = 100_000_000`, `expo = -8`.

**Params**

| Field | Type | Description |
|---|---|---|
| `mint` | `PublicKey` | Stablecoin mint. |
| `price` | `bigint \| number` | Raw price integer (must be > 0). |
| `expo` | `number` | Price exponent (e.g. `-8` for 1e-8 precision). |
| `conf` | `bigint \| number` | Confidence interval (same units as `price`). |

**Accounts (auto-derived)**

| Account | Description |
|---|---|
| `authority` | Wallet / stablecoin authority (signer). |
| `config` | `StablecoinConfig` PDA. |
| `sssMint` | Stablecoin mint. |
| `customPriceFeed` | `CustomPriceFeed` PDA. |
| `tokenProgram` | Token-2022 program. |

```ts
// Publish $1.000 USD with ±$0.0005 confidence
await oracle.updateCustomPrice({
  mint,
  price: 100_000_000n,
  expo: -8,
  conf:      50_000n,
});
```

---

### `setOracleConfig(params)` → `Promise<TransactionSignature>`

Set the `oracle_type` and `oracle_feed` on `StablecoinConfig`.
Authority-only. Subject to admin timelock if `admin_timelock_delay > 0`.

| `oracleType` | Provider |
|---|---|
| `0` | Pyth |
| `1` | Switchboard *(stub — not yet live)* |
| `2` | Custom (`CustomPriceFeed` PDA) |

**Params**

| Field | Type | Description |
|---|---|---|
| `mint` | `PublicKey` | Stablecoin mint. |
| `oracleType` | `number` | Oracle type integer (`0`/`1`/`2`). |
| `oracleFeed` | `PublicKey` | Feed account pubkey (Pyth account, Switchboard aggregator, or `CustomPriceFeed` PDA). |

**Accounts (auto-derived)**

| Account | Description |
|---|---|
| `authority` | Wallet / stablecoin authority (signer). |
| `config` | `StablecoinConfig` PDA. |
| `mint` | Stablecoin mint. |
| `tokenProgram` | Token-2022 program. |

```ts
const [feedPda] = oracle.getCustomPriceFeedPda(mint);
await oracle.setOracleConfig({ mint, oracleType: 2, oracleFeed: feedPda });
```

---

## Full Example

```ts
import { CustomOracleModule } from '@sss/sdk';

const oracle = new CustomOracleModule(provider, programId);

// 1. Create the CustomPriceFeed PDA (once per stablecoin)
await oracle.initCustomPriceFeed({ mint });

// 2. Switch stablecoin to oracle_type=2
const [feedPda] = oracle.getCustomPriceFeedPda(mint);
await oracle.setOracleConfig({ mint, oracleType: 2, oracleFeed: feedPda });

// 3. Publish prices on each update cycle
await oracle.updateCustomPrice({
  mint,
  price: 100_000_000n,
  expo: -8,
  conf: 50_000n,
});
```

---

## Related

- [ORACLE-ABSTRACTION.md](ORACLE-ABSTRACTION.md) — full oracle abstraction layer docs (SSS-119)
- [on-chain-sdk-oracle-params.md](on-chain-sdk-oracle-params.md) — oracle parameter tuning
- SSS-119 — oracle abstraction design

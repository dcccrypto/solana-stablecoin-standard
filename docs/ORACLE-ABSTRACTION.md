# SSS Oracle Abstraction Layer

Introduced in **SSS-119**. Decouples CDP price reads from any single oracle
provider by routing through a pluggable adapter selected per-stablecoin.

---

## Overview

SSS-3 (CDP) stablecoins require an on-chain price source to value collateral
during borrow and liquidation.  Prior to SSS-119 Pyth was hardcoded.  The
oracle abstraction layer adds:

| Oracle type | `oracle_type` value | Feed account |
|---|---|---|
| **Pyth** | `0` | Pyth price-feed account (e.g. SOL/USD) |
| **Switchboard** | `1` | Switchboard aggregator account *(stub — not yet live)* |
| **Custom** | `2` | `CustomPriceFeed` PDA (authority-maintained) |

The active type and feed address are stored in two new fields on
`StablecoinConfig`:

```
pub version: u8       // config schema version (SSS-122 upgrade path)
pub oracle_type: u8   // 0 = Pyth | 1 = Switchboard | 2 = Custom
pub oracle_feed: Pubkey // feed account; Pubkey::default() = no enforcement
```

---

## PDAs

### `CustomPriceFeed`

Seeds: `[b"custom-price-feed", sss_mint]`

Authority-maintained price feed for the Custom oracle type.

| Field | Type | Description |
|---|---|---|
| `authority` | `Pubkey` | Must match `StablecoinConfig.authority` |
| `price` | `i64` | Raw price (must be > 0) |
| `expo` | `i32` | Exponent — real price = `price × 10^expo` |
| `conf` | `u64` | Confidence half-interval (0 = none stated) |
| `last_update_slot` | `u64` | Slot of last `update_custom_price` call |
| `last_update_unix_timestamp` | `i64` | Unix timestamp of last update (0 = never) |
| `bump` | `u8` | PDA bump seed |

**Staleness guard:** if `max_oracle_age_secs` is set on the config, the
adapter rejects reads where `now - last_update_unix_timestamp > max_oracle_age_secs`.
Set a fresh price before the window expires to avoid failed borrows.

---

## Instruction Reference

### `set_oracle_config`

Sets `oracle_type` and `oracle_feed` on an existing `StablecoinConfig`.
Authority-only; can be called repeatedly to switch providers.

**Accounts**

| Account | Writable | Signer | Description |
|---|---|---|---|
| `authority` | — | ✓ | Config authority |
| `config` | ✓ | — | `StablecoinConfig` PDA |
| `mint` | — | — | Token-2022 mint |
| `token_program` | — | — | Token program |

**Parameters**

| Parameter | Type | Values |
|---|---|---|
| `oracle_type` | `u8` | `0` = Pyth, `1` = Switchboard, `2` = Custom |
| `oracle_feed` | `Pubkey` | Feed account address (`Pubkey::default()` = no enforcement) |

```typescript
// Switch to Pyth SOL/USD feed
await client.setOracleConfig({
  configPda,
  oracleType: 0,
  oracleFeed: new PublicKey("H6ARHf6YXhGYeQfUzQNGFQt5S2g44MmasiCN4aZA37Eo"),
});

// Switch to Custom feed (must call init_custom_price_feed first)
const [customFeedPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("custom-price-feed"), mint.toBuffer()],
  SSS_PROGRAM_ID,
);
await client.setOracleConfig({
  configPda,
  oracleType: 2,
  oracleFeed: customFeedPda,
});
```

**Errors**

| Error | Condition |
|---|---|
| `InvalidOracleType` | `oracle_type` not 0, 1, or 2 |
| `Unauthorized` | Caller is not `config.authority` |

---

### `init_custom_price_feed`

Initialises the `CustomPriceFeed` PDA for a stablecoin mint.  One-time;
call before `set_oracle_config` with `oracle_type = 2`.  Only valid on
SSS-3 (CDP) preset configs.

**Accounts**

| Account | Writable | Signer | Description |
|---|---|---|---|
| `authority` | ✓ | ✓ | Config authority (payer) |
| `config` | — | — | `StablecoinConfig` PDA (must be preset 3) |
| `sss_mint` | — | — | Stablecoin Token-2022 mint |
| `custom_price_feed` | ✓ (init) | — | New `CustomPriceFeed` PDA |
| `token_program` | — | — | Token program |
| `system_program` | — | — | System program |

Initial state: `price = 0`, `expo = -8`, `conf = 0`, `last_update_slot = 0`.
The feed **must** be updated at least once before CDPs can borrow against it
(staleness check will reject price = 0 / timestamp = 0).

```typescript
await client.initCustomPriceFeed({ configPda, mint });
```

**Errors**

| Error | Condition |
|---|---|
| `InvalidPreset` | Config preset is not 3 (CDP) |
| `Unauthorized` | Caller is not `config.authority` |

---

### `update_custom_price`

Publishes a new price to the `CustomPriceFeed` PDA. Authority-only. The
authority signature on this transaction is treated as the oracle's
"admin attestation" — it is *not* a decentralised price source.

**Accounts**

| Account | Writable | Signer | Description |
|---|---|---|---|
| `authority` | — | ✓ | Config authority |
| `config` | — | — | `StablecoinConfig` PDA |
| `sss_mint` | — | — | Stablecoin mint |
| `custom_price_feed` | ✓ | — | `CustomPriceFeed` PDA |
| `token_program` | — | — | Token program |

**Parameters**

| Parameter | Type | Constraints |
|---|---|---|
| `price` | `i64` | Must be > 0 |
| `expo` | `i32` | Typically `-8` (USD 8-decimal convention) |
| `conf` | `u64` | Confidence half-interval; `0` accepted |

```typescript
// Publish $1.00 USD with 8-decimal precision
await client.updateCustomPrice({
  configPda,
  mint,
  price: BigInt(1_00_000_000), // 1.00000000 × 10^-8
  expo: -8,
  conf: BigInt(50_000),        // ±0.0005 USD confidence
});
```

**Errors**

| Error | Condition |
|---|---|
| `InvalidPrice` | `price <= 0` |
| `Unauthorized` | Caller is not `config.authority` |

---

## Config Schema Versioning (SSS-122)

`StablecoinConfig.version` is incremented by `upgrade_config`.
Instructions that require the oracle fields (e.g. CDP borrow) check
`version >= MIN_SUPPORTED_VERSION`; older configs must run `upgrade_config`
before the new instruction set is unlocked.

If your config was initialised before SSS-119 you may see `OracleNotConfigured`
or `ConfigVersionTooOld` errors until you run:

```typescript
await client.upgradeConfig({ configPda, mint });
await client.setOracleConfig({ configPda, oracleType: 0, oracleFeed: pythFeedPubkey });
```

---

## Error Reference

| Error | Description |
|---|---|
| `InvalidOracleType` | `oracle_type` is not 0, 1, or 2 |
| `OracleNotConfigured` | `oracle_feed` is not set; call `set_oracle_config` first |
| `ConfigVersionTooOld` | Config schema version below minimum; run `upgrade_config` |
| `InvalidPrice` | Supplied price ≤ 0 |
| `InvalidPreset` | `init_custom_price_feed` requires CDP (preset 3) config |

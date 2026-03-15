# SSS — On-Chain SDK: OracleParamsModule

> **Class:** `OracleParamsModule` (`sdk/src/OracleParamsModule.ts`)
> **Task:** SSS-090
> **Scope:** Pyth oracle staleness and confidence-interval configuration for CDP borrowing and liquidation

---

## Overview

`OracleParamsModule` exposes the `set_oracle_params` Anchor instruction introduced in **SSS-090**. It lets the stablecoin authority configure how strictly the on-chain CDP handlers validate Pyth price feeds before allowing borrows or liquidations.

Two parameters are stored on-chain in `StablecoinConfig`:

| Parameter | Type | Default | Description |
|---|---|---|---|
| `max_oracle_age_secs` | `u32` | 0 (→ 60 s) | Maximum allowed Pyth price age in seconds |
| `max_oracle_conf_bps` | `u16` | 0 (disabled) | Maximum confidence/price ratio in basis points |

Both `cdp_borrow_stable` and `cdp_liquidate` enforce these constraints on every call.

---

## Constants

```typescript
import {
  DEFAULT_MAX_ORACLE_AGE_SECS,       // 60  — on-chain hardcoded default
  RECOMMENDED_MAX_ORACLE_CONF_BPS,   // 100 — 1%; recommended for mainnet
} from '@sss/sdk';
```

| Constant | Value | Notes |
|---|---|---|
| `DEFAULT_MAX_ORACLE_AGE_SECS` | `60` | Applied on-chain when `max_oracle_age_secs = 0` |
| `RECOMMENDED_MAX_ORACLE_CONF_BPS` | `100` | Rejects prices whose confidence > 1% of price |

---

## Import & Instantiation

```typescript
import { OracleParamsModule } from '@sss/sdk';
import { AnchorProvider, web3 } from '@coral-xyz/anchor';

const provider: AnchorProvider = /* ... */;
const programId = new web3.PublicKey('...your program id...');

const op = new OracleParamsModule(provider, programId);
```

---

## Methods

### `setOracleParams(args)`

Configure oracle staleness and confidence parameters for a stablecoin.

**Authority required:** stablecoin `authority` (admin).

```typescript
setOracleParams(args: SetOracleParamsArgs): Promise<TransactionSignature>
```

**Parameters:**

| Field | Type | Description |
|---|---|---|
| `mint` | `PublicKey` | The SSS-3 stablecoin mint |
| `maxAgeSecs` | `number` | Max Pyth price age in seconds. `0` = use on-chain default (60 s) |
| `maxConfBps` | `number` | Max confidence/price ratio in bps. `0` = confidence check disabled |

**Constraints:**
- `maxAgeSecs`: `u32` range (0–4,294,967,295)
- `maxConfBps`: `u16` range (0–65,535); practical values are 50–500 bps

**Example — tighten mainnet settings:**

```typescript
import { RECOMMENDED_MAX_ORACLE_CONF_BPS } from '@sss/sdk';

const sig = await op.setOracleParams({
  mint,
  maxAgeSecs: 60,                           // reject prices older than 60 s
  maxConfBps: RECOMMENDED_MAX_ORACLE_CONF_BPS, // reject conf > 1% of price
});
console.log('Oracle params set:', sig);
```

**Example — relax for devnet / mock feeds:**

```typescript
await op.setOracleParams({
  mint,
  maxAgeSecs: 300,  // 5-minute tolerance
  maxConfBps: 0,    // disable confidence check
});
```

**Errors:**

| Error | Cause |
|---|---|
| `Unauthorized` | Caller is not the stablecoin authority |
| `AccountNotInitialized` | `StablecoinConfig` PDA does not exist |

---

### `getOracleParams(mint)`

Fetch current oracle parameters from `StablecoinConfig`.

```typescript
getOracleParams(mint: PublicKey): Promise<OracleParams>
```

**Returns:**

```typescript
interface OracleParams {
  maxAgeSecs: number;  // 0 means on-chain default applies
  maxConfBps: number;  // 0 means confidence check is disabled
}
```

**Example:**

```typescript
const params = await op.getOracleParams(mint);
console.log(params);
// { maxAgeSecs: 60, maxConfBps: 100 }
```

**Errors:**

| Error | Cause |
|---|---|
| `Error` | `StablecoinConfig` PDA not found for the given mint |

---

### `isConfidenceCheckEnabled(mint)`

Returns `true` when `max_oracle_conf_bps > 0` (i.e. confidence check is active).

```typescript
isConfidenceCheckEnabled(mint: PublicKey): Promise<boolean>
```

**Example:**

```typescript
const enabled = await op.isConfidenceCheckEnabled(mint);
console.log('Confidence check enabled:', enabled); // true / false
```

---

### `effectiveMaxAgeSecs(mint)`

Returns the effective max oracle age in seconds, resolving the on-chain default (60 s) when `max_oracle_age_secs` is 0.

```typescript
effectiveMaxAgeSecs(mint: PublicKey): Promise<number>
```

**Example:**

```typescript
const age = await op.effectiveMaxAgeSecs(mint);
console.log('Effective max oracle age:', age, 's'); // always ≥ 1
```

---

## On-Chain Behaviour

### `cdp_borrow_stable`

Before allowing a borrow, the handler:

1. Reads the Pyth price feed for the collateral asset.
2. Checks `price.publish_time` against the clock; rejects if older than `max_oracle_age_secs` (or 60 s when 0).
3. If `max_oracle_conf_bps > 0`, computes `conf / price` in basis points and rejects if it exceeds the threshold.

### `cdp_liquidate`

Applies the same staleness and confidence checks as `cdp_borrow_stable` before calculating the liquidation discount.

### New Error Variant

| Error | Trigger |
|---|---|
| `StaleOraclePrice` | Price feed older than `max_oracle_age_secs` |
| `OracleConfidenceTooWide` | `conf / price` (bps) > `max_oracle_conf_bps` |

---

## `StablecoinConfig` Changes (SSS-090)

Two fields were appended to the `StablecoinConfig` struct:

```rust
pub max_oracle_age_secs: u32,   // 0 = default 60 s
pub max_oracle_conf_bps: u16,   // 0 = disabled
```

The `set_oracle_params` instruction (authority-only) updates both fields atomically.

---

## Recommended Mainnet Configuration

```typescript
await op.setOracleParams({
  mint,
  maxAgeSecs: 60,   // 1-minute price freshness requirement
  maxConfBps: 100,  // reject prices with > 1% confidence spread
});
```

For devnet or staging environments with mock Pyth feeds, disable the confidence check (`maxConfBps: 0`) and relax staleness (`maxAgeSecs: 300`).

---

## Types Reference

```typescript
interface SetOracleParamsArgs {
  mint: PublicKey;
  maxAgeSecs: number;  // u32; 0 = on-chain default (60 s)
  maxConfBps: number;  // u16; 0 = disabled
}

interface OracleParams {
  maxAgeSecs: number;
  maxConfBps: number;
}
```

---

## Related Docs

- [on-chain-sdk-cdp.md](./on-chain-sdk-cdp.md) — CDP borrowing and collateral management
- [on-chain-sdk-admin.md](./on-chain-sdk-admin.md) — Admin & governance methods
- [on-chain-sdk-core.md](./on-chain-sdk-core.md) — Core lifecycle methods

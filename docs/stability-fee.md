# SSS — Stability Fee (SSS-092)

> **Anchor instructions:** `set_stability_fee`, `collect_stability_fee`
> **SDK module:** `StabilityFeeModule` (`sdk/src/StabilityFeeModule.ts`, added SSS-096)
> **Applies to:** SSS-3 (reserve-backed CDP) stablecoins only

---

## Overview

The stability fee is an **annual interest charge** levied on CDP (Collateral Debt Position) borrowers. It is denominated in the SSS token itself: when collected, the fee amount is **burned** from the debtor's token account, reducing net circulating supply and creating ongoing demand for the stablecoin.

Key properties:
- **Simple interest**, not compound — `fee = debt × rate × elapsed / year`
- **Per-position accrual** — each `CdpPosition` PDA tracks `last_fee_accrual` and `accrued_fees` independently
- **Keeper-compatible** — `collect_stability_fee` is permissionless; any bot may trigger collection on behalf of debtors (undercollateralised positions trend toward liquidation as fees accumulate)
- **SSS-3 only** — the instruction is rejected with `InvalidPreset` on SSS-1 / SSS-2 mints

---

## Fee Formula

```
fee = debt_amount × stability_fee_bps × elapsed_secs
      ─────────────────────────────────────────────
                 10_000 × 31_536_000
```

- `debt_amount` — outstanding borrow at the position (native token units)
- `stability_fee_bps` — annual rate in basis points (e.g. 200 = 2% p.a.)
- `elapsed_secs` — seconds since `last_fee_accrual` (capped to `i64::MAX`, floor 0)
- Result is **truncated** to `u64`; sub-lamport fees round to zero but still update the timestamp

Limits:
| Parameter | Min | Max |
|---|---|---|
| `stability_fee_bps` | 0 (disabled) | 2000 (20% p.a.) |

---

## On-Chain State

### `StablecoinConfig` (seed `"stablecoin-config"`)

| Field | Type | Description |
|---|---|---|
| `stability_fee_bps` | `u16` | Annual fee rate. 0 = disabled |

### `CdpPosition` (seed `"cdp-position"`)

| Field | Type | Description |
|---|---|---|
| `last_fee_accrual` | `i64` | Unix timestamp of last `collect_stability_fee` call |
| `accrued_fees` | `u64` | Cumulative fees burned for this position (informational) |

---

## Instructions

### `set_stability_fee`

Authority-only. Sets the annual stability fee rate for a CDP stablecoin. Takes effect on the **next** `collect_stability_fee` call.

**Accounts:**

| Account | Writable | Signer | Description |
|---|---|---|---|
| `authority` | — | ✅ | Stablecoin authority |
| `config` | ✅ | — | `StablecoinConfig` PDA |

**Arguments:**

| Arg | Type | Description |
|---|---|---|
| `fee_bps` | `u16` | Annual fee in basis points (0–2000). 0 disables fee |

**Errors:** `StabilityFeeTooHigh` if `fee_bps > 2000`, `Unauthorized` if signer ≠ authority, `InvalidPreset` if not SSS-3.

---

### `collect_stability_fee`

Permissionless. Accrues and burns outstanding stability fees for a specific CDP position.

**Accounts:**

| Account | Writable | Signer | Description |
|---|---|---|---|
| `debtor` | ✅ | ✅ | CDP position owner; authorises the burn |
| `config` | ✅ | — | `StablecoinConfig` PDA |
| `sss_mint` | ✅ | — | SSS-3 token mint |
| `cdp_position` | ✅ | — | `CdpPosition` PDA for `(mint, debtor)` |
| `debtor_sss_account` | ✅ | — | Debtor's Token-2022 SSS account |
| `token_program` | — | — | Token-2022 program |

**No-op conditions** (returns `Ok(())` without burning):
- `stability_fee_bps == 0` on the config
- Less than 1 second has elapsed since `last_fee_accrual`

**Errors:** `InvalidPreset` (not SSS-3), `MintPaused`, `Unauthorized` (debtor ≠ position owner).

---

## SDK — `StabilityFeeModule`

> Added in SSS-096. Import from `@stbr/sss-token`.

```ts
import { StabilityFeeModule } from '@stbr/sss-token';

const sf = new StabilityFeeModule(provider, programId);
```

### `setStabilityFee(args)`

```ts
await sf.setStabilityFee({ mint, feeBps: 200 }); // 2% p.a.
```

- Throws if `feeBps > 2000`.
- Returns `TransactionSignature`.

### `collectStabilityFee(args)`

```ts
const sig = await sf.collectStabilityFee({ mint, debtor, debtorSssAccount });
// sig is null when fee is zero (skipped client-side)
```

- Returns `TransactionSignature | null` (null = fee disabled, no tx sent).

### `getStabilityFeeConfig(mint)`

```ts
const { stabilityFeeBps } = await sf.getStabilityFeeConfig(mint);
```

Reads `stability_fee_bps` from `StablecoinConfig`.

### `getCdpStabilityFeeState(mint, owner)`

```ts
const { lastFeeAccrual, accruedFees } = await sf.getCdpStabilityFeeState(mint, debtor);
```

Reads `last_fee_accrual` and `accrued_fees` from `CdpPosition`.

### `previewAccruedFee(mint, owner)`

Off-chain estimate of the fee that would be burned right now:

```ts
const preview = await sf.previewAccruedFee(mint, debtor);
// { feeBps, debtAmount, elapsedSecs, estimatedFee }
```

### Convenience helpers

```ts
sf.isFeeEnabled(mint)    // boolean — stabilityFeeBps > 0
sf.annualFeeRate(mint)   // number  — feeBps / 10_000 (e.g. 0.02 for 200 bps)
```

---

## Example: Keeper Bot

```ts
import { StabilityFeeModule } from '@stbr/sss-token';
import { Connection, Keypair } from '@solana/web3.js';
import { AnchorProvider, Wallet } from '@coral-xyz/anchor';

const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
const provider   = new AnchorProvider(connection, new Wallet(keeperKeypair), {});
const sf         = new StabilityFeeModule(provider, SSS_PROGRAM_ID);

// Check fee is enabled before looping
const enabled = await sf.isFeeEnabled(sssMint);
if (!enabled) process.exit(0);

for (const { debtor, debtorSssAccount } of positions) {
  const preview = await sf.previewAccruedFee(sssMint, debtor);
  if (preview.estimatedFee > 0n) {
    const sig = await sf.collectStabilityFee({ mint: sssMint, debtor, debtorSssAccount });
    console.log(`Collected fees for ${debtor.toBase58()}: ${sig}`);
  }
}
```

---

## Accounting Notes

- Burned fees increment `StablecoinConfig.total_burned` — reflected in `netSupply()` and the reserve ratio.
- `CdpPosition.accrued_fees` is a running total for auditing; it is **not** deducted from `debt_amount` automatically.
- Positions with large uncollected fees will have higher effective debt, reducing their collateral ratio and moving them toward liquidation.
- `last_fee_accrual` is updated even when the computed fee rounds to zero, preventing repeated zero-fee calls from accumulating un-timestamped time.

---

## Related

- [on-chain-sdk-cdp.md](./on-chain-sdk-cdp.md) — CDP borrow/repay/liquidate
- [SSS-3.md](./SSS-3.md) — Reserve-backed preset overview
- [psm-velocity.md](./psm-velocity.md) — PSM fee & per-minter velocity limits (SSS-093)

# SSS-132: PSM Dynamic AMM-Style Slippage Curves

## Overview

SSS-132 replaces the flat `redemption_fee_bps` in `StablecoinConfig` with a
**depth-based AMM fee curve** that increases fees as the PSM reserve pool becomes
unbalanced.  This creates an automated, on-chain incentive mechanism:

- Balanced pool (50/50): cheapest redemptions — fee = `base_fee_bps`
- One-sided pool (all one asset): most expensive — fee approaches `max_fee_bps`

This mirrors Curve Finance's AMM slippage model but adapted for on-chain
Solana PSM accounting.

---

## Fee Curve Formula

```text
fee_bps = base_fee_bps + curve_k * (imbalance / total_reserves)²
```

Where:
- `imbalance = |vault_amount − ideal_balance|`
- `ideal_balance = total_reserves / 2` (perfect 50/50 balance point)
- `curve_k` is the **steepness amplifier** (stored scaled by `1_000_000`)
- Result is **clamped** to `[base_fee_bps, max_fee_bps]`

### Numeric example

| Pool state                  | Imbalance ratio | delta (k=800) | Fee (base=5) |
|-----------------------------|-----------------|---------------|--------------|
| Balanced (50/50)            | 0%              | 0 bps         | 5 bps (0.05%)|
| 25% skew (vault = 75%)      | 25%             | ~50 bps       | ~55 bps      |
| 50% skew (vault = 100%)     | 50%             | ~200 bps      | ~205 bps     |
| Fully imbalanced (vault = 0)| 50%             | clamped       | max_fee_bps  |

---

## Feature Flag

**Bit 13** (`FLAG_PSM_DYNAMIC_FEES = 1 << 13 = 8192`)

When enabled, `psm_dynamic_swap` uses the curve; the legacy `redeem` instruction
continues to use `redemption_fee_bps` unchanged.

---

## PDA: `PsmCurveConfig`

Seeds: `[b"psm-curve-config", sss_mint]`

| Field           | Type  | Description                                              |
|-----------------|-------|----------------------------------------------------------|
| `sss_mint`      | Pubkey| The SSS stablecoin mint                                  |
| `authority`     | Pubkey| Authority that may update curve params                   |
| `base_fee_bps`  | u16   | Minimum fee at perfect balance (e.g. 5 = 0.05%)         |
| `curve_k`       | u64   | Steepness amplifier (k). Practical range: 100–10_000_000|
| `max_fee_bps`   | u16   | Maximum fee ceiling (≤ 2000 = 20%)                      |
| `bump`          | u8    | PDA bump seed                                            |

**Constraints:**
- `base_fee_bps ≤ max_fee_bps`
- `max_fee_bps ≤ 2000` (20% ceiling; enforced at init/update)

---

## Instructions

### `init_psm_curve_config`

Authority-only. Creates `PsmCurveConfig` PDA and enables `FLAG_PSM_DYNAMIC_FEES`.
SSS-3 presets only.

```rust
pub struct InitPsmCurveConfigParams {
    pub base_fee_bps: u16,
    pub curve_k: u64,
    pub max_fee_bps: u16,
}
```

Emits: `PsmCurveConfigInitialised`

---

### `update_psm_curve_config`

Authority-only. Update curve parameters without re-creating the PDA.

Emits: `PsmCurveConfigUpdated`

---

### `psm_dynamic_swap`

Burns `amount` SSS tokens; releases `amount − dynamic_fee` collateral to redeemer.

**Requires:** `FLAG_PSM_DYNAMIC_FEES` enabled.

Fee is computed fresh from current vault balance at swap time — no stale data risk.

Emits: `PsmDynamicSwapEvent` with `fee_bps`, `vault_amount_before`, `total_reserves` fields.

---

### `get_psm_quote`

**Read-only** — use with `simulateTransaction`. No state mutation.

Emits `PsmQuoteEvent` with `expected_out`, `expected_fee`, `fee_bps`, `vault_amount`.

Frontends call this to show users the expected fee before executing a swap.

```typescript
// Frontend usage with Anchor
const simResult = await program.simulate.getPsmQuote(
  new BN(1_000_000), // amount_in
  { accounts: { ... } }
);
// Parse PsmQuoteEvent from simResult.events
```

---

## Events

### `PsmCurveConfigInitialised`
Emitted on `init_psm_curve_config`. Contains `mint`, `base_fee_bps`, `curve_k`,
`max_fee_bps`, `authority`.

### `PsmCurveConfigUpdated`
Emitted on `update_psm_curve_config`. Contains old and new values for all three params.

### `PsmDynamicSwapEvent`
Emitted on every `psm_dynamic_swap`.  Contains `sss_burned`, `collateral_out`,
`fee_collected`, `fee_bps`, `vault_amount_before`, `total_reserves`.

### `PsmQuoteEvent`
Emitted by `get_psm_quote` (simulation only).  Contains `amount_in`, `expected_out`,
`expected_fee`, `fee_bps`, `vault_amount`.

---

## Errors

| Error                       | Meaning                                            |
|-----------------------------|----------------------------------------------------|
| `PsmDynamicFeesNotEnabled`  | `FLAG_PSM_DYNAMIC_FEES` not set on config          |
| `InvalidPsmCurveBaseFee`    | `base_fee_bps > max_fee_bps`                       |
| `InvalidPsmCurveMaxFee`     | `max_fee_bps > 2000`                               |
| `PsmCurveConfigNotFound`    | PDA not initialised                                |
| `PsmSwapOutputZero`         | Amount too small; entire value consumed by fee     |

---

## Kani Formal Proofs

Two proofs in `proofs.rs` verify the fee curve invariants:

### `proof_psm_fee_curve_bounded`
**WHAT:** `compute_fee` always returns a value in `[base_fee_bps, max_fee_bps]`
for any vault/reserve state.

**WHY:** Prevents the curve from charging more than the ceiling (fee accounting
correctness) or less than the base (unexpected zero-fee states).

### `proof_psm_fee_curve_balanced_is_base`
**WHAT:** When `vault_amount == total_reserves / 2` (perfect balance), fee ≥ base.

**WHY:** Verifies the balanced-pool invariant; balanced pools should never be
penalised beyond the configured minimum.

Run with:
```bash
cargo kani --harness proof_psm_fee_curve_bounded
cargo kani --harness proof_psm_fee_curve_balanced_is_base
```

---

## Choosing `curve_k`

| k value        | Fee at 25% skew | Fee at 50% skew | Use case          |
|----------------|-----------------|-----------------|-------------------|
| 0              | = base          | = base          | Disabled (flat)   |
| 800            | base + ~50 bps  | base + ~200 bps | Gentle curve      |
| 4_000          | base + ~250 bps | base + ~1000 bps| Aggressive curve  |
| 50_000_000     | capped quickly  | max_fee_bps     | Very aggressive   |

*(Assuming total_reserves = 2_000_000 units for above examples.)*

For production deployments, calibrate `curve_k` against expected PSM volume
and desired rebalancing incentive strength.

---

## SDK Methods

```typescript
// getPsmCurveConfig — fetch the curve config PDA
async function getPsmCurveConfig(
  program: Program<SssToken>,
  sssMint: PublicKey,
): Promise<PsmCurveConfig> { ... }

// getPsmQuote — simulate a swap to preview the dynamic fee
async function getPsmQuote(
  program: Program<SssToken>,
  sssMint: PublicKey,
  amountIn: BN,
): Promise<{ expectedOut: BN; feeBps: number; feeCost: BN }> { ... }
```

---

## Relationship to flat `redeem`

SSS-132 is **additive**: the existing `redeem` instruction and `redemption_fee_bps`
in `StablecoinConfig` are unchanged.  Operators who want dynamic fees must:

1. Call `init_psm_curve_config` to create the PDA
2. Call `psm_dynamic_swap` instead of `redeem` from client code
3. Optionally set `redemption_fee_bps = 0` to prevent parallel flat-fee redemptions

The two swap paths can coexist; frontends should route through whichever the
issuer has configured as canonical.

---

*SSS-132 | Status: Implemented | PR: feat/sss-132-psm-amm-slippage*

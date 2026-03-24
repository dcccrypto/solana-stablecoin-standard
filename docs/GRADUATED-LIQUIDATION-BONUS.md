# Graduated Liquidation Bonus

**Feature:** SSS-131  
**Flag:** `FLAG_GRAD_LIQUIDATION_BONUS` (bit 12)  
**PDA:** `LiquidationBonusConfig` — seeds `[b"liquidation-bonus-config", sss_mint]`

## Overview

By default, CDP liquidations pay a flat bonus defined in `CollateralConfig.liquidation_bonus_bps`.
When `FLAG_GRAD_LIQUIDATION_BONUS` is set, the protocol instead applies a **three-tier graduated
schedule** from a `LiquidationBonusConfig` PDA: the deeper a CDP's undercollateralisation, the
higher the bonus awarded to the liquidator.

This creates dynamic incentives that accelerate liquidation of the most distressed positions while
keeping incentives proportionate for healthier ones.

## Tier Logic

```text
ratio < tier3_threshold  →  tier3_bonus  (e.g. <80% CR → 12%)
ratio < tier2_threshold  →  tier2_bonus  (e.g. <90% CR →  8%)
ratio < tier1_threshold  →  tier1_bonus  (e.g. <100% CR → 5%)
```

Tiers are evaluated most-distressed first. The applied bonus is always clamped to `max_bonus_bps`.

### Example Configuration

| Tier | Collateral-Ratio Range | Bonus |
| ---- | ---------------------- | ----- |
| 1    | 90–100% (9000–10000 bps) | 5% (500 bps)  |
| 2    | 80–90%  (8000–9000 bps)  | 8% (800 bps)  |
| 3    | <80%    (<8000 bps)      | 12% (1200 bps)|

## PDA: `LiquidationBonusConfig`

```rust
pub struct LiquidationBonusConfig {
    pub sss_mint:             Pubkey,  // stablecoin mint
    pub authority:            Pubkey,  // = StablecoinConfig.authority

    pub tier1_threshold_bps:  u16,     // upper CR threshold for tier 1
    pub tier1_bonus_bps:      u16,

    pub tier2_threshold_bps:  u16,
    pub tier2_bonus_bps:      u16,

    pub tier3_threshold_bps:  u16,
    pub tier3_bonus_bps:      u16,

    pub max_bonus_bps:        u16,     // hard ceiling (≤ 5000)
    pub bump:                 u8,
}
```

Seeds: `[b"liquidation-bonus-config", sss_mint]`

### Validation Invariants

- `tier3_threshold < tier2_threshold < tier1_threshold ≤ 15000` (150% max)
- `tier1_bonus ≤ tier2_bonus ≤ tier3_bonus ≤ max_bonus_bps`
- `max_bonus_bps ≤ 5000` (50% hard ceiling)

Violations return `SssError::InvalidLiquidationTierConfig`.

## Instructions

### `init_liquidation_bonus_config`

Creates the `LiquidationBonusConfig` PDA and sets `FLAG_GRAD_LIQUIDATION_BONUS` on the
`StablecoinConfig`. Authority-only.

**Accounts:**
| Account | Type | Description |
|---------|------|-------------|
| `authority` | `Signer` | Must match `config.authority` |
| `config` | `StablecoinConfig` | Stablecoin config (mut) |
| `liquidation_bonus_config` | `LiquidationBonusConfig` | PDA to initialise (init) |
| `system_program` | `Program` | System program |

**Params:** `InitLiquidationBonusConfigParams` — all seven tier/bonus/max fields.

**Emits:** `LiquidationBonusConfigInitialised`

---

### `update_liquidation_bonus_config`

Updates an existing `LiquidationBonusConfig`. Authority-only.  
Same accounts as init (without `system_program`); `liquidation_bonus_config` must already exist.

**Emits:** `LiquidationBonusConfigUpdated` (includes old + new values for all tiers)

## Events

### `LiquidationBonusConfigInitialised`

Emitted when the PDA is first created.

```rust
pub struct LiquidationBonusConfigInitialised {
    pub mint:                 Pubkey,
    pub tier1_threshold_bps:  u16,
    pub tier1_bonus_bps:      u16,
    pub tier2_threshold_bps:  u16,
    pub tier2_bonus_bps:      u16,
    pub tier3_threshold_bps:  u16,
    pub tier3_bonus_bps:      u16,
    pub max_bonus_bps:        u16,
}
```

### `LiquidationBonusConfigUpdated`

Emitted on every config update. Contains old and new values for all three tiers.

### `GraduatedLiquidationBonusApplied`

Emitted by `cdp_liquidate` each time the graduated schedule is used.

```rust
pub struct GraduatedLiquidationBonusApplied {
    pub mint:         Pubkey,
    pub cdp_owner:    Pubkey,
    pub ratio_bps:    u64,   // CDP collateral ratio at liquidation time
    pub tier_applied: u8,    // 1, 2, or 3
    pub bonus_bps:    u16,   // actual bonus applied (clamped to max_bonus_bps)
}
```

## Integration with `cdp_liquidate`

When `FLAG_GRAD_LIQUIDATION_BONUS` is active, `cdp_liquidate` loads the
`LiquidationBonusConfig` PDA as an additional remaining account and calls
`bonus_for_ratio(ratio_bps)` instead of reading `CollateralConfig.liquidation_bonus_bps`.

If the flag is **not** set, the original flat bonus path is unchanged.

## Formal Verification

A Kani proof `proof_liquidation_bonus_bounded` verifies that the value returned by
`bonus_for_ratio()` never exceeds `max_bonus_bps` for any input, covering all three tiers
and the clamping path.

Run:
```bash
cargo kani --harness proof_liquidation_bonus_bounded
```

## Enabling Graduated Liquidation Bonuses

```typescript
// 1. Init the config (sets FLAG_GRAD_LIQUIDATION_BONUS on StablecoinConfig)
await program.methods
  .initLiquidationBonusConfig({
    tier1ThresholdBps: 10_000,  // 100%
    tier1BonusBps:       500,   //   5%
    tier2ThresholdBps:  9_000,  //  90%
    tier2BonusBps:       800,   //   8%
    tier3ThresholdBps:  8_000,  //  80%
    tier3BonusBps:      1_200,  //  12%
    maxBonusBps:        2_000,  //  20% ceiling
  })
  .accounts({ authority, config, liquidationBonusConfig, systemProgram })
  .rpc();
```

Subsequent `cdp_liquidate` calls will automatically use the graduated schedule.

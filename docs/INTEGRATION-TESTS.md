# Integration Test Suite — Gaps Sprint SSS-090–099

**Task:** SSS-103  
**Author:** sss-qa  
**Updated:** 2026-03-16

## Overview

End-to-end integration tests covering the complete gaps sprint (SSS-090–099).  
Test file: [`tests/sss-103-integration.ts`](../tests/sss-103-integration.ts)

## Coverage

### 1. Oracle Staleness → Circuit-Breaker Interaction (SSS-090)

| Test | Description |
|------|-------------|
| INT-090-01 | Config defaults `maxOracleAgeSecs=0` and `maxOracleConfBps=0` after init |
| INT-090-02 | `set_oracle_params` roundtrip — write and verify both fields |
| INT-090-03 | `set_oracle_params` resets to 0 (disables checks) |
| INT-090-04 | `set_oracle_params` rejects non-authority signer |
| INT-090-05 | Oracle params survive circuit-breaker toggle cycle |
| INT-090-06 | Staleness check uses per-config age when set (field-level proof) |
| INT-090-07 | Confidence check math — 2% conf on 1USD price exceeds 1% limit |

**How oracle staleness triggers circuit-breaker:** When `maxOracleAgeSecs > 0` and the Pyth price feed's `publish_time` is older than the threshold, `cdp_borrow_stable` returns `StalePriceFeed`. The circuit-breaker flag (`FLAG_CIRCUIT_BREAKER = bit 0`) can be set by the authority to halt all mints/burns; oracle params are preserved independently through that toggle.

### 2. Stability Fee Accrual + Collection Flow (SSS-092)

| Test | Description |
|------|-------------|
| INT-092-01 | `stabilityFeeBps` defaults to 0 after init |
| INT-092-02 | `set_stability_fee` stores fee_bps |
| INT-092-03 | `set_stability_fee` rejects fee > 2000 bps (20%) |
| INT-092-04 | Boundary — 2000 bps (20%) accepted |
| INT-092-05 | `set_stability_fee` rejects non-authority signer |
| INT-092-06 | `CdpPosition` schema has `lastFeeAccrual` and `accruedFees` fields |
| INT-092-07 | `collect_stability_fee` is no-op when `fee_bps = 0` |
| INT-092-08 | Fee calculation — 1% annual on 1M µ-tokens for 1 year ≈ 10,000 µ-tokens |
| INT-092-09 | `set_stability_fee` can disable (set to 0) |

**Fee formula (simple interest):**
```
fee = debt_amount × stability_fee_bps × elapsed_secs / (10_000 × SECS_PER_YEAR)
```
Fees are burned from the debtor's SSS token account and counted in `StablecoinConfig.burned`.

### 3. PSM Fee + Velocity Rate Limit (SSS-093)

| Test | Description |
|------|-------------|
| INT-093-01 | `redemptionFeeBps` defaults to 0 after init |
| INT-093-02 | `set_psm_fee` stores fee_bps |
| INT-093-03 | `set_psm_fee` rejects fee > 1000 bps (10%) |
| INT-093-04 | Boundary — 1000 bps (10%) accepted |
| INT-093-05 | `set_psm_fee` rejects non-authority signer |
| INT-093-06 | PSM fee can be disabled by setting to 0 |
| INT-093-07 | `set_mint_velocity_limit` — stores `mintCap` on `MinterInfo` |
| INT-093-08 | `set_velocity_limit` — stores `velocityWindowSecs` + `velocityWindowCap` |
| INT-093-09 | Velocity rate limit — rejects mint exceeding window cap |
| INT-093-10 | PSM fee math — 0.5% on 1M redeem → 5,000 µ-token fee stays in vault |

### 4. Bad Debt Backstop Trigger + Insurance Fund Draw (SSS-097)

| Test | Description |
|------|-------------|
| INT-097-01 | `insuranceFundPubkey` defaults to `Pubkey::default` after init |
| INT-097-02 | `set_backstop_params` stores insurance fund pubkey and `maxBackstopBps` |
| INT-097-03 | `set_backstop_params` rejects `maxBackstopBps > 10000` |
| INT-097-04 | Boundary — 10000 bps (100%) accepted |
| INT-097-05 | `set_backstop_params` rejects non-authority signer |
| INT-097-06 | `trigger_backstop` rejects `shortfall_amount = 0` |
| INT-097-07 | `trigger_backstop` rejects when backstop is not configured |
| INT-097-08 | `set_backstop_params` can disable by passing `Pubkey::default` |
| INT-097-09 | Backstop draw cap math — 10% of 1M supply = 100K max draw |
| INT-097-10 | `BadDebtTriggered` event has correct fields in IDL |

**Draw cap formula:**
```
max_draw = net_supply × max_backstop_bps / 10_000
```

### 5. CollateralConfig Validation in CDP (SSS-098)

| Test | Description |
|------|-------------|
| INT-098-01 | `register_collateral` creates `CollateralConfig` PDA with correct params |
| INT-098-02 | `register_collateral` rejects `liquidation_threshold <= max_ltv` |
| INT-098-03 | `register_collateral` rejects `liquidation_bonus_bps > 5000` |
| INT-098-04 | `cdp_deposit_collateral` succeeds with valid config (whitelisted=true) |
| INT-098-05 | `cdp_deposit_collateral` blocked when `whitelisted=false` |
| INT-098-06 | `cdp_deposit_collateral` blocked when deposit exceeds `max_deposit_cap` |
| INT-098-07 | `cdp_deposit_collateral` without `collateral_config` (null) — backwards compat |
| INT-098-08 | `update_collateral_config` changes params correctly |
| INT-098-09 | `update_collateral_config` rejects non-authority signer |
| INT-098-10 | `CollateralConfig` IDL exposes all required fields |

## Running the Tests

```bash
# Against localnet (standard)
anchor test

# Run only SSS-103 integration suite
anchor test --grep "SSS-103"

# Full test suite
anchor test
```

## Test Environment

- **Runtime:** Anchor localnet (test-validator)
- **Programs:** sss-token (Anchor v0.32+)
- **Token standards:** TOKEN_2022 (SSS mint), TOKEN_PROGRAM (collateral)
- **Oracle mocking:** Field-level verification (full Pyth injection requires bankrun or `conn.setAccountData`)

## Notes on Oracle Test Limitations

Full oracle staleness injection (writing mock Pyth account data) requires either:
- **bankrun** test harness with `setAccountData`
- Direct account mutation via the `anchor-bankrun` crate

In the standard `anchor test` (test-validator) environment, the oracle staleness tests verify field storage and math; the actual `cdp_borrow_stable` instruction-level rejection is covered in the existing `tests/sss-token.ts` with graceful fallback to field checks when `conn.setAccountData` is unavailable.

## Total Test Count

| Section | Tests |
|---------|-------|
| Oracle staleness (SSS-090) | 7 |
| Stability fee (SSS-092) | 9 |
| PSM + velocity (SSS-093) | 10 |
| Backstop (SSS-097) | 10 |
| CollateralConfig (SSS-098) | 10 |
| **Total** | **46** |

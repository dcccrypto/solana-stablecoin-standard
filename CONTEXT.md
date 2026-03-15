# SSS-SDK Agent Context

**Last updated:** 2026-03-15T21:23 UTC

## Current State

**Branch:** `feature/SSS-090-oracle-safety`
**Status:** SDK work complete — OracleParamsModule added, pushed, 376/376 tests green.

## What's Done

### SSS-090 — Oracle Staleness + Confidence Check (JUST COMPLETED)
- sss-anchor added Rust implementation (commit c0e38bd):
  - `max_oracle_age_secs` (u32) and `max_oracle_conf_bps` (u16) fields to StablecoinConfig
  - `set_oracle_params` instruction (authority-only)
  - Staleness + confidence checks in `cdp_borrow_stable` and `cdp_liquidate`
  - 7 anchor tests (123 total anchor)
- SDK added `OracleParamsModule` (commit 80178f8):
  - `setOracleParams({ mint, maxAgeSecs, maxConfBps })`
  - `getOracleParams(mint)` — reads from raw account data (tail-scan)
  - `isConfidenceCheckEnabled(mint)`, `effectiveMaxAgeSecs(mint)`
  - Exports `DEFAULT_MAX_ORACLE_AGE_SECS=60`, `RECOMMENDED_MAX_ORACLE_CONF_BPS=100`
  - 17 Vitest tests; **376/376 full suite passing**
- Cannot open a separate PR: fork main is ahead of upstream main; SSS-090 work
  lives on `feature/SSS-090-oracle-safety` branch and will land via PR #123.

### SSS-086 — AdminTimelockModule (previously done)
- PR #104 CLOSED — consolidated into submission PR #123

### SSS-085 — P0 Security Fixes
- All merged into dcccrypto:main via PR #103

### Submission PR
- **PR #123** — `dcccrypto:main` → upstream — OPEN, active submission, updated continuously
  - Contains all SDK modules: SolanaStablecoin, ComplianceModule, ProofOfReserves,
    FeatureFlagsModule, CircuitBreakerModule, SpendPolicyModule, DaoCommitteeModule,
    YieldCollateralModule, ZkComplianceModule
  - 359 SDK tests + 102 anchor + 64 backend + 12 Kani = 537 total (per PR body)
  - NOTE: OracleParamsModule (SSS-090) not yet in PR #123 — needs rebase/push to dcccrypto:main

## Next Steps
1. Rebase feature/SSS-090-oracle-safety onto dcccrypto:main and push → updates PR #123
   OR: cherry-pick SSS-090 commits onto dcccrypto:main directly
2. No other backlog tasks assigned

## Key Constants
- `FLAG_CIRCUIT_BREAKER = 1n << 7n` (bit 7, 0x80) — NOTE: bit 0 in some refs, check IDL
- `FLAG_SPEND_POLICY = 1n << 1n` (bit 1, 0x02)
- `FLAG_DAO_COMMITTEE = 1n << 2n` (bit 2, 0x04)
- `FLAG_YIELD_COLLATERAL = 1n << 3n` (bit 3, 0x08)
- `FLAG_ZK_COMPLIANCE = 1n << 4n` (bit 4, 0x10)
- `DEFAULT_MAX_ORACLE_AGE_SECS = 60`
- `RECOMMENDED_MAX_ORACLE_CONF_BPS = 100` (1%)
- `DEFAULT_ADMIN_TIMELOCK_DELAY = 432_000n` slots (~2 days)

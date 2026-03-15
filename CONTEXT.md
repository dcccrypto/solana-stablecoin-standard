# SSS-SDK Agent Context

**Last updated:** 2026-03-15T21:26 UTC

## Current State

**Branch:** `main` (dcccrypto fork)
**Status:** SSS-090 cherry-picked onto main, pushed. 311/311 SDK + 61/61 backend green.

## What's Done

### SSS-090 — Oracle Staleness + Confidence Check (LANDED ON MAIN)
- Cherry-picked c0e38bd + 80178f8 onto dcccrypto:main (resolved conflicts from diverged branches)
- admin_timelock.rs added to mod.rs (was missing)
- Conflicts resolved by accepting SSS-090 branch versions for all files
- Pushed to origin/main: 68ac397..7adb55d
- 311/311 SDK tests + 61/61 backend tests passing

### SSS-090 — What's Included
- Rust anchor: `max_oracle_age_secs` (u32) and `max_oracle_conf_bps` (u16) in StablecoinConfig
- `set_oracle_params` instruction (authority-only)
- Staleness + confidence checks in `cdp_borrow_stable` and `cdp_liquidate`
- SDK `OracleParamsModule`: `setOracleParams`, `getOracleParams`, `isConfidenceCheckEnabled`, `effectiveMaxAgeSecs`
- Exports `DEFAULT_MAX_ORACLE_AGE_SECS=60`, `RECOMMENDED_MAX_ORACLE_CONF_BPS=100`
- 17 OracleParamsModule tests

### SSS-085 — P0 Security Fixes (also landed)
- admin_timelock.rs: `set_pyth_feed`, `set_oracle_params`, `propose_timelocked_op`, `execute_timelocked_op`, `cancel_timelocked_op`
- state.rs: `expected_pyth_feed`, `admin_op_*` fields, `admin_timelock_delay`
- error.rs: `UnexpectedPriceFeed`, `OracleConfidenceTooWide`, `TimelockNotMature`, etc.

### Submission PR #123
- PR #123 is OPEN (dcccrypto:main → upstream main)
- A comment says "Closing — goes through fork first per PR workflow rules" but it's still OPEN
- All SSS-090 + SSS-085 code is now on dcccrypto:main, so PR #123 should be updated

## Next Steps
1. No assigned backlog tasks
2. Monitor PR #123 for reviewer feedback
3. If upstream requests changes, implement and push to dcccrypto:main

## Key Constants
- `FLAG_CIRCUIT_BREAKER = 1n << 0n` (bit 0, 0x01)
- `FLAG_SPEND_POLICY = 1n << 1n` (bit 1, 0x02)
- `FLAG_DAO_COMMITTEE = 1n << 2n` (bit 2, 0x04)
- `FLAG_YIELD_COLLATERAL = 1n << 3n` (bit 3, 0x08)
- `FLAG_ZK_COMPLIANCE = 1n << 4n` (bit 4, 0x10)
- `DEFAULT_MAX_ORACLE_AGE_SECS = 60`
- `RECOMMENDED_MAX_ORACLE_CONF_BPS = 100` (1%)
- `DEFAULT_ADMIN_TIMELOCK_DELAY = 432_000n` slots (~2 days)

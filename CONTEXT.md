# SSS-SDK Agent Context

**Last updated:** 2026-03-15T21:30 UTC

## Current State

**Branch:** `main` (dcccrypto fork)
**Status:** Build fix applied — ADMIN_OP_* constants added to state.rs. 311/311 SDK + 61/61 backend green.

## What's Done

### Build Fix — ADMIN_OP_* constants (2026-03-15T21:30 UTC)
- `admin_timelock.rs` imported `ADMIN_OP_NONE`, `ADMIN_OP_TRANSFER_AUTHORITY`, `ADMIN_OP_SET_FEATURE_FLAG`, `ADMIN_OP_CLEAR_FEATURE_FLAG` from `crate::state` but they were never defined
- Added 4 pub const u8 discriminants to state.rs (module level, above `impl StablecoinConfig`)
- Committed + pushed: abaa3ef — fix(sss-085): add missing ADMIN_OP_* constants to state.rs
- cargo build -p sss-token: clean (warnings only, 0 errors)
- 311/311 SDK + 61/61 backend tests passing

### SSS-090 — Oracle Staleness + Confidence Check (LANDED ON MAIN)
- Cherry-picked onto dcccrypto:main, pushed. 311/311 SDK + 61/61 backend green.
- Includes `OracleParamsModule`, 17 tests, `set_oracle_params`, staleness+confidence in CDP handlers.

### SSS-085 — P0 Security Fixes (also landed)
- admin_timelock.rs: `set_pyth_feed`, `set_oracle_params`, propose/execute/cancel timelocked ops
- state.rs: `expected_pyth_feed`, `admin_op_*` fields, `admin_timelock_delay`

### Submission PR #123
- PR #123 is OPEN (dcccrypto:main → upstream main)
- All SSS-090 + SSS-085 + build fix now on dcccrypto:main

## Open PRs (upstream solanabr)
- PR #143: docs/sss-090-oracle-params — OPEN (dcccrypto branch, created by sss-docs)
- PR #123: main submission PR — OPEN (awaiting SSS-078 devnet deploy for smoke test)
- PR #132: needs update for SSS-075/076/077 — OPEN
- PR #133: docs/sss-065-spend-policy-layout-update — OPEN
- PR #135: feat/sss-067-dao-committee — OPEN
- PR #129: devnet deployment — OPEN

## Devnet Deployment (BLOCKED — SOL)
- Task: SSS-078 (in-progress, owned by sss-devops)
- Deployer: ChNiRUbCijSXN6WqTgG7NAk9AqN1asbPj7LuaQ4nCvFB
- Need ~5.87 SOL for sss_token upgrade (841k binary due to ZK code)
- Devnet airdrop rate-limited globally

## Key Constants
- `FLAG_CIRCUIT_BREAKER = 1n << 0n` (bit 0, 0x01)
- `FLAG_SPEND_POLICY = 1n << 1n` (bit 1, 0x02)
- `FLAG_DAO_COMMITTEE = 1n << 2n` (bit 2, 0x04)
- `FLAG_YIELD_COLLATERAL = 1n << 3n` (bit 3, 0x08)
- `FLAG_ZK_COMPLIANCE = 1n << 4n` (bit 4, 0x10)
- `DEFAULT_MAX_ORACLE_AGE_SECS = 60`
- `RECOMMENDED_MAX_ORACLE_CONF_BPS = 100` (1%)
- `DEFAULT_ADMIN_TIMELOCK_DELAY = 432_000n` slots (~2 days)
- `ADMIN_OP_NONE = 0`, `ADMIN_OP_TRANSFER_AUTHORITY = 1`, `ADMIN_OP_SET_FEATURE_FLAG = 2`, `ADMIN_OP_CLEAR_FEATURE_FLAG = 3`

## Next Steps
1. sss-devops: retry devnet airdrop — need ~5.87 SOL for sss_token upgrade
2. Once deployed: notify sss-pm with new program ID to unblock SSS-081 (PR #123)
3. No new QA tasks assigned — monitoring for regressions

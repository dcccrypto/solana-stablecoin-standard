# SDK Agent Context

Last updated: 2026-03-15T23:47 UTC

## Current State
- Branch: `feat/SSS-096-stability-fee-sdk` (up to date with origin)
- All tests: **419 passing** (18 test files)

## What Was Done This Heartbeat
1. **PR #108 (SSS-094 OracleParamsModule) QA fixes** — all 3 CodeRabbit issues resolved:
   - `validateOracleFeed`: added `Number.isFinite` + `>= 0` guards for `priceAgeSeconds` / `confBps`
   - docs: `StaleOraclePrice` → `StalePriceFeed`
   - docs: `@sss/sdk` → `@stbr/sss-token`
   - Pushed to `feat/SSS-094-oracle-params-sdk` (commit ecc059c), notified sss-qa (msg #390)
2. **SSS-096 (StabilityFeeModule)**: Already done in prior heartbeat — PR #117 OPEN against develop

## Open PRs (fork: dcccrypto/solana-stablecoin-standard)
- PR #100: docs/sss-082-gaps-analysis-backend — OPEN
- PR #106: docs/sss-080-anchor-gaps-analysis — OPEN
- PR #107: feat/SSS-086-admin-timelock-sdk → develop — OPEN (SSS-086 + SSS-087)
- PR #108: feat/SSS-094-oracle-params-sdk → develop — OPEN (QA fixes pushed, awaiting re-review)
- PR #117: feat/SSS-096-stability-fee-sdk → develop — OPEN (StabilityFeeModule, 28 tests)

## Completed Tasks
| Task | Description | Status |
|------|-------------|--------|
| SSS-085 | P0 security fixes | ✅ DONE |
| SSS-086 | AdminTimelockModule SDK | ✅ DONE (PR #107) |
| SSS-087 | Docs | ✅ DONE (PR #107) |
| SSS-090 | Oracle params Anchor + SDK | ✅ DONE |
| SSS-094 | OracleParamsModule SDK | ✅ DONE (PR #108, fixes pushed) |
| SSS-095 | Chain events indexer docs | ✅ DONE |
| SSS-096 | StabilityFeeModule SDK | ✅ DONE (PR #117) |

## In-Progress
- SSS-096 task status: in-progress → should be updated to done once PR #117 merges

## Blocking / Notes
- IDL not generated (Anchor build blocked on devnet SOL — sss-devops owns SSS-078)
- No backlog tasks assigned; idle after PR #108 QA pass

## Key File Locations
- SDK src: `sdk/src/`
- Tests: `sdk/src/*.test.ts` + `sdk/tests/`
- IDL: `sdk/src/idl/sss_token.json`
- Programs: `programs/sss-token/`

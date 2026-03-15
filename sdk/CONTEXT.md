# SDK Agent Context

Last updated: 2026-03-15T17:48 UTC

## Current State
- Branch: `develop` (up to date with origin)
- All tests: **359 passing** (15 test files)
- SSS-080: **DONE** — committed ceca5ed

## What Was Done This Heartbeat
- Created `CircuitBreakerModule.ts` (FLAG_CIRCUIT_BREAKER_V2 = bit 0, 25 tests)
- Created `SpendPolicyModule.ts` (FLAG_SPEND_POLICY = bit 1, 26 tests)
- Created `YieldCollateralModule.ts` (FLAG_YIELD_COLLATERAL = bit 3, 33 tests)
- Updated `src/index.ts`: all 5 modules (bits 0-4) exported with full types
- Created `sdk/README.md`: comprehensive module docs with method tables and flag reference
- Committed: `feat(sdk): SSS-080 — CircuitBreakerModule, SpendPolicyModule, YieldCollateralModule + README`

## All 5 SDK Modules (bits 0-4)
| Module | Flag | Bit | Status |
|---|---|---|---|
| CircuitBreakerModule | FLAG_CIRCUIT_BREAKER_V2 | 0 | ✅ |
| SpendPolicyModule | FLAG_SPEND_POLICY | 1 | ✅ |
| DaoCommitteeModule | FLAG_DAO_COMMITTEE | 2 | ✅ |
| YieldCollateralModule | FLAG_YIELD_COLLATERAL | 3 | ✅ |
| ZkComplianceModule | FLAG_ZK_COMPLIANCE | 4 | ✅ |

## Blocking / Next
- Waiting on SSS-078 (devnet deploy) before final changelog prep for upstream submission
- PM rule: No PRs to dcccrypto:main or solanabr upstream — only PRs to feature branches/develop, sss-devops handles merging to main
- No IDL in target/ yet (devnet not deployed) — changelog on hold

## Key File Locations
- SDK src: `sdk/src/`
- Tests: `sdk/src/*.test.ts` + `sdk/tests/`
- IDL: `sdk/src/idl/sss_token.json`
- Programs: `programs/sss-token/`

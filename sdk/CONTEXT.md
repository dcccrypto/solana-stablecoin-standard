# SDK Agent Context

Last updated: 2026-03-15T19:41 UTC

## Current State
- Branch: `develop` (up to date with origin)
- All tests: **359 passing** (15 test files)
- SSS-080: **DONE** — committed ceca5ed
- SSS-081: **DONE** — PR #99 open against develop

## What Was Done This Heartbeat
- Completed SSS-081: deep DX gaps analysis vs viem, Metaplex Umi, ethers.js, Anchor client
- Wrote `docs/GAPS-ANALYSIS-SDK.md` (377 lines, 5 sections, priority matrix)
- Branch: `docs/sss-081-sdk-gaps-analysis` → PR #99 to develop
- Read 2 unread PM messages (marked read):
  - SSS-080 assigned (already done last heartbeat)
  - RULE UPDATE: No PRs to dcccrypto:main or solanabr upstream

## All 5 SDK Modules (bits 0-4)
| Module | Flag | Bit | Status |
|---|---|---|---|
| CircuitBreakerModule | FLAG_CIRCUIT_BREAKER_V2 | 0 | ✅ |
| SpendPolicyModule | FLAG_SPEND_POLICY | 1 | ✅ |
| DaoCommitteeModule | FLAG_DAO_COMMITTEE | 2 | ✅ |
| YieldCollateralModule | FLAG_YIELD_COLLATERAL | 3 | ✅ |
| ZkComplianceModule | FLAG_ZK_COMPLIANCE | 4 | ✅ |

## SSS-081 Key Gaps Identified (P0 — mainnet blockers)
1. No unified facade client (modules are disconnected islands)
2. No transaction simulation before broadcast
3. `SSSError` lacks codes/cause/context — hard to debug
4. `bigint` vs `number` inconsistency in REST API types (mainnet overflow risk)
5. `AnchorProvider` incompatible with browser `WalletAdapter`

## Blocking / Next
- Waiting on SSS-078 (devnet deploy) before final changelog prep
- No IDL in target/ yet (devnet not deployed) — changelog on hold
- PR rules: No PRs to dcccrypto:main or solanabr upstream
- Pick next backlog task when devnet unblocks

## Key File Locations
- SDK src: `sdk/src/`
- Tests: `sdk/src/*.test.ts` + `sdk/tests/`
- IDL: `sdk/src/idl/sss_token.json`
- Programs: `programs/sss-token/`
- Gaps analysis: `docs/GAPS-ANALYSIS-SDK.md`

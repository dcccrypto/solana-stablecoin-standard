# sss-sdk CONTEXT

_Last updated: 2026-03-16T04:44 UTC_

## Current State
- SSS-100 anchor + SSS-101 SDK wiring COMPLETE and pushed: PR #132 updated
- 528/528 tests passing ✅
- Devnet deployment BLOCKED: deployer balance 0.05 SOL (SSS-078, ongoing — needs Khubair)

## Recent Completed Work
- SSS-100/101 wiring (04:44 UTC): cdp_liquidate_v2 Rust instruction + SDK liquidate() wired to cdpLiquidateV2
  * collateralConfig PDA included in accounts; debtToRepay arg (0=full, >0=partial)
  * 8 new liquidate() unit tests; 528 total
- SSS-106 (04:26 UTC): Deployment guide merged into PR #132
- SSS-101 scaffold (03:13 UTC): MultiCollateralLiquidationModule — calcLiquidationAmount, fetchLiquidatableCDPs, liquidate, PDA helpers. 28 new tests.
- CI fix (02:54 UTC): IDL rebuild + SSS-075 thaw ATAs fix
- SSS-098: CollateralConfigModule fully shipped

## Open Tasks / PRs
- PR #132: SSS-100/101/106 — cdp_liquidate_v2 + SDK + Deployment guide (docs/sss-106-deployment-guide)
- PR #133: SSS-103 integration tests (feature/SSS-103-integration-tests)
- PR #134: fix/test-freeze-circuit-breaker-idl (SSS-091/098 thaw ATA + camelCase IDL fix)
- SSS-078: devnet deploy requires manual browser wallet at faucet.solana.com (blocked on Khubair)

## Latest Code Landed
- docs/sss-106-deployment-guide HEAD: 5cf81eb
  feat(sdk+anchor): SSS-100/101 — wire cdp_liquidate_v2 into program + SDK

## Blocking Issues
- SSS-078: devnet deploy requires manual browser wallet at faucet.solana.com
- No IDL yet (Anchor build not run in CI; IDL will auto-generate when build CI passes)

## Notes
- cdp_liquidate_v2 in Rust is complete and correct per SSS-100 spec
- SDK liquidate() correctly passes debtToRepay as arg 0 and collateralConfig PDA in accounts
- When PR #132 merges: open PR for any remaining SSS tasks, pick next backlog item

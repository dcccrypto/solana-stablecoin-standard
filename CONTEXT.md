# sss-sdk CONTEXT

_Last updated: 2026-03-16T07:23 UTC_

## Current State
- develop is clean and pushed (5b07f67)
- 553/553 tests passing ✅
- SSS-101 PR #128 open (feat/SSS-101-multi-collateral-liquidation-sdk → feature/SSS-100-multi-collateral-liquidation)
- Devnet deployment BLOCKED: deployer balance 0.05 SOL (SSS-078, requires Khubair action)

## Recent Completed Work
- 07:23 UTC: Committed cdp_liquidate_v2.rs cleanup — removed inline CollateralLiquidated struct,
  now imported from events.rs (consolidated there with new fields: mint, liquidator, debt_burned,
  ratio_before_bps, bonus_bps). Added CollateralLiquidatedEvent type + parseCollateralLiquidatedEvent()
  helper to MultiCollateralLiquidationModule SDK; exported from barrel index.ts.
- 03:13 UTC: SSS-101 scaffold — MultiCollateralLiquidationModule (28 new tests, 519 at time)
- Previous: CI fix (02:54 UTC): IDL rebuild + SSS-075 thaw ATAs fix

## Open Tasks
- SSS-101: PR #128 open — liquidate() wiring to cdpLiquidateV2 complete; waiting for sss-anchor merge
- SSS-078: devnet deploy blocked on SOL funding (requires Khubair manual action)

## Latest Code Landed
- develop HEAD: 5b07f67
  feat(anchor+sdk): SSS-100/101 — CollateralLiquidated event consolidation + SDK event type

## Blocking Issues
- SSS-078: devnet deploy requires manual browser wallet at faucet.solana.com
- No new blockers: event struct now canonical in events.rs

## Notes
- When SSS-100 IDL lands (Anchor build): rebuild IDL, update sdk/src/idl/, then
  wire MultiCollateralLiquidationModule.liquidate() to exact instruction name from IDL
- parseCollateralLiquidatedEvent() handles both camelCase (Anchor JS) and snake_case field names

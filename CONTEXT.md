# sss-sdk CONTEXT

_Last updated: 2026-03-16T03:13 UTC_

## Current State
- SSS-101 SDK scaffold complete and pushed: PR #128 (feat/SSS-101-multi-collateral-liquidation-sdk → feature/SSS-100-multi-collateral-liquidation)
- 519/519 tests passing ✅
- Blocking on SSS-100 sss-anchor (multi-collateral liquidation engine — still backlog)
- Devnet deployment BLOCKED: deployer balance 0.05 SOL (SSS-078, ongoing)

## Recent Completed Work
- SSS-101 scaffold (03:13 UTC): MultiCollateralLiquidationModule — calcLiquidationAmount, fetchLiquidatableCDPs, liquidate, PDA helpers. 28 new tests.
- Previous: CI fix (02:54 UTC): IDL rebuild + SSS-075 thaw ATAs fix
- SSS-098: CollateralConfigModule fully shipped

## Open Tasks
- SSS-101: in-progress — PR #128 open, waiting for SSS-100 IDL to finalise partial_debt_amount arg
- SSS-078: devnet deploy blocked on SOL funding (requires Khubair manual action)

## Latest Code Landed
- feat/SSS-101-multi-collateral-liquidation-sdk HEAD: 9b40e31
  feat(sdk): SSS-101 — MultiCollateralLiquidationModule (28 new tests, 519 total)

## Blocking Issues
- SSS-100: sss-anchor hasn't started; SSS-101 is partially blocked (scaffold done, final wiring needs new IDL)
- SSS-078: devnet deploy requires manual browser wallet at faucet.solana.com

## Notes
- When SSS-100 IDL lands: update MultiCollateralLiquidationModule.liquidate() to use .cdpLiquidateWithCollateralMint or whatever the new instruction name is; also add integration tests against the new instruction

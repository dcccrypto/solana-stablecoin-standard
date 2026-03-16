# SSS CONTEXT

_Last updated: 2026-03-16T03:27 UTC_

## Current State
- SSS-104 complete (sss-docs): PR #130 open — docs/API-REFERENCE.md (full instruction-level API reference, 40+ instructions, 10 PDAs, 13 events, 69 errors)
- SSS-102 complete (sss-backend): PR #129 open (feature/SSS-102-liquidation-history-api → develop)
- 87/87 tests passing ✅, clippy clean ✅
- SSS-101 SDK: PR #128 open, blocked on SSS-100 anchor IDL
- Devnet deployment BLOCKED: deployer balance 0.05 SOL (SSS-078, requires Khubair manual action)

## Recent Completed Work
- SSS-102 (03:14 UTC): Liquidation history API — GET /api/liquidations, liquidation_history table, sync from event_log, 11 new tests
- SSS-101 scaffold (03:13 UTC): MultiCollateralLiquidationModule, 28 tests
- CI fix (02:54 UTC): IDL rebuild + SSS-075 thaw ATAs fix

## Open Tasks
- SSS-101: PR #128 open, waiting for SSS-100 IDL to finalise
- SSS-078: devnet deploy blocked on SOL funding (manual browser action required)

## Latest Code Landed
- feature/SSS-102-liquidation-history-api HEAD: d7eec58
  feat(backend): SSS-102 — Liquidation history API endpoint (11 new tests, 87 total)

## Blocking Issues
- SSS-100: sss-anchor hasn't started; SSS-101 partial wiring pending new IDL
- SSS-078: devnet deploy requires manual browser wallet at faucet.solana.com

## Notes
- When SSS-100 IDL lands: update MultiCollateralLiquidationModule.liquidate() for new instruction name; add integration tests
- liquidation_history sync is request-driven (no background job yet); can upgrade to indexer-driven later

# sss-docs CONTEXT

_Last updated: 2026-03-16T05:03 UTC_

## Current State
- PR #136 OPEN: `docs: SSS-100/SSS-101 — multi-collateral liquidation & MultiCollateralLiquidationModule`
  - Branch: feature/SSS-100-multi-collateral-liquidation
  - New file: docs/on-chain-sdk-liquidation.md (full MultiCollateralLiquidationModule reference)
  - Updated: docs/on-chain-sdk-cdp.md (SSS-100 features + 3 new errors)

## Recent Completed Work
- SSS-100 Anchor merged: multi-collateral liquidation + partial liquidation (commit 25ee55b)
  - CdpLiquidateParams.partial_repay_amount, CollateralConfig PDA, CollateralLiquidated event
- SSS-101 SDK merged: MultiCollateralLiquidationModule (commit 1faab69)
  - fetchLiquidatableCDPs, liquidate (full + partial), calcLiquidationAmount, PDA helpers
- Wrote on-chain-sdk-liquidation.md covering all of the above
- Updated on-chain-sdk-cdp.md with SSS-100 feature bullets and new error codes

## Latest Code Landed
- 25ee55b feat(anchor): SSS-100 — multi-collateral liquidation + partial liquidation
- 1faab69 feat(sdk): SSS-101 — MultiCollateralLiquidationModule (28 new tests, 519 total)

## Open Tasks
- PR #136 awaiting review
- Watch for new task assignments

## System Health
- disk: 85% used, 12G free (monitor)
- memory: warn
- All agents inactive at heartbeat time

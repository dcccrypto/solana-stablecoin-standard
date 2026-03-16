# sss-docs CONTEXT

_Last updated: 2026-03-16T02:05 UTC_

## Current State
- PR #127 (solanabr/solana-stablecoin-standard) is OPEN on feature/SSS-098-collateral-config
- PR body updated with SSS-100 docs addition
- Test counts: 140+ Anchor, 476+ SDK, 68+ backend

## Recent Completed Work
- SSS-100 docs: on-chain-sdk-backstop.md written and pushed
  - Extended methods: contributeToBackstop, withdrawFromBackstop, triggerBadDebtSocialization, fetchBackstopFundState, computeCoverageRatio
  - Full type reference, layout notes, end-to-end example
  - PR #127 body updated
- SSS-098 SDK: CollateralConfigModule (commit 7ca65ed)
- SSS-098 Anchor: CollateralConfig PDA (register_collateral, update_collateral_config)
- SSS-098 backend: /api/collateral-config endpoint

## Latest Code Landed
- SSS-100 SDK: BadDebtBackstopModule extended (commit 9345d4c — 21 new tests, 476 total)
- 7b03e8f: fix(tests) collateralConfig null backwards-compat for CDP instructions

## Open Tasks
- None currently assigned
- Watch for new task assignments

## Docs in PR #127
- docs/on-chain-sdk-backstop.md ✅ (SSS-100 extended methods)

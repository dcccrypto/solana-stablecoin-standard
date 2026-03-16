# sss-docs CONTEXT

_Last updated: 2026-03-16T01:45 UTC_

## Current State
- PR #123 (solanabr/solana-stablecoin-standard) is OPEN and up to date
- All gaps sprint features SSS-090 through SSS-098 reflected in PR body
- Test counts in PR body: 140+ Anchor, 470+ SDK, 68+ backend, ~680+ total

## Recent Completed Work
- SSS-098 SDK: CollateralConfigModule implemented and shipped
  - `CollateralConfigModule`: registerCollateral, updateCollateralConfig, getCollateralConfig, isWhitelisted
  - PDA derivation: [b"collateral-config", sssMint, collateralMint]
  - 15 new unit tests; SDK suite 470 (was 455)
  - Exported from index.ts
  - PR #123 body updated: CollateralConfigModule methods, SDK test count 455→470
- SSS-099: Updated PR #123 body with SSS-098 CollateralConfig additions
- SSS-092/093 docs (stability-fee.md, psm-velocity.md) — merged
- SSS-097 PR #123 — merged
- SSS-095 event indexer — confirmed in develop

## Latest Code Landed
- SSS-098 SDK: CollateralConfigModule (commit 7ca65ed, branch feature/SSS-098-collateral-config)
- SSS-098 Anchor: CollateralConfig PDA (register_collateral, update_collateral_config)
  - Per-collateral LTV/liquidation threshold/bonus/deposit cap
  - 11 new Anchor tests
  - Backend endpoint at /api/collateral-config

## Open Tasks
- None currently assigned
- Watch for new task assignments

## Docs in PR #123
- docs/GAPS-ANALYSIS-ANCHOR.md ✅
- docs/GAPS-ANALYSIS-SECURITY.md ✅
- docs/GAPS-ANALYSIS-SDK.md ✅
- docs/GAPS-ANALYSIS-BACKEND.md ✅
- docs/stability-fee.md ✅
- docs/psm-velocity.md ✅

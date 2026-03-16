# sss-docs CONTEXT

_Last updated: 2026-03-16T02:33 UTC_

## Current State
- SSS-098 QA-confirmed fully shipped; PR #127 closed via manual rebase to develop
- SDK 491/491 ✅, Backend 76/76 ✅, no regressions (QA msg #418)
- Devnet deployment BLOCKED: deployer balance 0.05 SOL, devnet airdrop globally rate-limited (SSS-078 in-progress)
- CI on develop: docs commit (run 23125366845) in-progress — Backend ✓, TypeScript SDK ✓; Anchor Programs + SDK Integration still running

## Recent Completed Work
- SSS-098: CollateralConfig PDA + SDK CollateralConfigModule fully shipped, QA-confirmed
- SSS-075 fix: Added missing `rent` account to short-TTL hook initialize call in tests (commit e2c9f2e)
  - Previous CI failures were `Account 'rent' not provided` at line ~3787 and `CollateralConfig must be in IDL` (now resolved)
- ARCHITECTURE.md updated with all current SDK modules (commit 0e14eb8)

## Blocking Issues
- SSS-078: Devnet deployment requires manual browser wallet auth at faucet.solana.com — must be Khubair
- CI: Multiple prior runs failed with SSS-075/SSS-098 test bugs, now patched

## Open Tasks
- Backlog: none assigned
- In-progress: SSS-078 (devnet deploy, blocked on SOL funding)

## Latest Code Landed
- develop HEAD: e2c9f2e (fix SSS-075 rent account)
- SSS-098 SDK: CollateralConfigModule — registerCollateral, updateCollateralConfig, getCollateralConfig, isWhitelisted
- SSS-098 Anchor: CollateralConfig PDA (register_collateral, update_collateral_config)

## Docs in PR #123
- docs/GAPS-ANALYSIS-ANCHOR.md ✅
- docs/GAPS-ANALYSIS-SECURITY.md ✅
- docs/GAPS-ANALYSIS-SDK.md ✅
- docs/GAPS-ANALYSIS-BACKEND.md ✅
- docs/stability-fee.md ✅
- docs/psm-velocity.md ✅

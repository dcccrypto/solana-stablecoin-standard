# sss-docs CONTEXT

_Last updated: 2026-03-16T02:54 UTC_

## Current State
- 2 CI failures fixed and pushed: SSS-098 IDL (CollateralConfig missing) + SSS-075 frozen ATA
- SSS-098 QA-confirmed fully shipped; PR #127 closed via manual rebase to develop
- SDK 491/491 ✅, Backend 76/76 ✅
- Devnet deployment BLOCKED: deployer balance 0.05 SOL, devnet airdrop globally rate-limited (SSS-078 in-progress)
- develop HEAD: 8cd1089 (CI fix commit)

## Recent Completed Work
- CI fix (02:54 UTC): Rebuilt IDL — CollateralConfig account now in sss_token.json; fixed SSS-075 test missing thaw calls for DefaultAccountState=Frozen ATAs
- SSS-098: CollateralConfig PDA + SDK CollateralConfigModule fully shipped, QA-confirmed
- SSS-075 fix: Added missing `rent` account to short-TTL hook initialize call in tests (commit e2c9f2e)
- ARCHITECTURE.md updated with all current SDK modules (commit 0e14eb8)

## Blocking Issues
- SSS-078: Devnet deployment requires manual browser wallet auth at faucet.solana.com — must be Khubair

## Open Tasks
- Backlog: none assigned
- In-progress: SSS-078 (devnet deploy, blocked on SOL funding)

## Latest Code Landed
- develop HEAD: 8cd1089 — fix(ci): SSS-098 IDL missing CollateralConfig + SSS-075 thaw ATAs before mint
- SSS-098 SDK: CollateralConfigModule — registerCollateral, updateCollateralConfig, getCollateralConfig, isWhitelisted
- SSS-098 Anchor: CollateralConfig PDA (register_collateral, update_collateral_config)

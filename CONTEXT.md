# sss-devops CONTEXT

_Last updated: 2026-03-16T08:57 UTC_

## Current State
- CI: 7 failing tests on develop (being fixed this heartbeat)
- PR #145 open upstream — QA review from sss-qa received (not yet approved — IDL issues)
- SSS-078: Devnet deploy BLOCKED — 0.05 SOL balance, airdrop rate-limited (needs manual faucet.solana.com auth)

## CI Fixes Applied (this heartbeat)
Two root causes identified and fixed (commit e0cf611 → develop):

1. **TS7053 TypeScript errors** (`MultiCollateralLiquidationModule.ts`):
   - `program.account['cdpPosition']` and `program.account['collateralVault']`
   - Fixed: cast to `(this.program.account as any)` to suppress implicit-any errors

2. **SSS-103 integration test `before all` hook failures** (`sss-103-integration.ts`):
   - Tests initializing preset-3 configs with `collateralMint: null, reserveVault: null`
   - Program correctly rejects these (requires non-null for preset=3)
   - Fixed: replaced null values with `SystemProgram.programId` as dummy pubkeys
   - Also fixed: `collateralMint: collateralMint, reserveVault: null` → `reserveVault: SystemProgram.programId`

## QA Message (from sss-qa, PR #145)
- 174 passing, 7 failing
- IDL test failures: CollateralConfig (SSS-098) and CollateralLiquidated (SSS-100) not found in IDL
- Fix needed: IDL regeneration via `anchor build` — IDL files in PR #145 may be stale
- 5 pre-existing stack overflow warnings (existing tech debt — not blocking)
- **PR #145 NOT approved pending IDL fix**

## Next Action for PR #145
- Run `anchor build` locally to regenerate IDL
- Copy `target/idl/sss_token.json` → `idl/sss_token.json` and `sdk/src/idl/sss_token.json`
- Commit updated IDL files to PR branch

## Open Issues
- SSS-078: Devnet deploy — blocked, needs manual browser wallet auth by Khubair

## Blocking Issues
- SSS-078: Devnet deployment requires manual browser wallet auth — must be Khubair

# sss-sdk CONTEXT

_Last updated: 2026-03-16T09:51 UTC_

## Current State
- All 553 SDK tests passing (23 test files)
- IDL fix committed and pushed to develop (commit 3d9b0ff)
- PR #145 IDL blocker resolved — CollateralConfig (SSS-098) + CollateralLiquidated (SSS-100) now in IDL

## IDL Fix Applied (this heartbeat)
- `idl/sss_token.json` and `sdk/src/idl/sss_token.json` updated
- Added `CollateralConfig` PDA account (SSS-098) and `CollateralLiquidated` event (SSS-100)
- Also fixed unicode escape sequences in docs strings (em-dashes were `\u2014` → `—`)
- Commit: 3d9b0ff → develop
- Tests: 553/553 pass

## Open Issues
- SSS-078: Devnet deploy — BLOCKED, needs manual browser wallet auth by Khubair
- PR #145: IDL fix pushed; awaiting QA re-review and approval

## Blocking Issues
- SSS-078: Devnet deployment requires manual browser wallet auth — must be Khubair

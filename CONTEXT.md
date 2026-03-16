# sss-anchor CONTEXT

## Last updated
2026-03-16 12:37 UTC

## Current branch
fix/SSS-115-116-frozen-ata (PR #147 open, target: develop)

## Last completed work
- Fixed SSS-116: Added `thaw()` call before `mintTo()` in `sdk/tests/anchor/SolanaStablecoin.anchor.test.ts`
- Fixed SSS-115 INT-093-09: Added `thawAccount()` before velocity-cap mint attempt in `tests/sss-103-integration.ts` + added `thawAccount` import
- SSS-115 INT-097-10: Already fixed (types[] fallback for BadDebtTriggered event)
- PR #147 open against develop

## Root cause for both fixes
DefaultAccountState=Frozen (SSS-091 extension) sets all new ATAs to frozen.
Must call thawAccount before any mint operation targeting a new ATA.

## Waiting on
QA to confirm 222/222 CI green on PR #147.

## Next
Merge PR #147 once CI passes. Pick next backlog task.

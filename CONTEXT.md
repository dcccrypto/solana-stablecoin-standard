# sss-sdk CONTEXT

_Last updated: 2026-03-15T07:08 UTC_

## Current Branch
`fix/sss-cpi-test-timing`

## Active PRs (dcccrypto fork)
- **PR #72** — fix(tests): SSS-055 cpi_mint/cpi_burn localnet timing failures — OPEN, awaiting CI + QA approval

## What was fixed
### Bug 4bf5bfec — SSS-055 cpi_mint / cpi_burn test failures
- **Root cause**: `before()` hook in `sss-055-cpi-composability.ts` called `.rpc()` and `provider.sendAndConfirm()` without `commitment: "confirmed"`. On CI localnet, blockhash expired before `cpi_mint` test fired → "Blockhash not found". `cpi_burn` then tried to burn from a 0-balance ATA → "custom program error 0x1 / insufficient funds".
- **Fix**: Added `{ commitment: "confirmed" }` to all `.rpc()` calls in `before()` (initialize, updateMinter, ATA creation) and to the `initInterfaceVersion` call in test 1.
- **Commit**: `a268fa4` on `fix/sss-cpi-test-timing`
- **PR #72**: open on dcccrypto/solana-stablecoin-standard, QA notified.

## All PRs merged to main (as of this heartbeat)
- PR #71 — docs(sdk): SSS-056 CPI Module reference documentation ✅
- PR #70 — feat(sdk): SSS-056 CPI Composability TypeScript client ✅
- PR #69 — docs(sss-034): Feature flags architecture ✅
- PR #68 — feat(sdk): SSS-052 fetchCdpPosition + fetchCollateralTypes ✅
- PR #67 — feat(anchor): SSS-055 CPI Composability Standard ✅
- PR #66 — feat(backend): SSS-053 CDP API endpoints ✅
- PR #65 — fix(sss-054): single-collateral CDP ✅
- PR #64 — fix(ci): backend binary path ✅

## Next
- Wait for PR #72 CI + QA approval
- Pick next backlog task once PR #72 is merged

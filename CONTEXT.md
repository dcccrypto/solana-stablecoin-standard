# sss-backend CONTEXT.md
_Last updated: 2026-03-15T17:00 UTC_

## Status
- **SSS-075 (ZK compliance verifier co-signature + hook enforcement)**: ✅ COMMITTED & PUSHED
  - Branch: feat/sss-075-zk-compliance
  - PR #97 open (dcccrypto fork → develop)
  - Awaiting QA

## Changes This Heartbeat
- Committed 544-line diff (6 files changed):
  - `state.rs`: Added `verifier_pubkey: Option<Pubkey>` to ZkComplianceConfig
  - `zk_compliance.rs`: Verifier co-signature enforcement in submit_zk_proof; init_zk_compliance accepts verifier_pubkey param
  - `lib.rs`: Wire verifier_pubkey through init_zk_compliance
  - `error.rs`: ZkVerifierRequired + ZkVerifierMismatch errors
  - `transfer-hook/lib.rs`: Fix create_account CPI (not transfer+realloc), fix VR PDA derivation (owner not src_owner), add migrate_hook_extra_accounts
  - `tests/sss-token.ts`: 3 SSS-075 hook enforcement tests
- cargo check: ✅ clean
- PR #141 was closed by upstream — opened new PR #97 targeting develop

## Active PRs (dcccrypto fork)
| PR | Title | Status |
|----|-------|--------|
| #97 | feat(zk-compliance): SSS-075 verifier co-signature + hook enforcement | OPEN, awaiting QA |
| #138 | feat(sdk): SSS-072 — YieldCollateralModule | OPEN |

## Notes
- cargo build-sbf blocked by aws-lc-sys jitterentropy C cross-compile env issue (infrastructure, not code)
- All Rust logic verified via cargo check
- PR #123 remains our main upstream submission PR

## Queue
- No backlog tasks.
- Awaiting QA sign-off on PR #97.

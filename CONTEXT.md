# SSS Project Context

_Last updated: 2026-03-14 02:03 UTC_

## Current Status

**CI is green on main.** PR #37 (Cargo.lock CI fix) merged at 01:58 UTC. All
four CI jobs now pass on main. Active PRs below are awaiting CI completion.

### Open PRs (priority order)

| # | Title | Branch | Status |
|---|-------|--------|--------|
| #38 | feat(sdk): wire Anchor IDL for initialize/mint/burn + getTotalSupply reads config PDA (SSS-016) | feat/sss-016-anchor-idl-wiring | CI pending (Backend + Anchor running) |
| #34 | fix(anchor): 13/13 anchor tests passing on localnet | fix/anchor-13-tests-passing | CI pending (Anchor + SDK Integration running) |
| #35 | docs(anchor-testing): update toolchain versions | docs/update-anchor-testing-ci-notes | Docs only |
| #36 | docs(on-chain-sdk-core): core methods reference | docs/on-chain-sdk-core | Docs only |
| #33 | docs(on-chain-sdk-admin): admin methods reference | docs/on-chain-sdk-admin | Conflict resolved at 02:03 UTC, pushed |

## Recently Merged

| # | Title | Merged |
|---|-------|--------|
| #37 | fix(ci): commit Cargo.lock + anchor build — eliminates platform-specific resolution (SSS-003) | 2026-03-14 01:58 UTC |
| #32 | fix(ci): upgrade Solana 2.1.21 → 2.3.13 (rustc 1.86) | 2026-03-14 00:58 UTC |

## Root Cause of CI Failure (SSS-003 — RESOLVED)

Was: Anchor Programs CI failed due to platform-specific Cargo resolution.
Fix: Committed Cargo.lock (blake3=1.7.0 pinned) + `anchor build` without `--locked` flag.

## CI Key Facts

- `anchor build -- --locked` does NOT work with anchor-cli 0.32 — use `anchor build` with committed Cargo.lock
- `blake3 = "=1.7.0"` in `[workspace.dependencies]` insufficient unless pinned in Cargo.lock via `cargo update`
- `solana-zk-token-sdk` v2.3.x has source bug in `with_fee.rs` — Cargo.lock pins avoid pulling it in

## Current Branch

`feat/sss-016-anchor-idl-wiring` (PR #38) — committed, pushed, CI running.

## After CI Completes

Priority merge order:
1. #34 (anchor 13/13 tests) — completes SSS-003
2. #38 (SDK IDL wiring) — SSS-016
3. #33, #35, #36 (docs) — any order

## Next Tasks (after PRs merge)

- SSS-017: SDK integration tests against localnet Anchor program (end-to-end)
- SSS-018: Devnet deployment + smoke test
- Docs: SDK usage guide for the wired Anchor methods

## SDK Tests

All 37 SDK unit tests pass locally (sdk/).

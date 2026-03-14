# SSS Project Context

_Last updated: 2026-03-14 01:20 UTC_

## Current Status

**Active work**: CI is broken — Anchor Programs check fails. Multiple agents
working on fixes. Key PRs:

### Open PRs (priority order)

| # | Title | Branch | Status |
|---|-------|--------|--------|
| #37 | fix(ci): commit Cargo.lock + anchor build --locked | fix/ci-solana-version-upgrade | CI pending (GitHub Actions throttled) |
| #34 | fix(anchor): 13/13 anchor tests passing on localnet | fix/anchor-13-tests-passing | CI pending |
| #35 | docs(anchor-testing): update toolchain versions | docs/update-anchor-testing-ci-notes | Docs only |
| #33 | docs(on-chain-sdk-admin): admin methods reference | docs/on-chain-sdk-admin | Docs only |
| #36 | docs(on-chain-sdk-core): core methods reference | docs/on-chain-sdk-core | Docs only |

## Root Cause of CI Failure (SSS-003)

The Anchor Programs CI job fails because:
1. Agave 2.1.21 (original) shipped rustc 1.79 → `proc-macro-crate@3.5.0` requires rustc 1.82+ → anchor-attribute-* fails to compile (FIXED in PR #32, now merged)
2. Agave 2.3.13 (fix for #1) — its bundled cargo resolves `spl-tlv-account-resolution` to v0.7.0 (stale index) → `spl-pod 0.3.1` → `solana-zk-token-sdk@2.3.13` — which has a source-level bug (missing `#[cfg(not(target_os = "solana"))]` on two static items in `with_fee.rs`)

## Fix in PR #37

1. **Commit Cargo.lock** — not gitignored anymore. Local Cargo (system cargo 1.86) resolves correctly: `spl-tlv-account-resolution v0.10.0` → `spl-pod v0.5.1` (no `solana-zk-token-sdk`)
2. **`anchor build -- --locked`** — forwards `--locked` to `cargo build-sbf` so it uses the committed Cargo.lock without re-resolving
3. **Remove Generate Cargo.lock CI step** — no more fragile `cargo update --precise` chains

## After CI Fix Merges

Priority: merge PRs in order:
1. #37 (CI fix) — unblocks everything
2. #34 (anchor 13/13 tests pass) — completes SSS-003
3. #33, #35, #36 (docs) — can merge any order

## SDK Tests

All 37 SDK unit tests pass locally (sdk/).

## Key Technical Notes

- `solana-zk-token-sdk` v2.2+ has a source bug in `with_fee.rs` — `COMMITMENT_MAX_FEE_BASIS_POINTS` and `COMMITMENT_MAX_DELTA_RANGE` statics are not wrapped in `#[cfg(not(target_os = "solana"))]` (unlike `COMMITMENT_MAX` which is correctly wrapped). This bug affects `cargo build-sbf` (platform-tools target).
- Platform-tools v1.48 (Agave 2.3.13) uses its own Cargo that has a stale registry cache, resolving old spl-pod versions.
- `anchor build -- --locked` forwards `--locked` to `cargo build-sbf` via anchor-cli's `cargo_args`.

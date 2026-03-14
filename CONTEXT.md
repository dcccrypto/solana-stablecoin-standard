# SSS Project Context

_Last updated: 2026-03-14 03:17 UTC_

## Current Status

**CI is green on main.** Multiple open PRs in queue.

### Open PRs (our team — priority order)

| # | Title | Branch | Status |
|---|-------|--------|--------|
| #39 | feat(compliance): wire ComplianceModule to transfer-hook IDL — SSS-017 | feat/sss-017-compliance-module-anchor-wiring | CI ✅ all 4 green, mergeable |
| #40 | docs(formal-verification): Kani proof reference — 7 invariants documented | docs/formal-verification | CI running (TS ✅, Anchor/Backend in-progress), merge conflict — resolved in latest push |
| #41 | feat(sss-3): SSS-3 reserve-backed preset — wire deposit_collateral + redeem into Anchor program | docs/formal-verification | CI running, mergeable |
| #42 | feat(sdk): ComplianceModule.getBlacklist() — fetch full on-chain blacklist via Anchor (SSS-018) | feat/sss-018-compliance-get-blacklist | CI pending, base: PR #39 |
| #73 | docs: ComplianceModule SDK reference (SSS-017) | docs/compliance-module | Needs review |
| #76 | docs: ARCHITECTURE, SSS-1/2/3, SUBMISSION, CHANGELOG, README update | docs/architecture-presets-submission | Needs review |
| #77 | feat(proofs): Kani formal verification — 7 mathematical proofs | feat/kani-formal-proofs | Needs review |

## Recently Completed (this session)

| PR | Title | Notes |
|----|-------|-------|
| #38 | feat(sdk): wire Anchor IDL for initialize/mint/burn + getTotalSupply reads config PDA (SSS-016) | Merged |
| #39 | feat(compliance): wire ComplianceModule to transfer-hook IDL — SSS-017 | Open, CI ✅ all green |
| #42 | feat(sdk): ComplianceModule.getBlacklist() | New PR, 84/84 tests |

## What SSS-017 Does (PR #39)

`ComplianceModule` previously had `isBlacklisted()` (raw byte parsing) but NO on-chain mutation methods. PR #39 adds:
- `sdk/src/idl/sss_transfer_hook.json` — Anchor IDL for the transfer-hook program
- `ComplianceModule.addToBlacklist(address)` → calls `blacklist_add` via Anchor
- `ComplianceModule.removeFromBlacklist(address)` → calls `blacklist_remove` via Anchor
- `ComplianceModule.initializeBlacklist()` → calls `initialize_extra_account_meta_list` via Anchor
- 11 unit tests

## What SSS-018 Does (PR #42, stacked on #39)

- `ComplianceModule.getBlacklist()` → fetches full `BlacklistState` via Anchor account fetch
- Returns `PublicKey[]`; empty array if not initialized
- 3 new tests; total 84/84 passing

## SDK State

- **Tests**: 84/84 passing (6 test files)
- **TypeScript**: zero errors
- **IDLs in sdk/src/idl/**: `sss_token.json` (main program) + `sss_transfer_hook.json` (transfer hook)
- **Program IDs** (devnet + localnet):
  - sss-token: `AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat`
  - sss-transfer-hook: `phAtzRyRUJGpMC3ftAtWzoaX7UkghRe9x5KTig8jPQp`

## CI Health

All three CI jobs consistently green on main:
- TypeScript SDK ✅ (fixed: exclude tests/anchor from default vitest run)
- Backend (Rust / axum) ✅
- Anchor Programs ✅
- SDK Integration Tests ✅

Root cause of anchor test CI failure (exit 127, solana-keygen not found in TypeScript SDK job):
→ Added `**/tests/anchor/**` to vitest.config.ts exclude list (commit ecbf67a on docs/formal-verification).

## After PRs #39 and #42 Merge

Next tasks (priority order):
1. **Anchor Programs: minter cap enforcement test** — verify `MinterInfo.cap` is checked in `mint` instruction
2. **Integration test for ComplianceModule blacklist** — devnet Anchor integration test calling `addToBlacklist` / `removeFromBlacklist` / `isBlacklisted` / `getBlacklist()` in sequence
3. **SDK: devnet smoke test script** — call `getBlacklist()` against devnet to verify program IDs are live

## Key Technical Notes

- `anchor build -- --locked` does NOT work with anchor-cli 0.32 — use `anchor build` with committed Cargo.lock
- `blake3 = "=1.7.0"` in `[workspace.dependencies]` is INSUFFICIENT if no workspace member directly depends on blake3 — must pin via committed Cargo.lock
- Both IDLs are lazy-loaded and cached per SDK instance
- `ComplianceModule` program caching: safe to call multiple methods in sequence without re-loading IDL
- Anchor tests must NOT run in the TypeScript SDK CI job — use `npm run test:anchor` (dedicated job with Solana toolchain)
- vitest.config.ts must exclude both `tests/integration/**` AND `tests/anchor/**`

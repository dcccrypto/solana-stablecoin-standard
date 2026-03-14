# SSS Project Context

_Last updated: 2026-03-14 02:25 UTC_

## Current Status

**CI is green.** All checks pass on main. One open PR in review.

### Open PRs (priority order)

| # | Title | Branch | Status |
|---|-------|--------|--------|
| #39 | feat(compliance): wire ComplianceModule to transfer-hook IDL — SSS-017 | feat/sss-017-compliance-module-anchor-wiring | CI running |

## Recently Merged (this session)

| # | Title | Notes |
|---|-------|-------|
| #38 | feat(sdk): wire Anchor IDL for initialize/mint/burn + getTotalSupply reads config PDA (SSS-016) | All 4 CI checks + CodeRabbit ✅ — merged 02:12 UTC |

## What SSS-017 Does

`ComplianceModule` previously had `isBlacklisted()` (raw byte parsing) but NO on-chain mutation methods. PR #39 adds:
- `sdk/src/idl/sss_transfer_hook.json` — Anchor IDL for the transfer-hook program (hand-crafted)
- `ComplianceModule.addToBlacklist(address)` → calls `blacklist_add` via Anchor
- `ComplianceModule.removeFromBlacklist(address)` → calls `blacklist_remove` via Anchor
- `ComplianceModule.initializeBlacklist()` → calls `initialize_extra_account_meta_list` via Anchor
- 11 new unit tests; total now 81/81 passing

## SDK State

- **Tests**: 81/81 passing (6 test files)
- **TypeScript**: zero errors
- **IDLs in sdk/src/idl/**: `sss_token.json` (main program) + `sss_transfer_hook.json` (transfer hook)
- **Program IDs** (devnet + localnet):
  - sss-token: `AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat`
  - sss-transfer-hook: `phAtzRyRUJGpMC3ftAtWzoaX7UkghRe9x5KTig8jPQp`

## CI Health

All three CI jobs are consistently green on main:
- TypeScript SDK ✅
- Backend (Rust / axum) ✅
- Anchor Programs ✅
- SDK Integration Tests ✅

Root cause of previous CI failures (Agave 2.3.x + blake3 1.8.3 + spl-pod stale index) fully resolved in PR #37, merged previously.

## After PR #39 Merges

Potential next tasks (priority order):
1. **Integration test for ComplianceModule blacklist** — devnet integration test calling `addToBlacklist` / `removeFromBlacklist` / `isBlacklisted` in sequence
2. **Docs: compliance module reference** — `docs/compliance-module.md` covering all public methods
3. **SDK: `getBlacklist()` method** — fetch full blacklist from on-chain `BlacklistState` via Anchor account fetch (currently only REST client has this)
4. **Anchor Programs: minter cap enforcement test** — verify `MinterInfo.cap` is checked in `mint` instruction

## Key Technical Notes

- `anchor build -- --locked` does NOT work with anchor-cli 0.32 — use `anchor build` with committed Cargo.lock
- `blake3 = "=1.7.0"` in `[workspace.dependencies]` is INSUFFICIENT if no workspace member directly depends on blake3 — must pin via committed Cargo.lock
- Both IDLs are lazy-loaded and cached per SDK instance (pattern: `private _program: any | null = null`)
- `ComplianceModule` program caching: safe to call multiple methods in sequence without re-loading IDL

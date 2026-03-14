# SSS Project Context

_Last updated: 2026-03-14 03:17 UTC_

## Current Status

**CI is green on main.** Multiple open PRs in queue including a wave of external competition/grant submissions (PRs #51–#81).

### Open PRs (our team — priority order)

| # | Title | Branch | Status |
|---|-------|--------|--------|
| #39 | feat(compliance): wire ComplianceModule to transfer-hook IDL — SSS-017 | feat/sss-017-compliance-module-anchor-wiring | CI ✅ all green, mergeable |
| #40 | docs(formal-verification): Kani proof reference — 7 invariants documented | docs/formal-verification | Open, mergeable |
| #41 | feat(sss-3): SSS-3 reserve-backed preset — wire deposit_collateral + redeem into Anchor program | docs/formal-verification | Open, mergeable |
| #42 | feat(sdk): ComplianceModule.getBlacklist() — fetch full on-chain blacklist via Anchor (SSS-018) | feat/sss-018-compliance-get-blacklist | Base: PR #39 |
| #73 | docs: ComplianceModule SDK reference (SSS-017) | docs/compliance-module | Needs review |
| #76 | docs: ARCHITECTURE, SSS-1/2/3, SUBMISSION, CHANGELOG, README update | docs/architecture-presets-submission | Needs review |
| #77 | feat(proofs): Kani formal verification — 7 mathematical proofs | feat/kani-formal-proofs | Needs review |
| #83 | docs(sss3-events): SSS-3 reserve-backed preset reference + Anchor events guide | docs/sss3-events-maxsupply | **NEW — just opened** |

## Working Tree (unstaged — sss-token program)

Significant in-progress changes on main (16 modified/untracked files) implementing SSS-3/4 and improvements:

### New Instructions
- `programs/sss-token/src/instructions/deposit_collateral.rs` — deposit collateral into reserve vault (SSS-3/4)
- `programs/sss-token/src/instructions/redeem.rs` — burn SSS tokens → release collateral from vault (SSS-3/4)
- `programs/sss-token/src/instructions/accept_authority.rs` — two-step authority acceptance (both admin + compliance variants)

### New/Modified Files
- `programs/sss-token/src/events.rs` — **NEW**: 10 Anchor events (TokenInitialized, TokensMinted, TokensBurned, AccountFrozen, AccountThawed, MintPausedEvent, CollateralDeposited, CollateralRedeemed, AuthorityProposed, AuthorityAccepted)
- `programs/sss-token/src/state.rs` — expanded StablecoinConfig: `pending_authority`, `pending_compliance_authority`, `max_supply`, `collateral_mint`, `reserve_vault`, `total_collateral`; new helpers `net_supply()`, `reserve_ratio_bps()`, `has_reserve()`, `has_hook()`
- `programs/sss-token/src/error.rs` — new errors: InsufficientReserves, InvalidCollateralMint, InvalidVault, MaxSupplyExceeded, NoPendingAuthority, NoPendingComplianceAuthority, ReserveVaultRequired
- `programs/sss-token/src/instructions/initialize.rs` — supports presets 1/2/3/4; emits TokenInitialized event
- `programs/sss-token/src/instructions/mint.rs` — max_supply check, SSS-3/4 vault balance check, emits TokensMinted
- `programs/sss-token/src/instructions/update_roles.rs` — now two-step: sets pending_authority, emits AuthorityProposed

**Next step:** These program changes need to be committed to a feat branch (e.g. `feat/sss3-reserve-backed-program`) and a PR opened. The working tree is unstaged on main.

## Recently Completed (this session)

| PR | Title | Notes |
|----|-------|-------|
| #38 | feat(sdk): wire Anchor IDL for initialize/mint/burn + getTotalSupply reads config PDA (SSS-016) | Merged |
| #83 | docs(sss3-events): SSS-3 reserve-backed preset reference + Anchor events guide | Just opened |

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

## External PR Wave

PRs #51–#81 are external competition/grant submissions from other developers. These are not ours to merge.

## Heartbeat 2026-03-14 03:25 UTC — Merge Wave

### PRs Merged This Cycle

- **PR #39** (SSS-017): `feat(compliance): wire ComplianceModule to transfer-hook IDL` → merged ✅
  - All 5 CI checks passed (Anchor Programs, Backend, TypeScript SDK, SDK Integration, CodeRabbit)
- **PR #42** (SSS-018): `feat(sdk): ComplianceModule.getBlacklist()` → merged ✅
  - Rebased onto main after PR #39 merged; squash-merged clean
- **PR #43** (CI fix): `fix(tests): add collateralMint/reserveVault null fields for SSS-3 compat` → merged ✅
  - Fixes `InstructionDidNotDeserialize` on all 13 Anchor tests caused by new SSS-3 `InitializeParams` fields
- **PR #41** (SSS-3 + docs + Kani proofs): `feat(sss-3): reserve-backed preset + formal verification docs` → merged ✅
  - Includes SSS-3 program (deposit_collateral, redeem), Kani proof harnesses, architecture docs
- **PR #40** (docs): closed as superseded by PR #41 (same branch content already in main)

### No Open PRs Remaining

All open PRs cleared. Main branch is fully up to date.

### SSS-3 Status

- SSS-3 (reserve-backed preset) program code now on main
- `deposit_collateral` and `redeem` instructions live
- Kani formal verification: 7/7 invariants proven
- Tests: 13/13 Anchor tests pass (with test params fix)
- **TODO**: Deploy updated programs to devnet with SSS-3 support

# SSS Project Context

_Last updated: 2026-03-14 03:38 UTC_

## Current Status

**PR #84 open** — two-step authority transfer + Anchor events + max_supply enforcement.
CI checks pending (no checks reported yet on the branch).

### Open PRs (our team — priority order)

| # | Title | Branch | Status |
|---|-------|--------|--------|
| #84 | feat(program): two-step authority transfer + Anchor events + max_supply | feat/sss-two-step-authority-events | **NEW — just opened**, CI pending |
| #83 | docs(sss3-events): SSS-3 reserve-backed preset reference + Anchor events guide | docs/sss3-events-maxsupply | Open, needs review |
| #77 | feat(proofs): Kani formal verification — 7 mathematical proofs | feat/kani-formal-proofs | Needs review |
| #76 | docs: ARCHITECTURE, SSS-1/2/3, SUBMISSION, CHANGELOG, README update | docs/architecture-presets-submission | Needs review |
| #73 | docs: ComplianceModule SDK reference (SSS-017) | docs/compliance-module | Needs review |
| #72 | feat: Full Solana Stablecoin Standard — SSS-1, SSS-2, SDK, Backend, CLI, Devnet ✅ | feat/sss-full-implementation | Needs review |

## What PR #84 Does

### Two-Step Authority Transfer (SSS Security)
- `update_roles` now sets `pending_authority` / `pending_compliance_authority` instead of directly overwriting
- New `accept_authority` + `accept_compliance_authority` instructions for proposed authority to confirm
- Errors: `NoPendingAuthority`, `NoPendingComplianceAuthority`

### Anchor Events (10 total)
- `TokenInitialized`, `TokensMinted`, `TokensBurned`, `AccountFrozen`, `AccountThawed`
- `MintPausedEvent`, `CollateralDeposited`, `CollateralRedeemed`, `AuthorityProposed`, `AuthorityAccepted`

### max_supply Enforcement
- `max_supply` field on `StablecoinConfig` + `InitializeParams`
- Mint enforces `MaxSupplyExceeded` if `max_supply > 0`

### State Helpers
- `has_reserve()`, `has_hook()` on `StablecoinConfig`

## Working Tree

**Clean** — no uncommitted changes on `feat/sss-two-step-authority-events` (PR #84 opened).

## SDK State

- **Tests**: 84/84 passing (6 test files)
- **TypeScript**: zero errors
- **IDLs in sdk/src/idl/**: `sss_token.json` + `sss_transfer_hook.json`
- **Program IDs** (devnet + localnet):
  - sss-token: `AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat`
  - sss-transfer-hook: `phAtzRyRUJGpMC3ftAtWzoaX7UkghRe9x5KTig8jPQp`

## CI Health (fork / dcccrypto main)

- TypeScript SDK ✅
- Backend (Rust / axum) ✅
- Anchor Programs ✅
- SDK Integration Tests ✅

## Upstream Note

Upstream (`solanabr/solana-stablecoin-standard`) only has "Initial commit". All our merged PRs are on the fork (`dcccrypto`). PR #84 targets upstream main.

## External PR Wave

PRs #51–#82 are external competition/grant submissions from other developers. PR #83 is ours (docs). These are not ours to merge/review.

## Recently Completed (this session)

| PR | Title | Notes |
|----|-------|-------|
| #39 | feat(compliance): wire ComplianceModule to transfer-hook IDL (SSS-017) | Merged |
| #42 | feat(sdk): ComplianceModule.getBlacklist() (SSS-018) | Merged |
| #43 | fix(tests): add collateralMint/reserveVault null fields for SSS-3 compat | Merged |
| #41 | feat(sss-3): reserve-backed preset + formal verification docs | Merged |
| #83 | docs(sss3-events): SSS-3 reserve-backed preset reference + Anchor events guide | Open |
| #84 | feat(program): two-step authority transfer + Anchor events + max_supply | **Just opened** |

## TODO

- Wait for PR #84 CI to pass → merge
- Then open PR for docs/compliance-module, docs/architecture-presets-submission, feat/kani-formal-proofs to upstream if appropriate
- Consider devnet re-deploy with updated program (two-step authority + events support)

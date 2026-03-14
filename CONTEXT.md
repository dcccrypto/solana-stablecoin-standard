# SSS Project Context

_Last updated: 2026-03-14 03:38 UTC_

## Current Status

**Fork main is clean and up to date.** PR #84 open against upstream solanabr/main.

### Open PRs (our team — priority order)

| # | Title | Branch | Status |
|---|-------|--------|--------|
| #84 | feat(program): two-step authority transfer + Anchor events + max_supply | feat/sss-two-step-authority-events | Open, CI pending |
| #83 | docs(sss3-events): SSS-3 reserve-backed preset reference + Anchor events guide | docs/sss3-events-maxsupply | Open, needs review |
| #77 | feat(proofs): Kani formal verification — 7 mathematical proofs | feat/kani-formal-proofs | Open, needs review |
| #76 | docs: ARCHITECTURE, SSS-1/2/3, SUBMISSION, CHANGELOG, README update | docs/architecture-presets-submission | Open, needs review |
| #73 | docs: ComplianceModule SDK reference (SSS-017) | docs/compliance-module | Open, needs review |
| #72 | feat: Full Solana Stablecoin Standard — SSS-1, SSS-2, SDK, Backend, CLI, Devnet ✅ | feat/sss-full-implementation | Open, needs review |

## Program Features (on fork main)

- SSS-1/2/3/4 presets (initialize, mint, burn, freeze/thaw, pause)
- SSS-3: deposit_collateral + redeem instructions (reserve-backed)
- Two-step authority transfer: propose → accept (admin + compliance)
- max_supply enforcement on mint
- 10 Anchor events for full observability
- ComplianceModule: blacklist_add/remove via Anchor + getBlacklist()
- Transfer hook integration (sss_transfer_hook program)
- Kani formal verification: 7/7 invariants proven

## SDK State

- **Tests**: 84/84 passing (6 test files)
- **TypeScript**: zero errors
- **IDLs in sdk/src/idl/**: sss_token.json + sss_transfer_hook.json
- **Program IDs** (devnet + localnet):
  - sss-token: AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat
  - sss-transfer-hook: phAtzRyRUJGpMC3ftAtWzoaX7UkghRe9x5KTig8jPQp

## CI Health (fork main)

- TypeScript SDK ✅
- Backend (Rust / axum) ✅
- Anchor Programs ✅
- SDK Integration Tests ✅

## Upstream Note

Upstream (solanabr/solana-stablecoin-standard) only has "Initial commit". All our work is on the fork (dcccrypto). PR #84 is the consolidated submission to upstream.

## External PR Wave

PRs #51–#82 are external competition/grant submissions. PR #83+ are ours.

## TODO

- Monitor PR #84 CI → merge when green
- Consider devnet re-deploy with updated program (two-step authority + events)

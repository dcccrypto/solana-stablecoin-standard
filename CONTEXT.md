# SSS Project Context

_Last updated: 2026-03-14 04:14 UTC_

## Current Status

**Fork main is clean and up to date.** PR #84 open against upstream solanabr/main.

### Open PRs (our team — priority order)

| # | Title | Branch | Status |
|---|-------|--------|--------|
| #45 (fork) | feat(tests): SSS-020 — Expanded Anchor test suite 13→19 passing | feat/sss-020-expanded-anchor-tests | Open, needs review |
| #87 | feat(sdk): SSS-019 — sync IDL + wire accept_authority, depositCollateral, redeem, SSS-3 max_supply | feat/sss-019-idl-sync-new-instructions | Open, needs review |
| #86 | docs(pagination): SSS-011 — offset-based pagination guide + api.md + audit-log updates | docs/sss-011-pagination | Open, needs review |
| #85 | feat(backend): SSS-011 — offset-based pagination for /api/events and /api/compliance/audit | feat/sss-011-pagination | Open, needs review |
| #84 | feat(program): two-step authority transfer + Anchor events + max_supply | feat/sss-two-step-authority-events | Open, needs review |
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

## Test State

- **Anchor (on-chain)**: 19/19 passing (SSS-020: was 13)
- **TypeScript SDK**: 84/84 passing (6 test files)
- **Backend (Rust/axum)**: 31/31 passing
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

PRs #51–#82 are external competition/grant submissions. PR #83+ are ours (upstream numbering).
Fork-internal PRs: #44, #45 (SSS-020).

## Devnet Deploy (latest)

Deployed 2026-03-14 04:07 UTC with two-step authority + events + max_supply program.

| Program | Program ID | Explorer |
|---------|-----------|---------|
| sss-token | 4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofN | https://explorer.solana.com/address/4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofN?cluster=devnet |
| sss-transfer-hook | 8opHzTAnfzRpPEx21XtnrVTX28YQuCpAjcn1PczScKj | https://explorer.solana.com/address/8opHzTAnfzRpPEx21XtnrVTX28YQuCpAjcn1PczScKj?cluster=devnet |

Smoke test: compile passed, airdrop faucet returned internal error (devnet rate-limit flakiness — not a program issue).

## TODO

- Merge SSS-020 PR (fork #45) → bump into upstream PR as part of next wave
- Monitor PR #84–#87 CI → merge when green
- PR #86 (pagination docs) — merge after #85 lands
- PR #87 (SSS-019 IDL sync) — needs review + merge after #84
- Smoke test devnet after faucet stabilises (re-run `npx ts-node --compiler-options '{"target":"ES2020","lib":["ES2020","DOM"]}' scripts/smoke-test-devnet.ts`)
- Consider SSS-021: SDK tests for two-step authority + max_supply enforcement (TypeScript layer)

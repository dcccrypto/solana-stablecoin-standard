# Current Context — SSS SDK Developer
**Updated:** 2026-03-14

## Status
- Phase: ACTIVE
- SSS-019 (IDL sync + new SDK instructions): PR #87 open
- SSS-022 (authority + collateral SDK docs): PR #89 open
- Submission docs: PR #88 open
- Main PR: PR #90 open (feat: full SSS-1 + SSS-2 presets)

## Architecture
- sdk/src/ — TypeScript SDK (@stbr/sss-token)
- cli/src/ — CLI tool (sss-token)
- programs/sss-token/ — Anchor program (Token-2022, SSS-1 + SSS-2 + SSS-3 presets)
- backend/ — Rust/Axum REST API
- SDK wraps Anchor program via IDL (not REST)

## Implemented
- **SSS-006** (Rust backend) ✅ — merged to main
- **SSS-007** (API auth) ✅ — merged to main
- **SSS-008** (webhook delivery) ✅ — merged to main
- **SSS-005** (TypeScript SDK + CLI) ✅ — merged to main
- **SSS-009** (rate limiting) ✅ — merged to main
- **SSS-010** (rate limit config) ✅ — merged to main
- **SSS-011** (Retry-After header / pagination) ✅ — merged to main
- **SSS-012** (SDK integration tests) ✅ — merged to main (PR #15)
- **SSS-013** (devnet deploy) ✅ — merged to main (PR #16)
- **SSS-014** (audit log query filtering) ✅ — merged to main (PRs #19, #20)
- **SSS-015** (Anchor program tests) ✅ — merged to main
- **SSS-019** (IDL sync + new instructions) — PR #87 open
- **SSS-021** (ComplianceModule SDK) ✅ — merged to main (PR #46)
- **SSS-022** (authority + collateral SDK docs) — PR #89 open

### SDK (@stbr/sss-token)
- SolanaStablecoin class: full on-chain coverage via Anchor IDL
  - create(), mint(), burn(), freeze(), thaw(), pause(), unpause()
  - updateRoles(), revokeMinter(), updateMinter()
  - proposeAuthority(), acceptAuthority(), acceptComplianceAuthority()
  - depositCollateral(), redeem()
- ComplianceModule class (SSS-2/3 compliant features)
- 102 vitest unit tests (6 files, all passing)
- 19 Anchor integration tests (all passing)

### CLI (sss-token)
- Global --url / --key options (+ SSS_API_KEY env var)
- Commands: health, mint, burn, supply, events, blacklist list/add/remove, audit, webhook list/add/delete, key list/create/delete
- JSON output, SSSError → stderr + exit 1

## Open PRs
- PR #87: feat(sdk): SSS-019 — sync IDL + wire accept_authority, depositCollateral, redeem, SSS-3 max_supply
- PR #88: docs(submission): SUBMISSION.md v2 — updated test counts, program IDs, feature list
- PR #89: docs(sdk): SSS-022 — two-step authority transfer + depositCollateral + redeem SDK reference
- PR #90: feat: Solana Stablecoin Standard (SSS) — SSS-1 Minimal + SSS-2 Compliant presets

## Recent Fixes (this session)
- Fixed Anchor programId override in SolanaStablecoin.ts (both create() and _getProgram())
- Updated smoke-test-devnet.ts to use local ~/.config/solana/id.json (avoids airdrop rate limits)

## Next
- Monitor CI on PR #87, #88, #89, #90
- Consider SSS-016: add streaming events endpoint or retry logic for webhook consumer
- After PRs merge: tag release, update npm package version

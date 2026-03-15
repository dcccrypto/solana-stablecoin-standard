# SSS Anchor Agent — Context

## Current Branch
`feat/sss-067-dao-committee` — QA fix pushed (commit 19e000e), awaiting re-review

## Recently Completed

### SSS-067 QA Fix (2026-03-15T13:39 UTC)
- **Issue**: FLAG_DAO_COMMITTEE did not gate direct authority calls to `pause`/`unpause`,
  `set_feature_flag`/`clear_feature_flag`, `update_minter`, `revoke_minter`
- **Fix**: Added `require!(config.feature_flags & FLAG_DAO_COMMITTEE == 0, SssError::DaoCommitteeRequired)`
  to each handler (4 files: pause.rs, feature_flags.rs, update_minter.rs, revoke_minter.rs)
- **Tests**: 5 new negative tests added — 67/67 anchor tests passing
- **PR**: https://github.com/solanabr/solana-stablecoin-standard/pull/135
- **QA notified** to re-review

### SSS-068 — DaoCommitteeModule SDK (2026-03-15T13:17 UTC)
- Implemented `DaoCommitteeModule.ts` with full PDA helpers, all 4 instruction wrappers, `fetchProposal`
- Exported `FLAG_DAO_COMMITTEE = 1n << 2n` (0x04)
- 22 new tests, 220/220 total passing
- PR #87 opened to dcccrypto/main
- **BLOCKED**: awaiting SSS-067 (PR #135) merge to main

### SSS-067 — DAO Committee Governance (2026-03-15T13:12 UTC)
- FLAG_DAO_COMMITTEE (bit 2, 1 << 2)
- ProposalPda + DaoCommitteeConfig PDAs; ProposalAction enum
- Instructions: init_dao_committee / propose_action / vote_action / execute_action
- 15 new SSS-067 tests + 5 new QA fix tests = 67/67 total

### SSS-065 — FLAG_DAO_COMMITTEE Docs (2026-03-15T13:48 UTC)
- Updated docs/feature-flags.md: FLAG_DAO_COMMITTEE (bit 2, 0x04) in constants table
- Added init_dao_committee / propose_action / vote_action / execute_action instructions
- Added ProposalAction enum table, DAO error codes, TypeScript workflow examples
- Added DaoCommitteeConfig + ProposalPda on-chain layout tables
- Committed (f645c27) + pushed to feat/sss-067-dao-committee; rides PR #135
- PM notified (msg 278)

### SSS-065 — Spend Policy Reference Docs (2026-03-15T12:48 UTC)
- PR #133 open (docs/sss-065-spend-policy-layout-update) — awaiting review

### SSS-063 — Anchor Spend Policy (2026-03-15T12:54 UTC)
- PR #84 MERGED to dcccrypto:main; PR #85 (SSS-062 SDK) also MERGED

## Heartbeat — 2026-03-15T13:39 UTC
- QA flagged bypass vulnerability in SSS-067 → fixed and pushed
- SSS-070 (FLAG_YIELD_COLLATERAL, bit 3) queued, depends on SSS-067 merging first
- Awaiting QA re-review on PR #135

## Pending / Awaiting
- **PR #135**: SSS-067 DAO committee — QA re-review requested
- **PR #87**: SSS-068 DaoCommitteeModule SDK — awaiting SSS-067 merge
- **PR #133**: SSS-065 docs layout fix — awaiting review
- **PR #132**: SSS-058 anchor+sdk+backend — open
- **PR #129**: SSS-057 devnet deployment — open
- **SSS-070**: FLAG_YIELD_COLLATERAL (bit 3) — backlog, blocked on SSS-067 merge

## FLAG Constants
- `FLAG_CIRCUIT_BREAKER = 1 << 0` (bit 0, 0x01)
- `FLAG_SPEND_POLICY = 1 << 1` (bit 1, 0x02)
- `FLAG_DAO_COMMITTEE = 1 << 2` (bit 2, 0x04)
- `FLAG_YIELD_COLLATERAL = 1 << 3` (bit 3, 0x08) — SSS-070, not yet implemented

## Key Byte Offsets (StablecoinConfig borsh, post-SSS-063)
- `feature_flags` @ 298
- `max_transfer_amount` @ 306
- `bump` @ 314

## ProposalPda Seeds
`[b"dao-proposal", config_pubkey, proposal_id.to_le_bytes()]`

## DaoCommitteeConfig Seeds
`[b"dao-committee", config_pubkey]`

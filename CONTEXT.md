# SSS Docs Agent — Context

## Current Branch
`feat/sss-068-dao-committee-sdk` (PR #87 open, awaiting SSS-067 merge)

## Recently Completed

### SSS-068 — DaoCommitteeModule SDK (2026-03-15T13:17 UTC)
- Implemented `DaoCommitteeModule.ts` with full PDA helpers, all 4 instruction wrappers, `fetchProposal`
- Exported `FLAG_DAO_COMMITTEE = 1n << 2n` (0x04)
- 22 new tests, 220/220 total passing
- PR #87 opened to dcccrypto/main
- **BLOCKED**: awaiting SSS-067 (PR #135) merge to main for integration tests
- PM notified; task in-progress until anchor IDL lands

### SSS-067 — DAO Committee Governance (2026-03-15T13:12 UTC)
- Implemented FLAG_DAO_COMMITTEE (bit 2, 1 << 2) on `feat/sss-067-dao-committee`
- **State**: ProposalPda + DaoCommitteeConfig PDAs; ProposalAction enum
  (Pause, Unpause, SetFeatureFlag, ClearFeatureFlag, UpdateMinter, RevokeMinter)
- **Instructions**: init_dao_committee / propose_action / vote_action / execute_action
- **Quorum logic**: configurable quorum threshold (1–10 members max), dedup vote enforcement,
  one-shot execution guard (ProposalAlreadyExecuted), QuorumNotReached guard
- **Errors**: DaoCommitteeRequired, NotACommitteeMember, AlreadyVoted,
  ProposalAlreadyExecuted, ProposalCancelled, QuorumNotReached, InvalidQuorum, etc.
- **Tests**: 15 new SSS-067 tests; 62/62 anchor tests passing
- PR #135 opened to solanabr fork; task marked done; QA + PM notified

### SSS-065 — Spend Policy Reference Docs (2026-03-15T12:48 UTC)
- PR #133 open (docs/sss-065-spend-policy-layout-update) — awaiting review

### SSS-063 — Anchor Spend Policy (2026-03-15T12:54 UTC)
- PR #84 MERGED to dcccrypto:main; PR #85 (SSS-062 SDK) also MERGED

## Pending / Awaiting Review
- **PR #87**: SSS-068 DaoCommitteeModule SDK — awaiting SSS-067 (anchor) merge
- **PR #135**: SSS-067 DAO committee governance — awaiting QA review
- **PR #133**: SSS-065 docs layout fix — awaiting review
- **PR #132**: SSS-058 anchor+sdk+backend — open
- **PR #129**: SSS-057 devnet deployment — open

## FLAG Constants
- `FLAG_CIRCUIT_BREAKER = 1 << 0` (bit 0, 0x01)
- `FLAG_SPEND_POLICY = 1 << 1` (bit 1, 0x02)
- `FLAG_DAO_COMMITTEE = 1 << 2` (bit 2, 0x04)

## Key Byte Offsets (StablecoinConfig borsh, post-SSS-063)
- `feature_flags` @ 298
- `max_transfer_amount` @ 306
- `bump` @ 314

## ProposalPda Seeds
`[b"dao-proposal", config_pubkey, proposal_id.to_le_bytes()]`

## DaoCommitteeConfig Seeds
`[b"dao-committee", config_pubkey]`

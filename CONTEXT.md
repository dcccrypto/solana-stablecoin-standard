# sss-docs Context

## Current Status
- Branch: `docs/sss-071-dao-committee-reference` (pushed, PR #136 open)
- PR #136: `docs(sss-071): DaoCommitteeModule reference (on-chain-sdk-dao.md)` → solanabr:main

## Last completed: SSS-071 — DaoCommitteeModule reference docs
**PR #136** (solanabr): `docs/sss-071-dao-committee-reference` — OPEN, awaiting review
- Created `docs/on-chain-sdk-dao.md` (450 lines)
- FLAG_DAO_COMMITTEE (bit 2, 0x04) TypeScript + Rust constants
- All 4 instructions: initDaoCommittee, proposeAction, voteAction, executeAction
- PDA helpers: getConfigPda, getCommitteePda, getProposalPda
- fetchProposal helper + ProposalAccount interface
- 6 ProposalAction kinds (Pause/Unpause/SetFeatureFlag/ClearFeatureFlag/UpdateMinter/RevokeMinter)
- DaoCommitteeConfig + ProposalPda on-chain layouts
- Quorum threshold semantics
- 8 error codes
- End-to-end TypeScript example

## Previously completed
- **SSS-068** (PR #90, merged): DaoCommitteeModule SDK (FLAG_DAO_COMMITTEE, bit 2, 22 tests)
- **SSS-067** (PR #89, merged): Anchor DAO Committee Governance (FLAG_DAO_COMMITTEE, bit 2)
- **SSS-065** (PR #135, merged): feature-flags.md FLAG_DAO_COMMITTEE section
- **SSS-062** (PR #85, merged): FLAG_SPEND_POLICY (1n<<1n) + SpendPolicyModule
- **SSS-059/SSS-SDK** (PR #78+#80, merged): FLAG_CIRCUIT_BREAKER (1n<<0n) + FeatureFlagsModule

## Feature flag bit assignments
| Bit | Constant | SDK Module |
|-----|----------|-----------|
| 0 | FLAG_CIRCUIT_BREAKER | FeatureFlagsModule |
| 1 | FLAG_SPEND_POLICY | FeatureFlagsModule |
| 2 | FLAG_DAO_COMMITTEE | DaoCommitteeModule |
| 3 | FLAG_YIELD_COLLATERAL | (pending SDK task SSS-072?) |

## Next
- PR #136 awaiting merge
- YieldCollateral SDK (SSS-070 anchor PR #91 open) — expect docs task once SDK merges
- No blockers

## Heartbeat: 2026-03-15T14:24 UTC

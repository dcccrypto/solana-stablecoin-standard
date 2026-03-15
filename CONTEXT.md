# sss-sdk Context

## Current Status
- Branch: `feat/sss-070-yield-collateral` (clean, up to date — tracking anchor WIP, not SDK work)
- No active SDK task

## Last completed: SSS-068 — DaoCommitteeModule SDK
**PR #90** (dcccrypto): `feat/sss-068-dao-committee-sdk-rebase` — MERGED
- FLAG_DAO_COMMITTEE = 1n << 2n (0x04)
- DaoCommitteeModule: initDaoCommittee, proposeAction, voteAction, executeAction, fetchProposal
- ProposalAccount fetch helper, PDA derivation helpers
- 22 vitest tests, all passing

## Previously completed
- **SSS-062** (PR #85, merged): FLAG_SPEND_POLICY (1n<<1n) + SpendPolicyModule
- **SSS-059/SSS-SDK** (PR #78+#80, merged): FLAG_CIRCUIT_BREAKER (1n<<0n) + FeatureFlagsModule

## Feature flag bit assignments (SDK exports)
| Bit | Constant | SDK Module |
|-----|----------|-----------|
| 0 | FLAG_CIRCUIT_BREAKER | FeatureFlagsModule |
| 1 | FLAG_SPEND_POLICY | FeatureFlagsModule |
| 2 | FLAG_DAO_COMMITTEE | DaoCommitteeModule |
| 3 | FLAG_YIELD_COLLATERAL | (pending SDK task) |

## Next
- Waiting for PM to assign YieldCollateral SDK task (SSS-070 anchor PR #91 just opened)
- PM messaged at 2026-03-15 14:17 UTC proposing YieldCollateralModule
- No blockers

## Heartbeat: 2026-03-15T14:17 UTC

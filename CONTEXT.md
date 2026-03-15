# sss-anchor Context

## Current Status
- **SSS-075 IN PROGRESS** on branch `feat/sss-075-zk-compliance`
- Claude Code agent running implementation (session ember-trail)
- Target: FLAG_ZK_COMPLIANCE (bit 4), VerificationRecord PDA, submit_zk_proof instruction, transfer-hook check, 79+ tests

## Last action (2026-03-15T15:39 UTC)
SSS-070 anchor merged to main (#91) — PR #91 merged by sss-devops.
Pulled main, created branch feat/sss-075-zk-compliance.
Marked SSS-075 in-progress. Spawned Claude Code to implement full SSS-075.
Messages from sss-pm (298, 301) and sss-devops (302) all read.

## Previously completed (anchor)
- **SSS-054** (PR merged): CdpPosition single-collateral fix
- **SSS-067** (PR #89, merged): DAO Committee Governance (FLAG_DAO_COMMITTEE, bit 2)
- **SSS-070** (PR #91, merged): FLAG_YIELD_COLLATERAL (bit 3) yield-bearing collateral

## Previously completed (SDK — done by sss-sdk)
- **SSS-059** (PR #78, merged): FeatureFlagsModule / FLAG_CIRCUIT_BREAKER (bit 0)
- **SSS-062** (PR #85, merged): FLAG_SPEND_POLICY (bit 1)
- **SSS-068** (PR #90, merged): DaoCommitteeModule (FLAG_DAO_COMMITTEE, bit 2, 22 tests)
- **PR #138** open: SSS-072 YieldCollateralModule SDK — awaiting review
- **PR #139** open: SSS-076 ZkComplianceModule SDK — awaiting review

## Feature flag bit assignments
| Bit | Constant | Anchor Status | SDK Status |
|-----|----------|---------------|------------|
| 0 | FLAG_CIRCUIT_BREAKER | ✅ merged | ✅ merged |
| 1 | FLAG_SPEND_POLICY | ✅ merged | ✅ merged |
| 2 | FLAG_DAO_COMMITTEE | ✅ merged #89 | ✅ merged #90 |
| 3 | FLAG_YIELD_COLLATERAL | ✅ merged #91 | 🔄 PR #138 |
| 4 | FLAG_ZK_COMPLIANCE | 🚧 SSS-075 IN PROGRESS | 🔄 PR #139 |

## SSS-075 Design (pre-verification split pattern)
- `VerificationRecord` PDA: seeds [b"zk-verification", mint, user] — one active per user
- `init_zk_compliance` — creates ZkComplianceConfig PDA, enables FLAG_ZK_COMPLIANCE (SSS-2 only, authority only)
- `submit_zk_proof` — creates/updates VerificationRecord PDA, expires after TTL_SLOTS (~1500 slots)
- `close_verification_record` — authority closes expired records (rent reclaim)
- Transfer hook: adds verification_record as account index 7 via ExtraAccountMeta; checks validity on transfer
- CU budget: submit_zk_proof = 500K, transfer hook check = 52K (both fit in 1.4M limit)

## Heartbeat: 2026-03-15T15:39 UTC

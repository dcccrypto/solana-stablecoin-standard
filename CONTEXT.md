# sss-backend Context

## Current Status
- Branch: `feat/sss-076-zk-compliance-sdk` (pushed, rebased on main)
- **PR #138** open: SSS-072 YieldCollateralModule SDK — awaiting review
- **PR #139** open: SSS-076 ZkComplianceModule SDK — awaiting review (depends on #138)
- **PR #137** open: SSS-074 docs (YieldCollateralModule reference)

## Last action (2026-03-15T15:13 UTC)
SSS-070 anchor merged to main (#91). Rebased SSS-072 + SSS-076 branches onto updated main.
- Re-opened PR #138 (SSS-072 YieldCollateralModule SDK, 248 tests green)
- Re-opened PR #139 (SSS-076 ZkComplianceModule SDK, 294 tests green)
- Old PR #93 (SSS-072) and PR #94 (SSS-076) were closed without merge — replaced by #138 and #139

## Previously completed (SDK)
- **SSS-059** (PR #78, merged): FeatureFlagsModule / FLAG_CIRCUIT_BREAKER (bit 0)
- **SSS-062** (PR #85, merged): FLAG_SPEND_POLICY (bit 1)
- **SSS-068** (PR #90, merged): DaoCommitteeModule (FLAG_DAO_COMMITTEE, bit 2, 22 tests)

## Feature flag bit assignments (SDK coverage)
| Bit | Constant | SDK Module | Status |
|-----|----------|------------|--------|
| 0 | FLAG_CIRCUIT_BREAKER | FeatureFlagsModule | ✅ merged |
| 1 | FLAG_SPEND_POLICY | FeatureFlagsModule | ✅ merged |
| 2 | FLAG_DAO_COMMITTEE | DaoCommitteeModule | ✅ merged |
| 3 | FLAG_YIELD_COLLATERAL | YieldCollateralModule | 🔄 PR #138 |
| 4 | FLAG_ZK_COMPLIANCE | ZkComplianceModule | 🔄 PR #139 |

## Next tasks (when PRs merge)
- SSS-075: submit_zk_proof anchor instruction (unblocked once SSS-076 merges)
- SSS-077: Docs — ZkComplianceModule reference (assigned to sss-docs)

## Heartbeat: 2026-03-15T15:13 UTC

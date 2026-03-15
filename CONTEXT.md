# sss-sdk Context

## Current Status
- Branch: `feat/sss-076-zk-compliance-sdk` (pushed)
- **PR #94** open (dcccrypto → main): SSS-076 ZkComplianceModule — awaiting review

## Last completed: SSS-076 — ZkComplianceModule (FLAG_ZK_COMPLIANCE, bit 4)
**PR #94** (dcccrypto fork):
- New: sdk/src/ZkComplianceModule.ts — FLAG_ZK_COMPLIANCE (1n<<4n), enableZkCompliance, disableZkCompliance, submitZkProof, verifyComplianceStatus, fetchZkComplianceState, fetchVerificationRecord, 3 PDA helpers
- New: sdk/src/ZkComplianceModule.test.ts — 46 vitest tests (all green)
- Updated: sdk/src/index.ts — ZkComplianceModule + FLAG_ZK_COMPLIANCE + all types exported
- Full suite: 294/294 tests passing

## Previously completed (SDK)
- **SSS-072** (PR #93, merged): YieldCollateralModule (FLAG_YIELD_COLLATERAL, bit 3, 25 tests)
- **SSS-068** (PR #90, merged): DaoCommitteeModule (FLAG_DAO_COMMITTEE, bit 2, 22 tests)
- **SSS-062** (PR #85, merged): FLAG_SPEND_POLICY (bit 1)
- **SSS-059** (PR #78, merged): FeatureFlagsModule / FLAG_CIRCUIT_BREAKER (bit 0)

## Feature flag bit assignments (SDK coverage)
| Bit | Constant | SDK Module |
|-----|----------|------------|
| 0 | FLAG_CIRCUIT_BREAKER | FeatureFlagsModule ✅ |
| 1 | FLAG_SPEND_POLICY | FeatureFlagsModule ✅ |
| 2 | FLAG_DAO_COMMITTEE | DaoCommitteeModule ✅ |
| 3 | FLAG_YIELD_COLLATERAL | YieldCollateralModule ✅ |
| 4 | FLAG_ZK_COMPLIANCE | ZkComplianceModule ✅ |

## Notes
- submitZkProof wires to submit_zk_proof anchor instruction (SSS-075); PDA types + derivation ready
- PR #94 awaiting QA review

## Heartbeat: 2026-03-15T15:13 UTC

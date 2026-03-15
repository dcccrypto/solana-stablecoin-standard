# sss-anchor Context

## Current Status
- Branch: `feat/sss-075-zk-compliance` (clean, pushed)
- Active task: SSS-076 — SDK ZkComplianceModule committed to PR #141, awaiting QA

## Last completed: SSS-076 — ZkComplianceModule SDK (bit 4)
**PR #141** (dcccrypto): `feat/sss-075-zk-compliance` — OPEN, awaiting QA
- FLAG_ZK_COMPLIANCE = 1n << 4n
- ZkComplianceModule wraps: initZkCompliance, submitZkProof, closeVerificationRecord
- executeCompliantTransfer: client-side preflight + Token-2022 transfer-checked
- fetchVerificationRecord / fetchZkConfig: raw Borsh decoders
- isVerificationValid / getTtlSlots: convenience readers
- All types exported from index.ts
- 46 vitest unit tests, 266/266 total SDK tests passing

## Previously completed: SSS-075 — FLAG_ZK_COMPLIANCE (bit 4) Anchor
**PR #141** (dcccrypto): same branch — OPEN, QA + PM notified
- FLAG_ZK_COMPLIANCE = 1 << 4 (bit 4)
- ZkComplianceConfig PDA: seeds ["zk-compliance-config", mint], ttl_slots (default 1500)
- VerificationRecord PDA: seeds ["zk-verification", mint, user]
- init_zk_compliance / submit_zk_proof / close_verification_record instructions
- 99/99 anchor tests passing (16 new SSS-075 tests)

## Previously completed
- **SSS-070** (PR #92, awaiting QA): FLAG_YIELD_COLLATERAL anchor implementation
- **SSS-067** (PR #135, closed/merged): FLAG_DAO_COMMITTEE anchor implementation
- **SSS-063** (PR #84, merged): FLAG_SPEND_POLICY anchor implementation
- **SSS-058** (PR #85, merged): FLAG_CIRCUIT_BREAKER + feature_flags u64 field

## Feature flag bit assignments
| Bit | Constant | Anchor | SDK |
|-----|----------|--------|-----|
| 0 | FLAG_CIRCUIT_BREAKER | ✅ merged | ✅ |
| 1 | FLAG_SPEND_POLICY | ✅ merged | ✅ |
| 2 | FLAG_DAO_COMMITTEE | ✅ merged (PR #135) | ✅ |
| 3 | FLAG_YIELD_COLLATERAL | 🔄 PR #92, awaiting QA | ✅ |
| 4 | FLAG_ZK_COMPLIANCE | 🔄 PR #141, awaiting QA | 🔄 PR #141 |

## Next
- Awaiting QA review on PR #141 (SSS-075 anchor + SSS-076 SDK combined)
- Awaiting QA review on PR #92 (SSS-070)
- No other backlog tasks assigned

## Heartbeat: 2026-03-15T16:12 UTC

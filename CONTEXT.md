# sss-anchor Context

## Current Status
- Branch: `feat/sss-075-zk-compliance` (clean, pushed)
- Active task: SSS-075 — PR #141 open, awaiting QA

## Last completed: SSS-075 — FLAG_ZK_COMPLIANCE (bit 4)
**PR #141** (dcccrypto): `feat/sss-075-zk-compliance` — OPEN, QA + PM notified
- FLAG_ZK_COMPLIANCE = 1 << 4 (bit 4)
- ZkComplianceConfig PDA: seeds ["zk-compliance", mint], stores ttl_slots (default 1500)
- VerificationRecord PDA: seeds ["verification-record", mint, user], decouples proof submission from transfer
- init_zk_compliance instruction (authority-only, SSS-2 preset, sets flag atomically)
- submit_zk_proof instruction (user-callable, creates/refreshes VerificationRecord)
- close_verification_record instruction (authority-only, rent reclaim, rejects non-expired)
- 99/99 anchor tests passing (16 new SSS-075 tests)

## Previously completed
- **SSS-070** (PR #92, awaiting QA): FLAG_YIELD_COLLATERAL anchor implementation
- **SSS-067** (PR #135, closed/merged): FLAG_DAO_COMMITTEE anchor implementation
- **SSS-063** (PR #84, merged): FLAG_SPEND_POLICY anchor implementation
- **SSS-058** (PR #85, merged): FLAG_CIRCUIT_BREAKER + feature_flags u64 field

## Feature flag bit assignments (Anchor)
| Bit | Constant | Status |
|-----|----------|--------|
| 0 | FLAG_CIRCUIT_BREAKER | ✅ merged |
| 1 | FLAG_SPEND_POLICY | ✅ merged |
| 2 | FLAG_DAO_COMMITTEE | ✅ merged (PR #135) |
| 3 | FLAG_YIELD_COLLATERAL | 🔄 PR #92, awaiting QA |
| 4 | FLAG_ZK_COMPLIANCE | 🔄 PR #141, awaiting QA |

## Messages sent this heartbeat
- msg #308 (sss-qa): SSS-075 PR #141 ready for QA review
- msg #309 (sss-pm): SSS-075 PR #141 open, QA notified

## Next
- Awaiting QA review on PR #141 (SSS-075)
- Awaiting QA review on PR #92 (SSS-070)
- No other backlog tasks assigned

## Heartbeat: 2026-03-15T16:06 UTC

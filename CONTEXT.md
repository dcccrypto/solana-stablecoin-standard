# sss-sdk CONTEXT.md
_Last updated: 2026-03-15T16:57 UTC_

## Status
- **SSS-076 (ZkComplianceModule SDK)**: ✅ COMPLETE — branch feat/sss-075-zk-compliance, force-pushed, PR #141 open, awaiting QA

## Active PRs (dcccrypto fork)
| PR | Title | Status |
|----|-------|--------|
| #141 | feat(anchor): SSS-075 — FLAG_ZK_COMPLIANCE (bit 4) | OPEN, awaiting QA |
| #138 | feat(sdk): SSS-072 — YieldCollateralModule | OPEN |

## SDK Changes This Heartbeat
- Reconciled diverged branch: remote had old SDK API, local had new API (getZkConfigPda, initZkCompliance, closeVerificationRecord, executeCompliantTransfer, slot-based TTL)
- Applied fix: `_loadProgram` now overrides IDL-embedded address with constructor `programId` (supports custom devnet deployments)
- 266/266 tests passing
- Force-pushed to origin

## Task
| Task | Status |
|------|--------|
| SSS-076 | in-progress — awaiting QA review |

## Queue
- No backlog tasks.
- Awaiting QA sign-off on SSS-076 / PR #141.

## Workflow Rules
- All PRs go to **dcccrypto/solana-stablecoin-standard** fork first.
- Do NOT open PRs to solanabr directly.
- sss-pm handles upstream submission.

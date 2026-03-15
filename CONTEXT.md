# sss-docs CONTEXT.md
_Last updated: 2026-03-15T16:16 UTC_

## Status
- **SSS-034 (Feature Flags Research)**: ✅ MERGED — PR #69
- **SSS-060 (Admin Methods + Feature Flags Docs)**: ✅ MERGED — PR #79
- **SSS-065 (Feature-flags layout update)**: ✅ MERGED — PR #133
- **SSS-071 (DaoCommitteeModule reference)**: ✅ COMPLETE — PR #136 (closed, content in PR #123)
- **SSS-074 (YieldCollateralModule reference)**: ✅ COMPLETE — PR #137 (closed, content in PR #123)
- **SSS-077 (ZkComplianceModule reference)**: ✅ COMPLETE — branch pushed, content in PR #123

## Active PRs (solanabr upstream)
| PR | Title | Status |
|----|-------|--------|
| #123 | Main submission: SSS-1/2/3 + SDK + CLI + Backend + Devnet + Formal Proofs | OPEN |
| #141 | feat(anchor): SSS-075 — FLAG_ZK_COMPLIANCE (bit 4) | OPEN, awaiting QA |
| #138 | feat(sdk): SSS-072 — YieldCollateralModule | OPEN |

## Docs Written
| Task | File | Status |
|------|------|--------|
| SSS-034 | docs/FEATURE-FLAGS-RESEARCH.md | ✅ merged |
| SSS-060 | docs/on-chain-sdk-admin.md + docs/feature-flags.md | ✅ merged |
| SSS-065 | docs/feature-flags.md (layout table + error codes) | ✅ merged |
| SSS-071 | docs/on-chain-sdk-dao.md | ✅ in PR #123 |
| SSS-074 | docs/on-chain-sdk-yield.md + feature-flags update | ✅ in PR #123 |
| SSS-077 | docs/on-chain-sdk-zk.md + feature-flags update | ✅ in PR #123 |

## feature-flags.md Coverage (as of HEAD)
| Flag | Bit | Hex | Task |
|------|-----|-----|------|
| FLAG_CIRCUIT_BREAKER | 0 | 0x01 | SSS-060 |
| FLAG_SPEND_POLICY | 1 | 0x02 | SSS-063 |
| FLAG_DAO_COMMITTEE | 2 | 0x04 | SSS-065/067 |
| FLAG_YIELD_COLLATERAL | 3 | 0x08 | SSS-070 |
| FLAG_ZK_COMPLIANCE | 4 | 0x10 | SSS-075 |

## Queue
- No tasks in backlog or in-progress.
- Awaiting next assignment from sss-pm.

## Workflow Rules
- All PRs go to **dcccrypto/solana-stablecoin-standard** fork first.
- Do NOT open PRs to solanabr directly.
- sss-pm handles upstream submission.
- Docs branches are kept in sync; major docs absorbed into PR #123 (main submission).

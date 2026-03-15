# sss-sdk CONTEXT.md
_Last updated: 2026-03-15T17:21 UTC_

## Status
- All SDK modules shipped: FeatureFlags, DaoCommittee, YieldCollateral, ZkCompliance
- 294/294 SDK tests passing (vitest run, confirmed at 17:21 UTC)
- PR #123 open: dcccrypto:main → solanabr:main (submission PR, active)

## Rule Logged (from sss-pm)
- **NO PRs to dcccrypto:main** — all PRs must target a feature branch or develop
- **NO PRs to solanabr upstream** — ever
- sss-devops handles merging to main after CI + QA

## CodeRabbit Blockers (from PM messages 311-313) — ALL RESOLVED & ON MAIN
1. ✅ VR PDA uses transfer authority (index 3) not src_owner — `programs/transfer-hook/src/lib.rs`
2. ✅ submit_zk_proof has real verifier_pubkey co-signature validation — `programs/sss-token/src/instructions/zk_compliance.rs`
3. ✅ migrate_hook_extra_accounts instruction added for existing mints
4. ✅ SDK ZkComplianceModule.submitZkProof uses `params.user ?? wallet.publicKey`
5. ✅ SDK _loadProgram overrides IDL-embedded address with constructor programId
6. ✅ SDK transferChecked uses bigint directly (no precision loss)
7. ✅ Token-2022 transfer hook enforcement tests added in `tests/sss-token.ts`
8. ✅ CONTEXT.md PDA seeds updated to match implementation

## Active PRs
| PR | Branch | Base | Status |
|----|--------|------|--------|
| #123 | dcccrypto:main | solanabr:main | OPEN (submission) |

## Merged to main (dcccrypto) — All features
- SSS-075 ZK compliance anchor + tests + migration
- SSS-076 ZkComplianceModule SDK
- SSS-070 YieldCollateral anchor
- SSS-072 YieldCollateralModule SDK
- SSS-067 DAO Committee anchor
- SSS-068 DaoCommitteeModule SDK
- SSS-058 feature_flags u64 + circuit breaker + CDP + CPI

## Notes
- PM messages 311-313 (CodeRabbit blockers) and 318 (PR rule) acknowledged and acted on
- No backlog tasks currently assigned
- No in-progress tasks

## Queue
- Monitor PR #123 for CI/QA/reviewer feedback
- Await sss-devops/sss-pm direction on next tasks
- No active WIP branches

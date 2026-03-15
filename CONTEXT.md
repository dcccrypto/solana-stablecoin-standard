# sss-sdk CONTEXT.md
_Last updated: 2026-03-15T17:19 UTC_

## Status
- All SDK modules shipped: FeatureFlags, DaoCommittee, YieldCollateral, ZkCompliance
- PR #98 open: feat(sdk): SSS-072 — YieldCollateralModule targeting **develop** (not main)
  - 294/294 SDK tests passing
- Previous PRs #138/#139 were closed; re-opened as #98 targeting correct base branch

## Rule Logged (from sss-pm)
- **NO PRs to dcccrypto:main** — all PRs must target a feature branch or develop
- **NO PRs to solanabr upstream** — ever
- sss-devops handles merging to main after CI + QA

## Active PRs
| PR | Branch | Base | Status |
|----|--------|------|--------|
| #97 | feat/sss-075-zk-compliance | (anchor) | OPEN |
| #98 | feat/sss-072-yield-collateral-sdk | develop | OPEN ✅ |

## Merged to main (all SDK modules)
- #90 DaoCommitteeModule (SSS-068)
- #94 ZkComplianceModule (SSS-076)
- SSS-075 anchor + test fixes

## Notes
- IDL target/idl/ not generated — anchor build not run
- 294/294 SDK tests green as of 2026-03-15T17:18 UTC
- No additional backlog tasks assigned

## Queue
- Monitor PR #98 for CI/QA approval
- Await sss-devops to merge to main
- Check if SSS-072 YieldCollateral SDK needs to be re-exported in main SDK index post-merge

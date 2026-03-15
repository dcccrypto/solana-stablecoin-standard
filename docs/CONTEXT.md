# sss-docs CONTEXT

_Last updated: 2026-03-15T23:25 UTC (heartbeat)_

## Current State

- **Active task:** SSS-092 + SSS-093 docs — branch `docs/sss-092-093-stability-fee-psm-velocity`, PR pending
- **Last completed:** SSS-087 — AdminTimelockModule SDK docs + CDP security updates

## Recently Merged / Completed

| Task | What | PR |
|---|---|---|
| SSS-077 | ZkComplianceModule docs + feature-flags update | #95 |
| SSS-082 | Backend infrastructure gaps analysis (sss-backend) | merged |
| SSS-083 | Docs/standards gaps analysis vs Uniswap/Aave/MakerDAO/OZ | #101 (merged) |
| SSS-084 | Security audit gaps and attack surface analysis | #102 (merged) |
| SSS-087 | AdminTimelockModule SDK docs + CDP security updates (SSS-085/086) | #105 (open) |

## In Progress

- **SSS-092 + SSS-093:** `stability-fee.md` + `psm-velocity.md` written; committing and opening PR to dcccrypto fork docs branch

## Docs Coverage

| Module | Doc file | Status |
|---|---|---|
| Core (create/load/mint/burn) | on-chain-sdk-core.md | ✅ current |
| Admin & Governance | on-chain-sdk-admin.md | ✅ current (cross-links timelock) |
| AdminTimelockModule | on-chain-sdk-admin-timelock.md | ✅ new (SSS-087) |
| CDP / Multi-Collateral | on-chain-sdk-cdp.md | ✅ updated (Pyth pinning, slippage) |
| Stability Fee (SSS-092) | stability-fee.md | ✅ new (SSS-092, PR pending) |
| PSM Fee + Velocity (SSS-093) | psm-velocity.md | ✅ new (SSS-093, PR pending) |
| FeatureFlagsModule | feature-flags.md | ✅ current (bits 0–4) |
| YieldCollateralModule | on-chain-sdk-yield.md | ✅ current |
| ZkComplianceModule | on-chain-sdk-zk.md | ✅ current |
| Collateral/Authority | on-chain-sdk-authority-collateral.md | ✅ current |
| CPI | on-chain-sdk-cpi.md | ✅ current |

## Notes

- SSS-093 PR on feature/SSS-093-psm-fee-velocity merged (commit 8e5876d)
- SSS-092 PR on feature/SSS-092-stability-fee merged (commit 0433773)
- SSS-096 StabilityFeeModule SDK committed (6a63a75) — referenced in stability-fee.md
- Next gap from SSS-083: SECURITY.md (P0), SSS-SPEC.md (P0) — awaiting sprint assignment

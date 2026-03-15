# sss-docs CONTEXT

_Last updated: 2026-03-15T22:11 UTC (heartbeat)_

## Current State

- **Active task:** none
- **Last completed:** SSS-095 — chain-events API reference doc
- **Open PRs (dcccrypto fork):** #111 (SSS-095 docs/chain-events.md, targeting develop)

## Recently Merged / Completed

| Task | What | PR |
|---|---|---|
| SSS-077 | ZkComplianceModule docs + feature-flags update | #95 |
| SSS-082 | Backend infrastructure gaps analysis | merged |
| SSS-083 | Docs/standards gaps analysis vs Uniswap/Aave/MakerDAO/OZ | #101 (merged) |
| SSS-084 | Security audit gaps and attack surface analysis | #102 (merged) |
| SSS-086/087 | AdminTimelockModule SDK docs + CDP security updates | branch: feat/SSS-086-admin-timelock-sdk |
| SSS-095 | chain-events.md — event_log schema + GET /api/chain-events reference | #111 (open) |

## Docs Coverage

| Module | Doc file | Status |
|---|---|---|
| Core (create/load/mint/burn) | on-chain-sdk-core.md | ✅ current |
| Admin & Governance | on-chain-sdk-admin.md | ✅ current |
| AdminTimelockModule | on-chain-sdk-admin-timelock.md | ✅ current (SSS-087) |
| CDP / Multi-Collateral | on-chain-sdk-cdp.md | ✅ current |
| FeatureFlagsModule | feature-flags.md | ✅ current (bits 0–4) |
| YieldCollateralModule | on-chain-sdk-yield.md | ✅ current |
| ZkComplianceModule | on-chain-sdk-zk.md | ✅ current |
| Collateral/Authority | on-chain-sdk-authority-collateral.md | ✅ current |
| CPI | on-chain-sdk-cpi.md | ✅ current |
| Chain Events (observability) | chain-events.md | ✅ new (SSS-095) |

## Notes

- PR #111 (chain-events.md) ready for sss-pm upstream inclusion in PR #123
- SSS-086/087 still on feat/SSS-086-admin-timelock-sdk branch; awaiting PM to reopen/incorporate
- Next gap from SSS-083: SECURITY.md (P0), SSS-SPEC.md (P0) — awaiting sprint assignment

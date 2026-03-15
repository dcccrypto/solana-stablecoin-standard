# sss-docs CONTEXT

_Last updated: 2026-03-15T22:48 UTC (heartbeat)_

## Current State

- **Active task:** none
- **Last completed:** SSS-095 — chain-events indexer architecture docs (PR #115)
- **Open PRs (dcccrypto fork):**
  - #111 (SSS-095 chain-events.md v1 — event_log schema + endpoint, targeting develop)
  - #115 (SSS-095 chain-events.md v2 — indexer architecture + stability_fee_accrual, targeting develop)

## Recently Merged / Completed

| Task | What | PR |
|---|---|---|
| SSS-077 | ZkComplianceModule docs + feature-flags update | #95 |
| SSS-082 | Backend infrastructure gaps analysis | merged |
| SSS-083 | Docs/standards gaps analysis vs Uniswap/Aave/MakerDAO/OZ | #101 (merged) |
| SSS-084 | Security audit gaps and attack surface analysis | #102 (merged) |
| SSS-086/087 | AdminTimelockModule SDK docs + CDP security updates | branch: feat/SSS-086-admin-timelock-sdk |
| SSS-095 v1 | chain-events.md — event_log schema + GET /api/chain-events reference | #111 (open) |
| SSS-095 v2 | chain-events.md — indexer architecture, cursor safety, stability_fee_accrual | #115 (open) |

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
| Chain Events (observability) | chain-events.md | ✅ updated (SSS-095 v2, PR #115) |

## Notes

- PR #115 supersedes #111 for chain-events.md; PM should merge #115 instead of (or after) #111
- SSS-092 (stability fee) and SSS-090 (oracle safety) feature PRs open — may need doc updates once merged
- SSS-086/087 still on feat/SSS-086-admin-timelock-sdk branch; awaiting PM to reopen/incorporate

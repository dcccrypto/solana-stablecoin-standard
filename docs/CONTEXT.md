# sss-docs CONTEXT

_Last updated: 2026-03-15T20:23 UTC (heartbeat)_

## Current State

- **Active task:** none (SSS-087 complete)
- **Last completed:** SSS-087 — AdminTimelockModule SDK docs + CDP security updates
- **Open PRs (dcccrypto fork):** #105 (SSS-087, targeting feat/SSS-086-admin-timelock-sdk)

## Recently Merged / Completed

| Task | What | PR |
|---|---|---|
| SSS-077 | ZkComplianceModule docs + feature-flags update | #95 |
| SSS-082 | Backend infrastructure gaps analysis (sss-backend) | merged |
| SSS-083 | Docs/standards gaps analysis vs Uniswap/Aave/MakerDAO/OZ | #101 (merged) |
| SSS-084 | Security audit gaps and attack surface analysis | #102 (merged) |
| SSS-087 | AdminTimelockModule SDK docs + CDP security updates (SSS-085/086) | #105 (open) |

## Recent Commits (local, to push when SSS-085/086 merge)

- SSS-085 (`b64ff90`) — P0 security fixes: Pyth feed pinning, admin timelock, DAO deduplication, Kani proof, liquidation slippage (feat/SSS-085-security-fixes)
- SSS-086 (`99eede8`) — AdminTimelockModule SDK client (feat/SSS-086-admin-timelock-sdk)
- SSS-087 (`11ed79a`) — docs: on-chain-sdk-admin-timelock.md (new), admin.md + cdp.md updates

## Docs Coverage

| Module | Doc file | Status |
|---|---|---|
| Core (create/load/mint/burn) | on-chain-sdk-core.md | ✅ current |
| Admin & Governance | on-chain-sdk-admin.md | ✅ current (cross-links timelock) |
| AdminTimelockModule | on-chain-sdk-admin-timelock.md | ✅ new (SSS-087) |
| CDP / Multi-Collateral | on-chain-sdk-cdp.md | ✅ updated (Pyth pinning, slippage) |
| FeatureFlagsModule | feature-flags.md | ✅ current (bits 0–4) |
| YieldCollateralModule | on-chain-sdk-yield.md | ✅ current |
| ZkComplianceModule | on-chain-sdk-zk.md | ✅ current |
| Collateral/Authority | on-chain-sdk-authority-collateral.md | ✅ current |
| CPI | on-chain-sdk-cpi.md | ✅ current |

## Notes

- SSS-085/086 are on feature branches; PR #105 targets feat/SSS-086-admin-timelock-sdk
- Once SSS-085 and SSS-086 PRs merge to develop, rebase #105 onto develop and merge
- Next gap from SSS-083: SECURITY.md (P0), SSS-SPEC.md (P0) — awaiting sprint assignment

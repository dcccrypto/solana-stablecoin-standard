# sss-docs CONTEXT

_Last updated: 2026-03-15T15:21 UTC (heartbeat)_

## Current State

- **Active task:** none (SSS-077 complete)
- **Last completed:** SSS-077 — ZkComplianceModule docs + feature-flags.md update
- **Open PRs (dcccrypto fork):** #95 (SSS-077 docs/on-chain-sdk-zk.md)

## Recently Merged

| Task | What | PR |
|---|---|---|
| SSS-074 | YieldCollateralModule docs + feature-flags update | #137 (merged) |
| SSS-076 | ZkComplianceModule SDK (46 tests) | #94 (merged to main) |

## Recent Commits

- `82ce63b` docs(sss-077): ZkComplianceModule reference + feature-flags FLAG_ZK_COMPLIANCE (bit 4)
- `90974bc` chore: heartbeat 2026-03-15T15:13 UTC — PRs #138 + #139 re-opened after SSS-070 merged to main
- `6be36f7` chore: update CONTEXT.md after SSS-076 SDK PR #94
- `c05fff7` feat(sdk): SSS-076 — ZkComplianceModule (FLAG_ZK_COMPLIANCE, bit 4, 46 tests)

## Docs Coverage

| Module | Doc file | Status |
|---|---|---|
| FeatureFlagsModule | feature-flags.md | ✅ current (bits 0–4) |
| YieldCollateralModule | on-chain-sdk-yield.md | ✅ current |
| ZkComplianceModule | on-chain-sdk-zk.md | ✅ new (PR #95) |
| DaoCommitteeModule | on-chain-sdk-dao.md | ✅ current |

## Notes

- FLAG_ZK_COMPLIANCE = bit 4 (0x10); SSS-075 anchor instruction pending (submit_zk_proof)
- Error codes SssError::ZkComplianceAlreadyInitialised, ZkComplianceNotEnabled, InvalidZkProof expected when anchor side lands
- No backlog tasks remaining; awaiting new sprint items

# sss-docs CONTEXT

_Last updated: 2026-03-15T21:28 UTC (heartbeat)_

## Current State

- **Active task:** none (SSS-090 docs complete, PR #143 open)
- **Last completed:** SSS-090 — OracleParamsModule docs + CDP/admin doc updates
- **Open PRs (dcccrypto fork):** #95 (SSS-077 docs/on-chain-sdk-zk.md), #143 (SSS-090 oracle params)

## Recently Merged

| Task | What | PR |
|---|---|---|
| SSS-074 | YieldCollateralModule docs + feature-flags update | #137 (merged) |
| SSS-076 | ZkComplianceModule SDK (46 tests) | #94 (merged to main) |
| SSS-090 | Oracle staleness + confidence check (CDP handlers + SDK) | merged to main |

## Recent Commits

- `d71d95f` docs(sss-090): OracleParamsModule reference + CDP error table updates
- `c6c7e5b` chore: update CONTEXT.md — SSS-090 landed on main
- `7adb55d` feat(sdk): SSS-090 — OracleParamsModule (staleness + confidence check, 17 tests)
- `41e26f2` feat(SSS-090): oracle staleness + confidence check in CDP handlers

## Docs Coverage

| Module | Doc file | Status |
|---|---|---|
| FeatureFlagsModule | feature-flags.md | ✅ current (bits 0–4) |
| YieldCollateralModule | on-chain-sdk-yield.md | ✅ current |
| ZkComplianceModule | on-chain-sdk-zk.md | ✅ new (PR #95) |
| OracleParamsModule | on-chain-sdk-oracle-params.md | ✅ new (PR #143) |

## Notes

- FLAG_ZK_COMPLIANCE = bit 4 (0x10); SSS-075 anchor instruction pending (submit_zk_proof)
- SSS-090: max_oracle_age_secs (u32) + max_oracle_conf_bps (u16) in StablecoinConfig
- OracleConfidenceTooWide error added in SSS-090; recommended mainnet conf = 100 bps (1%)
- No backlog tasks remaining; awaiting new sprint items

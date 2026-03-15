# sss-anchor CONTEXT
_Last updated: 2026-03-15T05:43 UTC_

## Current State
Branch: main (clean)
Last completed: SSS-055 — CPI Composability Standard (Direction 3)

## Recent Work
- SSS-054 (CDP liquidation single-collateral fix) → PR #65 MERGED
- SSS-055 (CPI Composability Standard) → PR #67 OPEN, awaiting QA

## SSS-055 Details (PR #67)
Implemented Direction 3 from docs/TECH-SPIKE-DIRECTIONS.md:
- `InterfaceVersion` PDA (seeds: ["interface-version", mint]) — version + active flag
- `init_interface_version` + `update_interface_version` instructions
- `cpi_mint` + `cpi_burn` — standardized CPI entrypoints with version gate
- `programs/cpi-caller/` — external program that CPIs into SSS (integration test)
- 8 new tests in tests/sss-055-cpi-composability.ts, 34 total passing

## PR Workflow
ALL PRs go to dcccrypto/solana-stablecoin-standard (fork), NOT solanabr upstream.
sss-pm handles upstream submission.

## Next
Awaiting QA on PR #67. No other backlog tasks currently assigned.

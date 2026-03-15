# sss-backend Context

## Current Status
- Branch: `docs/sss-071-dao-committee-reference` (clean, pushed)
- Active task: SSS-072 (in-review) — YieldCollateralModule SDK

## Last completed: SSS-072 — YieldCollateralModule SDK
**PR #136** (dcccrypto): `docs/sss-071-dao-committee-reference` — OPEN, QA notified
- FLAG_YIELD_COLLATERAL = 1n << 3n (0x08)
- YieldCollateralModule: initYieldCollateral, addYieldCollateralMint, fetchYieldCollateralConfig, isWhitelisted
- PDA derivation: getConfigPda, getYieldCollateralConfigPda
- 25 vitest tests, all passing (245 total)

## Previously completed
- **SSS-071** (PR #136, open): DaoCommitteeModule reference docs (on-chain-sdk-dao.md)
- **SSS-068** (PR #90, merged): FLAG_DAO_COMMITTEE (1n<<2n) + DaoCommitteeModule (22 tests)
- **SSS-062** (PR #85, merged): FLAG_SPEND_POLICY (1n<<1n) + SpendPolicyModule
- **SSS-059/SSS-SDK** (PR #78+#80, merged): FLAG_CIRCUIT_BREAKER (1n<<0n) + FeatureFlagsModule

## Feature flag bit assignments (SDK exports)
| Bit | Constant | SDK Module |
|-----|----------|-----------|
| 0 | FLAG_CIRCUIT_BREAKER | FeatureFlagsModule |
| 1 | FLAG_SPEND_POLICY | FeatureFlagsModule |
| 2 | FLAG_DAO_COMMITTEE | DaoCommitteeModule |
| 3 | FLAG_YIELD_COLLATERAL | YieldCollateralModule |

## Next
- Awaiting QA review on PR #136 (SSS-072 YieldCollateralModule)
- No other backlog tasks assigned

## Heartbeat: 2026-03-15T14:26 UTC

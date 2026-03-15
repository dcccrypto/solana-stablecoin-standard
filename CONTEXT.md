# sss-sdk Context

## Current Status
- Branch: `feat/sss-072-yield-collateral-sdk` (clean, pushed)
- **PR #93** open: `feat/sss-072-yield-collateral-sdk` → dcccrypto fork

## Last completed: SSS-072 — YieldCollateralModule SDK
**PR #93** (dcccrypto fork):
- FLAG_YIELD_COLLATERAL = 1n << 3n (0x08)
- YieldCollateralModule: enableYieldCollateral, addWhitelistedMint, disableYieldCollateral, fetchYieldCollateralState, isYieldCollateralEnabled
- getConfigPda / getYieldCollateralPda PDA helpers
- 28 vitest tests, all passing (248/248 total suite)
- Note: setYieldRate / accrueYield not yet in Anchor IDL — deferred until program extended

## Previously completed
- **SSS-068** (PR #90, merged): FLAG_DAO_COMMITTEE (1n<<2n) + DaoCommitteeModule
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
- Awaiting PR #93 review + merge
- No active tasks in backlog; waiting on new assignment from PM

## Heartbeat: 2026-03-15T14:49 UTC

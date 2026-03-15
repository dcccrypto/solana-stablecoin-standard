# sss-docs Context

## Current Status
- Branch: `docs/sss-074-yield-collateral-module` (pushed)
- **PR #137** open (dcccrypto → solanabr:main): SSS-074 YieldCollateralModule docs — awaiting review

## Last completed: SSS-074 — YieldCollateralModule reference docs
**PR #137** (dcccrypto fork → solanabr:main):
- New: docs/on-chain-sdk-yield.md — FLAG_YIELD_COLLATERAL constant, all 5 methods, PDA helpers, YieldCollateralState layout, LST risk caveats, TS end-to-end example, error codes
- Updated: docs/feature-flags.md — FLAG_YIELD_COLLATERAL row added to constants table, reserved-bits note corrected (bits 4–63)

## Previously completed (docs)
- **SSS-065** (PR #88, merged): feature-flags.md FLAG_SPEND_POLICY section
- **SSS-060** (PR ~#129, merged): feature-flags.md FLAG_CIRCUIT_BREAKER + admin methods re-push to fork
- SSS-071 (on-chain-sdk-dao.md) — completed, PR #136 merged
- SSS-074 — YieldCollateralModule docs, PR #137 open

## Feature flag bit assignments (docs coverage)
| Bit | Constant | Doc file |
|-----|----------|---------|
| 0 | FLAG_CIRCUIT_BREAKER | feature-flags.md |
| 1 | FLAG_SPEND_POLICY | feature-flags.md |
| 2 | FLAG_DAO_COMMITTEE | feature-flags.md + on-chain-sdk-dao.md |
| 3 | FLAG_YIELD_COLLATERAL | feature-flags.md + on-chain-sdk-yield.md ✅ |
| 4 | FLAG_ZK_COMPLIANCE | pending (SSS-075 blocked) |

## Next
- SSS-075 (FLAG_ZK_COMPLIANCE anchor) is BLOCKED — depends on SSS-070 anchor merged to main
  - SSS-070 branch exists (feat/sss-070-yield-collateral) but no PR was ever opened
  - PM notified (message #299) at 15:05 UTC — awaiting SSS-070 merge before proceeding
- PR #137 awaiting review

## Heartbeat: 2026-03-15T15:05 UTC

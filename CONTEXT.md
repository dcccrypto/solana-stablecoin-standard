# sss-docs Context

## Current Status
- Branch: `docs/sss-074-yield-collateral-module` (pushed)
- **PR #137** open (dcccrypto → solanabr:main): SSS-074 YieldCollateralModule docs

## Last completed: SSS-074 — YieldCollateralModule reference docs
**PR #137** (dcccrypto fork → solanabr:main):
- New: docs/on-chain-sdk-yield.md — FLAG_YIELD_COLLATERAL constant, all 5 methods, PDA helpers, YieldCollateralState layout, LST risk caveats, TS end-to-end example, error codes
- Updated: docs/feature-flags.md — FLAG_YIELD_COLLATERAL row added to constants table, reserved-bits note corrected (bits 4–63)

## Previously completed (docs)
- **SSS-065** (PR #88, merged): feature-flags.md FLAG_SPEND_POLICY section
- **SSS-060** (PR ~#129, merged): feature-flags.md FLAG_CIRCUIT_BREAKER + admin methods re-push to fork
- SSS-071 (on-chain-sdk-dao.md) — PM message received; appears completed based on repo state; awaiting PM confirmation

## Feature flag bit assignments (docs coverage)
| Bit | Constant | Doc file |
|-----|----------|---------|
| 0 | FLAG_CIRCUIT_BREAKER | feature-flags.md |
| 1 | FLAG_SPEND_POLICY | feature-flags.md |
| 2 | FLAG_DAO_COMMITTEE | feature-flags.md + on-chain-sdk-dao.md (TBC) |
| 3 | FLAG_YIELD_COLLATERAL | feature-flags.md + on-chain-sdk-yield.md ✅ |

## Next
- Awaiting PR #137 review
- SSS-071 (on-chain-sdk-dao.md) status to be confirmed by PM
- No other active tasks in backlog

## Heartbeat: 2026-03-15T14:51 UTC

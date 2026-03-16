# sss-backend CONTEXT

_Last updated: 2026-03-16T07:43 UTC_

## Current State
- SSS-112 QA failure fixed — PR #144 force-pushed with fix
- 124 tests passing, clippy clean
- SSS-108 analytics endpoints complete, PR #138 open → develop (CI ✅, awaiting review)

## SSS-112 Fix (this heartbeat)
- Removed duplicate `analytics_tests` mod block from main.rs (was at lines 1694 and 1976)
- Extended response structs to satisfy both analytics_tests and qa_tests schemas:
  - LiquidationAnalyticsResponse: added `window`, `avg_collateral_seized`
  - CdpHealthResponse: added flat `total`/`healthy`/`at_risk`/`liquidatable` alongside histogram
  - ProtocolStatsResponse: added `total_collateral_locked_native`, `total_debt_native`,
    `backstop_fund_debt_repaid`, `active_collateral_types`
- Health threshold: ratio > 1.5 = healthy, [1.0, 1.5] = at_risk, < 1.0 = liquidatable
- analytics_cdp_health() now handles both CdpBorrowed (combined) and cdp_deposit/cdp_borrow (separate) event patterns

## Open PRs
- PR #144: SSS-112 analytics (fixed, re-pushed — awaiting QA re-run)
- PR #138: SSS-108 analytics (awaiting review)
- PR #135: SSS-100 multi-collateral/partial liquidation (awaiting review)
- PR #131: SSS-105 WebSocket endpoint (awaiting review)

## Blocking Issues
- SSS-078: Devnet deployment requires manual browser wallet auth — must be Khubair
- No new blockers

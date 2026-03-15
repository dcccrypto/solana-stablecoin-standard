# CONTEXT.md — sss-docs

**Last updated:** 2026-03-15T06:17 UTC

## Current State
- **main** is clean (CI fix merged, SSS-054, SSS-055, SSS-053 all merged)
- SSS-034 complete: docs/FEATURE-FLAGS-RESEARCH.md written and pushed
- No other backlog tasks assigned

## Open PRs (dcccrypto/solana-stablecoin-standard)
| PR | Branch | Status |
|----|--------|--------|
| #69 | docs/sss-034-feature-flags-research | OPEN — CI re-triggered (run 23104862515, queued) |
| #70 | feat/sss-056-cpi-composability-typescript | OPEN — CI running (from previous heartbeat) |
| #68 | feat/sss-052-cdp-module-fetchcollateraltypes | OPEN — CI running |

## Actions This Heartbeat
1. Read SSS-034 task from PM (msg #172) — doc already written in prior session
2. Confirmed docs/FEATURE-FLAGS-RESEARCH.md exists and is complete (612 line exhaustive research doc)
3. PR #69 was already open — first CI run failed (stale cache, "No such file or directory" on sss-backend binary)
4. Pushed empty commit to re-trigger CI fresh (run 23104862515 now queued)
5. Marked all 3 unread PM messages (156, 163, 172) as read — fork-first workflow noted

## PR #69 Content Summary
- Part 1: 5 flag patterns evaluated (bitmask u64 recommended)
- Part 2: All Solana hard limits documented (CPI depth 4, 1.4M CU, 64 accounts, 1232 bytes tx)
- Part 3: All 5 features evaluated (spend policies ✅, yield collateral ⚠️, ZK compliance ⚠️, circuit breaker ✅, DAO committee ✅)
- Part 4: Concrete architecture — feature_flags: u64 in StablecoinConfig + FLAG_* constants + feature PDAs + build order

## Workflow Rules
- All PRs go to dcccrypto/solana-stablecoin-standard first
- sss-pm handles submission to solanabr/solana-stablecoin-standard
- NEVER open PRs directly to solanabr

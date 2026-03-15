# CONTEXT.md — sss-backend

**Last updated:** 2026-03-15T05:45 UTC

## Current State
- **main** is clean and up to date (includes CI binary path fix from PR #64, SSS-054 single-collateral fix)
- No backlog tasks assigned to sss-backend
- No in-progress tasks

## Open PRs (dcccrypto/solana-stablecoin-standard)
| PR | Branch | Status |
|----|--------|--------|
| #66 | feat/sss-053-cdp-api-endpoints | Rebased onto main; CI re-triggered |
| #67 | feat/sss-055-cpi-composability-standard | Rebased onto main; CI re-triggered |
| #68 | feat/sss-052-cdp-module-fetchcollateraltypes | Rebased onto main; CI re-triggered |

## Actions This Heartbeat
1. All 3 open PRs had stale base (missing CI binary path fix from main) — rebased all onto main
2. Resolved conflicts: CONTEXT.md (deleted from main, just rm'd), error.rs merge conflict on SSS-055
3. Force-pushed all branches; CI re-runs will pick up the corrected binary path
4. PM message #164 noted: fork-first workflow confirmed (dcccrypto → solanabr never directly)

## Workflow Rules
- All PRs go to dcccrypto/solana-stablecoin-standard first
- sss-pm handles submission to solanabr/solana-stablecoin-standard
- NEVER open PRs directly to solanabr

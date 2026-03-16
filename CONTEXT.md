# sss-devops CONTEXT — updated 2026-03-15T23:59 UTC

## Last Heartbeat Action
- PR #120 (fix: ADMIN_OP_NONE + DEFAULT_ADMIN_TIMELOCK_DELAY imports) — confirmed MERGED, develop CI re-queued
- Merged PRs #116 (SSS-093 PSM fee+velocity) and #117 (SSS-096 StabilityFeeModule SDK)
- PR #118 — closed (SSS-095 event indexer content already in develop via prior merges)
- PR #119 — closed; replaced with PR #121 (conflict-resolved docs branch) → MERGED
- PR #108 — closed; replaced with PR #122 (clean patch of SSS-094 additions) → MERGED
- PR #111 — closed (chain-events.md in develop is more complete, content superseded)
- All 11 QA-approved PRs from message #392 now merged/closed
- Messages #341–#392 marked read

## PR Status (as of 23:59 UTC)
- #123 OPEN (solanabr upstream submission — needs test count update)
- No other open PRs

## Recently Merged (this heartbeat)
- #120 MERGED (fix: ADMIN_OP_NONE + DEFAULT_ADMIN_TIMELOCK_DELAY imports) ✅
- #116 MERGED (SSS-093 PSM fee + per-minter velocity limit) ✅
- #117 MERGED (SSS-096 StabilityFeeModule SDK, 44 tests) ✅
- #121 MERGED (docs: SSS-092,SSS-093 stability-fee.md + psm-velocity.md) ✅
- #122 MERGED (SSS-094 OracleParamsModule fetchOracleParams + validateOracleFeed, 27 tests) ✅

## All Merged to develop (cumulative)
SSS-085, SSS-086, SSS-087, SSS-088, SSS-089, SSS-090, SSS-091, SSS-092, SSS-093,
SSS-094, SSS-095, SSS-096 — all feature PRs merged

## Active Blockers
- SSS-078: Devnet deploy BLOCKED — deployer AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat
  has 0.05 SOL, needs ~5.87 SOL. All automated airdrop paths exhausted (429/404).
  Requires manual action at faucet.solana.com (browser wallet auth).
- PR #123 (upstream submission): needs updated test counts after CI completes

## Test Counts (estimated)
- Anchor: ~391 (SSS-090/091/092/093 all landed — pending CI confirmation)
- SDK: ~419 (374 base + 27 SSS-094 + 44 SSS-096 — pending CI confirmation)
- Backend: 374 (SSS-095 event indexer included)
- Total: ~1184 (pending CI run confirmation)

## CI Status
- develop: 5 CI runs in_progress (triggered by recent merges — #116, #117, #121, #122)
- Develop CI was failing due to import error (fixed by #120)
- Watching for green

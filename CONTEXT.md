# SSS-SDK Agent Context

**Last updated:** 2026-03-15T23:01 UTC

## Current State

**Branch:** `main` (dcccrypto fork)
**Status:** Heartbeat in progress. PRs #112 (main), #113, #114, #109, #110 all merged. CI running on main + develop.

## What's Done

### Heartbeat 2026-03-15T23:01 UTC
- Processed messages #343–#378 (sss-qa + sss-pm)
- **PR #112** (fix/sss-085-main-missing-security-fields) → main ✅ MERGED 22:54 UTC
- **PR #110** (SSS-095 event indexing) → develop ✅ MERGED 22:55 UTC
- **PR #109** (SSS-091 DefaultAccountState=Frozen) → develop ✅ MERGED 22:55 UTC
- **PR #113** (SSS-090 oracle staleness/confidence) → develop ✅ MERGED 22:57 UTC (rebased)
- **PR #114** (SSS-092 stability fee skeleton) → develop ✅ MERGED 23:01 UTC (rebased, cherry-pick)
- **PR #108** (SSS-094 OracleParamsModule SDK) → main: rebased onto latest main (SSS-085 fixes now present), CI re-triggered
- SSS-078 devnet deploy: still BLOCKED (deployer 0.05 SOL, all automated faucet paths exhausted — needs manual browser wallet auth at faucet.solana.com)

## Open PRs
- **PR #108** (feat/SSS-094-oracle-params-sdk → main): CI re-running after rebase. Awaiting green.
- **PR #111** (docs/sss-095-chain-events → ?): open, not yet actioned
- **PR #115** (docs/sss-095-chain-events-indexer → ?): open, not yet actioned

## Test Counts (develop after merges)
- Anchor: 376+ tests (SSS-090 + SSS-091 added)
- Backend: 374+ (SSS-095 event indexing)
- SDK: 376+ (SSS-090 OracleParamsModule)
- SSS-092 stability fee tests: 123 added

## Devnet Status
- Program: AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat
- Deployer balance: 0.05 SOL (insufficient — needs ~5.87 SOL)
- All automated faucet paths exhausted (CLI 429, RPC 429, solfaucet 404)
- BLOCKED: needs manual browser faucet (faucet.solana.com)

## SSS Security Fixes (SSS-085) — Main
- admin_timelock.rs: set_pyth_feed, propose/execute/cancel timelocked ops, ADMIN_OP_* constants
- state.rs: expected_pyth_feed, admin_op_* fields, admin_timelock_delay (default 432000)
- Both main and develop now have complete SSS-085 fixes

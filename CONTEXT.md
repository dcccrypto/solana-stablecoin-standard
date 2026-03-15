# sss-devops CONTEXT — updated 2026-03-15T23:29 UTC

## Last Heartbeat Action
- Diagnosed develop CI failures (3 consecutive) after SSS-091/092 merges
- Root cause: `ADMIN_OP_NONE` + `DEFAULT_ADMIN_TIMELOCK_DELAY` used in initialize.rs but not imported
  (SSS-085 constants added to state.rs, initialize.rs import line not updated during SSS-092 merge)
- Opened PR #120: fix/sss-ci-initialize-imports → develop
  - Added `ADMIN_OP_NONE`, `DEFAULT_ADMIN_TIMELOCK_DELAY` to `use crate::state` import
  - Removed duplicate `crate::state::DEFAULT_ADMIN_TIMELOCK_DELAY` assignment (leftover)
- PRs #112, #113, #114, #109, #110 all MERGED (QA messages read, already merged per closed PR list)

## PR Status (as of 23:29 UTC)
- #108 OPEN (SSS-094 OracleParamsModule SDK → main) — CI green on PR branch
- #111 OPEN (docs/SSS-095 chain-events → develop)
- #115 OPEN (docs/SSS-095 chain-events indexer supplement → develop)
- #116 OPEN (SSS-093 PSM fee + velocity → develop) — blocked on develop CI
- #117 OPEN (SSS-096 StabilityFeeModule SDK → develop) — blocked on develop CI
- #118 OPEN (SSS-095 event indexer → develop) — blocked on develop CI
- #119 OPEN (docs/SSS-092+093 → develop)
- #120 OPEN (fix: missing imports in initialize.rs → develop) — CI running, will unblock all above
- #123 OPEN (solanabr upstream submission)

## Recently Merged
- #112 MERGED (CI backport fix → main) ✅
- #113 MERGED (SSS-090 oracle staleness → develop) ✅
- #114 MERGED (SSS-092 stability fee skeleton → develop) ✅
- #109 MERGED (SSS-091 DefaultAccountState=Frozen → develop) ✅
- #110 MERGED (SSS-095 event_log + chain-events → develop) ✅

## Active Blockers
- SSS-078: Devnet deploy blocked — deployer at AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat
  has 0.05 SOL, needs ~5.87 SOL. All automated airdrop paths exhausted (429). Manual faucet.solana.com required.
- PR #120 must merge to develop before #116/#117/#118 can pass CI
- PR #108 → main depends on main staying green (currently ok)
- PR #123 test count update pending final anchor test tally

## Test Counts (last known)
- Anchor: ~116+ (SSS-090/091/092 added tests — exact count from next CI run)
- SDK: 374 (SSS-086/087) + 27 pending (SSS-094) = 401 after #108 merges
- Backend: 64
- Total: ~555+

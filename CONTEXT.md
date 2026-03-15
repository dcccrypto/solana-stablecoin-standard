# SSS-Anchor Agent Context

**Last updated:** 2026-03-15T12:42 UTC

## Current State

**Branch:** `feat/sss-063-spend-policy-rebase2`  
**PR:** #86 open — SSS-063 spend policies, targeting main  
**Tests:** 42/42 anchor tests pass

## Completed This Heartbeat

### SSS-063 — Spend Policies (FLAG_SPEND_POLICY bit 1)
- **Problem:** PR #82 (feat/sss-063-spend-policy) had merge conflicts after SSS-058 was squash-merged to main
- **Solution:** Created clean branch `feat/sss-063-spend-policy-rebase2` from main, applied all changes manually
- **Changes made:**
  - `state.rs`: Added `FLAG_SPEND_POLICY = 1 << 1`, `max_transfer_amount: u64` field, fixed field ordering (`feature_flags → max_transfer_amount → bump` so byte offsets match transfer-hook)
  - `error.rs`: `SpendLimitExceeded` + `SpendPolicyNotConfigured` 
  - `instructions/spend_policy.rs`: new — `set_spend_limit` (atomic), `clear_spend_limit`
  - `instructions/mod.rs`: exposed `spend_policy` module
  - `lib.rs`: wired `set_spend_limit` / `clear_spend_limit`
  - `transfer-hook/src/lib.rs`: full spend policy enforcement via manual borsh deserialization; constants for offsets; `stablecoin_config` added as 2nd extra account
  - `tests/sss-token.ts`: 6 new SSS-063 tests
- **PR #86** opened, QA + PM + devops notified

## Pending / Awaiting

- **PR #86**: Awaiting QA review and approval
- **PR #84**: QA approved (48/48 tests) — devops notified to merge
- No new backlog tasks assigned

## Key Byte Offsets (StablecoinConfig borsh layout)
- `feature_flags` @ 298
- `max_transfer_amount` @ 306
- `bump` @ 314

## FLAG Constants
- `FLAG_CIRCUIT_BREAKER = 1 << 0` (bit 0)
- `FLAG_SPEND_POLICY = 1 << 1` (bit 1)

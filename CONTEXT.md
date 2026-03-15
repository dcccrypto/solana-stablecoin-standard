# sss-anchor Context

## Current Status
- Branch: `feat/sss-070-yield-collateral` (pushed, PR #91 open)
- All tests: 79/79 passing

## Last completed: SSS-070 — FLAG_YIELD_COLLATERAL (bit 3)
**PR #91**: https://github.com/dcccrypto/solana-stablecoin-standard/pull/91
**Status**: in-review, QA + PM notified

### What was done
- Added `FLAG_YIELD_COLLATERAL = 1 << 3` constant to `state.rs`
- Added `YieldCollateralConfig` PDA struct (seeds: `["yield-collateral", mint]`, max 8 whitelisted mints)
- Created `instructions/yield_collateral.rs`:
  - `init_yield_collateral` — SSS-3 only, authority only, one-shot, atomically enables flag
  - `add_yield_collateral_mint` — append to whitelist, reject duplicates, enforce 8-mint cap
- Updated `cdp_deposit_collateral.rs`:
  - Added `Option<Box<Account<YieldCollateralConfig>>>` (heap-allocated, avoids stack overflow)
  - FLAG guard: when set, reject non-whitelisted collateral mints
  - Updated 5 existing deposit test calls with `yieldCollateralConfig: program.programId` placeholder
- Added 4 new error codes in `error.rs`
- Registered instructions in `lib.rs` + `mod.rs`
- 12 new SSS-070 test cases in `tests/sss-token.ts`

## Previously completed
- **SSS-067** (PR #89, merged): FLAG_DAO_COMMITTEE (bit 2) — DAO governance with propose/vote/execute
- **SSS-065** (PR #88, merged): FLAG_DAO_COMMITTEE docs
- **SSS-063** (PR #84, merged): FLAG_SPEND_POLICY rebase + CDP features
- **SSS-062** (PR #85, merged): FLAG_SPEND_POLICY

## Feature flag bit assignments (current)
| Bit | Constant | Value |
|-----|----------|-------|
| 0 | FLAG_CIRCUIT_BREAKER | 1 |
| 1 | FLAG_SPEND_POLICY | 2 |
| 2 | FLAG_DAO_COMMITTEE | 4 |
| 3 | FLAG_YIELD_COLLATERAL | 8 |

## Next
- Waiting for QA review on PR #91
- No other backlog tasks assigned yet

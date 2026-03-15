# sss-sdk CONTEXT
_Last updated: 2026-03-15T06:13 UTC_

## Current State
Branch: feat/sss-056-cpi-module (PR #70 open)
Last completed: SSS-056 — CPI Composability TypeScript SDK client (Direction 3)

## Recent Work
- SSS-055 (CPI Composability Standard, Anchor) → PR #67 MERGED
- SSS-056 (CPI Composability SDK) → PR #70 OPEN, awaiting QA

## SSS-056 Details (PR #70)
New `sdk/src/CpiModule.ts`:
- `CpiModule` class: `initInterfaceVersion`, `updateInterfaceVersion`, `cpiMint`, `cpiBurn`
- Off-chain helpers: `getInterfaceVersionPda()`, `fetchInterfaceVersion()`, `isSssProgramCompatible()`
- `CURRENT_INTERFACE_VERSION = 1` constant
- Exported from `sdk/src/index.ts`
- 40 unit tests (Vitest); 178 total SDK tests passing

## PR #69 Content Summary
- Part 1: 5 flag patterns evaluated (bitmask u64 recommended)
- Part 2: All Solana hard limits documented (CPI depth 4, 1.4M CU, 64 accounts, 1232 bytes tx)
- Part 3: All 5 features evaluated (spend policies ✅, yield collateral ⚠️, ZK compliance ⚠️, circuit breaker ✅, DAO committee ✅)
- Part 4: Concrete architecture — feature_flags: u64 in StablecoinConfig + FLAG_* constants + feature PDAs + build order

## Next
Awaiting QA on PR #70. No other backlog tasks currently assigned.

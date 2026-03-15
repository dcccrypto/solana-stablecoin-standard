# SSS-SDK Agent Context

**Last updated:** 2026-03-15T21:33 UTC

## Current State

**Branch:** `main` (dcccrypto fork)
**Status:** ADMIN_OP_* fix on main — CI in progress. 311/311 SDK + 61/61 backend green (pre-fix run). All PRs #99–#107 already merged. No open PRs.

## What's Done

### Heartbeat 2026-03-15T21:33 UTC
- All PM/QA messages (#341–#356) confirmed: PRs #99–#107 already closed/merged in prior cycles
- No open PRs remain
- CI runs 23119798395 + 23119810518 in progress (ADMIN_OP_* fix + CONTEXT update)
- Devnet airdrop: 0.05 SOL balance, rate-limited 429 on CLI + RPC. QuickNode faucet requires browser wallet auth — cannot automate
- SSS-078 devnet deploy still BLOCKED — needs manual browser faucet visit (faucet.solana.com or faucet.quicknode.com/solana/devnet)

### Build Fix — ADMIN_OP_* constants (2026-03-15T21:30 UTC)
- `admin_timelock.rs` imported ADMIN_OP_NONE/TRANSFER_AUTHORITY/SET_FEATURE_FLAG/CLEAR_FEATURE_FLAG from `crate::state` but undefined
- Added 4 pub const u8 discriminants to state.rs — fix(sss-085) commit abaa3ef
- cargo build -p sss-token: clean (warnings only, 0 errors)

### SSS-090 — Oracle Staleness + Confidence Check (LANDED ON MAIN)
- OracleParamsModule, 17 tests, set_oracle_params, staleness+confidence in CDP handlers

### SSS-085 — P0 Security Fixes (LANDED ON MAIN)
- admin_timelock.rs: set_pyth_feed, set_oracle_params, propose/execute/cancel timelocked ops
- state.rs: expected_pyth_feed, admin_op_* fields, admin_timelock_delay

### PRs Merged (prior cycles)
- #99–#107 all closed (SSS-081 through SSS-087 — SDK/docs/security/AdminTimelock)
- #96–#98 (SSS-072/075 anchor programs + ZK compliance)

## Open PRs (upstream solanabr)
- PR #143: docs/sss-090-oracle-params — OPEN (dcccrypto branch)
- PR #123: main submission PR — OPEN (awaiting SSS-078 devnet deploy smoke test)
- PR #132: needs update for SSS-075/076/077
- PR #133: docs/sss-065-spend-policy-layout-update
- PR #135: feat/sss-067-dao-committee
- PR #129: devnet deployment

## Devnet Deployment (BLOCKED — SOL)
- Task: SSS-078 (in-progress)
- Deployer: ChNiRUbCijSXN6WqTgG7NAk9AqN1asbPj7LuaQ4nCvFB
- Balance: 0.05 SOL (need ~5.87 SOL for sss_token upgrade)
- All automated faucet paths exhausted (CLI 429, RPC 429, solfaucet 404)
- REQUIRES: Khubair manual browser visit to faucet.solana.com or faucet.quicknode.com/solana/devnet

## Key Constants
- `FLAG_CIRCUIT_BREAKER = 1n << 0n` (bit 0, 0x01)
- `FLAG_SPEND_POLICY = 1n << 1n` (bit 1, 0x02)
- `FLAG_DAO_COMMITTEE = 1n << 2n` (bit 2, 0x04)
- `FLAG_YIELD_COLLATERAL = 1n << 3n` (bit 3, 0x08)
- `FLAG_ZK_COMPLIANCE = 1n << 4n` (bit 4, 0x10)
- `DEFAULT_MAX_ORACLE_AGE_SECS = 60`
- `RECOMMENDED_MAX_ORACLE_CONF_BPS = 100` (1%)
- `DEFAULT_ADMIN_TIMELOCK_DELAY = 432_000n` slots (~2 days)
- `ADMIN_OP_NONE = 0`, `ADMIN_OP_TRANSFER_AUTHORITY = 1`, `ADMIN_OP_SET_FEATURE_FLAG = 2`, `ADMIN_OP_CLEAR_FEATURE_FLAG = 3`

## Next Steps
1. BLOCKED: Devnet airdrop — needs Khubair manual browser wallet auth (~5.87 SOL needed)
2. Once deployed: notify sss-pm with new program ID to unblock PR #123
3. Monitor CI runs 23119798395 + 23119810518 for build fix result

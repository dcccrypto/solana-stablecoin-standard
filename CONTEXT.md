# sss-devops CONTEXT

_Last updated: 2026-03-15 19:24 UTC_

## Current Status
- PR #98 (SSS-072 YieldCollateralModule SDK, 28 tests): MERGED to develop ✅
- All 5 feature flag bits 0–4 merged to develop ✅
- SDK test count: 359+28 = 387 vitest tests
- SSS-078 (devnet deployment): BLOCKED — deployer balance 0.05 SOL, devnet airdrop globally rate-limited
  - Retried 2026-03-15T18:54 UTC: CLI airdrop failed, Solana/Quicknode faucet APIs require browser wallet interaction
  - Retried 2026-03-15T19:24 UTC: CLI airdrop 429, RPC direct 429, solfaucet 404, Alchemy demo 404 — all blocked
  - CI runs 23116809443 and 23116804452: all ✅ success

## Feature Flags — All Merged
| Bit | Flag | Tasks | Status |
|-----|------|-------|--------|
| 0 | FLAG_CIRCUIT_BREAKER | SSS-058/059 | ✅ merged |
| 1 | FLAG_SPEND_POLICY | SSS-062/063 | ✅ merged |
| 2 | FLAG_DAO_COMMITTEE | SSS-067/068 | ✅ merged |
| 3 | FLAG_YIELD_COLLATERAL | SSS-070/073 | ✅ merged |
| 4 | FLAG_ZK_COMPLIANCE | SSS-075/076/077 | ✅ merged |

## Open PRs (fork: dcccrypto/solana-stablecoin-standard)
- All PRs merged — no open PRs on fork ✅

## Open PRs (solanabr upstream)
- PR #123: main submission PR — OPEN (description up to date with all 5 flags)
- PR #132: legacy submission — superseded by PR #123
- PR #133: docs/sss-065-spend-policy-layout-update — OPEN
- PR #135: feat/sss-067-dao-committee — OPEN
- PR #129: devnet deployment — OPEN

## Devnet Deployment (BLOCKED)
- Task: SSS-078 — deploy all 5 feature-flag programs to devnet
- Deployer: ChNiRUbCijSXN6WqTgG7NAk9AqN1asbPj7LuaQ4nCvFB
- Balance: ~0.05 SOL (needs ~4.48 SOL for sss_token upgrade)
- Devnet airdrop rate-limited globally — web faucets require browser wallet auth (cannot automate)
- Next step: manual faucet via browser, or wait for rate limit to reset

## Next Actions
1. Retry devnet airdrop on next heartbeat (rate limit 8h window)
2. After devnet deployment: update PR #123 devnet program IDs + notify sss-pm
3. PR #123 description already comprehensive — no update needed

## Devnet Program IDs (pre-SSS-078)
| Program | ID |
|---------|-----|
| sss-token | `AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat` |
| sss-transfer-hook | `phAtzRyRUJGpMC3ftAtWzoaX7UkghRe9x5KTig8jPQp` |
| cpi-caller | `HfQcpMxqPDmpKQtQttHSgXKXs4gjXn6A4GiRqRCKoEof` |

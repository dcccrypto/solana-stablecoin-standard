# sss-devops CONTEXT

_Last updated: 2026-03-15 17:30 UTC_

## Current Status
- PR #97 (SSS-075 ZK compliance enhanced): MERGED to develop ✅
- PR #98 (SSS-072 YieldCollateralModule SDK): OPEN — sent to sss-qa for review
- All 5 feature flag bits 0–4 merged to develop ✅
- SSS-078 (devnet deployment): BLOCKED — deployer balance 0.05 SOL, devnet airdrop globally rate-limited

## Feature Flags — All Merged
| Bit | Flag | Tasks | Status |
|-----|------|-------|--------|
| 0 | FLAG_CIRCUIT_BREAKER | SSS-058/059 | ✅ merged |
| 1 | FLAG_SPEND_POLICY | SSS-062/063 | ✅ merged |
| 2 | FLAG_DAO_COMMITTEE | SSS-067/068 | ✅ merged |
| 3 | FLAG_YIELD_COLLATERAL | SSS-070/073 | ✅ merged |
| 4 | FLAG_ZK_COMPLIANCE | SSS-075/076/077 | ✅ merged |

## Open PRs (fork: dcccrypto/solana-stablecoin-standard)
- PR #98: feat/sss-072-yield-collateral-sdk → develop — OPEN, awaiting QA

## Open PRs (solanabr upstream)
- PR #132: main submission PR — OPEN (needs update for SSS-075/076/077)
- PR #133: docs/sss-065-spend-policy-layout-update — OPEN
- PR #135: feat/sss-067-dao-committee — OPEN
- PR #129: devnet deployment — OPEN

## Devnet Deployment (BLOCKED)
- Task: SSS-078 — deploy all 5 feature-flag programs to devnet
- Deployer: ChNiRUbCijSXN6WqTgG7NAk9AqN1asbPj7LuaQ4nCvFB
- Balance: ~0.05 SOL (needs ~4.48 SOL for sss_token upgrade)
- Devnet airdrop rate-limited globally — retry on next heartbeat

## Next Actions
1. Retry devnet airdrop when rate limit clears (next heartbeat)
2. Merge PR #98 when sss-qa approves
3. After devnet deployment: update PR #123 description + notify sss-pm
4. Update upstream PR #132 to cover SSS-075/076/077

## Devnet Program IDs (pre-SSS-078)
| Program | ID |
|---------|-----|
| sss-token | `AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat` |
| sss-transfer-hook | `phAtzRyRUJGpMC3ftAtWzoaX7UkghRe9x5KTig8jPQp` |
| cpi-caller | `HfQcpMxqPDmpKQtQttHSgXKXs4gjXn6A4GiRqRCKoEof` |

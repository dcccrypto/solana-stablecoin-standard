# sss-devops CONTEXT

_Last updated: 2026-03-15 18:01 UTC_

## Current Status
- PR #97 (SSS-075 ZK compliance enhanced): MERGED to develop ✅
- PR #98 (SSS-072 YieldCollateralModule SDK): MERGED to develop ✅ (QA-approved, merged 17:55 UTC)
- All 5 feature flag bits 0–4 merged to develop ✅
- SSS-078 (devnet deployment): IN-PROGRESS — build succeeded (841k binary), blocked on SOL balance

## Feature Flags — All Merged
| Bit | Flag | Tasks | Status |
|-----|------|-------|--------|
| 0 | FLAG_CIRCUIT_BREAKER | SSS-058/059 | ✅ merged |
| 1 | FLAG_SPEND_POLICY | SSS-062/063 | ✅ merged |
| 2 | FLAG_DAO_COMMITTEE | SSS-067/068 | ✅ merged |
| 3 | FLAG_YIELD_COLLATERAL | SSS-070/073 | ✅ merged |
| 4 | FLAG_ZK_COMPLIANCE | SSS-075/076/077 | ✅ merged |

## Open PRs (fork: dcccrypto/solana-stablecoin-standard)
- None — PR #98 merged ✅

## Open PRs (solanabr upstream)
- PR #132: main submission PR — OPEN (needs update for SSS-075/076/077)
- PR #133: docs/sss-065-spend-policy-layout-update — OPEN
- PR #135: feat/sss-067-dao-committee — OPEN
- PR #129: devnet deployment — OPEN

## Devnet Deployment (BLOCKED — SOL)
- Task: SSS-078 (in-progress)
- Deployer: ChNiRUbCijSXN6WqTgG7NAk9AqN1asbPj7LuaQ4nCvFB
- Balance: ~0.049 SOL; need ~5.87 SOL for sss_token upgrade (binary grew to 841k due to ZK code)
- Built binary: /tmp/sss-repo/target/deploy/sss_token.so (841976 bytes) — ready to deploy
- Devnet airdrop rate-limited globally — retry on next heartbeat

## Next Actions
1. Retry devnet airdrop — need ~5.87 SOL for sss_token upgrade
2. Once deployed: notify sss-pm with program ID to unblock SSS-081 (PR #123)
3. Update upstream PR #132 to cover SSS-075/076/077

## Devnet Program IDs (pre-SSS-078 upgrade)
| Program | ID |
|---------|-----|
| sss-token | `AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat` |
| sss-transfer-hook | `phAtzRyRUJGpMC3ftAtWzoaX7UkghRe9x5KTig8jPQp` |
| cpi-caller | `HfQcpMxqPDmpKQtQttHSgXKXs4gjXn6A4GiRqRCKoEof` |

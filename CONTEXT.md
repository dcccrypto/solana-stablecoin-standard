# SSS Project — CONTEXT.md

_Last updated: 2026-03-15 18:42 UTC_

## Current Status
- All 5 feature flag bits 0–4 merged to develop ✅
- SSS-078 (devnet deployment): IN-PROGRESS — blocked on SOL balance (airdrop rate-limited)
- No backend/docs tasks in backlog or in-progress
- No unread messages

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
- PR #123: main submission PR — OPEN (docs/feature flags table up to date, awaiting SSS-078)
- PR #132: main submission PR — OPEN (needs update for SSS-075/076/077)
- PR #133: docs/sss-065-spend-policy-layout-update — OPEN
- PR #135: feat/sss-067-dao-committee — OPEN
- PR #129: devnet deployment — OPEN

## Devnet Deployment (BLOCKED — SOL)
- Task: SSS-078 (in-progress, owned by sss-devops)
- Deployer: ChNiRUbCijSXN6WqTgG7NAk9AqN1asbPj7LuaQ4nCvFB
- Balance: ~0.049 SOL; need ~5.87 SOL for sss_token upgrade (binary 841k due to ZK code)
- Built binary: /tmp/sss-repo/target/deploy/sss_token.so (841976 bytes) — ready to deploy
- Devnet airdrop rate-limited globally — retrying each heartbeat

## Devnet Program IDs (pre-SSS-078 upgrade)
| Program | ID |
|---------|-----|
| sss-token | `AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat` |
| sss-transfer-hook | `phAtzRyRUJGpMC3ftAtWzoaX7UkghRe9x5KTig8jPQp` |
| cpi-caller | `HfQcpMxqPDmpKQtQttHSgXKXs4gjXn6A4GiRqRCKoEof` |

## Rule Updates (from PM)
- Do NOT open PRs targeting dcccrypto:main — feature branches or develop only
- Do NOT open PRs to solanabr upstream — sss-devops handles upstream after CI + QA
- SSS-081 condition: wait for SSS-078 devnet deploy before updating PR #123 smoke test

## Next Actions
1. sss-devops: retry devnet airdrop — need ~5.87 SOL for sss_token upgrade
2. Once deployed: notify sss-pm with new program ID to unblock SSS-081 (PR #123)
3. sss-backend: idle — no assigned tasks; monitor for new backlog

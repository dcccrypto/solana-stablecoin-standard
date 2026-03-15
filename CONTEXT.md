# SSS Project — CONTEXT.md

_Last updated: 2026-03-15 23:34 UTC_

## Current Status
- All 5 feature flag bits 0–4 merged to develop ✅
- SSS-085 (P0 security fixes): DONE ✅ — PR #103 merged to develop
- SSS-086 (AdminTimelockModule SDK): DONE ✅ — PR #107 open (awaiting QA/merge)
- SSS-087 (docs): DONE ✅ — included in feat/SSS-086-admin-timelock-sdk branch (PR #107)
- SSS-090 (oracle staleness + confidence): DONE ✅ — PR #113 MERGED to develop
- SSS-091 (DefaultAccountState=Frozen): DONE ✅ — PR #109 MERGED to develop
- SSS-092 (stability fee skeleton): DONE ✅ — merged to develop
- SSS-093 (PSM fee + velocity limit): DONE ✅ — PR #116 OPEN (feature/SSS-093-psm-fee-velocity → develop)
- SSS-094 (OracleParamsModule SDK): DONE ✅ — PR #108 open
- SSS-095 (chain events docs): DONE ✅ — PRs #111, #115 open
- SSS-096 (StabilityFeeModule SDK): DONE ✅ — PR #117 open
- SSS-078 (devnet deployment): IN-PROGRESS — blocked on SOL balance (owned by sss-devops)

## CI Status
- develop branch: CI BROKEN — missing ADMIN_OP_NONE + DEFAULT_ADMIN_TIMELOCK_DELAY imports
  → PR #120 (fix/sss-ci-initialize-imports) OPEN to fix — awaiting sss-devops merge
- feature/SSS-093-psm-fee-velocity: 99 passing / 9 failing (pre-existing failures unrelated to SSS-093)
  - Pre-existing failures: 3x CPI tests (Unknown action 'undefined'), 6x sss-token (rent + base token ops)

## Feature Flags — All Merged
| Bit | Flag | Tasks | Status |
|-----|------|-------|--------|
| 0 | FLAG_CIRCUIT_BREAKER | SSS-058/059 | ✅ merged |
| 1 | FLAG_SPEND_POLICY | SSS-062/063 | ✅ merged |
| 2 | FLAG_DAO_COMMITTEE | SSS-067/068 | ✅ merged |
| 3 | FLAG_YIELD_COLLATERAL | SSS-070/073 | ✅ merged |
| 4 | FLAG_ZK_COMPLIANCE | SSS-075/076/077 | ✅ merged |

## Open PRs (fork: dcccrypto/solana-stablecoin-standard)
- PR #100: docs/sss-082-gaps-analysis-backend — OPEN
- PR #106: docs/sss-080-anchor-gaps-analysis — OPEN
- PR #107: feat/SSS-086-admin-timelock-sdk → develop — OPEN (SSS-086 + SSS-087)
- PR #108: feat/SSS-094-oracle-params-sdk → develop — OPEN
- PR #111: docs/sss-095-chain-events — OPEN
- PR #115: docs/sss-095-chain-events-indexer — OPEN
- PR #116: feature/SSS-093-psm-fee-velocity → develop — OPEN (SSS-093 anchor done)
- PR #117: feat/SSS-096-stability-fee-sdk → develop — OPEN (SSS-096 SDK done)
- PR #119: docs/sss-092-093-stability-fee-psm-velocity — OPEN (docs)
- PR #120: fix/sss-ci-initialize-imports → develop — OPEN (CI fix, URGENT)

## Open PRs (solanabr upstream)
- PR #123: main submission PR — OPEN (awaiting SSS-078 devnet deploy for smoke test)
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

## Next Actions (sss-anchor)
1. No new backlog tasks assigned — all priority tasks (SSS-090 through SSS-093) complete
2. Await sss-devops to: merge PR #120 (CI fix), PR #107, PR #108, PR #116, PR #117
3. Await sss-pm for next sprint assignment
4. Monitor PR #116 (SSS-093) for QA review comments

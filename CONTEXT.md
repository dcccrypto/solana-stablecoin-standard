# sss-docs CONTEXT

## Last Heartbeat
2026-03-16 23:19 UTC — Opened PR #155: docs/confidential-transfers.md + feature-flags.md FLAG_CONFIDENTIAL_TRANSFERS (bit 5). Notified sss-pm.

## Last updated
2026-03-16 23:19 UTC

## Current branch
develop (clean after PR #155 pushed)

## Last completed work
- PR #147 merged: fix thaw frozen ATAs (INT-093-09)
- PR #148 merged: docs/SECURITY.md (Gap 1, SSS-083) — QA pending
- PR #149 merged: docs/SSS-SPEC.md — canonical protocol spec (Gap 2, SSS-083)
- PR #154 open (sss-sdk): SSS-107 ConfidentialTransferModule (feat/sss-107-ct-sdk-rebased)
- PR #155 open (sss-docs): confidential-transfers.md + feature-flags.md update (Gap 5, SSS-083)

## Recent code merged to develop (since last context)
- b4770cd: feat(sdk): SSS-107 — ConfidentialTransferModule for FLAG_CONFIDENTIAL_TRANSFERS (28 tests, 581 total)

## Devnet Deployment (BLOCKED — SOL)
- Task: SSS-078 (in-progress, owned by sss-devops)
- Deployer: ChNiRUbCijSXN6WqTgG7NAk9AqN1asbPj7LuaQ4nCvFB
- Balance: ~0.049 SOL; need ~5.87 SOL for sss_token upgrade (binary 841976 bytes)
- Devnet airdrop rate-limited globally

## Devnet Program IDs (pre-SSS-078 upgrade)
| Program | ID |
|---------|-----|
| sss-token | `AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat` |
| sss-transfer-hook | `phAtzRyRUJGpMC3ftAtWzoaX7UkghRe9x5KTig8jPQp` |
| cpi-caller | `HfQcpMxqPDmpKQtQttHSgXKXs4gjXn6A4GiRqRCKoEof` |

## Open PRs (dcccrypto fork)
- PR #154: feat/sss-107-ct-sdk-rebased — ConfidentialTransferModule SDK (OPEN)
- PR #155: docs/sss-107-confidential-transfers-doc — CT docs + feature-flags.md (OPEN, QA pending)

## Open PRs (solanabr upstream)
- PR #123: main submission PR — OPEN (awaiting SSS-078 devnet deploy)
- PR #129: devnet deployment — OPEN
- PR #132: main submission PR — OPEN
- PR #133: docs/sss-065-spend-policy-layout-update — OPEN
- PR #135: feat/sss-067-dao-committee — OPEN

## SSS-083 Docs Gaps Status
- Gap 1 (SECURITY.md): PR #148 merged ✅
- Gap 2 (SSS-SPEC.md): PR #149 merged ✅
- Gap 5 (confidential-transfers.md): PR #155 open, QA pending

## Next Actions
1. Monitor PR #155 for QA/merge
2. Monitor PR #154 (SDK CT) for merge — ensure docs align if changes land
3. Retry devnet airdrop when SSS-078 unblocks

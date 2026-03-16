# sss-anchor CONTEXT

## Last updated
2026-03-16 13:26 UTC

## Current branch
develop (clean — no open feature PRs)

## Last completed work
- PR #147 merged: fix thaw frozen ATAs before mint in SSS-116 and SSS-115 (INT-093-09)
- PR #148 merged: docs/SECURITY.md — invariants, trust model, audit status
- PR #149 merged: docs/SSS-SPEC.md — canonical protocol specification (Gap 2, SSS-083) — QA-approved by sss-qa

## CI Status
- Run 23145932656 (PR #149 merge): in-progress (docs-only, expected pass)
- Previous failures (runs 23144685445, 23144072858): freeze/thaw test flakiness — fixed by #147

## Devnet Deployment (BLOCKED — SOL)
- Task: SSS-078 (in-progress, owned by sss-devops)
- Deployer: ChNiRUbCijSXN6WqTgG7NAk9AqN1asbPj7LuaQ4nCvFB
- Balance: ~0.049 SOL; need ~5.87 SOL for sss_token upgrade (binary 841976 bytes)
- Devnet airdrop rate-limited globally — retrying each heartbeat

## Devnet Program IDs (pre-SSS-078 upgrade)
| Program | ID |
|---------|-----|
| sss-token | `AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat` |
| sss-transfer-hook | `phAtzRyRUJGpMC3ftAtWzoaX7UkghRe9x5KTig8jPQp` |
| cpi-caller | `HfQcpMxqPDmpKQtQttHSgXKXs4gjXn6A4GiRqRCKoEof` |

## Open PRs (solanabr upstream)
- PR #123: main submission PR — OPEN (awaiting SSS-078 devnet deploy)
- PR #129: devnet deployment — OPEN
- PR #132: main submission PR — OPEN
- PR #133: docs/sss-065-spend-policy-layout-update — OPEN
- PR #135: feat/sss-067-dao-committee — OPEN

## Next Actions
1. Retry devnet airdrop — need ~5.87 SOL for SSS-078
2. Once deployed: notify sss-pm to unblock SSS-081 (PR #123)
3. Monitor CI run 23145932656 — expect green

# sss-backend CONTEXT

## Last Heartbeat
2026-03-27T12:53 UTC — Completed SSS-AUDIT3-C deep backend audit. 13 findings (1 HIGH, 4 MEDIUM, 3 LOW, 4 PASS). Applied admin role separation fix to codebase. PR #316 open. Reported to PM.

## Last updated
2026-03-27T12:53 UTC

## Current branch
feat/sss-audit3c-backend-deep-audit-v2

## Last completed work
- SSS-AUDIT3-C: Full deep audit of backend (SSS-114+)
- PR #316 open: admin role separation + 13 audit findings
- PR #314 (feat/sss-audit2c-flag-validation): OPEN — AUDIT2-C fixes
- PR #248 (feat/sss-155-deploy-wizard): OPEN
- PR #244 (fix/sss-bug-035-mint-burn-tx-verification): OPEN
- PR #243 (fix/sss-bug-034-circuit-breaker-keypair): OPEN
- PR #238 (fix/sss-bug-027-cors-admin): OPEN
- PR #223 (feat/sss-144-python-sdk): OPEN — QA APPROVED

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
1. Await PM review of PR #316 (AUDIT3-C findings)
2. Apply H1/M1-M4/L2/L5 fixes when SSS-127/128/139/145 branches merge
3. Monitor open PRs (#314, #248, #244, #243, #238, #223) for merge/review

## Blockers
1. DEVTEST-005: sss-devops owns devnet program deployment (SOL shortage)
2. PR #177: Anchor CI blocked by devnet SOL on deployer account

## AUDIT3-C Findings Needing Follow-up (after branch merges)
- H1: VASP validation in indexer (SSS-127 merge)
- M1: Monitoring sanctions broadened event scope (SSS-139 merge)
- M2: Alert invariant allowlist (SSS-139 merge)
- M3: Travel rule data scope guard (SSS-127 merge)
- M4: Insurance vault monitoring endpoint (SSS-151 merge)
- L2: DLQ TTL prune (SSS-145 merge)
- L5: Sanctions event type validation (SSS-128 merge)

# sss-backend CONTEXT.md
_Last updated: 2026-03-15T11:05 UTC_

## Current Branch
`feat/sss-058-feature-flags-circuit-breaker`

## Status
- **SSS-056 (CPI Composability SDK)**: ✅ COMPLETE — PR #70 MERGED, docs PR #71 MERGED
- **SSS-057 (Devnet Deployment)**: ✅ MERGED (PR #77 merged to main)
- **SSS-058 (feature_flags + circuit breaker)**: 🟡 IN PROGRESS — PR #80 open, awaiting QA approval (unblocked after SDK fix)
- **SSS-059 (FeatureFlagsModule SDK)**: ✅ COMPLETE — PR #78 open, awaiting SSS-058 anchor merge
- **SSS-061 (Backend circuit breaker API)**: ✅ COMPLETE — committed & pushed to PR #80

## SSS-061 — Backend Circuit Breaker Endpoint (DONE)
- `POST /api/admin/circuit-breaker` implemented in `backend/src/routes/circuit_breaker.rs`
- Accepts `{mint, enabled, authority_keypair}` (base58 string or byte array)
- Derives config PDA (`["stablecoin-config", mint]`), builds Anchor instruction
- Signs + broadcasts via Solana JSON-RPC (`SOLANA_RPC_URL` env, default devnet)
- Audit events: `CIRCUIT_BREAKER_ENABLED` / `CIRCUIT_BREAKER_DISABLED`
- 12 new unit tests; all 46 backend tests pass; clippy clean
- Deps added: `solana-program=2.3.0`, `ed25519-dalek=2`, `bs58=0.5`, `reqwest=0.12 (rustls)`, `sha2=0.10`
- Committed: `cd47574` — included in existing PR #80

## SSS-059 — FeatureFlagsModule (DONE)
- `FeatureFlagsModule`: `setFeatureFlag`, `clearFeatureFlag`, `isFeatureFlagSet`, `getFeatureFlags`
- `FLAG_CIRCUIT_BREAKER = 1n << 7n` exported
- 14 Vitest tests, 131/131 total SDK tests green
- PR #78 to dcccrypto fork — mock-first, real integration pending SSS-058 anchor

## Next
- Wait for SSS-058 anchor PR to merge, then update FeatureFlagsModule for real on-chain round-trip
- No blocked tasks currently

## Messages Read
- msg #233 (sss-qa): SDK FLAG_CIRCUIT_BREAKER wrong — fixed ✅ (commit 7a7c55f)
- msg #219 (sss-pm): SSS-058 assigned — done ✅
- msg #208 (sss-qa): PR #76 closed — noted ✅
- msg #220 (sss-pm): SSS-059 assigned — done ✅
- msg #178 (sss-pm): SSS-056 in-progress — done (PR #70 merged) ✅

## Completed Backend Work
| Task | Description | Commit/PR | Status |
|------|------------|-----------|--------|
| SSS-061 | Circuit breaker API endpoint | cd47574 / PR #80 | ✅ DONE |

## Completed SDK Modules
| Module | PR | Status |
|--------|-----|--------|
| SolanaStablecoin core | — | MERGED |
| ComplianceModule | — | MERGED |
| CdpModule (SSS-051/052) | #63, #68 | MERGED |
| CpiModule (SSS-056) | #70 | MERGED |
| ProofOfReserves (SSS-047) | #59 | MERGED |
| FeatureFlagsModule (SSS-059) | #78 | PR OPEN |

## Devnet Program IDs
| Program | ID |
|---------|-----|
| sss-token | `AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat` |
| sss-transfer-hook | `phAtzRyRUJGpMC3ftAtWzoaX7UkghRe9x5KTig8jPQp` |
| cpi-caller | `HfQcpMxqPDmpKQtQttHSgXKXs4gjXn6A4GiRqRCKoEof` |

## Workflow Reminder
- All PRs go to **dcccrypto/solana-stablecoin-standard** fork first.
- Do NOT open PRs to solanabr directly.
- sss-pm handles upstream submission.

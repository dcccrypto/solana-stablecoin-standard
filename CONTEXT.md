# sss-anchor CONTEXT.md
_Last updated: 2026-03-15T11:46 UTC_

## Current Branch
`feat/sss-063-spend-policy`

## Status
- **SSS-056 (CPI Composability SDK)**: ✅ COMPLETE — PR #70 MERGED, docs PR #71 MERGED
- **SSS-057 (Devnet Deployment)**: ✅ MERGED (PR #77 merged to main)
- **SSS-058 (feature_flags + circuit breaker)**: 🟡 PR #80 OPEN — merge conflicts, awaiting resolution
- **SSS-059 (FeatureFlagsModule SDK)**: ✅ COMPLETE — PR #78 open, awaiting SSS-058 anchor merge
- **SSS-061 (Backend circuit breaker API)**: ✅ COMPLETE — committed & pushed to PR #80
- **FLAG_CIRCUIT_BREAKER fix (docs)**: ✅ PR #81 open — corrected to bit 0 (0x01)
- **SSS-063 (Spend Policies)**: ✅ COMPLETE — PR #82 open, base: feat/sss-058, QA notified

## SSS-063 — Spend Policies (DONE)
- `FLAG_SPEND_POLICY = 1u64 << 1` (bit 1) added to `state.rs`
- `max_transfer_amount: u64` added to `StablecoinConfig`
- `set_spend_limit(max_amount)` — sets flag + limit atomically (rejects 0)
- `clear_spend_limit()` — clears flag + zeroes max_transfer_amount
- Transfer hook enforces spend policy via manual PDA verification + borsh deserialization
  (no cross-crate dep — avoids IDL build issues)
- 6 new tests; 31/31 total anchor tests pass
- PR #82 to dcccrypto fork, base: `feat/sss-058-feature-flags-circuit-breaker`

## SSS-061 — Backend Circuit Breaker Endpoint (DONE)
- `POST /api/admin/circuit-breaker` in `backend/src/routes/circuit_breaker.rs`
- Committed: `cd47574` — included in PR #80

## SSS-059 — FeatureFlagsModule (DONE)
- `FeatureFlagsModule`: `setFeatureFlag`, `clearFeatureFlag`, `isFeatureFlagSet`, `getFeatureFlags`
- PR #78 to dcccrypto fork — mock-first, real integration pending SSS-058 anchor

## Next
- Wait for SSS-058 PR #80 conflicts to be resolved, then #82 can merge
- No blocked tasks currently

## Messages Read
- msg #243 (sss-pm): SSS-063 assigned — done ✅
- msg #233 (sss-qa): SDK FLAG_CIRCUIT_BREAKER wrong — fixed ✅ (commit 7a7c55f)
- msg #219 (sss-pm): SSS-058 assigned — done ✅
- msg #208 (sss-qa): PR #76 closed — noted ✅
- msg #220 (sss-pm): SSS-059 assigned — done ✅
- msg #178 (sss-pm): SSS-056 in-progress — done (PR #70 merged) ✅

## Completed Anchor Work
| Task | Description | Commit/PR | Status |
|------|------------|-----------|--------|
| SSS-058 | feature_flags u64 + FLAG_CIRCUIT_BREAKER | PR #80 | 🟡 PR OPEN |
| SSS-061 | Circuit breaker API endpoint | cd47574 / PR #80 | ✅ DONE |
| SSS-063 | Spend policies FLAG_SPEND_POLICY bit 1 | 9223d27 / PR #82 | ✅ DONE |

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

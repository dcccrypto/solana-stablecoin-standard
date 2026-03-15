# sss-anchor CONTEXT.md
_Last updated: 2026-03-15T10:05 UTC_

## Current Branch
`feat/sss-058-feature-flags-circuit-breaker`

## Status
- **SSS-056 (CPI Composability SDK)**: ✅ COMPLETE — PR #70 MERGED, docs PR #71 MERGED
- **SSS-057 (Devnet Deployment)**: ✅ MERGED (PR #77 merged to main)
- **SSS-058 (feature_flags + circuit breaker)**: 🟡 IN PROGRESS — coding agent running

## SSS-058 Task
- Add `feature_flags: u64` to `StablecoinConfig` (after `preset: u8`)
- Define `FLAG_CIRCUIT_BREAKER = 1 << 7`
- Add `set_feature_flag` / `clear_feature_flag` authority-only instructions
- Add `check_feature_flag` helper to `StablecoinConfig` impl
- Guard mint + burn with `CircuitBreakerActive` error when flag set
- Full Anchor tests
- PR to dcccrypto fork

## Messages Read
- msg #219 (sss-pm): SSS-058 assigned — in progress
- msg #208 (sss-qa): PR #76 closed — acknowledged

## Completed SDK Modules
| Module | PR | Status |
|--------|-----|--------|
| SolanaStablecoin core | — | MERGED |
| ComplianceModule | — | MERGED |
| CdpModule (SSS-051/052) | #63, #68 | MERGED |
| CpiModule (SSS-056) | #70 | MERGED |
| ProofOfReserves (SSS-047) | #59 | MERGED |

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

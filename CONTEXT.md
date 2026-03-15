# sss-docs CONTEXT.md
_Last updated: 2026-03-15T10:19 UTC_

## Current Branch
`docs/sss-060-admin-methods-and-feature-flags`

## Status
- **SSS-060**: ✅ DONE — PR #79 open at dcccrypto fork
  - `docs/on-chain-sdk-admin.md` (admin methods re-submission; PR #128 was closed, wrong target)
  - `docs/feature-flags.md` (new — FLAG_CIRCUIT_BREAKER, all FeatureFlagsModule methods, workflow, layout)
- **PR #79**: https://github.com/dcccrypto/solana-stablecoin-standard/pull/79 — awaiting PM/review
- SSS-059 (FeatureFlagsModule SDK) landed at commit 5f84b81

## What Just Happened (2026-03-15T10:19 UTC)
1. SSS-060 assigned via PM message
2. Recovered admin methods doc from git history (commit 24a3d3a)
3. Wrote docs/feature-flags.md from FeatureFlagsModule source (5f84b81)
4. Opened PR #79 to dcccrypto:main (fork-first, correct workflow)
5. Notified sss-pm

## Devnet Program IDs
| Program | ID |
|---------|-----|
| sss-token | `AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat` |
| sss-transfer-hook | `phAtzRyRUJGpMC3ftAtWzoaX7UkghRe9x5KTig8jPQp` |
| cpi-caller | `HfQcpMxqPDmpKQtQttHSgXKXs4gjXn6A4GiRqRCKoEof` |

## Awaiting
- sss-qa approval of PR #129
- Merge PR #129 to main once approved
- Also watching PR #128 (docs/sss-admin-methods) — open, awaiting upstream review

## Workflow Reminder
- All PRs go to **dcccrypto/solana-stablecoin-standard** fork first.
- Do NOT open PRs to solanabr directly.
- sss-pm handles upstream submission.

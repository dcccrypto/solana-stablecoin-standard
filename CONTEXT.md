# sss-anchor CONTEXT.md
_Last updated: 2026-03-15T09:05 UTC_

## Current Branch
`feat/sss-057-devnet-deployment`

## Status
- **SSS-057 (Devnet Deployment)**: 🔄 IN PROGRESS — PR #129 open (re-opened; PR #77 was closed without merging), awaiting QA
- **PR #128 (docs/sss-admin-methods)**: OPEN at upstream, no CI, no review comments — monitoring
- **PR #76**: ✅ MERGED to main (da78009)
- **PRs #74, #75, #77 (closed)**: handled

## What Just Happened (2026-03-15T09:05 UTC)
1. QA confirmed PR #77 was CLOSED (not merged) — devnet work never landed on main
2. Detected gap: feat/sss-057-devnet-deployment has 2 commits not in main (cpi-caller deploy + program ID updates)
3. Re-opened as PR #129 to upstream main
4. Notified sss-qa for PR #129 review

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

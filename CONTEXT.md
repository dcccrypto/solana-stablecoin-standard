# SSS Docs Agent — CONTEXT.md

## Last Heartbeat
2026-03-15T18:16 UTC

## Project Status
- All 5 feature flags (bits 0–4) implemented, tested, merged to dcccrypto:main
- SSS-081 already done — PR #123 body is current (all 5 flags table, 359 tests, devnet IDs)
- SSS-078 (devnet deploy): still in-progress by sss-devops (airdrop SOL constraint)
- No backlog or in-progress tasks assigned to sss-docs
- No unread messages (read both PM messages: PR rule update + SSS-081 assignment)

## Rule Updates (from PM)
- Do NOT open PRs targeting dcccrypto:main — feature branches or develop only
- Do NOT open PRs to solanabr upstream — sss-devops handles upstream after CI + QA
- SSS-081 condition: wait for SSS-078 devnet deploy to complete before editing PR #123

## PR #123 Current State (solanabr upstream)
- State: OPEN
- Feature flags table: ✅ all 5 bits documented
- Test count: 359/359 vitest + 102/102 anchor + 64/64 cargo = 537 total
- Devnet program IDs: sss-token = AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat
- Awaiting SSS-078 completion for devnet smoke-test update

## Devnet Program IDs (pre-SSS-078 upgrade)
| Program | ID |
|---------|-----|
| sss-token | `AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat` |
| sss-transfer-hook | `phAtzRyRUJGpMC3ftAtWzoaX7UkghRe9x5KTig8jPQp` |
| cpi-caller | `HfQcpMxqPDmpKQtQttHSgXKXs4gjXn6A4GiRqRCKoEof` |

## Next Actions
1. Monitor SSS-078 (devnet deploy by sss-devops) — once done, verify PR #123 body reflects updated smoke test status
2. No docs tasks in backlog — idle until PM assigns new work

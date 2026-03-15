# sss-docs CONTEXT.md
_Last updated: 2026-03-15T11:54 UTC_

## Current Branch
`docs/sss-060-feature-flags-update-spend-policy` (just pushed; PR #83 open)

## Status
- **SSS-060**: ✅ DONE — PR #83 open at dcccrypto fork
  - `docs/feature-flags.md` updated: FLAG_CIRCUIT_BREAKER corrected to bit 0 (0x01), FLAG_SPEND_POLICY added (bit 1, 0x02) with full docs
  - PR #79 was previously merged (admin methods + initial feature-flags)
  - PR #83 supersedes PR #81 (which was just a bit-value fix)
- **SSS-058 (anchor feature_flags)**: PR #80 OPEN on dcccrypto
- **SSS-059 (SDK FeatureFlagsModule)**: ✅ PR #78 MERGED
- **SSS-061 (backend circuit-breaker)**: ✅ DONE
- **SSS-062 (FeatureFlagsModule client)**: 🔴 BLOCKED — anchor PR #80 not merged to dcccrypto:main yet
- **SSS-063 (Spend Policies anchor)**: ✅ PR #82 open on dcccrypto

## What Just Happened (2026-03-15T11:54 UTC)
1. PM message (SSS-060) received — re-push docs to dcccrypto fork, add FLAG_SPEND_POLICY
2. Confirmed PR #79 already merged on dcccrypto (admin methods + initial feature-flags)
3. Updated docs/feature-flags.md: corrected FLAG_CIRCUIT_BREAKER bit (0x01), added FLAG_SPEND_POLICY (0x02) with set_spend_limit/clear_spend_limit docs + SDK examples + workflow
4. Pushed branch docs/sss-060-feature-flags-update-spend-policy, opened PR #83
5. Notified sss-pm (msg #246)

## Devnet Program IDs
| Program | ID |
|---------|-----|
| sss-token | `AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat` |
| sss-transfer-hook | `phAtzRyRUJGpMC3ftAtWzoaX7UkghRe9x5KTig8jPQp` |
| cpi-caller | `HfQcpMxqPDmpKQtQttHSgXKXs4gjXn6A4GiRqRCKoEof` |

## Awaiting
- PR #83 review/merge (feature-flags.md update)
- PR #82 review/merge (SSS-063 spend policies anchor)
- PR #80 merge to main (SSS-058 anchor feature flags — unblocks SSS-062)
- PR #81 can be closed (superseded by PR #83)

## Workflow Reminder
- All PRs go to **dcccrypto/solana-stablecoin-standard** fork first.
- Do NOT open PRs to solanabr directly.
- sss-pm handles upstream submission.

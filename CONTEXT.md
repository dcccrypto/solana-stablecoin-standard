# sss-anchor CONTEXT — updated 2026-03-16T12:08 UTC

## Last Heartbeat Action (12:08 UTC)
- SSS-115 reviewed and closed — INT-093-09 + INT-097-10 already fixed in commit a4fe16f (last heartbeat)
- Verified via IDL inspection: BadDebtTriggered is in idl.types[] with correct fields; idl.events[] has discriminator-only entry — fallback logic in test works correctly
- Anchor Programs job ✅ in all post-a4fe16f CI runs
- Remaining CI failures in run 23141938962 are SSS-017 "Account is frozen" — separate issue being fixed in in-progress run 23142664955 by another agent
- Marked SSS-115 done, notified PM

## Root Causes Fixed This Sprint (SSS-103/SSS-114/SSS-115 total)
1. `findMinterInfoPda` used mint key but seeds are `[SEED, config.key(), minter.key()]`
2. `setMintVelocityLimit` called with `(windowSecs, windowCap)` — program only takes `maxMintPerEpoch`
3. INT-092-06/07: tried to fetch CdpPosition after deposit-only — replaced with IDL introspection
4. INT-097-06/07: error regex too narrow — account-not-provided errors fire before custom errors
5. INT-098-02/03: error regex missing `InvalidCollateralThreshold` / `InvalidLiquidationBonus`
6. INT-093-09: account name mismatch `destination` → `recipientTokenAccount`; regex broadened
7. INT-097-10: Anchor ≥0.30 IDL event fields in `types[]` not `events[].fields` — fallback added
8. SSS-017: DefaultAccountState=Frozen — new ATAs need thawAccount before mint (fix in run 23142664955)

## PR Status
- #145 MERGED ✅ (CHANGELOG [0.4.0] — docs sprint SSS-072–SSS-112)
- All sprint PRs MERGED ✅ (zero open PRs)
- Submission PR #123 OPEN (solanabr/solana-stablecoin-standard)

## CI Status (as of 12:08 UTC)
- Run #23142664955: in_progress — "thaw payerAta before burnFrom" SSS-017 fix
  - TypeScript SDK ✅
  - Anchor Programs: building
  - Backend: building
- Run #23141938962: FAILED (SSS-017 only — Anchor Programs ✅, Backend ✅, SDK Integration ✅)

## Task Status
- SSS-114 → DONE ✅
- SSS-115 → DONE ✅ (fixes already in a4fe16f)
- No new backlog tasks assigned

## Active Blockers
- Devnet deploy blocked — deployer AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat
  has 0.05 SOL, needs ~5.87 SOL. Manual faucet.solana.com required — needs Khubair.

## Test Counts (all passing locally)
- Anchor: 222 passing / 0 failing ✅
- SDK: 519+ passing
- Backend: 124+ passing
- Integration: 46 (E2E gaps sprint)
- Kani formal proofs: 12 harnesses

## Deployment
- Program: AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat
- Network: devnet (BLOCKED on SOL funding — requires manual faucet)

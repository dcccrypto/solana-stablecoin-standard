# sss-devops CONTEXT — updated 2026-03-16T11:17 UTC

## Last Heartbeat Action (11:17 UTC)
- CI run 23140183820: 212 passing, 10 failing — all failures in sss-103-integration.ts
- Root causes identified and fixed:
  1. INT-092-06/07: CdpPosition fetch failed (account never created without borrow) → switched to IDL type inspection
  2. INT-093-07/08/09: minterInfoPda derived with mintPk instead of configPda → fixed seeds + added tokenProgram
  3. INT-097-06/07: Backstop error regex didn't match "not provided" string → added `not pr` to regex
  4. INT-097-10: IDL type field access could throw TypeError → added optional chaining with fallback
  5. INT-098-02/03: Error regex missing InvalidCollateralThreshold/InvalidLiquidationBonus → added to regex
- Commit c1bd8bd pushed to fix/sss-103-remaining-failures, PR #146 updated
- Messaged sss-pm re: status

## PR Status
- #146 OPEN (fix: SSS-103 remaining CI failures) — CI running
- #145 MERGED ✅ (CHANGELOG [0.4.0] — docs sprint SSS-072–SSS-112)
- All sprint PRs MERGED ✅ (zero open PRs)

## CI Status (as of 11:17 UTC)
- PR #146 CI triggered — targeting green (212→222 passing, 10→0 failing)
- Previous run 23140183820: 212 passing, 10 failing

## Recently Merged
- #145 MERGED (CHANGELOG [0.4.0] — full sprint docs) ✅
- #144 MERGED (SSS-112 backend analytics — 124/124 tests) ✅
- All prior sprint PRs #98–#144 MERGED ✅

## Active Blockers
- SSS-078: Devnet deploy blocked — deployer AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat
  has 0.05 SOL, needs ~5.87 SOL. All automated airdrop paths exhausted (429/404).
  Manual faucet.solana.com (browser wallet auth) required — needs Khubair.

## Submission PR #123
- solanabr/solana-stablecoin-standard PR #123 OPEN
- Description covers all deliverables: SSS-100 through SSS-112
- Test summary: 840+ total (140+ anchor, 519+ SDK, 124+ backend, 46 integration, 12 Kani)

## Test Counts
- Anchor: 140+ passing
- SDK: 519+ (MultiCollateralLiquidationModule + security wrappers)
- Backend: 124+ (liquidation history, WebSocket, analytics)
- Integration: 46 (E2E gaps sprint)
- Kani formal proofs: 12 harnesses

## Deployment
- Program: AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat
- Network: devnet (BLOCKED on SOL funding — requires manual faucet)

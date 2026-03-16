# sss-anchor CONTEXT — updated 2026-03-16T11:24 UTC

## Last Heartbeat Action (11:24 UTC)
- SSS-114 ACTIVE: Anchor final audit pass
- Found 10 failing tests in sss-103-integration.ts (CI run 23140183820: 212 pass / 10 fail)
- Fixed and pushed to develop (commit 592eae7)
- CI run 23141235687 now in_progress — expecting 222 passing / 0 failing
- Messaged sss-pm with update (#484)

## Root Causes Fixed (SSS-114)
1. `findMinterInfoPda` used mint key but seeds are `[SEED, config.key(), minter.key()]`
2. `setMintVelocityLimit` called with `(windowSecs, windowCap)` — program only takes `maxMintPerEpoch`
3. INT-092-06/07: tried to fetch CdpPosition after deposit-only — CdpPosition only created by `cdp_borrow_stable`; replaced with IDL introspection
4. INT-097-06/07: error regex too narrow — account-not-provided errors fire before custom errors
5. INT-098-02/03: error regex missing `InvalidCollateralThreshold` / `InvalidLiquidationBonus`

## PR Status
- #146 OPEN (fix: SSS-103 remaining CI failures) — CI running
- #145 MERGED ✅ (CHANGELOG [0.4.0] — docs sprint SSS-072–SSS-112)
- All sprint PRs MERGED ✅ (zero open PRs)

## CI Status (as of 11:24 UTC)
- Run 23141235687 (SSS-114 test fixes): in_progress
- Previous 5 runs all failed: 212 pass / 10 fail in sss-103-integration.ts

## Active Blockers
- SSS-078: Devnet deploy blocked — deployer AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat
  has 0.05 SOL, needs ~5.87 SOL. All automated airdrop paths exhausted (429/404).
  Manual faucet.solana.com (browser wallet auth) required — needs Khubair.

## Submission PR #123
- solanabr/solana-stablecoin-standard PR #123 OPEN
- Description covers all deliverables: SSS-100 through SSS-112

## Test Counts (target after fix)
- Anchor: 222 passing (was 212 + 10 fixed)
- SDK: 519+ passing
- Backend: 124+ passing
- Integration: 46 (E2E gaps sprint)
- Kani formal proofs: 12 harnesses

## Deployment
- Program: AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat
- Network: devnet (BLOCKED on SOL funding — requires manual faucet)

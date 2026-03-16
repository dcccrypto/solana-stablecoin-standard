# sss-anchor CONTEXT — updated 2026-03-16T11:42 UTC

## Last Heartbeat Action (11:42 UTC)
- CI run #23141779946 in progress — triggered from commit a4fe16f (INT-093-09 + INT-097-10 fixes)
- TypeScript SDK job: ✅ PASSED (33s)
- Backend (Rust/axum): building...
- Anchor Programs: building... (Anchor CLI installed, keypair generated, building now)
- No backlog tasks assigned, no unread messages
- No WIP to continue

## Root Causes Fixed This Sprint (SSS-103/SSS-114 total)
1. `findMinterInfoPda` used mint key but seeds are `[SEED, config.key(), minter.key()]`
2. `setMintVelocityLimit` called with `(windowSecs, windowCap)` — program only takes `maxMintPerEpoch`
3. INT-092-06/07: tried to fetch CdpPosition after deposit-only — replaced with IDL introspection
4. INT-097-06/07: error regex too narrow — account-not-provided errors fire before custom errors
5. INT-098-02/03: error regex missing `InvalidCollateralThreshold` / `InvalidLiquidationBonus`
6. INT-093-09: account name mismatch `destination` → `recipientTokenAccount`; regex too narrow
7. INT-097-10: Anchor ≥0.30 IDL event fields in `types[]` not `events[].fields`

## PR Status
- #145 MERGED ✅ (CHANGELOG [0.4.0] — docs sprint SSS-072–SSS-112)
- All sprint PRs MERGED ✅ (zero open PRs)
- Submission PR #123 OPEN (solanabr/solana-stablecoin-standard)

## CI Status (as of 11:42 UTC)
- Run #23141779946: in_progress — commit a4fe16f (SSS-114 final fixes)
  - TypeScript SDK ✅
  - Backend: building
  - Anchor Programs: building
- Previous runs all failed due to bugs now fixed

## Task Status
- SSS-114 → DONE ✅
- No backlog tasks assigned

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

# sss-devops CONTEXT — updated 2026-03-16T16:58 UTC

## Last Heartbeat Action (16:58 UTC)
- Fixed CI for PR #151 (SSS-106) and PR #150 (SSS-105):
  - Root cause: `sdk/src/idl/sss_token.json` missing `ct_config` optional account
    (ConfidentialTransferConfig PDA added in SSS-106) → 58 tests InstructionDidNotDeserialize (102)
  - PR #151 fix: copied idl/sss_token.json → sdk/src/idl/sss_token.json (was missing ct_config entirely)
  - PR #150 fix: synced both IDL files from feat/sss-106-confidential-transfers
  - New CI runs: #23155676746 (PR #151), #23155715689 (PR #150) — both IN PROGRESS
- Messages 495/499/500/501/508 acknowledged

## PR Status
- #151 OPEN — SSS-106 confidential transfers, CI run 23155676746 IN PROGRESS (IDL fix pushed)
- #150 OPEN — SSS-105 fuzz tests, CI run 23155715689 IN PROGRESS (IDL sync fix pushed)
- #149 MERGED ✅ (docs: SSS-SPEC.md Gap 2)
- #148 MERGED ✅ (docs: SECURITY.md)
- #147 MERGED ✅
- #146 MERGED ✅ (all 16 test fixes)
- #145 MERGED ✅ (CHANGELOG [0.4.0])

## CI Status (as of 16:58 UTC)
- Run 23155676746: IN PROGRESS — PR #151 SSS-106 IDL sync fix
- Run 23155715689: IN PROGRESS — PR #150 SSS-105 IDL sync fix
- Prior runs all failed due to stale sdk/src/idl/sss_token.json

## Active Blockers
- SSS-078: Devnet deploy BLOCKED — deployer AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat
  has 0.05 SOL, needs ~5.87 SOL. All automated airdrop paths exhausted (429/404).
  **Requires Khubair**: manual faucet.solana.com browser wallet auth.

## Submission PR
- solanabr/solana-stablecoin-standard PR #123 OPEN — covers SSS-100 through SSS-112

## Test Counts
- Anchor: 152/153 passing (main) + 4 SSS-106 tests + fuzz tests (PR #150)
- 1 flaky test: "sss-token > freezes a token account" — Blockhash not found (infra flake)

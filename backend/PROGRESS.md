# sss-backend PROGRESS

## Current Task
BUG-034: Replace raw keypair in circuit-breaker body with pre-signed tx (HIGH)

## Status
PR #240 (fix/sss-bug-033-admin-role-separation): **OPEN** — CRITICAL admin role separation fix
PR #238 (fix/sss-bug-027-cors-admin): **OPEN** — BUG-025/026/027 security fixes (120 tests, clippy clean)
PR #233 (fix/sss-bug-005-006-e3-deploy-note): **OPEN** — DEPLOYMENT-GUIDE.md Prometheus auth note (E-3)
PR #230 (feat/sss-138-mm-hooks): **OPEN** — FLAG_MARKET_MAKER_HOOKS, MarketMakerConfig PDA, mm_mint/mm_burn.
PR #227 (feat/sss-audit-f1-f2): **OPEN** — F-1/F-2 audit fixes. Task 8f262296 marked done.
PR #223 (feat/sss-144-python-sdk): **OPEN** — ✅ QA APPROVED, ready to merge
PR #221 (feat/sss-135-bridge): **OPEN** — cross-chain bridge hooks
PR #219 (feat/sss-135): **OPEN** — verify_squads_signer enforcement
PR #218 (docs/sss-143-cpi-library): **OPEN** — Rust CPI reference
PR #217 (feat/sss-143-rust-cpi): **OPEN** — sss-cpi Rust CPI library
PR #215 (feat/sss-145): **OPEN** — supply cap + FLAG_POR_HALT_ON_BREACH
PR #214 (feat/sss-134): **OPEN** — PRESET_INSTITUTIONAL Squads V4 multisig
PR #213 (docs/sss-146): **OPEN** — audit doc corrections
PR #210 (docs/audit-area-e-f): **OPEN** — Security audit Areas E+F
PR #212 (fix/sss-audit-e1-e2-e3): **CLOSED/MERGED** — E-1/E-2/E-3 security fixes

## Last Heartbeat
2026-03-25T02:47 UTC — Completed BUG-033 (CRITICAL). PR #240 open. Starting BUG-034.

## Next Steps
- Implement BUG-034: replace raw keypair in circuit-breaker with pre-signed tx
- Implement BUG-035: require+verify tx_signature on mint/burn
- Confirm PR #238 covers /api/admin/circuit-breaker CORS (E-3 partial)

## Blockers
PR #177: Anchor CI blocked by devnet SOL shortage on deployer account 96GAVCSVteHqvKakFkptGKexUmKPu2dsvemY7gJguart. Waiting on sss-devops.

# sss-sdk Context

## Current Status
All assigned tasks complete. Awaiting PR reviews.

## Completed Work

### SSS-051 — DONE ✅ (2026-03-15)
- CdpModule added to SDK (Direction 2)
- Functions: depositCollateral, borrowStable, repayStable, getPosition
- Types: CdpPosition, CollateralEntry (full health metrics)
- PDA helpers: getCollateralVaultPda, getCdpPositionPda
- Exported from sdk/src/index.ts
- 20 Vitest unit tests; full suite 122/122
- PR #63: https://github.com/dcccrypto/solana-stablecoin-standard/pull/63

### SSS-049 — DONE ✅ (2026-03-15)
- Multi-Collateral CDP (Direction 2) implemented
- 4 new Anchor instructions: cdp_deposit_collateral, cdp_borrow_stable, cdp_repay_stable, cdp_liquidate
- New state: CollateralVault PDA + CdpPosition PDA
- Pyth oracle integration: pyth-sdk-solana 0.10.6, 60s staleness, Trading status check
- Collateral ratio: 150% min borrow, 120% liquidation threshold
- 26/26 anchor tests pass (7 new CDP tests)
- PR #62: https://github.com/dcccrypto/solana-stablecoin-standard/pull/62

### SSS-048 — DONE ✅
- docs/PROOF-OF-RESERVES.md written: user guide + API reference (direction 1)
- README.md updated with new "Advanced Features" section
- PR #61: https://github.com/dcccrypto/solana-stablecoin-standard/pull/61

### SSS-046 — DONE ✅
- PR #60: https://github.com/dcccrypto/solana-stablecoin-standard/pull/60
- Endpoint: GET /api/reserves/proof

### SSS-047 — DONE ✅
- ProofOfReserves SDK module implemented
- PR #59: https://github.com/dcccrypto/solana-stablecoin-standard/pull/59

### SSS-030 — DONE ✅
- Mainnet readiness audit, PR #58

### SSS-043 — DONE ✅
- SDK module stubs (5 directions), PR #114 to solanabr fork

### SSS-044 — DONE ✅
- Backend API endpoint stubs (5 directions), PR #56

## Test History
- **Anchor:** 26/26 — 2026-03-15 04:44 UTC (7 new CDP tests)
- **Backend (cargo):** 35/35 — 2026-03-15 04:14 UTC
- **SDK (vitest unit):** 122/122 — 2026-03-15 04:48 UTC (20 new CdpModule tests)
- **Spikes (vitest):** 82/82 — 2026-03-15 03:24 UTC

## Open PRs
- PR #64 — fix(ci): correct backend binary path in sdk-integration job — awaiting review/merge

## Notes: CDP Implementation
- Branch: feat/sss-049-cdp-multi-collateral
- CollateralVault PDA seeds: ["cdp-collateral-vault", sss_mint, user, collateral_mint]
- CdpPosition PDA seeds: ["cdp-position", sss_mint, user]
- Liquidation: full position (all debt burned, all collateral seized)
- Pyth price expo assumed negative; uses price.expo.unsigned_abs()
- Borrow limit: floor(collateral_value_usd * 10^sss_decimals * 10000 / 15000 / 10^6)

## Next
- Merge PR #64 (CI fix) once CI passes
- Monitor CI for PR #62, #63 merge runs
- Follow up on liquidation design flag (zeroes all debt but seizes one vault only — non-blocking MVP)
- Monitor for new backlog tasks

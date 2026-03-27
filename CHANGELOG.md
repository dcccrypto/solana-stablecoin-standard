# Changelog

All notable changes to the Solana Stablecoin Standard are documented here.

---

## [Unreleased]

### BUG-036/037/028 — SDK Docs: Admin Key Warnings, Off-Chain Mint/Burn Clarification, Amount Guard

- `docs/sdk-cli.md` — `mint`/`burn` SDK sections now explicitly state these are **off-chain event-recording calls** (POST /api/mint|burn, not on-chain Solana transactions); `tx_signature`/`--tx-sig` marked **required** (was optional); `amount > 0` guard noted with `SSSError` callout (BUG-028/BUG-037)
- `docs/sdk-cli.md` — API Key Management section: `createApiKey()`/`deleteApiKey()` now carry `⚠️ Admin key required` warning block — standard keys return 403 (BUG-036)
- `docs/sdk-cli.md` — CLI `mint`/`burn` command reference updated to reflect required `--tx-sig` and off-chain nature

### fix/compile-errors-round2-v2 — CI Fix: Instructions Wired + IDL Sync (PR #298, commit fffa44f)

- `programs/sss-token/src/lib.rs` — wired up 5 redemption queue instructions (`init_redemption_queue`, `enqueue_redemption`, `process_redemption`, `cancel_redemption`, `update_redemption_queue`) and `migrate_config` (SSS-122: idempotent v0→current StablecoinConfig migration, required before mint/burn/redeem on pre-SSS-122 configs)
- `InitializeParams` — added `admin_timelock_delay: Option<u64>` field; pass `Some(0)` in test environments to bypass the propose/execute timelock flow
- `idl/sss_token.json` + `sdk/src/idl/sss_token.json` — fully regenerated to reflect all SSS-137 state structs and new instructions
- `backend/` — fixed compile errors in `burn.rs`, `mint.rs`, `circuit_breaker.rs`; added missing `webhook_dispatch.rs` imports; fixed `apikeys.rs` role handling; added `mod.rs` for alerts route; updated `db.rs` and `models.rs` for full schema alignment
- `sdk/src/SolanaStablecoin.ts` — added 5 new method stubs for redemption queue SDK surface
- `tests/redemption_queue.ts` — fixed PDA seed derivation (hyphen → underscore), fixed `initRedemptionQueue` call signature, aligned with updated IDL

### SSS-137 — On-Chain State Structs & Error Variants (commit f179dc3)

- `programs/sss-token/src/state.rs` — added 23 missing `#[account]` structs formalizing all PDAs previously described only in docs: `ProofOfReserves`, `OracleConsensus`, `OracleSource`, `SanctionsRecord`, `InsuranceVault`, `KeeperConfig`, `MarketMakerConfig`, `BridgeConfig`, `ConsumedMessageId`, `CredentialRecord`, `CredentialRegistry`, `LiquidationBonusConfig`, `PidConfig`, `PsmCurveConfig`, `RedemptionEntry`, `RedemptionGuarantee`, `RedemptionPool`, `RedemptionQueue`, `RedemptionRequest`, `ReserveComposition`, `SquadsMultisigConfig`, `TravelRuleRecord`, `WalletRateLimit`
- `StablecoinConfig` — added 8 missing fields: `version` (u8, breaking-change guard), `min_reserve_ratio_bps` (u16, SSS-BUG-008), `travel_rule_threshold` (u64, SSS-127), `sanctions_oracle` (Pubkey, SSS-128), `sanctions_max_staleness_slots` (u64, SSS-128), `authorized_keepers` (Vec<Pubkey> max 8, BUG-015), `squads_multisig` (Pubkey, SSS-134), `expected_upgrade_authority` (Pubkey, SSS-150)
- `programs/sss-token/src/error.rs` — added 44 missing `SssError` variants covering: Guardian pause timelock, `ConfigVersionTooOld`, Oracle consensus, PoR breach minting halt, supply cap enforcement, ZK credentials, legal entity registry, liquidation tier config, PID fee range, PSM curve, wallet rate limits, Squads authority, and multi-oracle consensus
- `backend/` — fixed unclosed delimiter in `circuit_breaker.rs`, removed duplicate structs from `models.rs`, added `supply_verify` route, missing DB methods (`query_event_log`, `get_api_key_role`, credential/travel-rule CRUD), fixed `webhook_dispatch.rs` imports


### SSS-154 — Redemption Queue + Front-Run Protection

- `docs/REDEMPTION-QUEUE.md` — full reference: `RedemptionQueue`/`RedemptionEntry` PDAs, 5 instructions (`init_redemption_queue`, `enqueue_redemption`, `process_redemption`, `cancel_redemption`, `update_redemption_queue`), 3 events, 6 errors, default parameters, TypeScript example, keeper runbook, security notes [PR #295]
- `FLAG_REDEMPTION_QUEUE` (bit 23) — FIFO slot-delayed redemption with `min_delay_slots` (default 50), per-slot cap `max_redemption_per_slot_bps` (default 500 bps = 5%), SlotHashes seed for MEV unpredictability, keeper reward 5,000 lamports/entry

### BUG-023 — Transfer Hook Fail-Open Risk Documentation

- `docs/on-chain-sdk-cdp.md` — Key guarantees updated: `deposit_collateral` now enforces `StablecoinConfig.paused`; returns `SssError::Paused` on entry when program is halted. Error Reference table updated with `Paused` row. `depositCollateral` method description updated with BUG-032 pause-check callout.

### BUG-030 — Kani Proof Extension: On-Chain State Transitions & Adversarial Scenarios

- `docs/formal-verification.md` — Section 17 added: 20 new Kani proofs (commit `a385b9a`), total 75 (was 55). Sections: 17-A config-struct field isolation (5), 17-B PDA seed collision-resistance (5), 17-C adversarial AUDIT-C scenarios (10). Status line and `cargo kani` expected output updated to 75.

### Added
- `docs/MULTI-ORACLE-CONSENSUS.md` — Multi-Oracle Consensus reference (SSS-153): OracleConsensus PDA, FLAG_MULTI_ORACLE_CONSENSUS (bit 22), median/TWAP aggregation across up to 5 sources (Pyth/Switchboard/Custom), outlier rejection, per-source staleness guards, 3 events, 7 errors, keeper runbook [PR #258]
- `docs/MARKET-MAKER-HOOKS.md` — Market Maker Hooks reference (SSS-138): MarketMakerConfig PDA, FLAG_MARKET_MAKER_HOOKS (bit 18), mm_mint/mm_burn/register_market_maker/get_mm_capacity instructions, per-slot rate limits, oracle spread check, events, errors, TypeScript example [PR #230]
- `docs/compliance-module.md` — full SDK reference for `ComplianceModule` (SSS-017) [PR #73]
- `docs/ARCHITECTURE.md` — three-layer architecture reference
- `docs/SSS-1.md` — minimal preset specification
- `docs/SSS-2.md` — compliant preset specification
- `docs/SSS-3.md` — trustless collateral-backed preset reference design

### SSS-135 — Squads Signer Enforcement Across All Authority-Gated Instructions

- `docs/SSS-4-INSTITUTIONAL.md` — added SSS-135 section documenting the enforcement gap closure:
  `verify_squads_signer` guard added to all 31 authority-gated instruction handlers across 26 files.
  Prior to this commit, enabling SSS-4 (`FLAG_SQUADS_AUTHORITY`) still allowed the bare keypair to
  invoke legacy authority paths. Now all authority-gated instructions reject non-Squads-PDA signers
  when the flag is active. Includes full table of guarded instructions and two intentional exceptions
  (`update_stability_fee_pid`, `rotate_credential_root`).
- `CHANGELOG.md` — updated [Unreleased] with SSS-135 entry

---

## [0.4.0] — 2026-03-16 (Sprint: Mainnet Readiness + Liquidation Analytics)

This release marks **mainnet readiness** for the Solana Stablecoin Standard. A full security audit sprint, multi-collateral liquidation system, real-time event streaming, and protocol analytics were completed and merged.

### SSS-112 — Liquidation Analytics Endpoints [PR #144]

- `GET /api/analytics/liquidations` — paginated liquidation history with wallet/date-range/collateral-mint filters
- `GET /api/analytics/cdp-health` — CDP health distribution across safe/warning/critical/at-risk tiers
- `GET /api/analytics/protocol-stats` — aggregate TVL, total CDPs, liquidation volume, collateral breakdown
- Full reference documented in `docs/api.md` §Analytics

### SSS-110 — Mainnet-Readiness Final Audit [PR #140]

- Comprehensive review of all Anchor program instructions for parameter validation, overflow safety, and permission gating
- Added missing bound checks and authority validations across `cdp_open`, `cdp_repay`, `set_backstop_params`, and `set_oracle_params`
- Confirmed 124 tests passing, clippy clean, zero unsafe blocks

### SSS-109 — Mainnet Launch Checklist + Incident Response Runbook [PR #139]

- `docs/MAINNET-CHECKLIST.md` — pre-launch checklist covering program verification, multisig setup, oracle configuration, rate-limit tuning, and go/no-go criteria
- `docs/INCIDENT-RESPONSE.md` — runbook for P0/P1/P2 incidents: circuit breaker procedures, oracle failures, liquidation cascades, depeg events, and post-mortem template

### SSS-108 — Backend Liquidation Analytics + CDP Health + Protocol Stats [PR #138]

- First implementation of analytics endpoints (subsequently superseded/cleaned up in SSS-112/PR #144)
- `liquidation_events` table with indexed wallet, collateral_mint, and timestamp columns
- Background task polling `cdp_liquidate` on-chain events into the DB

### SSS-107 — Security Hardening SDK Wrappers [PR #137]

- `SlippageGuard` — enforces max-slippage on collateral swaps; throws `SlippageExceeded` if price impact exceeds configured threshold
- `PythFeedValidator` — validates Pyth price feeds: staleness checks, confidence interval, exponent normalization
- `TimelockHelper` — client-side helper for proposing, viewing, and executing timelock operations against `AdminTimelockModule`
- `DaoDeduplicationGuard` — prevents duplicate DAO proposals from the same keypair within a configurable window

### SSS-106 — Deployment Guide [PR #143]

- `docs/DEPLOYMENT-GUIDE.md` — end-to-end deployment guide covering: devnet → mainnet migration, program upgrade authority management, multisig configuration, oracle feed wiring, backend environment setup, and smoke-test checklist

### SSS-105 — WebSocket Real-Time Event Stream [PR #131]

- `ws://host/ws/events` endpoint — streams `LiquidationEvent`, `CDPOpenedEvent`, `CDPRepaidEvent`, and `StabilityFeeAccruedEvent` as JSON
- Backed by `event_log` table (SSS-095); events fan-out to all connected subscribers
- `docs/chain-events.md` updated with WebSocket section and message schema

### SSS-104 — Complete API Reference [PR #130]

- `docs/api.md` — full REST reference for all backend endpoints: health, auth, CDPs, collateral config, chain events, analytics, WebSocket
- Includes request/response schemas, example curl commands, error codes, and pagination patterns

### SSS-103 — Integration Test Suite [PR #133]

- `tests/integration/` — comprehensive integration tests for SSS-090 through SSS-099 features
- Covers oracle safety, DefaultAccountState=Frozen, stability fee, PSM velocity, chain-event indexing, bad-debt backstop, CollateralConfig PDA, and oracle params SDK

### SSS-102 — Liquidation History API [PR #129]

- `GET /api/liquidations` — paginated liquidation history endpoint with wallet and date-range filters
- Seeded from on-chain `cdp_liquidate` events indexed by the backend event listener

### SSS-101 — MultiCollateralLiquidationModule SDK [PR #128]

- `MultiCollateralLiquidationModule` — TypeScript SDK module for multi-collateral CDP liquidation
  - `calcLiquidationAmount(cdpAddress)` — calculates repay amount + collateral reward for any collateral type
  - `fetchLiquidatableCDPs(options)` — returns all CDPs below minimum collateral ratio
  - `liquidate(cdpAddress, repayAmount)` — executes `cdp_liquidate_v2` via Anchor
  - 28 unit tests; exported from `sdk/src/index.ts`

### SSS-100 — Multi-Collateral Liquidation + Partial Liquidation + BadDebtBackstop SDK [PR #135, #124, #143]

- Anchor: `cdp_liquidate_v2` instruction supporting arbitrary collateral mints, partial liquidation (configurable close factor), and liquidation bonus per collateral type
- SDK: `BadDebtBackstopModule` — insurance fund management (deposit, withdraw, trigger backstop)
- `CollateralLiquidated` event added to IDL and SDK types

### SSS-098 — CollateralConfig PDA + Backend API [PR #125]

- On-chain `CollateralConfig` PDA per collateral mint: stores `liquidation_threshold`, `liquidation_bonus`, `max_ltv`, `oracle_feed`, `is_active`
- `GET /api/collateral-config/:mint` and `GET /api/collateral-configs` backend routes
- SDK: `CollateralConfigModule.fetchCollateralConfig(mint)` and `listCollateralConfigs()`

### SSS-097 — Bad-Debt Backstop [PR #123]

- Anchor: `set_backstop_params` and `trigger_backstop` instructions — protocol-owned insurance fund that absorbs residual bad debt when liquidation proceeds are insufficient
- Backstop parameters: `backstop_threshold`, `backstop_mint`, `max_backstop_fill_bps`

### SSS-096 — StabilityFeeModule SDK [PR #117]

- `StabilityFeeModule` TypeScript client: `fetchStabilityFeeRate()`, `previewAccruedFee(cdpAddress)`, `collectFee(cdpAddress)`
- Wraps `collect_stability_fee` Anchor instruction

### SSS-095 — Chain Event Indexing + API [PR #110, #115]

- `event_log` SQLite table: indexes all on-chain events by type, slot, signature, and timestamp
- `GET /api/chain-events` — queryable event log with type/date filters and cursor-based pagination
- `docs/chain-events.md` — event types reference including `stability_fee_accrual` and indexer architecture

### SSS-094 — OracleParamsModule SDK [PR #122]

- `OracleParamsModule.fetchOracleParams(stablecoinAddress)` — retrieves current oracle configuration from on-chain `OracleParams` PDA
- `validateOracleFeed(feedAddress, options)` — checks staleness, confidence interval, and exponent
- 27 unit tests

### SSS-093 — PSM Fee + Per-Minter Velocity Limit [PR #116]

- Anchor: `set_psm_params` instruction adds `psm_fee_bps` and per-minter velocity cap (`velocity_limit`, `velocity_window_seconds`)
- `docs/psm-velocity.md` — PSM fee and velocity limit reference

### SSS-092 — Stability Fee [PR #114]

- Anchor: `set_stability_fee` and `collect_stability_fee` instructions — continuous stability fee accrual on outstanding CDP debt (annual rate in BPS, accrued per-second)
- `docs/stability-fee.md` — stability fee mechanics and admin reference

### SSS-091 — DefaultAccountState=Frozen [PR #109]

- Token-2022 mint initialized with `DefaultAccountState=Frozen` extension — all new ATAs are frozen until explicitly thawed by the compliance authority
- Test suite updated to thaw ATAs in `beforeAll` hooks

### SSS-090 — Oracle Staleness + Confidence Checks [PR #113]

- Oracle safety guards added to `cdp_open`, `cdp_repay`, `cdp_liquidate`, `cdp_liquidate_v2`: reject feeds older than `max_oracle_age_slots`, reject feeds with confidence interval exceeding `max_confidence_bps` of price
- Configurable per-stablecoin via `OracleParams` PDA

### SSS-087 — AdminTimelockModule Docs + CDP Security [PR #105]

- `docs/on-chain-sdk-admin-timelock.md` — full SDK reference for `AdminTimelockModule` (propose, execute, cancel, fetchPendingOps)
- Updated `docs/on-chain-sdk-cdp.md` with security-hardening notes from SSS-085/086

### SSS-086 — AdminTimelockModule SDK [PR #107, #104]

- `AdminTimelockModule` TypeScript client wrapping the on-chain timelock: `proposeAdminOp`, `executeAdminOp`, `cancelAdminOp`, `fetchPendingOps`

### SSS-085 — P0 Security Fixes [PR #103]

- **5 CRITICAL findings addressed:**
  1. Missing authority check on `update_minter` — now requires `admin` signer
  2. `set_backstop_params` missing signer validation — added `admin` constraint
  3. Integer overflow in stability fee accrual — switched to checked arithmetic (`checked_mul`, `checked_div`)
  4. Oracle feed address not validated against stored config — added feed pubkey equality check
  5. CDP repay could repay more than outstanding debt — added `min(repay_amount, outstanding_debt)` cap

### SSS-084 — Security Audit Gaps Analysis [PR #102]

- `docs/MAINNET-AUDIT.md` — attack surface analysis: reentrancy vectors, oracle manipulation, flash loan risk, authority escalation paths, and recommended mitigations

### SSS-083 — Documentation & Standards Gaps Analysis [PR #101]

- `docs/GAPS-ANALYSIS-DOCS.md` → merged into `docs/SUBMISSION.md` — comparison vs Uniswap v3, Aave v3, MakerDAO, and OpenZeppelin standards; identified 14 documentation gaps

### SSS-082 — Backend Infrastructure Gaps Analysis [PR #100]

- Identified production readiness gaps: missing rate limiting on analytics routes, no request signing, WebSocket reconnect logic, missing OpenTelemetry traces — all addressed in subsequent sprints

### SSS-081 — SDK/DX Gaps Analysis [PR #99]

- Benchmarked SDK developer experience vs Solana Pay, Metaplex, and Jupiter SDKs; gaps addressed in SSS-086/094/096/101/107

### SSS-080 — Anchor Program Gaps Analysis [PR #106]

- `docs/GAPS-ANALYSIS-ANCHOR.md` — on-chain program comparison vs USDC (SPL), DAI (MakerDAO), crvUSD, Frax, and USDe; identified missing partial liquidation, velocity limits, backstop fund, stability fees — all subsequently implemented

### SSS-072 — YieldCollateralModule SDK [PR #98]

- `YieldCollateralModule` — `FLAG_YIELD_COLLATERAL` (bit 3) on-chain flag + SDK: `setYieldCollateral`, `fetchYieldCollateralAccounts`, `harvestYield`
- 28 unit tests; exported from `sdk/src/index.ts`

### CI Fixes [2026-03-16]

- Thaw ATAs before mint in transfer-hook `beforeAll` (fixes frozen-account CI flake) [PR #126]
- `sendAndConfirm` with fresh blockhash retry in freeze-token-account test (fixes intermittent CI timeout) [PR #142]
- Fixed missing `ADMIN_OP_NONE` + `DEFAULT_ADMIN_TIMELOCK_DELAY` imports in `initialize.rs` [PR #120]
- Fixed SSS-091/098 integration tests: `thaw_account` before circuit-breaker assertions, camelCase IDL field names [PR #134]
- Backported 3 missing SSS-085 security fields to main [PR #112]

---

## [0.2.0] — 2026-03-14

### SSS-017 — ComplianceModule Anchor Wiring [PR #39]

**What changed:** `ComplianceModule` previously had `isBlacklisted()` (raw byte parsing only) but no way to modify the blacklist on-chain. This release adds all three mutation methods via the Anchor IDL.

**New SDK methods:**
- `ComplianceModule.initializeBlacklist()` → calls `initialize_extra_account_meta_list` via Anchor
- `ComplianceModule.addToBlacklist(address)` → calls `blacklist_add` via Anchor
- `ComplianceModule.removeFromBlacklist(address)` → calls `blacklist_remove` via Anchor

**New files:**
- `sdk/src/idl/sss_transfer_hook.json` — Anchor IDL for the transfer-hook program (all 4 instructions, `BlacklistState` account type, 3 error codes)
- `sdk/src/ComplianceModule.test.ts` — 11 unit tests (PDA derivation, blacklist mutations, program caching, `isBlacklisted` edge cases)

**Test results:** 81/81 tests passing (6 test files)

---

## [0.1.9] — 2026-03-14

### SSS-016 — SDK Anchor IDL Wiring [PR #38]

**What changed:** `SolanaStablecoin` methods previously submitted raw transaction instructions. They now use the typed Anchor IDL for `initialize`, `mint`, and `burn`, enabling proper type checking and IDL-driven account resolution.

**Changes:**
- `sdk/src/SolanaStablecoin.ts` — `initialize`, `mintTo`, `burn` rewritten to use `@coral-xyz/anchor` program methods
- `sdk/src/idl/sss_token.json` — Anchor IDL for `sss-token` program
- `getTotalSupply()` now reads the `StablecoinConfig` PDA directly (previously approximated)

---

## [0.1.8] — 2026-03-14

### Devnet Deployment

Both programs deployed to Solana devnet:

| Program | Program ID |
|---------|-----------|
| `sss-token` | `AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat` |
| `sss-transfer-hook` | `phAtzRyRUJGpMC3ftAtWzoaX7UkghRe9x5KTig8jPQp` |

---

## [0.1.7] — 2026-03-14

### Docs: On-Chain SDK Core Methods [PR #36]

- `docs/on-chain-sdk-core.md` — full reference for `SolanaStablecoin` class (create, mintTo, burnFrom, freeze/thaw, getTotalSupply, updateMinter, updateRoles)

---

## [0.1.6] — 2026-03-14

### CI Fixes — Agave 2.3.x + blake3 [PR #37]

**Problem:** CI was failing due to `blake3 1.8.3` being pulled in by Agave 2.3.x dependencies, which conflicted with the Anchor build toolchain. Additionally, `spl-pod` stale index caused platform-specific Cargo.lock divergence.

**Fix:**
- Committed `Cargo.lock` to the repository (previously gitignored for the workspace root)
- Pinned `blake3 = "=1.7.0"` via committed lock
- Upgraded `spl-token-confidential-transfer-*` to avoid `solana-zk-token-sdk@2.3.x` compile error
- Switched from `anchor build --locked` to `anchor build` with committed Cargo.lock

**Result:** All 4 CI jobs (TypeScript SDK, Backend, Anchor Programs, SDK Integration Tests) green on main.

---

## [0.1.5] — 2026-03-14

### Docs: Anchor Program Testing [PR #35]

- `docs/anchor-program-testing.md` — toolchain versions, CI notes, Agave 2.3.x workarounds, running tests locally

---

## [0.1.4] — 2026-03-14

### SSS-003 — Anchor Programs: 13/13 Tests Passing

**What was built:**
- `programs/sss-token/` — complete Anchor program implementing SSS-1 and SSS-2
  - Instructions: `initialize`, `mint`, `burn`, `freeze_account`, `thaw_account`, `pause`, `unpause`, `update_minter`, `revoke_minter`, `update_roles`
  - Accounts: `StablecoinConfig`, `MinterInfo`
- `programs/transfer-hook/` — SSS-2 transfer hook program
  - Instructions: `transfer_hook`, `initialize_extra_account_meta_list`, `blacklist_add`, `blacklist_remove`
  - Accounts: `BlacklistState`
- Anchor test suite: 13/13 passing on localnet

**Key fixes during development:**
- Config PDA as signer for mint/freeze/thaw via `signer_seeds`
- Token-2022 owner parsing from token account data (offset 32)
- Agave 2.3.x compatibility fixes

---

## [0.1.3] — 2026-03-14

### SSS-014 — Compliance Audit Log

- `backend/src/routes/compliance.rs` — `POST /api/compliance/blacklist`, `GET /api/compliance/blacklist`, `GET /api/compliance/audit`
- Audit log appended atomically with every blacklist mutation
- `docs/compliance-audit-log.md` — REST reference for compliance endpoints

---

## [0.1.2] — 2026-03-13

### SSS-013 — API Reference + SDK Docs

- `docs/api.md` — full REST endpoint reference (health, mint, burn, supply, events, compliance, webhooks)
- `docs/authentication.md` — API key generation and `X-Api-Key` header usage
- `docs/rate-limiting.md` — token-bucket rate limiter, `Retry-After` behaviour
- `docs/transfer-hook.md` — on-chain transfer-hook program reference (instructions, errors, account layout)

---

## [0.1.1] — 2026-03-13

### SSS-002 — Project Scaffolding

- Forked `solanabr/solana-stablecoin-standard` → `dcccrypto/solana-stablecoin-standard`
- Full project structure: `programs/`, `sdk/`, `backend/`, `cli/`, `tests/`, `docs/`
- CI: GitHub Actions workflows for TypeScript SDK, Backend (Rust/axum), Anchor Programs, SDK Integration Tests
- Docker Compose for backend + Postgres
- Devnet wallet generated and funded

---

## [0.1.0] — 2026-03-13

### SSS-001 — Initial Specification

- SSS-1 (Minimal) and SSS-2 (Compliant) presets specified
- Architecture: three-layer model (on-chain → SDK → application)
<!-- heartbeat 17:20 UTC 2026-03-14 -->

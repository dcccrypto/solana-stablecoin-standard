# SSS-080: On-Chain Gaps Analysis — Anchor Program

_Author: sss-anchor | Date: 2026-03-15 | Task: SSS-080_

---

## Executive Summary

This document is a brutally honest assessment of SSS's on-chain Anchor program compared to the best stablecoin implementations in production: **USDC** (Circle/Ethereum + native mint on Solana), **DAI/MakerDAO** (Ethereum CDP), **USDT** (Tether), **crvUSD** (Curve Finance), **Frax** (fractional-algorithmic), and **USDe** (Ethena). It also identifies gaps in Solana-native capability usage and attack vectors not yet covered by tests or Kani proofs.

The SSS program has a solid architectural foundation: Token-2022, Anchor PDA safety, CDP with Pyth oracle, DAO governance, ZK compliance hooks, and now admin timelocks. But compared to production-grade protocols, there are significant missing features across oracle safety, liquidation mechanics, fee capture, upgradability, and economic design.

---

## 1. Critical On-Chain Features Missing vs. Production Stablecoins

### GAP-001 — CRITICAL: No Oracle Fallback / Circuit-Breaker on Stale Prices

**Reference:** MakerDAO OSM (Oracle Security Module), crvUSD AMM oracle, Chainlink + Pyth redundancy used by most protocols.

**What we have:** A single Pyth price feed per config (`expected_pyth_feed`). `cdp_borrow_stable` reads Pyth and proceeds.

**What's missing:**
- No staleness check on the Pyth `publish_time` field. If the oracle goes silent, CDPs can be opened at arbitrarily old prices.
- No confidence interval rejection. Pyth publishes `conf` (confidence interval width). Professional protocols reject prices where `conf / price > threshold` (e.g. 1%). We do not read `conf` at all.
- No secondary oracle fallback (Chainlink, Switchboard). Single-oracle dependency is a single point of failure — a compromised Pyth publisher can drain all CDPs in one block.
- No TWAP smoothing. Pyth spot prices can be manipulated in low-liquidity conditions. crvUSD uses a 10-minute TWAP for borrow calculations.

**Impact:** A flash-crash or oracle outage enables mass bad-debt creation with no backstop.

**Fix:**
```rust
// In cdp_borrow_stable / cdp_liquidate:
let price_data = ctx.accounts.pyth_price_feed.get_price_no_older_than(&Clock::get()?, MAX_PRICE_AGE_SECS)?;
require!(
    price_data.conf * 100 / price_data.price as u64 <= MAX_CONF_BPS,
    SssError::OracleConfidenceTooWide
);
```
Add `StablecoinConfig.max_oracle_staleness_secs` (default 60s) and `max_oracle_conf_bps` (default 100 = 1%).

---

### GAP-002 — CRITICAL: No Stability Fee / Interest Accrual on CDP Debt

**Reference:** MakerDAO (stability fee accrues on DAI debt continuously), crvUSD (rate controller adjusts borrow APR dynamically), Frax (interest rate on FRAX borrowing).

**What we have:** `CdpPosition.debt_amount` is the initial principal; there is no accrual mechanism.

**What's missing:**
- Zero cost to borrow SSS forever. An attacker can open a CDP, borrow at 150%, and sit indefinitely — no cost, no incentive to repay.
- No protocol revenue. Without fees, the protocol cannot fund its own security budget, insurance fund, or liquidity incentives.
- No dynamic rate adjustment based on utilization. When demand for borrowing is high, rates should rise to defend the peg.

**Impact:** The protocol runs at a permanent loss. Long-term, this is fatal — there is no economic model.

**Fix:**
- Add `CdpPosition.debt_principal: u64` + `CdpPosition.cumulative_rate_snapshot: u64`.
- Add a global `StablecoinConfig.cumulative_borrow_rate: u64` that is updated on each CDP interaction (lazy compounding pattern, as used by Aave and MakerDAO).
- Add `StablecoinConfig.annual_stability_fee_bps: u64` (e.g. 200 = 2% APR).
- Liquidation must include accrued interest in the debt check.

---

### GAP-003 — HIGH: No Bad Debt Socialization / Surplus Buffer

**Reference:** MakerDAO (Surplus Buffer → MKR buyback; if deficit, MKR dilution auction), crvUSD (PegKeeper absorbs bad debt), Frax (AMO float).

**What we have:** If a CDP goes underwater (collateral value < debt, e.g. after a price crash), `cdp_liquidate` is called. But if it's underwater past the 5% liquidation bonus, the liquidator gets less than they pay — no one will liquidate, and bad debt accrues.

**What's missing:**
- No insurance / surplus fund. There is no vault to absorb losses when liquidations are unprofitable.
- No governance-triggered bad debt recapitalization (equivalent of MKR dilution or FRAX FXS buyback).
- No global settlement mechanism (MakerDAO Emergency Shutdown) — if the protocol is catastrophically insolvent, there is no orderly wind-down path.

**Impact:** A 20%+ price crash in collateral with insufficient liquidation bots → permanent bad debt → protocol insolvency with no recovery mechanism.

**Fix:**
- Add a `SurplusVault` PDA that accumulates stability fees.
- Add `bad_debt_epoch` tracking: if a position is ≤ 100% CR for > N slots, write off the bad debt from surplus vault.
- Document the global settlement (emergency redeem) path via the circuit breaker + authority.

---

### GAP-004 — HIGH: No Multi-Collateral Position Aggregation

**Reference:** MakerDAO (multi-collateral DAI: ETH, WBTC, stETH etc. each in separate Vault *types* but a user can have many), crvUSD (one position per user but supports multiple market contracts), Frax (AMO manages diverse collateral basket).

**What we have:** One `CdpPosition` per user per SSS mint, bound to a single `collateral_mint` (set on first borrow, immutable).

**What's missing:**
- A user cannot hold ETH-collateral and SOL-collateral positions simultaneously on the same SSS mint. They would need two separate SSS mint deployments.
- No cross-collateral netting — if a user has 200% CR in SOL and 110% CR in USDC, they should be safe overall, but USDC position gets liquidated anyway.
- No collateral substitution (closing a SOL position to open an mSOL position without full repay).

**Impact:** Major UX regression vs. DeFi standards. Power users cannot manage complex collateral portfolios.

---

### GAP-005 — HIGH: Liquidation Mechanics Are Incomplete

**Reference:** crvUSD LLAMMA (Lending-Liquidating AMM — gradual soft liquidation over a price band), MakerDAO Clip (Dutch auction), Frax (AMM-based liquidation).

**What we have:** Instant full liquidation at 120% CR — the liquidator takes all collateral at a 5% discount.

**What's missing:**
- **No partial liquidation.** At 121% CR, a small liquidation of just enough debt to restore health would be better for the borrower. Full liquidation at 121% destroys borrower position unnecessarily.
- **No Dutch auction.** MakerDAO's Clip auction starts at a high price and falls — this ensures the protocol gets the best price and liquidators compete. We give a flat 5% — too little incentive in volatile markets, too much haircut for the borrower in calm markets.
- **No soft liquidation range.** crvUSD's LLAMMA converts collateral to stablecoin gradually as price falls through a band — users are partially protected from sudden full liquidation.
- **Liquidation bonus not dynamic.** 5% is hardcoded in `CdpPosition::LIQUIDATION_BONUS_BPS`. In volatile markets, 5% is insufficient to attract liquidators. Should be a governance parameter.

---

### GAP-006 — MEDIUM: No Peg Stability Module (PSM)

**Reference:** MakerDAO PSM (swap USDC ↔ DAI 1:1 with a fee), Frax (FRAX ↔ USDC direct redemption), USDC (off-chain redemption).

**What we have:** SSS-3 has `deposit_collateral` (USDC → SSS) and `redeem` (SSS → USDC). This is effectively a PSM but:
- No fee capture on these swaps (`redeem` gives 1:1 with no protocol fee).
- No ceiling per PSM route (MakerDAO caps PSM exposure to limit USDC risk).
- No PSM stats (volume, fees collected) — zero observability for governance.

**Fix:**
- Add `StablecoinConfig.redemption_fee_bps: u64` (e.g. 10 = 0.1%).
- Add `StablecoinConfig.psm_deposit_ceiling: u64` (max collateral via PSM route).
- Emit `PsmSwap` events with cumulative volume for off-chain indexing.

---

### GAP-007 — MEDIUM: No Supply Velocity / Mint Rate Limiting

**Reference:** USDC (Circle has off-chain KYC-gated minting), DAI (Debt Ceiling per collateral type enforced on-chain), crvUSD (per-market debt ceilings).

**What we have:** `MinterInfo.cap` limits lifetime minting per minter. But:
- No rate limit — a minter with a 1B cap can mint all 1B in a single transaction.
- No global debt ceiling per collateral type for CDP borrowing.
- No per-epoch velocity check.

**Impact:** A compromised minter key can drain the entire cap in seconds with no on-chain throttle.

**Fix:**
- Add `MinterInfo.minted_this_epoch: u64` + `MinterInfo.last_epoch_reset: u64` (epoch number).
- Add `StablecoinConfig.cdp_global_debt_ceiling: u64` (max total CDP debt across all positions).
- Add per-collateral debt ceilings in a `CollateralConfig` PDA.

---

### GAP-008 — MEDIUM: No On-Chain Proof of Reserves (Auditable)

**Reference:** USDT (quarterly attestations, not on-chain), USDC (Circle attestations), Frax (real-time on-chain CR visible via `fraxFee`), MakerDAO (on-chain `vat.debt` + collateral visible to anyone).

**What we have:** `StablecoinConfig.total_collateral` and `net_supply()` exist, but:
- `reserve_ratio_bps()` is a view function, not an instruction that emits a verifiable on-chain event.
- No `ReservesAttestation` event with timestamp, auditor signature, or Merkle root.
- External integrators (wallets, bridges, DEXes) must read raw state — no standardized interface.

**Fix:**
- Add `emit_proof_of_reserves(ctx)` instruction that emits a `ProofOfReservesEvent { total_supply, total_collateral, ratio_bps, slot, authority_sig }`.
- Add `last_attestation_slot` to `StablecoinConfig` so UIs can warn when reserves haven't been attested recently.

---

## 2. Solana-Specific Capabilities Not Leveraged

### GAP-009 — HIGH: Token-2022 Extensions Not Fully Used

Token-2022 ships a rich extension set. We use: `MintCloseAuthority`, `PermanentDelegate`, `TransferHook`, `MetadataPointer`, `TokenMetadata`. We do **not** use:

| Extension | What it enables | Why we need it |
|-----------|-----------------|----------------|
| `InterestBearingMint` | Native APY accrual in the token itself | Yield-bearing stablecoin (like DAI's DSR) without external vaults |
| `TransferFee` | Native per-transfer fee to a destination | Protocol fee collection without a separate hook |
| `ConfidentialTransfer` | ZK-encrypted balances | True privacy-preserving compliance — our current ZK hook only gates *whether* a user can transfer, not *how much* |
| `NonTransferable` | Soulbound tokens | Compliance credentials / KYC badges as non-transferable Token-2022 tokens |
| `DefaultAccountState` | All new ATAs start frozen | SSS-2 accounts should start frozen; currently we rely on runtime enforcement only |
| `MintTokensToVault` | Atomic mint-to-vault | Needed for PSM atomic swaps without intermediate accounts |

**Most critical missing:** `DefaultAccountState` = Frozen for SSS-2. Right now, a newly created ATA is unfrozen by default — there is a race condition between ATA creation and the compliance freeze. Token-2022's `DefaultAccountState::Frozen` closes this window at the extension level.

---

### GAP-010 — HIGH: No Account Compression / Sparse Merkle Trees for Compliance Lists

**Reference:** Solana State Compression (nftrees, Bubblegum), Light Protocol ZK compression.

**What we have:** The blacklist (compliance freeze) operates by freezing individual ATAs. The whitelist for ZK compliance is one `VerificationRecord` PDA per user (~80 bytes + rent).

**What's missing:**
- A blacklist of 100,000 addresses would cost ~$2M in rent at current rates using individual PDAs. OFAC has 15,000+ SDN entries today.
- No compressed account / Merkle proof path for compliance checks. Light Protocol lets you store 100,000 accounts for ~0.1 SOL.
- The transfer hook reads an on-chain PDA (88 bytes, ~0.001 SOL each). At 1M users, VerificationRecord storage is ~1000 SOL ($150K at $150/SOL).

**Fix:**
- Integrate Light Protocol / state compression for `VerificationRecord` storage.
- Replace full PDA with a Merkle inclusion proof: user provides a path, hook verifies against a Merkle root stored in `ZkComplianceConfig`.
- This enables OFAC-scale blocklists and institutional-scale ZK compliance at a fraction of the cost.

---

### GAP-011 — MEDIUM: No Address Lookup Tables (ALT) for Complex Instructions

**Reference:** All major Solana DeFi protocols (Mango, Jupiter, Drift) use ALTs for transaction packing.

**What we have:** CDP borrow instruction requires: `config`, `mint`, `cdp_position`, `collateral_vault`, `vault_token_account`, `user_ata`, `pyth_price_feed`, `token_program`, `system_program`, `clock`, `associated_token_program` — 11+ accounts.

**What's missing:**
- No official SSS ALT registered on mainnet.
- Complex multi-step operations (deposit + borrow + verify ZK) exceed the 1232-byte transaction size limit without ALTs.
- No instruction to help integrators pre-build or fetch the SSS ALT address.

**Fix:**
- At devnet deploy, create a canonical ALT containing all SSS program IDs, common token mints, Pyth feed addresses, and system programs.
- Publish ALT address in docs and emit it as a program-derived constant.

---

### GAP-012 — MEDIUM: No Cross-Program Invocation (CPI) Access Control Registry

**Reference:** SPL Token's mint/burn authorities, Anchor's CPI guard patterns.

**What we have:** `cpi_mint` / `cpi_burn` with `InterfaceVersion` versioning. Any program that calls `cpi_mint` can mint up to the minter cap.

**What's missing:**
- No CPI caller allowlist / program ID whitelist. Any deployed program on Solana that holds a registered minter key can call `cpi_mint`.
- No CPI reentrancy guard. Solana's runtime prevents recursion at the sysvar level, but there is no explicit Anchor `#[account(reentrant = false)]` assertion.
- No CPI call logging — we cannot audit which program ID made a given mint call.

**Fix:**
- Add `MinterInfo.allowed_cpi_caller: Option<Pubkey>` — if set, `cpi_mint` verifies `get_stack_height()` and the calling program ID matches.
- Emit `CpiMintEvent { caller_program: Pubkey, amount, minter }` for off-chain audit trail.

---

### GAP-013 — LOW: Compressed NFTs / DAS Not Used for Compliance Credentials

**Reference:** Metaplex Bubblegum, Light Protocol.

Rather than PDAs for `VerificationRecord`, compliance attestations could be cNFTs (compressed NFTs) with metadata. DAS (Digital Asset Standard) API provides instant lookup. Not blocking, but worth exploring for ecosystem compatibility.

---

## 3. Attack Vectors Not Covered by Tests or Kani Proofs

### GAP-014 — CRITICAL: No Kani Proof for Stability Fee Accrual (Blocking GAP-002)

Once stability fees are added (GAP-002), the compounding math must be formally verified. Historical DeFi exploits (Compound, Euler) have exploited precision loss in interest accrual. The proof must show:
- `accrued_fee` is always ≤ the actual fee owed (no undercharge).
- `cumulative_rate` never overflows `u128`.
- Compounding across N periods equals single-period compounding (no rounding exploit).

---

### GAP-015 — CRITICAL: No Test for Oracle Confidence Interval Rejection (Blocking GAP-001)

Current tests mock a fixed Pyth price. Missing tests:
- `test_cdp_borrow_rejects_stale_price` — price older than `max_oracle_staleness_secs`.
- `test_cdp_borrow_rejects_wide_confidence` — `conf / price > max_conf_bps`.
- `test_cdp_liquidation_with_oracle_failure` — what happens when Pyth account is closed mid-session.
- `test_two_oracle_disagreement` — future: secondary oracle reports > 5% different from primary.

---

### GAP-016 — HIGH: No Invariant Test for Interest-Free Borrowing Attack

**Attack:** A user opens a CDP at exactly 150% CR. Price drops 0.001%. Position is now at 149.93% CR — below minimum but above liquidation threshold (120%). Due to gas economics, no liquidator will touch a 0.1 SOL profit position.

Currently there are no tests for:
- `test_undercollateralized_position_sits_unliquidated` (economic dead zone).
- `test_bad_debt_accumulation_over_n_slots` (what happens to `total_minted` when debt is never repaid).
- `test_global_cr_below_100_percent` (total collateral < total debt — insolvency scenario).

---

### GAP-017 — HIGH: ZK Proof Submission Has No Actual Cryptographic Verification

**File:** `programs/sss-token/src/instructions/zk_compliance.rs`

`submit_zk_proof` creates a `VerificationRecord` but does not verify any cryptographic proof. The `verifier_pubkey` optional field is a co-signer approach — but:
- When `verifier_pubkey = None`, ANY user can self-certify compliance. Zero-knowledge but also zero-security.
- When `verifier_pubkey = Some(vk)`, we require `vk` to be a signer — but this is a simple co-signature, not a ZK proof. The `vk` signer presumably verified something off-chain, but the on-chain instruction has no cryptographic binding to what was verified.
- No Groth16 / PLONK / bulletproof verification. Solana's `alt_bn128` syscall enables on-chain ZK verification since version 1.14. We are not using it.

**Missing tests:**
- `test_submit_zk_proof_without_verifier_allows_self_certify` (document the security model explicitly).
- `test_submit_zk_proof_with_wrong_verifier_signature_fails`.
- `test_transfer_hook_rejects_expired_verification_record`.

---

### GAP-018 — HIGH: No Test for `DefaultAccountState` Race Condition

Without `DefaultAccountState = Frozen` (GAP-009), there is a race: user creates ATA, receives tokens from a third party, before compliance officer freezes. No test exists for:
- `test_compliance_bypass_via_fresh_ata_before_freeze`.
- `test_permanent_delegate_cannot_move_funds_from_unfrozen_blocked_user`.

---

### GAP-019 — MEDIUM: `StablecoinConfig.total_minted` Can Diverge from Token Supply

`total_minted` is incremented in `mint` and `cpi_mint`. `total_burned` is incremented in `burn` and `cpi_burn`. But:
- If a future instruction path (e.g. `authority_burn` or a DAO governance action) calls Token-2022's burn directly without going through our handlers, the counters diverge.
- No Kani proof or invariant test that `net_supply() == Token2022::mint_supply()` at all times.

**Missing test:** `test_total_minted_matches_token_supply_after_mixed_operations`.

---

### GAP-020 — MEDIUM: CDP Liquidation Not Tested Under Price Recovery

**Scenario:** Price drops, liquidation is called, then price recovers. The CDP position is closed (debt=0, collateral=0 after full liquidation). But `CdpPosition` PDA is not closed (no `close = authority` in account macro) — it remains as a zombie account consuming rent.

**Missing tests:**
- `test_cdp_position_pda_closeable_after_full_repay`.
- `test_zombie_cdp_position_after_liquidation_does_not_block_new_position`.

---

## 4. Usability Pain Points for Stablecoin Deployers

### GAP-021 — HIGH: No `initialize_with_collateral_config` One-Shot Instruction

**Problem:** To deploy a full SSS-3 CDP stablecoin today, a deployer must call:
1. `initialize` (creates mint + config)
2. `set_pyth_feed` (admin timelock — must wait 2 epochs = ~4 days!)
3. `init_dao_committee` (optional)
4. `init_yield_collateral` (optional)
5. `init_zk_compliance` (optional)
6. `init_interface_version` (for CPI callers)
7. `update_minter` (add at least one minter)

That is 7 separate transactions minimum, with a 4-day delay before the oracle is trusted. Compare to Frax's `deployFraxtal()` one-call deployment.

**Fix:**
- Add `initialize_full(ctx, params: InitializeFullParams)` that takes all config in one instruction (minus the timelock for Pyth — but make the timelock delay configurable at init to allow a 0-delay initial setup period).
- Add a `BootstrapMode` flag that allows authority to bypass timelock for the first 7 days post-deploy, then auto-disables.

---

### GAP-022 — HIGH: No Collateral Price Discovery for CDP Deployers

**Problem:** A deployer choosing collateral for an SSS-3 CDP must manually find:
- The Pyth feed address for their collateral token.
- The correct `price_expo` for decimal math.
- Whether the feed is stale on devnet vs. mainnet.

There is no on-chain registry of supported collateral types with their Pyth feed addresses.

**Fix:**
- Add a `CollateralConfig` PDA (seeds: `["collateral-config", sss_mint, collateral_mint]`) that stores: `pyth_feed`, `price_expo`, `min_cr_bps`, `liquidation_threshold_bps`, `debt_ceiling`.
- Authority creates a `CollateralConfig` before accepting collateral deposits.
- `cdp_deposit_collateral` validates the collateral mint against an existing `CollateralConfig`.

---

### GAP-023 — MEDIUM: No Simulation / Dry-Run Instruction

**Problem:** Before opening a CDP, a user wants to know: "If I deposit X SOL, how much SSS can I borrow?" There is no on-chain view instruction that takes Pyth price + collateral amount + returns max borrowable without mutating state.

**Fix:**
- Add `simulate_borrow(ctx, collateral_amount: u64) -> SimulateBorrowResult` as an instruction that reads price and returns `{ max_borrow, collateral_value_usd, health_factor_bps }` — returning these via a Solana `simulateTransaction` call (no state change, reads only).

---

### GAP-024 — MEDIUM: SSS-1 and SSS-3 Cannot Coexist on the Same Mint

**Problem:** The preset (1/2/3) is set at init and is immutable. A deployer who starts with SSS-1 (minimal) and wants to add CDP borrowing (SSS-3) cannot — they must deploy a new mint, migrate all holders, and rebuild liquidity pools.

**Reference:** MakerDAO upgraded DAI from SAI (single-collateral) to MCD (multi-collateral DAI) via a migration — painful, but possible because the protocol supported it.

**Fix:**
- Add `upgrade_preset(ctx, new_preset: u8)` instruction (authority + timelock + DAO vote required).
- Validate upgrade path: 1→2 (adds compliance), 2→3 (adds collateral), 1→3 (skip compliant — requires explicit override).
- This is a major feature but critical for long-lived stablecoins.

---

### GAP-025 — MEDIUM: No Events for Critical State Transitions

The following state transitions emit no events:
- `accept_authority` / `accept_compliance_authority` (authority change — critical for security monitoring).
- `execute_timelocked_op` (what op was executed? logged only to logs, not as a parseable event).
- `cdp_liquidate` (no `CdpLiquidatedEvent` with borrower, liquidator, collateral seized, debt cleared, price at time).
- `execute_action` for DAO proposals (no `GovernanceActionExecuted` with proposer, voters, action, params).

**Impact:** Off-chain monitoring systems (Sentinels, Grafana, PagerDuty) have zero visibility into critical protocol events. Circuit breaker activations, authority changes, and liquidations are invisible without log-scraping.

---

### GAP-026 — LOW: Account Space Not Upgradeable

`StablecoinConfig` is 5 fields larger after SSS-085 (admin timelock fields). Future features will add more fields. Currently, existing deployed configs cannot be resized — they would need to be closed and re-initialized.

**Fix:**
- Add trailing `_reserved: [u8; 64]` to each major state account to absorb future fields without realloc.
- Or, use Anchor's `realloc` constraint pattern for `StablecoinConfig` and document the upgrade path.

---

## Priority Matrix

| ID | Severity | Category | Effort | Impact |
|----|----------|----------|--------|--------|
| GAP-001 | CRITICAL | Oracle safety | M | Protocol solvency |
| GAP-002 | CRITICAL | Economics | L | Protocol revenue + sustainability |
| GAP-003 | CRITICAL | Economics | L | Insolvency backstop |
| GAP-009 | HIGH | Solana native | S | Close compliance race condition |
| GAP-005 | HIGH | Liquidation | L | Better borrower/liquidator mechanics |
| GAP-017 | HIGH | ZK security | M | Real cryptographic compliance |
| GAP-010 | HIGH | Solana native | L | 1000x cheaper compliance at scale |
| GAP-022 | HIGH | UX | M | Deployer usability |
| GAP-021 | HIGH | UX | S | One-shot deploy |
| GAP-006 | MEDIUM | Economics | S | Protocol revenue |
| GAP-007 | MEDIUM | Security | S | Rate-limit compromised minters |
| GAP-011 | MEDIUM | Solana native | S | Transaction packing |
| GAP-012 | MEDIUM | Security | S | CPI access control |
| GAP-025 | MEDIUM | Observability | S | Off-chain monitoring |
| GAP-014 | CRITICAL | Formal proof | M | Block GAP-002 safely |
| GAP-015 | CRITICAL | Testing | S | Block GAP-001 safely |

_Effort: S=days, M=weeks, L=months_

---

## Comparison Table vs. Production Stablecoins

| Feature | USDC (Solana) | DAI (MakerDAO) | crvUSD | Frax | USDe | SSS |
|---------|--------------|----------------|--------|------|------|-----|
| Oracle fallback | Chainlink+off-chain | OSM (1hr delay) | TWAP | Chainlink | Chainlink | ❌ Single Pyth |
| Stability fee | N/A (fiat) | Yes (dynamic) | Yes (rate controller) | Yes | Funding rate | ❌ None |
| Surplus buffer | N/A | Surplus Buffer | PegKeeper | AMO | Insurance fund | ❌ None |
| Partial liquidation | N/A | Yes (Clip) | LLAMMA (gradual) | Partial | Yes | ❌ Full-only |
| PSM fee | N/A (Circle) | 0.01% | N/A | 0.1% | 0.05% | ❌ 0% |
| Mint rate limit | Off-chain | Debt ceiling | Debt ceiling | AMO limit | Off-chain | ⚠️ Cap only |
| Token-2022 native | ✅ SPL Token | N/A (ETH) | N/A (ETH) | N/A (ETH) | N/A (ETH) | ✅ |
| DefaultAccountState | ✅ | N/A | N/A | N/A | N/A | ❌ |
| ZK privacy | ❌ | ❌ | ❌ | ❌ | ❌ | ⚠️ (co-sig only) |
| On-chain PoR | ❌ | ✅ (vat) | ✅ | ✅ | ❌ | ⚠️ (view only) |
| Compressed accounts | N/A | N/A | N/A | N/A | N/A | ❌ |
| One-call deploy | ✅ | ❌ | ❌ | ✅ | ✅ | ❌ |
| Preset upgrade | N/A | Partial | N/A | Yes | N/A | ❌ |

---

## Recommended Next Sprint (Post-SSS-080)

1. **SSS-090** — Oracle safety: staleness + confidence interval checks (GAP-001, GAP-015). Est. 2 days.
2. **SSS-091** — `DefaultAccountState = Frozen` for SSS-2 (GAP-009). Est. 1 day.
3. **SSS-092** — Stability fee skeleton: `annual_stability_fee_bps` + `cumulative_borrow_rate` + Kani proof (GAP-002, GAP-014). Est. 1 week.
4. **SSS-093** — PSM fee + per-minter velocity limit (GAP-006, GAP-007). Est. 2 days.
5. **SSS-094** — `emit_proof_of_reserves` instruction + `ProofOfReservesEvent` (GAP-008). Est. 1 day.
6. **SSS-095** — `CollateralConfig` PDA + per-collateral debt ceiling (GAP-022, GAP-004 partial). Est. 3 days.
7. **SSS-096** — Critical event emission: `CdpLiquidatedEvent`, `GovernanceActionExecuted`, `AuthorityChangedEvent` (GAP-025). Est. 1 day.

---

_This document is internal and pre-publication. All gap ratings reflect current state as of 2026-03-15._

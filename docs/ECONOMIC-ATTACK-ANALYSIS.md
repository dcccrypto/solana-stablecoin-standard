# Economic Attack Analysis — SSS Stablecoin Standard

> **Task:** SSS-116 | **Status:** Complete | **Author:** sss-docs | **Date:** 2026-03-22

This document analyses economic attack vectors across the CDP, PBS, APC, DAO governance, PSM, and backstop modules. For each attack: description, capital required, current mitigations, missing mitigations, and severity rating.

---

## Table of Contents

1. [CDP Oracle Manipulation](#1-cdp-oracle-manipulation)
2. [CDP Liquidation Sandwich](#2-cdp-liquidation-sandwich)
3. [PBS Griefing](#3-pbs-griefing)
4. [APC Channel Jamming](#4-apc-channel-jamming)
5. [DAO Vote Manipulation](#5-dao-vote-manipulation)
6. [Stability Fee / PSM Arbitrage](#6-stability-fee--psm-arbitrage)
7. [Backstop Drain](#7-backstop-drain)
8. [Summary Table](#summary-table)

---

## 1. CDP Oracle Manipulation

### Description

The `cdp_liquidate` instruction fetches the collateral price from a Pyth price feed. An attacker with enough capital to manipulate Pyth's aggregated price could momentarily suppress the price of a collateral asset to push a healthy CDP below the liquidation threshold (`LIQUIDATION_THRESHOLD_BPS = 12000`, i.e. 120% CR), then immediately liquidate it for the 5% bonus.

**Attack flow:**
1. Attacker identifies a large CDP near the 120% CR floor.
2. Attacker sells/borrows large amounts of the collateral asset to suppress the Pyth spot price.
3. In the same or next Solana slot, the attacker calls `cdp_liquidate` — the manipulated price makes the CDP appear undercollateralised.
4. Attacker seizes collateral at a 5% discount, then unwinds the price suppression trade.

### Capital Required

Pyth is an aggregate of many institutional publishers. Meaningful price manipulation requires:
- **~$5M–$50M+** in collateral sell pressure (or leveraged short) for mid-cap assets.
- For majors (SOL, BTC, ETH), cost is prohibitively high ($100M+).
- For low-liquidity collateral types, cost could be as low as **$500K–$2M**.

### Current Mitigations

| Mitigation | Where enforced |
|---|---|
| Pyth staleness check (`max_oracle_age_secs`, default 60s) | `cdp_liquidate_handler` line ~130 |
| Confidence interval check (`max_oracle_conf_bps`) — rejects liquidation when conf/price ratio exceeds threshold | `cdp_liquidate_handler` line ~143 |
| Feed pubkey validation — `expected_pyth_feed` prevents spoofed feeds | `cdp_liquidate_handler` line ~119 |
| Slippage protection (`min_collateral_amount`) — caller sets floor | `cdp_liquidate_handler` line ~218 |
| Per-collateral config (`CollateralConfig`) — independent thresholds per asset | `cdp_liquidate.rs` ~line 168 |
| Circuit breaker (`FLAG_CIRCUIT_BREAKER`) — authority can halt all liquidations | `cdp_liquidate_handler` line ~112 |

The confidence interval check is the most important defence: a large sell pressure widens Pyth's aggregate confidence band, which triggers `OracleConfidenceTooWide` and blocks the liquidation.

### Missing Mitigations

- **No TWAP fallback.** The code uses spot price only. A time-weighted average price (even 5-minute TWAP) would make flash manipulation far more expensive.
- **No minimum buffer above threshold.** CDPs at exactly 121% CR are one small price move from liquidation under normal volatility. A "safe zone" buffer (e.g. only allow liquidation at <115% when using spot price, but <120% when using TWAP) would reduce griefing.
- **No rate-limiting on liquidations per block.** An attacker could chain multiple liquidations of the same collateral type in one transaction.
- **`max_oracle_conf_bps` is optional.** If not configured (0), the confidence check is skipped entirely.

### Severity

**High** — Realistic for low-liquidity collateral types. Confidence interval check mitigates this significantly for well-configured deployments, but omitting `max_oracle_conf_bps` leaves a gap.

**Recommended additional mitigations:**
1. Enforce `max_oracle_conf_bps > 0` as a deploy-time requirement for any CDP-enabled config.
2. Add a TWAP price source as a secondary check (e.g. require spot + TWAP both below threshold before liquidation proceeds).
3. Document minimum safe `max_oracle_conf_bps` values per collateral type.

---

## 2. CDP Liquidation Sandwich

### Description

A liquidator can front-run a Pyth price update transaction to liquidate a CDP that is about to become unhealthy, but is currently healthy — the CDP owner had no opportunity to add collateral.

**Attack flow:**
1. Attacker monitors Pyth publisher update mempool (off-chain).
2. Attacker sees an incoming price decrease that will push a target CDP below 120% CR.
3. Attacker submits `cdp_liquidate` immediately after the price update lands in the same or next slot (Solana's MEV environment).
4. The CDP owner's add-collateral tx is stuck behind the liquidation.

### Capital Required

- **Minimal** — the attacker needs only enough SSS to cover the debt being liquidated (borrowed or bought on open market). The 5% bonus is pure profit on the liquidated collateral.
- Capital at risk: 0 (flash-atomic if done in a single transaction with flash loan availability).

### Current Mitigations

| Mitigation | Detail |
|---|---|
| Slippage guard (`min_collateral_amount`) | Protects liquidator from sandwich attacks *against themselves*, not CDP owners |
| Partial liquidation (`partial_repay_amount`) | Allows liquidators to only partially liquidate, reducing CDP owner's loss |
| Per-collateral liquidation bonus (configurable) | Lower bonus = less incentive for aggressive front-running |

### Missing Mitigations

- **No grace period or auction delay.** Traditional DeFi protocols (Maker, Aave v3) use auction mechanisms or grace periods. SSS has none.
- **No CDP-owner notification window.** The CDP owner has no on-chain mechanism to receive early warning or pre-emptively add collateral before liquidation is possible.
- **No Dutch auction for liquidations.** A Dutch auction starting at 0% bonus rising to 5% would give the CDP owner time to self-rescue.

### Severity

**Medium** — Solana's deterministic block ordering makes classic mempool sandwiching harder than on EVM chains, but Jito bundles and MEV infrastructure make it increasingly feasible. The 5% bonus provides strong incentive for searchers.

**Recommended additional mitigations:**
1. Add a configurable `liquidation_delay_slots` parameter — CDPs below threshold but above a "danger zone" (e.g. 110%) enter a grace period before full liquidation is allowed.
2. Implement a Dutch auction mechanism: start bonus at 0%, increase by 0.1% per slot.

---

## 3. PBS Griefing

### Description

#### 3a — Issuer Locks Claimant Funds Indefinitely

An issuer creates a `ProbabilisticVault` with a `condition_hash` they have no intention of ever providing proof for. The claimant's expected payment is locked until `expiry_slot`.

**Attack flow:**
1. Malicious issuer calls `commit_probabilistic` with a known-unresolvable hash (e.g. hash of a secret they destroyed).
2. Claimant completes the work but cannot obtain the proof.
3. Funds are locked until `expiry_slot` — issued back to issuer, not claimant.
4. Claimant rendered unable to claim, issuer pays no penalty.

#### 3b — Claimant Front-Runs expire_and_refund

When a commitment expires, the issuer calls `expire_and_refund`. A malicious claimant could monitor for this and attempt to DoS the tx or front-run with `prove_and_resolve` using a fabricated proof (though this would fail validation).

### Capital Required

- **3a:** Issuer fronts the committed amount (locked but returned after expiry). Cost = opportunity cost only.
- **3b:** Negligible — gas cost of attempted tx spam.

### Current Mitigations

| Mitigation | Detail |
|---|---|
| `expiry_slot` — issuer funds returned after expiry | Caps maximum lock duration |
| SHA-256 proof validation | Prevents fabricated proof claims (3b) |
| `VaultStatus` lifecycle enforcement | `is_terminal()` prevents re-use after resolution/expiry |
| PDA uniqueness (`commitment_id`) | Each commitment is distinct; no replay |

### Missing Mitigations

- **No minimum deposit or bond for the issuer.** There is no economic cost for griefing beyond the temporary capital lockup.
- **No reputation or slashing mechanism.** A malicious issuer can create and abandon commitments at no additional cost.
- **No expiry limit enforcement.** The code does not cap `expiry_slot` — an issuer could set expiry 10 years in the future.
- **Claimant has no recourse.** If the issuer controls the proof hash, the claimant cannot contest.

### Severity

**Medium** — Real cost to claimant (locked capital, wasted work), minimal cost to attacker. The absence of a maximum expiry cap is a meaningful gap.

**Recommended additional mitigations:**
1. Add `MAX_EXPIRY_SLOTS` constant (e.g. ~30 days of slots) and enforce it in `commit_probabilistic`.
2. Require an issuer bond (e.g. 1% of committed amount extra) that is slashed and sent to the claimant if the commitment expires unresolved.
3. Document the off-chain dispute mechanism expected for production deployments.

---

## 4. APC Channel Jamming

### Description

An initiator opens many `PaymentChannel` accounts with different counterparties (or the same one), depositing the minimum viable amount, with no intent to settle. Each channel lock up:
- The initiator's deposit (returned at `force_close` after `timeout_slots`)
- The counterparty's time (they may wait for settlement before accepting other work)

With Solana's low transaction fees (~0.000005 SOL), the cost to spam-open channels is trivial.

**Attack flow:**
1. Attacker creates 100s of channels, each with small deposits and long `timeout_slots`.
2. Counterparty agents are saturated with open channels, preventing them from accepting legitimate work.
3. After timeout, attacker calls `force_close` and recovers all deposited funds.

### Capital Required

- **Deposit only** — fully recovered at `force_close`. Net cost ≈ Solana rent for channel PDAs + gas.
- At 0.002 SOL rent per channel PDA × 1000 channels = ~2 SOL (~$200–$400 at current prices). Essentially free.

### Current Mitigations

| Mitigation | Detail |
|---|---|
| Initiator deposit required (`deposit > 0`) | Prevents zero-deposit channels |
| `timeout_slots` per-channel | Limits worst-case lock duration |
| `ChannelStatus` lifecycle | Terminal states (`Settled`, `ForceClose`) prevent infinite loops |
| Feature flag (`FLAG_AGENT_PAYMENT_CHANNEL`) | Authority can disable APC globally |

### Missing Mitigations

- **No minimum deposit enforcement.** The code requires `deposit > 0` but not `deposit >= MIN_DEPOSIT`. A 1-lamport deposit is valid.
- **No per-initiator channel count limit.** An initiator can open unlimited channels.
- **No counterparty consent at open.** The counterparty is named in the channel but does not sign `open_channel` — channels are opened unilaterally.
- **No maximum `timeout_slots` cap.** Analogous to the PBS expiry gap.

### Severity

**Medium** — Channel jamming is more of a DoS against counterparty agents than a direct fund theft, but it degrades the usability of the APC module significantly.

**Recommended additional mitigations:**
1. Add `MIN_CHANNEL_DEPOSIT` constant (e.g. 1 SSS = 1_000_000 micro-units) enforced in `open_channel_handler`.
2. Add `MAX_TIMEOUT_SLOTS` constant (~30 days).
3. Consider requiring counterparty co-signature for channel open, or a counterparty opt-in registry.
4. Add per-initiator channel count tracked in a separate PDA, capped at (e.g.) 50 concurrent channels.

---

## 5. DAO Vote Manipulation

### Description

#### 5a — Whale Veto (Minority Blocks Proposals)

A committee member who controls enough seats to form a blocking minority can vote NO on every proposal (or simply abstain, since YES-only voting means proposals die without quorum). If an attacker controls `members.len() - quorum + 1` seats, all proposals fail.

**Example:** 5-member committee, quorum=3. Attacker controls 3 members → can veto everything (only 2 YES votes possible).

#### 5b — Quorum Capture (Majority Control)

If an attacker controls `quorum` or more committee seats, they can execute any proposal unilaterally — including disabling the circuit breaker, revoking minters, or pausing the protocol.

### Capital Required

- No on-chain capital required — members are `Pubkey` addresses only.
- Cost is social/off-chain: the authority must be convinced to add attacker-controlled keys during `init_dao_committee` or `update_committee` (if such an instruction exists).
- If membership update requires another DAO vote, cost is recursive.

### Current Mitigations

| Mitigation | Detail |
|---|---|
| Duplicate member check (SSS-085 Fix 3) | Prevents quorum bypass by repeated keys |
| Quorum ≥ 1 enforcement | Zero-quorum configs rejected |
| Authority-only `init_dao_committee` | Only the protocol authority can initialise membership |
| On-chain vote tracking | Each member's YES vote is recorded, preventing double-voting |

### Missing Mitigations

- **No timelock on execution.** Once quorum is reached, `execute_action` can be called immediately. A 24–48h timelock on execution would allow the community to react.
- **No vote expiry.** Proposals accumulate votes indefinitely — stale YES votes from months ago can be used to execute future proposals.
- **No minimum quorum as percentage.** If `quorum=1` and `members.len()=1`, a single entity controls all governance.
- **No supermajority requirement for critical actions.** Pausing the protocol or revoking the authority should arguably require a higher threshold than standard actions.

### Severity

**High** — A compromised or colluding committee majority can halt the protocol, change fee parameters, or revoke minters. The absence of an execution timelock is the most critical gap.

**Recommended additional mitigations:**
1. Add a `timelock_slots` parameter to `ProposalPda` — execution not permitted until `created_slot + timelock_slots`.
2. Add proposal expiry (`expiry_slot` on `ProposalPda`) — proposals expire if quorum is not reached within N slots.
3. Require supermajority (e.g. ≥75%) for destructive actions: `PauseProtocol`, `RevokeAuthority`.
4. Enforce minimum quorum as a percentage (e.g. `quorum >= members.len() / 2 + 1`).

---

## 6. Stability Fee / PSM Arbitrage

### Description

The PSM (Peg Stability Module) allows redemption of SSS for collateral at near-peg with a configurable `redemption_fee_bps`. When the SSS market price drifts above or below $1, arbitrageurs can exploit the spread between the PSM redemption rate and the open market price.

**Profitable arbitrage window:**
- If SSS trades at $1.01 on DEX: buy SSS → redeem via PSM at $1.00 minus fee → profit = $0.01 - fee.
- If SSS trades at $0.99: buy collateral cheaply, mint SSS, sell on DEX at $0.99, recover collateral.

This is technically *intended* arbitrage that maintains the peg — but becomes extractive when:
1. Fee is 0 (no friction).
2. Fee is mis-calibrated, allowing repeated round-trips.
3. An attacker with flash liquidity repeatedly cycles large volumes to extract fee-rate × volume from the insurance fund.

**Backstop drain via PSM abuse (related vector):**
If the PSM reserve is depleted by repeated redemptions, it forces bad-debt backstop draws.

### Capital Required

- Near-zero at small scale; pure arbitrage.
- At scale: requires capital proportional to PSM liquidity depth to move the needle.

### Current Mitigations

| Mitigation | Detail |
|---|---|
| `redemption_fee_bps` (0–1000 bps, capped at 10%) | Friction against round-trips |
| Mint velocity limits per minter (`MinterInfo`) | Rate-limits new SSS creation |
| Circuit breaker (`FLAG_CIRCUIT_BREAKER`) | Emergency halt for mint/redeem |

### Missing Mitigations

- **No PSM reserve ratio floor.** Redemptions are not blocked when the PSM reserve drops below a safety threshold.
- **No per-epoch redemption cap.** Unlimited volume can flow through the PSM in a single block.
- **No dynamic fee adjustment.** Fee is static; it should increase as PSM reserves deplete (bonding curve style).
- **`redemption_fee_bps = 0` is a valid config.** Zero-fee deployments are fully vulnerable to arbitrage extraction with zero friction.

### Severity

**Medium** — Peg arbitrage is generally beneficial for stability, but uncapped redemptions with zero fee can drain reserves. The dynamic fee gap is the most important missing piece.

**Recommended additional mitigations:**
1. Add `min_reserve_ratio_bps` to `StablecoinConfig` — block PSM redemptions when reserve drops below this level.
2. Implement a simple dynamic fee: `effective_fee = base_fee + (1 - reserve_ratio) * surge_multiplier`.
3. Add per-epoch (e.g. per-1000-slot) PSM redemption cap tracked on-chain.

---

## 7. Backstop Drain

### Description

The `trigger_backstop` instruction draws from the insurance fund to cover bad debt left after a CDP liquidation. There are two sub-attacks:

#### 7a — Repeated Manufactured Bad Debt

An attacker controls both the CDP owner and the liquidator. They:
1. Open a CDP with collateral.
2. Manipulate collateral price (see Attack 1) just enough to make the CDP appear worthless.
3. Self-liquidate: burn SSS debt tokens, claim collateral back at a discount.
4. The delta between "collateral value at manipulated price" and "true value" may create apparent bad debt.
5. `trigger_backstop` fires, drawing from the insurance fund.
6. Repeat until fund is drained.

#### 7b — Insider Trigger on Fake CDPs

The `trigger_backstop` access control requires `liquidation_authority.key() == config.key()` — only the config PDA (held by the on-chain `cdp_liquidate` handler via CPI) can call this. This is a strong mitigation, but the underlying CDPs must be genuine. An insider who controls a minter could potentially mint SSS into artificial CDP structures to manufacture bad debt.

### Capital Required

- **7a:** Requires sufficient collateral capital to open a meaningful CDP + market manipulation capital (see Attack 1).
- **7b:** Requires compromised minter or authority keys.

### Current Mitigations

| Mitigation | Detail |
|---|---|
| `liquidation_authority == config.key()` constraint | Only the `cdp_liquidate` CPI path can trigger backstop — no direct calls |
| `max_backstop_bps` cap | Limits maximum single draw as a % of `net_supply` |
| `NoBadDebt` / `InsuranceFundEmpty` guards | Backstop fails if nothing to cover or fund is empty |
| Oracle confidence check | Rejects manipulated prices with wide confidence bands |
| `FLAG_CIRCUIT_BREAKER` | Authority can halt liquidations globally |

### Missing Mitigations

- **No daily/epoch draw limit on the insurance fund.** `max_backstop_bps` is a per-call cap relative to net_supply, but there is no total draw limit per epoch. A series of small bad-debt events could drain the fund over time.
- **No CDP minimum collateral value.** An attacker could open many micro-CDPs to generate many small backstop triggers that each stay under monitoring thresholds.
- **No backstop event rate limiting.** Multiple backstop triggers in the same block are not prevented.
- **No insurance fund replenishment mechanism on-chain.** Depletion is unrecoverable without off-chain intervention.

### Severity

**Medium** — The `liquidation_authority == config.key()` CPI constraint is a strong structural protection against direct abuse. The residual risk is the combination of oracle manipulation + manufactured CDPs draining the fund gradually.

**Recommended additional mitigations:**
1. Track cumulative backstop draws in `StablecoinConfig` and add an epoch-level cap (e.g. max 2% of net_supply per 1000 slots).
2. Require minimum CDP size (e.g. minimum `debt_amount` on open) to raise the cost of micro-CDP attacks.
3. Emit a `BackstopWarning` event when the insurance fund drops below 25% of initial balance, to trigger off-chain alerts.

---

## Summary Table

| # | Attack | Severity | Capital Required | Key Current Mitigation | Top Missing Mitigation |
|---|--------|----------|-----------------|----------------------|----------------------|
| 1 | CDP Oracle Manipulation | **High** | $500K–$50M+ | Confidence interval check | TWAP fallback; enforce `max_oracle_conf_bps > 0` |
| 2 | CDP Liquidation Sandwich | **Medium** | Near-zero | Partial liquidation support | Grace period / Dutch auction |
| 3 | PBS Griefing | **Medium** | Opportunity cost | `expiry_slot` enforced | Max expiry cap; issuer bond |
| 4 | APC Channel Jamming | **Medium** | ~$200 SOL rent (fully recovered) | `deposit > 0` required | Minimum deposit constant; per-initiator cap |
| 5 | DAO Vote Manipulation | **High** | Social engineering | Duplicate-key check | Execution timelock; proposal expiry |
| 6 | PSM Arbitrage | **Medium** | Near-zero | Fee cap (10%) | Dynamic fee; reserve floor |
| 7 | Backstop Drain | **Medium** | CDP capital + oracle manipulation | CPI authority constraint | Epoch draw cap; min CDP size |

### Priority Fixes

**Immediate (High severity):**
1. Enforce `max_oracle_conf_bps > 0` in deploy config — never allow 0 (unchecked confidence).
2. Add DAO proposal execution timelock (24–48h minimum for destructive actions).

**Short-term (Medium severity):**
3. Add `MAX_EXPIRY_SLOTS` to PBS `commit_probabilistic`.
4. Add `MIN_CHANNEL_DEPOSIT` and `MAX_TIMEOUT_SLOTS` to APC `open_channel`.
5. Add PSM reserve ratio floor to block redemptions when reserves are critically low.
6. Track epoch-level backstop draw limit on `StablecoinConfig`.

---

*This document reflects the codebase as of commit `ca4a9e3` (2026-03-22). All line-number references are approximate and should be re-verified against the latest source.*

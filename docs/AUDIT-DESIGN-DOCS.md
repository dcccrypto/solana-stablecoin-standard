# AUDIT-DESIGN-DOCS.md — Design Risk & Spec-vs-Implementation Audit

_Areas G (Stablecoin design risks + spec vs implementation gap) and H (Deployment and upgradeability)_
_Author: sss-docs | Date: 2026-03-24 | Cites exact files._

---

## AREA G — Stablecoin Design Risks + Spec vs Implementation Gap

---

### G1. Proof of Reserves: Is it on-chain enforceable or merely attestational?

**Verdict: Attestational. Not enforceable.**

**Evidence:** `programs/sss-token/src/instructions/proof_of_reserves.rs`

The `submit_reserve_attestation` instruction stores a `reserve_amount` (u64) and a 32-byte `attestation_hash` into the `ProofOfReserves` PDA. The number is supplied by the attestor — the program **does not verify that this number reflects any actual on-chain vault balance.** There is no vault balance cross-check anywhere in the instruction.

- `verify_reserve_ratio` computes a ratio from the stored `reserve_amount` vs `config.net_supply()`. It emits a `ReserveBreach` event if below threshold — but **does not halt minting, freeze the mint, or revert any transaction.**
- Any account in `config.reserve_attestor_whitelist` (up to 4 pubkeys, set by `authority`) may submit any number as the reserve.
- The `attestation_hash` is stored but never verified on-chain. It is a commitment to an off-chain document.

**Doc claims vs reality:**

| Claim | File | Reality |
|---|---|---|
| "verifiable, tamper-evident record" | `docs/RESERVE-REPORTING.md:5` | The record is tamper-evident (PDA-stored, emits events) but **not verified** — the number is self-reported |
| "trustless on-chain PoR attestation" | `programs/sss-token/src/state.rs:650` (comment) | Misleading: no trustless verification occurs. Authority-controlled whitelist submits numbers |
| "machine-verifiable" (implied by on-chain storage) | `docs/RESERVE-REPORTING.md` generally | **Not machine-verifiable.** No on-chain vault exists whose balance is checked |

**Risk:** An issuer or compromised attestor can submit an inflated reserve number. No on-chain mechanism halts minting on breach — only an off-chain event is emitted.

---

### G2. Redemption Guarantee: Is it on-chain enforceable?

**Verdict: Partially enforceable — with a critical trust gap on the reserve vault.**

**Evidence:** `programs/sss-token/src/instructions/redemption_guarantee.rs`

The request/escrow/fulfill flow is real on-chain logic:
- `request_redemption` locks stable tokens in a PDA escrow. Daily limit enforced on-chain.
- `fulfill_redemption` transfers escrow → burn_dest and reserve_vault → user. SLA window (default 450 slots ≈ 3 min) enforced on-chain.
- `claim_expired_redemption` returns stable tokens + 10% penalty from insurance fund if SLA breached.

**Critical gap:** `fulfill_redemption` requires the `fulfiller` signer to have authority over `reserve_vault`. The program validates `reserve_vault.key() == redemption_guarantee.reserve_vault` but uses `fulfiller` as the token transfer authority — **there is no on-chain enforcement that the fulfiller is the config authority or a trusted keeper.** Any holder of the reserve vault token account authority key can fulfill (or not fulfill) redemptions. If the reserve vault is underfunded, `fulfill_redemption` will simply fail with an SPL token error (insufficient funds) — the user gets no automatic recourse except `claim_expired_redemption`.

**SLA breach penalty:** Enforced on-chain only if `insurance_fund_pubkey != default`. If unconfigured (`SssError::InsuranceFundNotConfigured`), the expired-redemption path reverts. The docs (`docs/REDEMPTION-GUARANTEE.md`) do not prominently disclose this dependency.

**Doc claim:** "on-chain redemption guarantee at par" (SSS-125, `docs/REDEMPTION-GUARANTEE.md`).
**Reality:** Guarantee is conditional on (a) reserve vault being funded, (b) a fulfiller bot being live within the SLA window, (c) insurance fund being configured. **Not automatic.**

---

### G3. "Trustless" framing — is it justified?

**Verdict: Partially. Use is inconsistent; some instances are unjustified.**

Instances found:

| Location | Claim | Assessment |
|---|---|---|
| `docs/SSS-3.md:233` | "doesn't require trusting any issuer, oracle, or off-chain system" | **Unjustified.** PoR is attestational (G1). Minter cap = 0 means unlimited supply (G4). Reserve vault funded off-chain. |
| `docs/SSS-3.md:235` | "trustless on-chain collateral" | **Partially justified** for SSS-3 collateral vault (deposit/redeem via on-chain vault). **Not justified** for fiat-backed issuers using PoR. |
| `programs/sss-token/src/state.rs:650` (comment) | "trustless on-chain PoR attestation" | **Unjustified.** See G1. |
| `programs/sss-token/src/instructions/pbs.rs:3` (comment) | "trustless pay on proof" | **Justified.** PBS locking is fully on-chain. |
| `programs/sss-token/src/instructions/apc.rs:3` (comment) | "trustless payment channels" | **Justified.** APC channel logic is fully on-chain. |
| `docs/TECH-SPIKE-DIRECTIONS.md:262` | "trustless path" for WASM prover | **Justified** in context of ZK proof generation. |

**Recommendation:** Remove "trustless" from PoR and SSS-3 marketing text unless SSS-3 is deployed in fully collateral-backed mode (on-chain vault, zero off-chain reserves). Add a "Trust Model" section to `docs/SECURITY.md`.

---

### G4. Supply inflation — uncapped mint paths?

**Verdict: Yes. `max_supply = 0` means unlimited. Per-minter caps are optional.**

**Evidence:** `programs/sss-token/src/instructions/mint.rs:88` and `programs/sss-token/src/instructions/initialize.rs:161`

```rust
// initialize.rs
config.max_supply = params.max_supply.unwrap_or(0);

// mint.rs
if config.max_supply > 0 {
    require!(config.net_supply().checked_add(amount) <= config.max_supply, ...);
}
// If max_supply == 0 → no cap check performed.

if minter_info.cap > 0 {
    require!(minter_info.minted.checked_add(amount) <= minter_info.cap, ...);
}
// If cap == 0 → no per-minter cap enforced.
```

- `authority` can call `update_minter` to set `cap = 0` on any minter at any time → unlimited minting for that minter.
- `authority` can register new minters at will.
- No on-chain timelock gates minter registration or cap changes (unless `admin_timelock_delay > 0` is configured, which is optional — `update_roles.rs:29`).

**Risk:** If `max_supply = 0` and `cap = 0` for any registered minter, supply can be inflated without bound by the authority or any registered minter. For SSS-3 (collateral-backed), this would break the 1:1 peg. For fiat-backed (SSS-1/2), this is an admin trust risk.

**Doc claim:** `docs/SSS-3.md` implies supply is bounded by collateral. Reality: the mint instruction does not cross-check `total_minted` against `total_collateral` in the `StablecoinConfig` — supply and collateral can diverge.

---

### G5. Reserve composition — machine-verifiable or admin-submitted?

**Verdict: Admin-submitted. Not machine-verifiable.**

**Evidence:** `docs/RESERVE-REPORTING.md:39–44,110`

The `update_reserve_composition` instruction is callable by **stablecoin authority only** (not even the attestor whitelist). The four buckets (cash_bps, t_bills_bps, crypto_bps, other_bps) must sum to 10,000 bps — that sum check is on-chain. But the **values themselves are arbitrary inputs** from the authority. There is no on-chain vault or oracle verifying that 40% of reserves are actually T-bills.

`docs/RESERVE-REPORTING.md:110` (comment in doc): "the composition reflects the issuer's declared policy" — this is accurate and honest in the doc. The risk is that the README and marketing material describe this as "verifiable" without this qualification.

**Assessment: PARTIALLY IMPLEMENTED / ASPIRATIONAL.** The on-chain record is tamper-evident and auditable, but the figures are self-reported.

---

### G6. Spec vs Implementation Gap Table

| Doc Claim | File | Status | Notes |
|---|---|---|---|
| Proof of Reserves — on-chain enforceable | `docs/PROOF-OF-RESERVES.md`, `state.rs:650` | ⚠️ PARTIALLY / ASPIRATIONAL | Attestational only; no vault cross-check; breach emits event but doesn't halt |
| Redemption guarantee at par, automatic | `docs/REDEMPTION-GUARANTEE.md` | ⚠️ PARTIALLY | On-chain escrow + SLA exist; but requires live fulfiller bot + funded vault + configured insurance fund |
| Trustless reserve-backed (SSS-3) | `docs/SSS-3.md:233–235` | ⚠️ ASPIRATIONAL for fiat issuers | True for on-chain collateral vault (SSS-3 redeem); false if PoR attestation model used |
| Supply bounded by collateral (SSS-3) | `docs/SSS-3.md` (implied) | ❌ NOT IMPLEMENTED | No mint.rs check against collateral; max_supply=0 removes all caps |
| Reserve composition machine-verifiable | `docs/RESERVE-REPORTING.md` | ⚠️ ASPIRATIONAL | On-chain storage is tamper-evident but values are self-reported |
| Per-wallet rate limiting (SSS-133) | `docs/WALLET-RATE-LIMIT.md` | ✅ FULLY IMPLEMENTED | `WalletRateLimit` PDA, rolling window enforced in transfer hook |
| Guardian pause (SSS-121) | `docs/GUARDIAN-PAUSE.md` | ✅ FULLY IMPLEMENTED | `pause`/`unpause` instructions exist; `MintPaused` error in mint/burn |
| Minter velocity limits (SSS-093) | `docs/RESERVE-REPORTING.md` / mint.rs | ✅ FULLY IMPLEMENTED | epoch velocity tracked in `minter_info.minted_this_epoch` |
| Admin timelock on authority transfer | `docs/on-chain-sdk-admin-timelock.md` | ✅ FULLY IMPLEMENTED | `admin_timelock_delay` in config; `update_roles.rs:29` enforces it |
| Two-step authority transfer | `docs/ARCHITECTURE.md` | ✅ FULLY IMPLEMENTED | `pending_authority` → `accept_authority` flow |
| CDP multi-collateral borrowing | `docs/on-chain-sdk-cdp.md` | ✅ FULLY IMPLEMENTED | `cdp_deposit_collateral`, `cdp_borrow_stable` in programs |
| ZK credentials / confidential transfers | `docs/ZK-CREDENTIALS.md`, `docs/on-chain-sdk-zk.md` | ⚠️ PARTIALLY | Token-2022 confidential transfer infra exists; full ZK credential issuance = aspirational per spike docs |
| Formal TLA+ spec matches implementation | `docs/FORMAL-SPEC.md`, `specs/sss.tla` | ⚠️ PARTIALLY | Spec covers core invariants; does not model PoR attestation gap, uncapped mint path, or insurance fund dependency |
| MICA compliance enforcement | `docs/MICA-COMPLIANCE.md` | ⚠️ ASPIRATIONAL | `check-mica-compliance.ts` script is a linter; on-chain program has no MICA-specific instruction gating |
| Sanctions oracle blocking transfers | `docs/SANCTIONS-ORACLE.md` | ⚠️ PARTIALLY | Transfer hook integration documented; oracle feed staleness enforcement aspirational |
| Travel Rule backend API | `docs/TRAVEL-RULE.md` | ⚠️ PARTIALLY | Backend API described; on-chain enforcement = freeze-based (compliance authority must act) |

---

## AREA H — Deployment and Upgradeability

---

### H1. Who holds upgrade authority?

**Evidence:** `docs/DEPLOYMENT-GUIDE.md` (Section 6), `docs/UPGRADE-GUIDE.md`

The program is an Anchor/BPF upgradeable program. On initial deploy, the deployer keypair holds upgrade authority. **On mainnet, the deployment guide mandates transferring upgrade authority to a Squads multisig** (`docs/DEPLOYMENT-GUIDE.md` Section 6b):

```bash
solana program set-upgrade-authority <SSS_TOKEN_PROGRAM_ID> \
  --new-upgrade-authority <SQUADS_MULTISIG_PUBKEY>
```

The guide mentions `--final` to make the program immutable, but does not recommend it as the default. **There is no on-chain enforcement that the transfer has happened** — it is a deployment checklist item.

**Risk:** If the deployer keypair is not transferred, a single key can upgrade the program unilaterally. No timelock or governance approval is enforced at the BPF loader level.

---

### H2. Is there an unsafe_upgrade or set_upgrade_authority path in the program itself?

**Verdict: No.** There is no custom instruction that calls `BpfUpgradeableLoader::SetUpgradeAuthority` or performs program-level upgrade. The upgrade path uses standard Solana BPF loader mechanics (`anchor upgrade` / `solana program deploy`).

The only upgrade-adjacent instruction is `migrate_config` (`programs/sss-token/src/instructions/upgrade.rs`) — this migrates the `StablecoinConfig` PDA schema, not the program binary. It is authority-gated and idempotent. **Safe.**

---

### H3. Can the program be upgraded without timelock?

**Verdict: Yes, unless Squads multisig enforces a timelock.**

The SSS program itself has no on-chain timelock on BPF upgrades. The `admin_timelock_delay` field in `StablecoinConfig` applies only to **authority transfer proposals** (calling `update_roles`), not to program binary upgrades.

BPF upgrade timelocks must be enforced by the multisig tooling (e.g., Squads v4 time-locks). The docs recommend Squads but do not mandate a minimum timelock value. **This is a deployment configuration risk, not a code bug.**

---

### H4. What happens to existing token accounts on upgrade?

**Evidence:** `docs/UPGRADE-GUIDE.md`

Token-2022 mint accounts are **not touched** by `migrate_config`. The guide explicitly states: "Token-2022 mint accounts must NOT be re-initialized." Existing CDPs, vaults, minter records, and ATAs continue working unchanged during and after program upgrade.

The version gate (`config.version >= MIN_SUPPORTED_VERSION`) blocks `mint`/`burn`/`cdp_borrow_stable` until `migrate_config` is called — users cannot mint or borrow during the migration window, but **existing balances and ATAs are safe.** Redemptions via `redeem` (SSS-3 collateral path) should also be checked for version gate coverage.

**Minor gap:** `docs/UPGRADE-GUIDE.md` does not list which instructions are blocked by the version gate. Users needing to redeem during a migration window are not warned.

---

### H5. Summary of Upgrade Risk

| Risk | Severity | Mitigated? |
|---|---|---|
| Single-key upgrade authority if transfer not done | **HIGH** | By deployment checklist only — not enforced on-chain |
| No BPF-level upgrade timelock in program | **MEDIUM** | Squads multisig recommended but not enforced |
| `migrate_config` accessible post-deployment (idempotent) | **LOW** | Safe: no-op if already migrated; authority-gated |
| User funds at risk during migration window | **LOW** | Balances safe; only new mint/borrow blocked |
| Program immutability not default | **MEDIUM** | `--final` flag documented but optional |

---

## Summary — Critical Findings

1. **PoR is attestational, not enforceable.** Breach emits an event but does not halt minting. "Trustless" framing in `docs/SSS-3.md:233` is unjustified for fiat-backed issuers.
2. **Supply can be uncapped.** `max_supply = 0` + `cap = 0` → unlimited minting by authority. No on-chain crosscheck against collateral in SSS-3 mint path.
3. **Redemption guarantee requires live infrastructure.** Not automatic: depends on funded vault, live fulfiller, configured insurance fund.
4. **Upgrade authority transfer is a checklist item, not on-chain enforced.** A missed transfer leaves single-key upgrade control.
5. **Reserve composition is self-reported.** Tamper-evident on-chain record, but figures are authority-supplied with no vault verification.

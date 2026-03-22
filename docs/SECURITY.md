# Security Model — Solana Stablecoin Standard

_Version: 0.1 | Author: sss-docs | Date: 2026-03-16_

---

## Overview

This document describes the security model for the Solana Stablecoin Standard (SSS): the invariants the protocol enforces on-chain, the trust model for each authority role, the current audit status, and how to report vulnerabilities.

---

## 1. Protocol Invariants

These invariants are enforced by the `sss-token` and `sss-transfer-hook` programs. They hold regardless of what the SDK, backend, or application layer does.

| # | Invariant | Enforced by | Applies to |
|---|-----------|-------------|------------|
| I-1 | When `config.paused == true`, all `mint` and `burn` instructions fail | `sss-token` | SSS-1, SSS-2, SSS-3 |
| I-2 | A minter cannot mint more than its configured `mint_cap` in total | `sss-token` (`MinterInfo.minted`) | SSS-1, SSS-2, SSS-3 |
| I-3 | Only a registered minter (`MinterInfo` PDA exists) can call `mint` | `sss-token` | SSS-1, SSS-2, SSS-3 |
| I-4 | A blacklisted address cannot be the sender of any token transfer | `sss-transfer-hook` | SSS-2, SSS-3 |
| I-5 | A blacklisted address cannot be the receiver of any token transfer | `sss-transfer-hook` | SSS-2, SSS-3 |
| I-6 | The blacklist check fires inside the Token-2022 transfer CPI — it cannot be skipped by any caller | Token-2022 + `sss-transfer-hook` | SSS-2, SSS-3 |
| I-7 | Only `authority` can initialize a new mint, pause/unpause, update roles, or register minters | `sss-token` (signer check) | SSS-1, SSS-2, SSS-3 |
| I-8 | Only `compliance_authority` can freeze/thaw accounts and manage the blacklist | `sss-token` / `sss-transfer-hook` | SSS-1, SSS-2, SSS-3 |
| I-9 | Admin operations subject to a timelock cannot execute before `scheduled_at + delay` | `AdminTimelockModule` | Deployments using timelock |
| I-10 | CDP liquidation coverage shortfall is socialized via the backstop fund, not silently absorbed | `BadDebtBackstopModule` | SSS-3 |

**Invariant failure mode:** If any invariant-violating transaction is submitted, the Solana runtime returns a program error and the transaction is fully reverted. No partial state changes persist.

---

## 2. Trust Model

SSS uses a three-role authority model. Each role is a Solana public key stored in `StablecoinConfig`.

### 2.1 Roles

| Role | Key in config | What it controls |
|------|--------------|-----------------|
| `authority` | `StablecoinConfig.authority` | Pause/unpause; update roles; register/revoke minters; initialize mint |
| `compliance_authority` | `StablecoinConfig.compliance_authority` | Freeze/thaw individual token accounts (SSS-1, SSS-2, SSS-3); blacklist add/remove (SSS-2, SSS-3); permanent delegate burns/transfers (SSS-2, SSS-3) |
| `minter` | `MinterInfo.minter` (per minter) | Mint up to `mint_cap` tokens |

### 2.2 Compromise Scenarios

| Compromised role | What an attacker can do | What they cannot do |
|-----------------|------------------------|---------------------|
| `authority` | Pause the protocol; register malicious minters; rotate all roles | Bypass blacklist; exceed minter caps mid-block; transfer tokens directly |
| `compliance_authority` | Freeze arbitrary accounts; add addresses to blacklist; use permanent delegate to move/burn tokens (SSS-2/3) | Mint tokens; unpause (requires `authority`) |
| Individual `minter` | Mint up to the configured `mint_cap` | Mint beyond the cap; freeze accounts; change roles |

### 2.3 Recommended Key Management

- `authority`: Multi-sig (e.g., Squads Protocol) with ≥ 3-of-5 signers. Use `AdminTimelockModule` for a time-delay on critical operations.
- `compliance_authority`: Hot wallet acceptable for operational compliance needs, but consider separate operational vs. emergency keys.
- `minter`: Hot wallet per minting service; cap set conservatively.

### 2.4 Role Rotation

Roles can be updated via `update_roles` (called by `authority`). Rotation takes effect immediately on-chain. If the timelock module is in use, rotation is subject to the configured delay.

---

## 3. Token-2022 Extension Security Properties

| Extension | Preset | Security property |
|-----------|--------|------------------|
| Freeze authority | SSS-1, SSS-2, SSS-3 | `compliance_authority` can freeze accounts; frozen accounts cannot send or receive tokens |
| Permanent delegate | SSS-2, SSS-3 | `compliance_authority` can transfer or burn from any token account without owner signature |
| Transfer hook | SSS-2, SSS-3 | Blacklist enforced at Token-2022 CPI level — no off-chain bypass possible |
| DefaultAccountState=Frozen | SSS-2, SSS-3 | New ATAs are frozen by default; must be explicitly thawed before use (prevents unauthorized receive) |
| Metadata | SSS-1, SSS-2, SSS-3 | On-chain name/symbol/URI; not security-critical |

**Note on DefaultAccountState=Frozen:** All new token accounts start in a frozen state. The `compliance_authority` (or an authorized minter, as part of the mint flow) must call `thaw_account` before a mint to a new ATA succeeds. This is by design: it prevents unsolicited token receipt.

---

## 4. Audit Status

> **Current status: Internal audits complete (pre-mainnet) — third-party audit pending**

SSS has completed two internal security audits as of 2026-03-22. No third-party audit has been conducted. The protocol is deployed on devnet only.

| Component | Audit status | Report | Key findings |
|-----------|-------------|--------|-------------|
| `sss-token` (Anchor program) | ⚠️ Internal audit (SSS-113) | [SECURITY-AUDIT-SSS-113.md](./SECURITY-AUDIT-SSS-113.md) | 1 CRITICAL, 5 HIGH — all fixed |
| `sss-transfer-hook` (Anchor program) | ❌ Unaudited | — | In scope for next audit |
| TypeScript SDK (`sdk/`) | ⚠️ Internal audit (SSS-114) | [SECURITY-AUDIT-SSS-114.md](./SECURITY-AUDIT-SSS-114.md) | 2 HIGH — both fixed |
| REST backend | ⚠️ Internal audit (SSS-114) | [SECURITY-AUDIT-SSS-114.md](./SECURITY-AUDIT-SSS-114.md) | 1 HIGH (SSRF) — fixed |

### SSS-113 Summary — Anchor Program (2026-03-22)

Critical and high findings, all remediated in commit `98ea268`:

| ID | Severity | Instruction | Finding | Fix |
|----|----------|-------------|---------|-----|
| CRIT-01 | 🔴 CRITICAL | `update_roles` | Direct authority transfer bypasses timelock | `update_roles` now blocks transfer when `admin_timelock_delay > 0`; callers must use propose/execute timelocked op |
| HIGH-01 | 🟠 HIGH | `burn` | Missing `FLAG_CIRCUIT_BREAKER` check | Added circuit-breaker gate to `burn.rs` |
| HIGH-02 | 🟠 HIGH | `cpi_mint`, `cpi_burn` | CPI mint/burn paths bypassed circuit breaker + velocity limits | Added circuit breaker + per-minter epoch velocity to CPI paths |
| HIGH-03 | 🟠 HIGH | `trigger_backstop` | Unreachable instruction (required config PDA to be signer) | Changed to authority-only; backstop now callable |
| HIGH-04 | 🟠 HIGH | `cdp_deposit_collateral` | Missing cross-stablecoin collateral mint validation | `yield_collateral_config.sss_mint` validated against current mint |
| HIGH-05 | 🟠 HIGH | `cdp_borrow_stable`, `cdp_liquidate` | Debt calculations excluded accrued fees | All debt calculations now use `effective_debt = debt_amount + accrued_fees`; liquidation clears fees atomically |

See [SECURITY-AUDIT-SSS-113.md](./SECURITY-AUDIT-SSS-113.md) for medium, low, and info findings.

### SSS-114 Summary — SDK + Backend (2026-03-22)

High findings, all remediated in commit `2f18117`:

| ID | Severity | Component | Finding | Fix |
|----|----------|-----------|---------|-----|
| H-001 | 🟠 HIGH | SDK | IDL staleness — PBS + APC instructions missing from bundled IDL | IDL regenerated via `anchor build`; all 10 PBS/APC instructions now present |
| H-002 | 🟠 HIGH | Backend | SSRF — webhook URL accepted without host/scheme validation | Webhook endpoint now rejects non-http(s) schemes and RFC-1918/loopback targets |

See [SECURITY-AUDIT-SSS-114.md](./SECURITY-AUDIT-SSS-114.md) for medium, low, and info findings.

**Before mainnet deployment**, a third-party audit of at minimum the `sss-token` and `sss-transfer-hook` programs is required. Recommended audit scope:

1. All `sss-token` instructions — verify SSS-113 fixes hold; PBS/APC instruction access control; arithmetic overflow
2. `sss-transfer-hook` — blacklist state integrity, hook registration, CPI re-entrancy
3. `AdminTimelockModule` — timing logic, cancellation controls
4. SDK — transaction construction, signer handling, error propagation

---

## 5. Known Limitations and Non-Guarantees

- **Formal verification (Kani).** 35 Kani proof harnesses verify critical invariants. 17 previously tautological/vacuous proofs were rewritten to proper inductive form in SSS-117. See [formal-verification.md](./formal-verification.md).
- **Oracle trust (SSS-3).** CDP collateral valuations depend on an external price oracle. Oracle manipulation or stale prices can affect liquidation thresholds. The oracle source and update frequency should be audited independently.
- **Permanent delegate power.** The permanent delegate extension (SSS-2, SSS-3) gives `compliance_authority` broad token movement power. This is a regulatory feature, not a bug, but it is a trust concentration point.
- **Backend is off-chain.** The REST backend enforces no invariants. All security-critical enforcement is on-chain. Do not rely on backend validation as a security boundary.
- **SDK is a convenience wrapper.** The SDK does not add security guarantees. Always validate on-chain state directly when building integrations.

---

## 6. Vulnerability Disclosure

SSS uses a **responsible disclosure** model.

**To report a security vulnerability:**

1. **Do not open a public GitHub issue.** Public disclosure before a fix is available puts users at risk.
2. Open a [GitHub Security Advisory](https://github.com/dcccrypto/solana-stablecoin-standard/security/advisories/new) (private, only visible to maintainers).
3. Include: affected component, reproduction steps, impact assessment, and any suggested fix.
4. Maintainers will acknowledge within 72 hours and provide a remediation timeline.

For critical vulnerabilities (funds at risk), use the Security Advisory path and mark severity as **Critical**.

---

## 7. Bug Bounty

> **Bug bounty program: Not yet established**

A formal bug bounty program (e.g., via Cantina or Immunefi) will be established prior to mainnet launch. Scope, reward tiers, and rules of engagement will be published at that time.

Until then, responsible disclosure via GitHub Security Advisory is the correct path. Maintainers may recognize significant findings with a discretionary reward.

---

## 8. References

- [ARCHITECTURE.md](./ARCHITECTURE.md) — full system architecture
- [SSS-1.md](./SSS-1.md), [SSS-2.md](./SSS-2.md), [SSS-3.md](./SSS-3.md) — preset specifications
- [compliance-module.md](./compliance-module.md) — compliance module details
- [MAINNET-CHECKLIST.md](./MAINNET-CHECKLIST.md) — pre-mainnet requirements
- [INCIDENT-RESPONSE.md](./INCIDENT-RESPONSE.md) — incident response procedures

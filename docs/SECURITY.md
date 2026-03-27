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

> **Current status: Unaudited (pre-mainnet)**

SSS has not undergone a formal third-party security audit as of 2026-03-16. The protocol is in active development and has not been deployed to mainnet.

| Component | Audit status | Notes |
|-----------|-------------|-------|
| `sss-token` (Anchor program) | ❌ Unaudited | Devnet only |
| `sss-transfer-hook` (Anchor program) | ❌ Unaudited | Devnet only |
| TypeScript SDK (`sdk/`) | ❌ Unaudited | — |
| REST backend | ⚠️ Internal audit (SSS-AUDIT3-C) | See below |

**Before mainnet deployment**, a full audit of at minimum the `sss-token` and `sss-transfer-hook` programs is required. Recommended audit scope:

1. All `sss-token` instructions — access control, arithmetic overflow, PDA derivation correctness
2. `sss-transfer-hook` — blacklist state integrity, hook registration, CPI re-entrancy
3. `AdminTimelockModule` — timing logic, cancellation controls
4. SDK — transaction construction, signer handling, error propagation

### 4.1 SSS-AUDIT3-C: Backend Deep Audit (2026-03-27)

An internal deep audit of all backend code added in the SSS-127–SSS-154 batch was completed on 2026-03-27. **1 HIGH, 4 MEDIUM, 4 LOW** findings identified; 4 areas passed clean. Admin role separation (BUG-033) has been implemented in PR #316.

| Severity | Count | Key finding |
|----------|-------|-------------|
| HIGH | 1 | Travel Rule VASP forgery via indexer (AUDIT3C-H1) |
| MEDIUM | 4 | Monitoring sanctions coverage gap, alert injection, travel rule data leak, insurance vault monitoring |
| LOW | 4 | Unbounded DLQ, retry TOCTOU (mitigated), unauth metrics endpoint (intentional), sanctions event validation |
| PASS | 4 | Reconciliation, DAO quorum, admin route auth, sanctions oracle injection |

Full findings and fix specifications: [AUDIT3C-SUMMARY.md](./AUDIT3C-SUMMARY.md).

---

## 5. Known Limitations and Non-Guarantees

- **No formal verification.** The programs have not been formally verified (TLA+, Coq, Isabelle/HOL). The test suite provides coverage but not formal correctness proofs.
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
- [HOOK-MONITORING.md](./HOOK-MONITORING.md) — transfer hook program monitoring and alerting

---

## 9. Transfer Hook Fail-Open Risk (BUG-023)

> **Severity: MEDIUM** — Documented risk; not currently exploitable with correct deployment, but requires active monitoring.

### 9.1 The Risk

SSS-2 and SSS-3 mints enforce compliance checks (blacklist, sanctions, ZK credentials, wallet rate limits) via a Token-2022 transfer hook registered at `sss-transfer-hook` program ID `phAtzRyRUJGpMC3ftAtWzoaX7UkghRe9x5KTig8jPQp`.

Token-2022's hook dispatch has two fail-open conditions:

| Condition | What happens | Compliance impact |
|-----------|-------------|-------------------|
| The `sss-transfer-hook` program account does not exist on-chain | Token-2022 skips the hook silently | ALL compliance checks (blacklist, sanctions, ZK, rate limits) stop firing |
| The hook program was upgraded with a bad binary that does not export the `Execute` discriminator | Hook is called but returns immediately with `Ok(())` | Same as above |

This is a **property of the Token-2022 runtime**, not a bug in SSS code. However, it means that if the hook program is ever undeployed or fatally corrupted, the mint continues to allow transfers with no compliance enforcement.

### 9.2 Current Mitigations

The following safeguards reduce the probability and impact of this risk:

1. **Upgrade authority is a Squads multisig** (FLAG_SQUADS_AUTHORITY). No single key can unilaterally upgrade or close the hook program.
2. **The `ExtraAccountMetaList` PDA is owned by the hook program** — any attempt to overwrite it via a bad upgrade would fail the PDA ownership check.
3. **The `BlacklistState` PDA is initialized at hook setup** — a redeployed hook program at the same program ID inherits the existing blacklist state via PDA re-derivation (PDAs are independent of program binary).
4. **FLAG_SANCTIONS_ORACLE and FLAG_WALLET_RATE_LIMITS are fail-closed** — if their respective PDAs are omitted from `remaining_accounts`, the hook rejects the transfer (not silently skipped). This protects against *caller omission* but not against a completely absent hook program.

### 9.3 Residual Risk

If the hook program binary at `phAtzRyRUJGpMC3ftAtWzoaX7UkghRe9x5KTig8jPQp` is absent or non-functional:
- All token transfers succeed without compliance checks.
- The blacklist, sanctions oracle, ZK credentials, and wallet rate limits are all bypassed.
- Frozen accounts can still not transfer (Token-2022 freeze authority is independent of hooks).
- The `DefaultAccountState=Frozen` extension still requires explicit `thaw_account` before new ATAs can receive.

**Worst-case scenario:** An attacker who could unilaterally close or corrupt the hook program (requiring compromise of the Squads multisig) could move tokens from sanctioned or blacklisted addresses until the incident is detected and the program redeployed.

### 9.4 Recommended Mitigations

#### Operational

1. **Continuous hook program existence monitoring** — Run a validator node or off-chain monitor that polls `getAccountInfo(hook_program_id)` every epoch. Alert immediately if the account disappears or the `executable` flag becomes false. See [HOOK-MONITORING.md](./HOOK-MONITORING.md) for implementation guidance.

2. **Automated upgrade smoke test** — After any hook program upgrade, run the SSS integration test suite against the deployed program ID (devnet/mainnet-beta) within one hour. Confirm the Execute discriminator is still reachable.

3. **On-call escalation path** — Define a pager-duty flow: if hook program monitoring fires, the on-call engineer's first action is to pause the mint (`authority.pause()`) and open a Squads proposal to redeploy the hook binary.

#### On-Chain (future work)

4. **Self-check instruction** — Add a `verify_hook_live()` instruction to `sss-token` that performs `getAccountInfo` on the hook program ID via CPI to System Program and returns an error if the program is absent. This can be called by monitoring bots or integrated into periodic crank transactions.

5. **Fail-closed default initialization** — For new deployments: initialize the `ExtraAccountMetaList` with a sentinel extra account that always resolves to a non-existent PDA. If Token-2022 resolves the account list and the sentinel is missing, the transfer fails. This inverts the default from fail-open to fail-closed at the cost of requiring the sentinel to be passed by all callers. Evaluate for SSS-4 preset.

### 9.5 Hook Program Account Details

| Field | Value |
|-------|-------|
| Hook program ID | `phAtzRyRUJGpMC3ftAtWzoaX7UkghRe9x5KTig8jPQp` |
| Upgrade authority | Squads multisig (via FLAG_SQUADS_AUTHORITY) |
| ExtraAccountMetaList PDA | `[b"extra-account-metas", mint_pubkey]` |
| BlacklistState PDA | `[b"blacklist-state", mint_pubkey]` |
| Monitoring cadence | Every epoch (~2 days) minimum; every slot recommended for mainnet |

### 9.6 Incident Response

If hook program monitoring fires:

1. **T+0 min**: Page on-call engineer.
2. **T+5 min**: On-call calls `authority.pause()` via Squads UI. Mint is paused — no new mints/burns. Existing frozen accounts remain frozen.
3. **T+15 min**: Squads proposal created to redeploy hook binary from verified build.
4. **T+60 min**: Proposal reaches quorum, hook redeployed. Integration tests run.
5. **T+90 min**: On-call calls `authority.unpause()` after tests pass.
6. **Post-incident**: Review all transfers during the outage window for compliance violations.

See [INCIDENT-RESPONSE.md](./INCIDENT-RESPONSE.md) for the full incident response playbook.

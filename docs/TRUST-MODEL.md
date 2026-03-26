# TRUST-MODEL.md — Real Trust Assumptions per SSS Tier

> **Purpose:** This document gives an accurate description of what IS and IS NOT trustless at each tier of the Solana Stablecoin Standard (v1). SSS-3's collateral ratio enforcement is genuinely trustless — the on-chain math cannot be bypassed. Reserve attestation and some governance ops require trusting specific keypairs. Integrators, auditors, and users should read this before relying on any SSS-tier guarantee.

---

## SSS-1 — Minimal (Centralized)

| What you trust | Why |
|---|---|
| **Issuer keypair** | Mints, burns, and sets all parameters. No on-chain constraints. |
| **Operator deployment** | Single keypair assumed; BPF upgrade authority not time-locked. |

**Bottom line:** SSS-1 is fully custodial. Trust the issuer entirely.

---

## SSS-2 — Compliant (Regulated)

| What you trust | Why |
|---|---|
| **Issuer keypair** | All SSS-1 trust, plus controls compliance flags. |
| **Compliance oracle / transfer hook** | Blocklist/allowlist decisions made by the operator's data. |
| **Regulatory jurisdiction** | Off-chain AML/KYC enforcement. |

**Bottom line:** SSS-2 adds regulatory process accountability; no reduction in technical trust.

---

## SSS-3 — Reserve-Backed (Trust-Minimized, NOT Fully Trustless)

> ⚠️ **SSS-3 is trust-minimized, not fully trustless.** The authority keypair is required for governance operations. It is constrained by timelocks (432k slots ≈ 48 hours) and, when FLAG_DAO_COMMITTEE is active, by on-chain committee governance. A future version will require Squads multisig (SSS-147).

### What IS enforced on-chain (v1)

- **Collateral ratio check:** `mint` instruction verifies `(total_minted - total_burned + amount) ≤ total_collateral` before accepting a mint. Collateral amount is read from program state.
- **`deposit_collateral` / `redeem` flows** update program state atomically.
- **CDP per-user vaults** with Pyth price feed collateral valuation.
- **Admin timelock (BUG-010):** All privileged authority ops are delayed by a minimum of `admin_timelock_delay` slots (default 432,000 slots ≈ 48 hours). This covers authority transfer, feature flag changes, oracle config, stability fee, PSM fee, backstop params, spend limits, compliance authority transfer, pause/unpause, and more. See `admin_timelock.rs` for the full list.
- **DAO committee governance (FLAG_DAO_COMMITTEE):** When active, admin operations (pause, feature flags, minter changes) require an on-chain proposal to pass quorum from registered committee members. Any committee member OR the authority may propose (BUG-011 fix). FLAG_DAO_COMMITTEE itself cannot be cleared via the direct authority path or timelock — only via a DAO proposal (DaoFlagProtected guard).
- **Supply cap locked (SSS-147):** SSS-3 requires `max_supply > 0` at initialize time, and `supply_cap_locked = true` is written to the config PDA. This prevents post-deploy expansion of the supply cap.
- **Oracle integrity (SSS-153):** Multi-oracle consensus flag (FLAG_MULTI_ORACLE_CONSENSUS) enables a `OracleConsensus` PDA as the canonical price source, aggregating multiple independent oracle feeds to prevent single-oracle manipulation.

### What is NOT trustless (v1) ⚠️

| Trust assumption | Detail | Risk |
|---|---|---|
| **Authority keypair required** | Authority must sign to propose timelocked ops. Timelocked at 432k slots (≈ 48h); cannot act instantly. | Compromised authority key has a 48-hour attack window before changes take effect. |
| **Squads multisig not yet required** | FLAG_SQUADS_AUTHORITY integration is planned (SSS-134) but not enforced at initialize time. A single-key SSS-3 deployment is currently valid. | Single key is weaker than multisig. Planned: SSS-147 will require FLAG_SQUADS_AUTHORITY at SSS-3 init time. |
| **Reserve attestor keypair** | `reserve_amount` in program state is submitted by a whitelisted keypair (`submit_reserve_attestation`). The program does NOT independently read the reserve vault balance. | Attestor can lie; collateral check is only as honest as the attestor. |
| **`set_reserve_attestor_whitelist` is NOT timelocked** | Admin can swap the attestor whitelist instantly with no delay. | Malicious admin can replace attestor and attest false reserves immediately. |
| **ZK credential verifier is a stub (v1)** | `zk_credential.rs` accepts any proof shape; Groth16 verification is not implemented. | ZK privacy claims are aspirational in v1; do not rely on them for compliance. |
| **Cross-chain bridge is a CPI stub (v1)** | `bridge.rs` emits events but does not enforce cross-chain state. | Bridge minting is not collateral-verified end-to-end. |
| **BPF upgrade authority** | `MAINNET-CHECKLIST.md` items for upgrade authority freeze are unchecked. The program binary can be replaced by the upgrade authority at any time. | All on-chain invariants can be changed by a binary upgrade. |

### Trust Summary — SSS-3 v1

| Layer | Trustless? | Notes |
|---|---|---|
| Collateral ratio math | ✅ **Yes** | `mint` instruction enforces ratio on-chain; cannot be bypassed |
| Supply cap immutability | ✅ **Yes (SSS-147)** | `supply_cap_locked = true` enforced at SSS-3 init; `max_supply > 0` required |
| Admin timelock (BUG-010) | ✅ **Yes** | 432k slot delay on all privileged ops |
| DAO committee governance | ✅ **Yes (when active)** | FLAG_DAO_COMMITTEE gates all admin ops behind on-chain quorum; committee members OR authority may propose |
| FLAG_DAO_COMMITTEE removal | ✅ **Protected** | Cannot be cleared by authority or timelock — only via a DAO proposal (DaoFlagProtected) |
| Oracle integrity | ✅ **Yes (SSS-153)** | Multi-oracle consensus via FLAG_MULTI_ORACLE_CONSENSUS |
| Guardian multisig emergency pause | ✅ **Yes** | Pause/unpause requires multisig quorum |
| Reserve attestation | ⚠️ **Trust-minimized** | Permissioned on-chain attestor keypair; not a direct vault read |
| Squads multisig enforcement | ⚠️ **Planned** | FLAG_SQUADS_AUTHORITY implemented (SSS-134) but not required at SSS-3 init (SSS-147 TODO) |
| Attestor whitelist governance | ❌ **No (v1)** | `set_reserve_attestor_whitelist` not timelocked; instant swap possible |
| ZK credential privacy | ❌ **Stub (v1)** | Groth16 verifier not implemented; do not rely on for compliance |
| Cross-chain bridge collateral | ❌ **Stub (v1)** | CPI stub only; bridge minting not collateral-verified end-to-end |
| Program upgrade immutability | ❌ **No** | Upgrade authority not yet revoked; all invariants can be changed by binary upgrade |

---

## Squads Multisig Integration (Planned — SSS-134 / SSS-147)

FLAG_SQUADS_AUTHORITY (bit 13) is implemented in the program: when set, all authority-signed instructions verify that the signer is a valid Squads V4 multisig vault.

**Current status (SSS-147):** The flag is implemented and enforced for covered instructions, but it is NOT required at SSS-3 initialize time. A future sprint will add a compile-time TODO guard that rejects SSS-3 deployments unless FLAG_SQUADS_AUTHORITY is set.

**Planned guard (not yet active):**
```rust
// TODO SSS-147: When squads_authority module is implemented, require FLAG_SQUADS_AUTHORITY
// for SSS-3 preset at initialize time (no single-key SSS-3 deployments).
```

---

## DAO Committee Governance Layer

When FLAG_DAO_COMMITTEE is enabled:

1. **Any committee member OR the authority** may submit proposals via `propose_action` (BUG-011 fix — prevents authority capture).
2. Committee members vote YES via `vote_action`.
3. Once `votes.len() >= quorum`, anyone can execute via `execute_action`.
4. **FLAG_DAO_COMMITTEE itself is protected:** it cannot be cleared by the authority (direct call blocks), by timelock (`DaoFlagProtected` guard), or by any path other than an explicit DAO proposal. This prevents the authority from unilaterally dissolving the governance layer.

---

## Recommended Mitigations (Future Versions)

1. **Require Squads multisig at SSS-3 init:** Enforce `FLAG_SQUADS_AUTHORITY` at initialize time — no single-key SSS-3 deployments.
2. **Trustless reserve verification:** Replace attestor model with on-chain vault balance read inside `mint` (or use a decentralized oracle / Merkle proof).
3. **Timelock `set_reserve_attestor_whitelist`:** Minimum 24–48 h delay before attestor changes take effect.
4. **Implement Groth16 verifier:** Required before ZK credential / confidential transfer claims can be honoured.
5. **Freeze or multi-sig upgrade authority:** Revoke or move to governance before mainnet.
6. **Expand timelock coverage:** All admin functions that affect the reserve or mint path should be timelocked.

---

## References

- `programs/sss-token/src/instructions/admin_timelock.rs` — timelock (BUG-010, full coverage)
- `programs/sss-token/src/instructions/dao_committee.rs` — DAO governance (SSS-067, BUG-011)
- `programs/sss-token/src/instructions/feature_flags.rs` — FLAG_DAO_COMMITTEE guard
- `programs/sss-token/src/instructions/initialize.rs` — SSS-3 supply cap lock (SSS-147)
- `programs/sss-token/src/instructions/squads_authority.rs` — Squads V4 multisig (SSS-134)
- `programs/sss-token/src/instructions/multi_oracle.rs` — multi-oracle consensus (SSS-153)
- `programs/sss-token/src/state.rs` — `supply_cap_locked` field
- `programs/sss-token/src/proof_of_reserves.rs` — attestor-submitted reserve
- `docs/PROOF-OF-RESERVES.md` — PoR documentation
- `docs/DAO-GOVERNANCE.md` — DAO committee documentation
- `docs/DEPLOYMENT-GUIDE.md` — deployment checklist
- `docs/MAINNET-CHECKLIST.md` — upgrade authority items (currently unchecked)
- Audit finding: AUDIT-G (sss-docs, 2026-03-24) — source of trust model findings
- SSS-147 sprint — trustless hardening (DAO member proposals, supply cap lock, Squads TODO)

---

*Last updated: 2026-03-26 — SSS-147 trustless hardening sprint*

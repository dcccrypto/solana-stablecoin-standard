# TRUST-MODEL.md — Real Trust Assumptions per SSS Tier

> **Purpose:** This document replaces any prior "trustless" framing with an accurate description of who you must trust at each tier of the Solana Stablecoin Standard (v1). Integrators, auditors, and users should read this before relying on any SSS-tier guarantee.

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

## SSS-3 — Reserve-Backed (Collateral-Enforced)

### What IS enforced on-chain (v1)

- Collateral ratio check: `mint` instruction verifies `(total_minted - total_burned + amount) ≤ total_collateral` before accepting a mint. Collateral amount is read from program state.
- `deposit_collateral` / `redeem` flows update program state.
- CDP per-user vaults with Pyth price feed collateral valuation.

### What is NOT trustless (v1) ⚠️

| Trust assumption | Detail | Risk |
|---|---|---|
| **Reserve attestor keypair** | `reserve_amount` in program state is submitted by a whitelisted keypair (`submit_reserve_attestation`). The program does NOT independently read the reserve vault balance. | Attestor can lie; collateral check is only as honest as the attestor. |
| **`set_reserve_attestor_whitelist` is NOT timelocked** | Admin can swap the attestor whitelist instantly with no delay. | Malicious admin can replace attestor and attest false reserves immediately. |
| **`max_supply = 0` means uncapped** | If `max_supply` is left at zero, minting is limited only by the collateral ratio — and that ratio depends on the attestor's submitted value. | Combined with attestor compromise, unlimited mint is possible. |
| **ZK credential verifier is a stub (v1)** | `zk_credential.rs` accepts any proof shape; Groth16 verification is not implemented. | ZK privacy claims are aspirational in v1; do not rely on them for compliance. |
| **Cross-chain bridge is a CPI stub (v1)** | `bridge.rs` emits events but does not enforce cross-chain state. | Bridge minting is not collateral-verified end-to-end. |
| **BPF upgrade authority** | `MAINNET-CHECKLIST.md` items for upgrade authority freeze are unchecked. The program binary can be replaced by the upgrade authority at any time. | All on-chain invariants can be changed by a binary upgrade. |
| **Admin timelock coverage** | `set_reserve_attestor_whitelist` is excluded from `admin_timelock.rs`. | See above; no delay on critical whitelist changes. |

### Trust Summary — SSS-3 v1

| Layer | Trustless? | Notes |
|---|---|---|
| Collateral ratio enforcement | **Partial** | Math enforced; but input (reserve amount) is attestor-submitted |
| Reserve attestation | **No** | Permissioned keypair; not vault-read |
| Attestor whitelist governance | **No** | No timelock |
| ZK credential privacy | **No (stub)** | Not implemented in v1 |
| Cross-chain bridge collateral | **No (stub)** | Not implemented in v1 |
| Program upgrade immutability | **No** | Upgrade authority not revoked |

---

## Recommended Mitigations (Future Versions)

1. **Trustless reserve verification:** Replace attestor model with on-chain vault balance read inside `mint` (or use a decentralized oracle / Merkle proof).
2. **Timelock `set_reserve_attestor_whitelist`:** Minimum 24–48 h delay before attestor changes take effect.
3. **Set `max_supply` explicitly:** Never leave at 0 for production deployments.
4. **Implement Groth16 verifier:** Required before ZK credential / confidential transfer claims can be honoured.
5. **Freeze or multi-sig upgrade authority:** Revoke or move to governance before mainnet.
6. **Expand timelock coverage:** All admin functions that affect the reserve or mint path should be timelocked.

---

## References

- `programs/sss-token/src/proof_of_reserves.rs` — attestor-submitted reserve
- `programs/sss-token/src/mint.rs` — collateral ratio check
- `programs/sss-token/src/zk_credential.rs` — stub verifier
- `programs/sss-token/src/bridge.rs` — CPI stub
- `programs/sss-token/src/admin_timelock.rs` — timelock (partial coverage)
- `docs/PROOF-OF-RESERVES.md` — PoR documentation
- `docs/DEPLOYMENT-GUIDE.md` — deployment checklist
- `docs/MAINNET-CHECKLIST.md` — upgrade authority items (currently unchecked)
- Audit finding: AUDIT-G (sss-docs, 2026-03-24) — source of most findings above

---

*Last updated: 2026-03-24 by sss-docs agent (SSS-BUG-007)*

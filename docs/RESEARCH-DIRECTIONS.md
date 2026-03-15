# SSS Research Directions — Technical Feasibility Report

**Task:** SSS-032  
**Author:** sss-docs  
**Date:** 2026-03-15  
**Status:** Complete

---

## Overview

Five candidate directions for the next evolution of the Solana Stablecoin Standard. Each section covers: what exists today on Solana/EVM, what is technically feasible with current Solana primitives, estimated complexity, and who would use it and why.

---

## Direction 1 — On-Chain Proof of Reserves (ZK/Merkle Attestation)

### What Exists Today
- **EVM:** Chainlink Proof of Reserve feeds (centralised oracle), Merkle-proof based PoR used by exchanges (BitMEX, Gate.io) and some DeFi protocols (Helio).
- **Solana:** No standardised on-chain PoR primitive. Some custodial stablecoins publish off-chain attestations from auditors (e.g., Circle's USDC monthly reports). Light Protocol offers ZK-compressed account state but no PoR-specific tooling.

### Technical Feasibility on Solana
**Fully feasible today.** The approach:
1. Issuer builds a Merkle tree off-chain (leaf = `SHA256(address || balance_le_u64)`), publishes root to a `ReserveMerkleRoot` PDA each epoch.
2. Any holder submits an inclusion proof (`Vec<[u8; 32]>`, depth ≤ 20) via `verify_inclusion`.
3. On-chain SHA-256 is a syscall (`sol_sha256`) — a depth-20 proof costs ~20,000 CU, well within the 1.4M limit.

No external dependencies required. Optional ZK extension via Light Protocol for compressed leaf storage at near-zero rent.

### Estimated Complexity
| Component | Effort |
|-----------|--------|
| Anchor program (root update + verify) | 3 days |
| Off-chain tree builder + CLI | 2 days |
| TypeScript SDK wrapper + docs | 1 day |
| **Total** | **~6 dev-days** |

Key risk: canonical leaf encoding — the off-chain tree builder and on-chain verifier must agree exactly on byte layout; a mismatch silently breaks all proofs.

### Who Would Use It and Why
- **Stablecoin issuers** wanting trustless, auditor-free reserve attestation (competitive differentiator vs. Circle/Tether).
- **DeFi protocols** (lending, collateral vaults) that need programmatic reserve verification before accepting a stablecoin as collateral.
- **Retail holders** who want self-serve proof they are included in the attested supply — no third party required.
- **Regulators and auditors** who want on-demand, slot-specific snapshots without requesting issuer cooperation.

---

## Direction 2 — Multi-Collateral CDP Vaults

### What Exists Today
- **EVM:** MakerDAO DAI is the canonical reference — multi-collateral CDP with on-chain liquidation bots, Chainlink oracles, and a stability fee mechanism. Liquity (single-collateral LUSD) and AAVE's GHO are newer variants.
- **Solana:** Hubble Protocol (USDH) and MarginFi offer CDP-style borrowing against SOL/LST collateral. No open standard exists for third parties to add new collateral types to a shared CDP framework.

### Technical Feasibility on Solana
**Feasible but tight on CPI depth.** Architecture:
- `Vault` PDA per user holds `collateral_amount`, `debt_amount`, `collateral_mint`.
- `CollateralType` PDA stores oracle feed address + liquidation ratio per asset.
- Pyth/Switchboard price feeds are read-only account deserialization (no CPI, ~5,000 CU).
- `liquidate` calls SSS `burn` (CPI 1) → Token-2022 (CPI 2) → System (CPI 3). From a caller program, depth hits 4 — Solana's maximum.

The CPI depth constraint means the CDP program cannot be called from another program during liquidation. Liquidator bots call it directly.

### Estimated Complexity
| Component | Effort |
|-----------|--------|
| Anchor program (single collateral MVP) | 5 days |
| Multi-collateral extension + oracle integration | 4 days |
| Liquidation bot (off-chain Rust/TS) | 3 days |
| Tests + docs | 2 days |
| **Total** | **~14 dev-days** |

Hardest part: oracle staleness + sandwich attack mitigation (TWAP fallback, confidence interval checks, minimum time between oracle update and liquidation call).

### Who Would Use It and Why
- **Protocol builders** who want to issue synthetic stablecoins backed by diversified on-chain collateral without building CDP infrastructure from scratch.
- **DeFi users** who want to use SOL/JitoSOL/mSOL as productive collateral to mint stablecoins and deploy them in yield strategies.
- **Institutional parties** who want regulated CDP vaults with programmable compliance layered on top (connects directly to Direction 4).

---

## Direction 3 — Cross-Program Composability Standard (CPI Interface)

### What Exists Today
- **EVM:** ERC-20's `transfer`/`transferFrom`/`approve` interface — any contract can call any ERC-20-compliant token with the same ABI. IERC-20 is the universal composability primitive.
- **Solana:** No equivalent standard. Each stablecoin program has a unique IDL; integrators must write custom CPI code per issuer. SPL Token provides basic transfer, but not mint/burn/getReserveRatio-style operations.

### Technical Feasibility on Solana
**Fully feasible today** — Anchor doesn't support runtime interfaces, but a **discriminator-based dispatch pattern** achieves equivalent composability:

```
mint_discriminator = sha256("global:mint")[..8]
burn_discriminator = sha256("global:burn")[..8]
```

Any program that wants to call any SSS-compatible mint:
1. Derives discriminators from the published ABI namespace.
2. Constructs the standard account list.
3. Calls via `invoke` or `invoke_signed` — no custom CPI library needed.

CPI cost: ~12,000 CU total per mint/burn call via the interface.

### Estimated Complexity
| Component | Effort |
|-----------|--------|
| Interface spec + IDL publication | 1 day |
| CPI stubs in Anchor (Rust feature flag) | 2 days |
| TypeScript CPI client | 1 day |
| Integration test (external program → SSS) | 1 day |
| Docs | 1 day |
| **Total** | **~6 dev-days** |

Hardest part: IDL versioning. Breaking account changes cause silent `AccountNotEnoughKeys` errors for existing callers. Mitigation: `InterfaceVersion` PDA that callers check before invoking.

### Who Would Use It and Why
- **DeFi protocols** (DEXes, lending markets, yield aggregators) that want to integrate any SSS stablecoin with zero custom code — one integration covers all SSS-compliant issuers.
- **Stablecoin issuers** who want their token instantly composable with the existing Solana DeFi ecosystem without negotiating custom integrations.
- **SSS itself** — Directions 1 and 4 become simpler to build if the CPI interface is standardised first.

This direction has the highest leverage: **build it first, it unlocks everything else.**

---

## Direction 4 — Programmable Compliance Rules (On-Chain Rule Engine)

### What Exists Today
- **EVM:** OpenZeppelin's `AccessControl` and custom role-based pause logic. Chainalysis on-chain sanctions screening (an oracle, not a rule engine). Circle's USDC uses a static blocklist contract.
- **Solana:** Token-2022 Transfer Hook extension enables arbitrary on-chain logic at transfer time. No standard rule engine framework exists; each issuer implements custom hook logic.

### Technical Feasibility on Solana
**Feasible within compute budget for ≤20 rules.** Design:
- `Rule` PDAs (128 bytes each) encode rule type + params: `blacklist`, `amount_limit`, `velocity`, `jurisdiction_block`, `multisig_approval`.
- Transfer Hook evaluates rules in priority order, short-circuiting on first failure.
- Compute budget per rule: blacklist ~3,000 CU, amount limit ~500 CU, velocity tracker ~5,000 CU. Ten rules ≈ 35,000 CU — comfortable within the 400,000 CU available to a Transfer Hook.
- Velocity tracking uses a slot-based rolling window PDA (`window_start_slot + accumulated_amount`); resets when `current_slot - window_start_slot > window_size_slots`.

### Estimated Complexity
| Component | Effort |
|-----------|--------|
| Core rule PDAs + basic types (blacklist, amount) | 3 days |
| Velocity tracker + window arithmetic | 2 days |
| Transfer Hook integration | 2 days |
| Admin SDK (add/remove/update rules) | 1 day |
| Tests + docs | 2 days |
| **Total** | **~10 dev-days** |

Hardest part: velocity tracker correctness. Solana clock is slot-based, not wall-clock; approximate windows are acceptable but must be clearly documented. Consensus on reset semantics matters for auditability.

### Who Would Use It and Why
- **Regulated stablecoin issuers** who need to demonstrate on-chain compliance (velocity limits for AML, multisig approval for large mints) to regulators — without relying on centralised enforcement.
- **Institutional DeFi** participants who need verifiable compliance trails and on-chain audit logs.
- **DAOs** issuing governance-controlled stablecoins that want programmable emission policies (e.g., auto-pause if supply grows >10% in one hour).

---

## Direction 5 — Confidential Transfers with Selective Issuer Disclosure

### What Exists Today
- **EVM:** Aztec Protocol (deprecated), Tornado Cash (regulatory issues), Railgun (ZK shielded ERC-20s). No major stablecoin uses confidential transfers by default.
- **Solana:** Token-2022 ships a **Confidential Transfer extension** today — balances and transfer amounts are encrypted with ElGamal on Ristretto255. An optional auditor public key allows the issuer to decrypt all amounts. The `@solana/spl-token` v0.4+ SDK includes WASM proof generation.

### Technical Feasibility on Solana
**Feasible on Solana 1.18+ with mandatory pre-verification.** Constraints:
- ZK proof verification (`VerifyTransferWithFee`) costs ~1.7M CU — over the per-transaction limit.
- **Solana 1.18 split-proof instruction** (`VerifyProof`) allows proof verification in a separate transaction with a proof hash stored in a sysvar, which the actual transfer instruction checks. This is the mandatory implementation path.
- Auditor pattern: `ConfidentialTransferMint.auditor_elgamal_pubkey` causes every transfer to encrypt the amount twice — once for the recipient, once for the auditor. Auditor decrypts offline with their `ElGamalSecretKey`.
- ElGamal keypairs are deterministically derived from wallet signatures — no backup required: `HKDF(sha512(sign("ElGamal keypair")), "sss-elgamal-v1")`.

### Estimated Complexity
| Component | Effort |
|-----------|--------|
| Mint-level setup (enable CT, set auditor key) | 2 days |
| Client SDK (keygen, deposit, withdraw, CT transfer) | 3 days |
| WASM proof generation integration | 3 days |
| Auditor decrypt tool | 1 day |
| Tests + docs | 2 days |
| **Total** | **~11 dev-days** |

Hardest part: ZK proof generation is Rust/WASM only — no pure TypeScript equivalent. The SDK must bundle a ~2MB WASM prover (trustless) or offload to a backend service (introduces trust). WASM is the correct path.

### Who Would Use It and Why
- **Privacy-sensitive users** — individuals and businesses who do not want their stablecoin balances visible on-chain while retaining the ability to prove compliance to regulators.
- **Enterprises** using stablecoins for payroll, supplier payments, or treasury management — amounts are commercially sensitive.
- **Regulated issuers** who need to offer privacy to users while retaining audit capability (the auditor key pattern satisfies both requirements).
- **Sovereign / CBDC-style** deployments where monetary privacy is a policy requirement but law enforcement access is also required.

---

## Summary

| # | Direction | What Exists Today | Feasible Now? | LoE | Primary Audience |
|---|-----------|------------------|--------------|-----|-----------------|
| 1 | Proof of Reserves | Off-chain attestations; no Solana standard | ✅ Yes | **6 days** | Issuers, DeFi protocols, retail holders |
| 2 | Multi-Collateral CDP | Hubble/MarginFi (no open standard) | ✅ Yes (CPI depth tight) | **14 days** | Protocol builders, DeFi users |
| 3 | CPI Composability | EVM: ERC-20; Solana: no standard | ✅ Yes | **6 days** | All DeFi integrators |
| 4 | Compliance Rule Engine | Static blocklists; no on-chain rule standard | ✅ Yes | **10 days** | Regulated issuers, institutions |
| 5 | Confidential Transfers | Token-2022 CT exists; no SSS integration | ✅ Yes (Solana 1.18+) | **11 days** | Privacy users, enterprises, CBDC |

**Recommended build order:**
1. **Direction 3** (CPI interface) — highest leverage, shortest path, unlocks Directions 1 and 4.
2. **Direction 1** (Proof of Reserves) — high impact, lowest LoE after interface is in place.
3. **Direction 4** (Compliance Rule Engine) — builds on Transfer Hook infrastructure already in SSS.
4. **Direction 5** (Confidential Transfers) — builds on Token-2022 CT, needs Solana 1.18+.
5. **Direction 2** (Multi-Collateral CDP) — largest standalone feature, tackle last.

*This report is backed by a technical architecture spike (`docs/TECH-SPIKE-DIRECTIONS.md`) and 82 spike validation tests in `tests/spikes/` (SSS-042).*

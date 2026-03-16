# Documentation & Standards Gaps Analysis — Solana Stablecoin Standard

_Task: SSS-083 | Author: sss-docs | Date: 2026-03-15_

---

## Executive Summary

SSS has solid reference documentation (architecture, SDK API, preset specs, devnet guide) but lacks the documentation infrastructure that every serious open-source financial protocol publishes. Benchmarking against Uniswap v3, Aave v3, MakerDAO, and OpenZeppelin reveals five structural gaps: (1) no security model document, (2) no formal specification, (3) no integration guide for common patterns, (4) no SIP-style formal proposal document, and (5) missing doc categories universally present in best-in-class protocols. Each gap is described below with concrete recommendations.

---

## 1. Benchmark Protocols — Doc Coverage Summary

| Area | Uniswap v3 | Aave v3 | MakerDAO | OpenZeppelin | **SSS (current)** |
|------|------------|---------|----------|--------------|-------------------|
| Whitepaper / overview | ✅ PDF | ✅ | ✅ | ✅ | ✅ (README + SUBMISSION.md) |
| Architecture | ✅ | ✅ | ✅ | ✅ | ✅ ARCHITECTURE.md |
| SDK / API reference | ✅ | ✅ | ✅ | ✅ | ✅ api.md, on-chain-sdk-*.md |
| Formal specification | ✅ (whitepaper + TLA+) | ✅ (risk model) | ✅ (MIPs) | ❌ | ❌ **MISSING** |
| Security model doc | ✅ (dedicated section) | ✅ (risk + audits) | ✅ (liquidation + oracle model) | ✅ | ❌ **MISSING** |
| Audit reports / findings | ✅ Trail of Bits, ABDK | ✅ | ✅ | ✅ | ❌ **MISSING** |
| Bug bounty doc | ✅ (Cantina) | ✅ | ✅ | ✅ | ❌ **MISSING** |
| Integration guide | ✅ (quickstart, guides) | ✅ (quickstart, React SDK) | ✅ (partner-type guides) | ✅ | ⚠️ partial (SSS-1/2 preset docs only) |
| Error codes reference | ⚠️ | ✅ | ✅ | ✅ | ⚠️ scattered in SDK docs |
| Governance / upgrade model | ✅ UNI governance | ✅ AaveDAO | ✅ MIPs | ✅ (proxy patterns) | ❌ **MISSING** |
| Changelog / versioning | ✅ | ✅ | ✅ | ✅ | ❌ **MISSING** |
| On-chain event / account reference | ✅ | ✅ | ✅ | ✅ | ⚠️ partial (architecture only) |

---

## 2. Gap 1 — Security Model Documentation

### What every serious protocol has

Uniswap v3 publishes a dedicated **Security** section covering: threat models, invariants the protocol guarantees, audit reports with findings/resolutions, and an ongoing bug bounty program. MakerDAO publishes its liquidation mechanics, oracle security model, and recapitalization mechanism. Aave publishes its risk parameters, solvency conditions, and circuit breakers.

### What SSS is missing

There is no `SECURITY.md` or security model document. A reviewer or integrator cannot find:

- What invariants the protocol guarantees (e.g., "a blacklisted address can never receive or send tokens on an SSS-2 mint")
- What the assumed trust model is (who holds the freeze/compliance authority, what happens if they are compromised)
- What audit coverage exists (programs, SDK, backend)
- How security vulnerabilities should be reported
- What the bug bounty program is (if any)

### Recommended action

Create `SECURITY.md` with:

1. **Invariants table** — one row per program-level guarantee (e.g., `pause` halts all mint/burn; blacklist enforced at runtime via transfer hook; minter caps enforced on-chain)
2. **Trust model** — roles (authority, compliance_authority, minter), what each can do, what happens if compromised
3. **Audit status** — programs, SDK, backend; findings summary if audited; "unaudited" disclosure if not
4. **Vulnerability disclosure** — responsible disclosure process, contact (e.g., GitHub Security Advisory)
5. **Bug bounty** — scope and rewards if applicable

---

## 3. Gap 2 — Formal Specification

### What every serious protocol has

Uniswap v3 has a whitepaper with mathematical definitions of concentrated liquidity, virtual reserves, and fee accumulation. The constant product invariant (`x*y=k`) is formally stated. Trail of Bits' formal verification and MetaTrust's Isabelle/HOL proof provide machine-checked correctness. MakerDAO uses MIPs (Maker Improvement Proposals) as a living formal spec. Both treat the spec as separate from the developer guide.

### What SSS is missing

SSS has implementation docs (how to call the SDK) but no spec doc (what the protocol *is*). There is no document that formally defines:

- The SSS preset taxonomy (what distinguishes SSS-1, SSS-2, SSS-3 at the protocol level)
- The invariants each preset enforces (expressed as preconditions/postconditions, not prose)
- Account data layout (field-by-field definition of `StablecoinConfig`, `MinterInfo`, `BlacklistState`)
- Instruction semantics (what each instruction must validate, what state transitions it produces)
- Error taxonomy (all `SssError` variants, when each is returned)
- Token-2022 extension constraints (which extensions are mandatory per preset, which are optional)

Without this, the protocol is an implementation, not a standard.

### Recommended action

Create `SSS-SPEC.md` — the canonical protocol specification:

```
# SSS Protocol Specification

## 1. Scope and Goals
## 2. Definitions (Mint, StablecoinConfig, preset, authority roles)
## 3. Preset Taxonomy
   ### 3.1 SSS-1 — Minimal
   ### 3.2 SSS-2 — Compliant (transfer hook + blacklist)
   ### 3.3 SSS-3 — Trustless Collateral-Backed (reference design)
## 4. Account Schemas (field-by-field, with types and constraints)
## 5. Instruction Semantics (preconditions, state transitions, postconditions)
## 6. Error Codes (exhaustive table)
## 7. Token-2022 Extension Requirements per Preset
## 8. Invariants (formal prose or pseudocode)
## 9. Out of Scope
```

This document is the foundation for any future SIP-style extension or third-party audit.

---

## 4. Gap 3 — Integration Guide

### What every serious protocol has

- **Uniswap v3**: Step-by-step guides for swaps, flash swaps, liquidity provision, local environment setup. Each guide is self-contained with code samples.
- **Aave**: Quickstart with React hooks, supply/borrow examples, partner-type guides (CEX, DEX, keepers, wallets).
- **MakerDAO**: Separate guides per integrator type (exchange, CDP owner, keeper).

### What SSS is missing

The current docs show *how the SDK methods work* but not *how to integrate SSS into a product*. Missing integration scenarios:

| Integration Pattern | Status |
|--------------------|--------|
| Issue a stablecoin (SSS-1, end-to-end) | ⚠️ SDK examples exist but no narrative guide |
| Mint tokens via API (backend integration) | ❌ |
| Integrate transfer hook into a DEX or AMM | ❌ |
| Compliance workflow (blacklist → freeze → burn) | ❌ |
| Cross-program invocation (CPI) from another Anchor program | ❌ (formal-verification.md exists but not CPI guide) |
| Wallet integration (display balances, sign transactions) | ❌ |
| Index SSS events with a custom indexer | ❌ (geyser/polling covered in backend gaps only) |
| Upgrade authority rotation | ❌ |

### Recommended action

Create `INTEGRATION-GUIDE.md` with one section per pattern above. Each section: goal → prerequisites → code walkthrough → common errors → links to relevant SDK docs.

At minimum, the **Mint via API** and **Compliance workflow** patterns are needed for any real production integrator.

---

## 5. Gap 4 — Formal Proposal / SIP-Style Document

### What every serious protocol has

- **Ethereum**: EIPs follow a structured template: title, author, status, type, created, abstract, motivation, specification, rationale, backwards compatibility, security considerations, copyright.
- **MakerDAO**: MIPs (Maker Improvement Proposals) — same structure. Each new feature is a formal proposal before implementation.
- **Solana**: SIMDs (Solana Improvement Documents) for core protocol changes.

### Should SSS have one?

Yes. SSS presents itself as a *standard* (not just an SDK), which means external parties need to implement it. For the standard to be taken seriously by:
- Wallet providers (who may want to recognize SSS mints natively)
- CEXes and DEXes (who may want to respect blacklists)
- Regulators and auditors (who need a durable spec they can reference)
- Other Solana protocol teams (who may want to CPI into SSS)

...there must be a canonical document they can cite. The SUBMISSION.md serves this role informally but is bounty-submission prose, not a technical standard.

### Recommended action

Publish `SSS-0.md` as the meta-proposal document:

```
# SSS-0: Solana Stablecoin Standard — Meta Document

## Abstract
## Motivation (why a standard, not just an SDK)
## Preset Registry (SSS-1, SSS-2, SSS-3 — official designations)
## Conformance Requirements (what an implementation must do to claim SSS-N compliance)
## Extension Process (how to propose SSS-4, SSS-5, etc.)
## Reference Implementation
## Security Considerations
## Copyright / License
```

This converts SSS from "a very good SDK" into "a citable Solana standard."

---

## 6. Gap 5 — Missing Doc Categories (Quick Wins)

The following documents exist in all four benchmark protocols and are absent in SSS:

### 6.1 `CHANGELOG.md` / Release Notes
Every protocol publishes a versioned changelog. SSS has git history but no user-readable changelog. Integrators need to know what changed between SDK versions.

**Recommended:** Add `CHANGELOG.md` following Keep a Changelog format; automate from PR descriptions.

### 6.2 Error Codes Reference
SSS errors are documented inline in SDK docs but there is no single reference page. Integrators get `SssError::MinterCapExceeded` and have to search to understand it.

**Recommended:** Create `ERROR-CODES.md` — one table, all `SssError` variants, description, likely cause, resolution.

### 6.3 Governance / Authority Management
Who can rotate the freeze authority? How should a production issuer manage key rotation? What is the recommended multisig setup? This is documented in Aave (Emergency Admin, Pool Admin) and MakerDAO (governance votes). SSS has no equivalent.

**Recommended:** Add `AUTHORITY-MANAGEMENT.md` covering recommended Squads/multisig setup, key rotation procedures, emergency freeze procedure.

### 6.4 Audit Disclosure
Even if SSS is currently unaudited, a formal statement saying so — plus the scope of any planned audit — builds trust. The absence of any mention is worse than an "unaudited — audit planned for Q2 2026" statement.

**Recommended:** Add audit status section to `SECURITY.md` (see Gap 1).

### 6.5 On-Chain Account Reference
`ARCHITECTURE.md` describes accounts at a high level. There is no exhaustive account reference with field names, types, sizes, and byte layouts. This is needed for anyone building a custom indexer, explorer integration, or direct RPC client (bypassing the SDK).

**Recommended:** Add `ACCOUNT-REFERENCE.md` — Anchor IDL-derived, one section per account type.

---

## 7. Priority Matrix

| Document | Gap | Priority | Effort |
|----------|-----|----------|--------|
| `SECURITY.md` | Trust/audit | **P0** | Medium |
| `SSS-SPEC.md` (formal spec) | Protocol credibility | **P0** | High |
| `SSS-0.md` (meta proposal) | Standard legitimacy | **P1** | Medium |
| `INTEGRATION-GUIDE.md` | Developer adoption | **P1** | High |
| `ERROR-CODES.md` | DX / quick win | **P2** | Low |
| `CHANGELOG.md` | Maintenance hygiene | **P2** | Low |
| `AUTHORITY-MANAGEMENT.md` | Production readiness | **P2** | Medium |
| `ACCOUNT-REFERENCE.md` | Ecosystem integrations | **P3** | Medium |

---

## 8. Verdict — Do We Need an EIP/SIP-Style Proposal?

**Yes, and it is the most important missing piece.**

The other gaps are developer experience issues. The missing formal proposal document is a *credibility* issue. Without `SSS-0.md`, SSS cannot be:
- Referenced in a Solana SIMD
- Cited by a wallet team implementing native SSS support
- Used as a compliance evidence artifact by an issuer
- Formally reviewed by an auditor as a standard (vs. auditing a specific implementation)

The format should follow EIP-1 structure adapted for Solana: abstract, motivation, specification (linking to SSS-SPEC.md), rationale, backwards compatibility, security considerations. Publish it as `SSS-0.md` in `docs/` and link it prominently from README.

---

_End of gaps analysis. Next steps: create tasks for P0 items (SECURITY.md, SSS-SPEC.md) and assign to sss-docs sprint._

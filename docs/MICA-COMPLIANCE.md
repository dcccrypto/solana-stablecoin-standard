# MiCA Compliance Guide — Solana Stablecoin Standard

> **Regulation:** EU Markets in Crypto-Assets Regulation (MiCA) — Regulation (EU) 2023/1114  
> **Applicability:** Issuers deploying SSS stablecoins targeting EU markets as Asset-Referenced Tokens (ARTs) or E-Money Tokens (EMTs)  
> **Last updated:** 2026-03-23

---

## Overview

This guide maps SSS protocol features to MiCA requirements for stablecoin issuers. It covers which SSS presets and flags satisfy each article, configuration examples, and the monthly attestation workflow.

> ⚠️ **Disclaimer:** This document is technical guidance only. It does not constitute legal advice. MiCA compliance also requires legal entity registration as a credit institution or authorised e-money institution in an EU member state, a published whitepaper approved by a competent authority, and ongoing CASP obligations. SSS handles the _on-chain_ requirements; the off-chain legal obligations are the issuer's responsibility.

---

## MiCA Article Mapping

### Art. 36 — Reserve Requirements

**Requirement:** ARTs and EMTs must maintain a reserve of assets at least equal to the outstanding amount of tokens issued. Reserves must be invested in secure, low-risk instruments (Art. 36(1)(b)).

**SSS Mapping:**

| MiCA Requirement | SSS Feature | Preset |
|---|---|---|
| Reserve ≥ 100% of circulating supply | On-chain collateral ratio enforcement (SSS-3 VaultState) | SSS-3 |
| Reserve assets held in custody | SSS-3 vault — on-chain account, readable by anyone | SSS-3 |
| Reserve segregation from issuer funds | Vault as segregated custodian account (see Art. 34 below) | SSS-3 |
| Monthly attestation | Proof of Reserves (SSS-123, `POST /api/proof-of-reserves`) | All presets |

**Configuration:** Set `collateral_ratio` to `>= 100` (value in basis points × 100, so 10000 = 100%). For EMT issuers, a ratio of 10200 (102%) is recommended to cover price fluctuation buffers.

```typescript
// Initialize SSS-3 with MiCA-compliant collateral ratio
await sss.initialize({
  preset: 3,
  collateralRatio: 10200,   // 102% — satisfies Art. 36 buffer
  reserveAsset: USDC_MINT,  // Stablecoin-denominated reserve (low-risk)
  // ... other required fields
});
```

---

### Art. 45 — Redemption Rights

**Requirement:** Holders of ARTs/EMTs must be able to redeem their tokens at par value at any time. The issuer must fulfil redemption within **1 business day** (Art. 45(5)).

**SSS Mapping:** SSS-125 (redemption guarantee) provides an on-chain SLA enforcement mechanism. The redemption queue is processed by the backend with configurable SLA.

| MiCA Requirement | SSS Feature |
|---|---|
| Redemption at par value | `redeem()` burns tokens and releases collateral at 1:1 peg |
| SLA ≤ 1 business day | SSS-125 redemption queue with 24h processing SLA |
| No redemption fees above cost | `redemption_fee` config param (set to 0 for strict MiCA compliance) |
| Suspension only with regulator approval | `FLAG_CIRCUIT_BREAKER` — log suspension events to compliance audit log |

**Configuration:**

```typescript
// SSS-125 redemption guarantee config
await sss.setRedemptionSLA({
  maxProcessingMs: 86_400_000,   // 24 hours (1 business day)
  redemptionFee: 0,               // No fees — MiCA Art. 45(4) strict compliance
  notifyOnQueue: true,            // Webhook/email notification when queue builds
});
```

> **Note on circuit breaker:** If `FLAG_CIRCUIT_BREAKER` is triggered (e.g., for emergency pause), the suspension must be reported to the competent authority. All `pause` events are automatically logged to the immutable compliance audit log (see [compliance-audit-log.md](./compliance-audit-log.md)).

---

### Art. 23 — Transaction Limits

**Requirement:** Issuers of significant ARTs/EMTs may be required to impose per-transaction limits on non-investment use cases to reduce systemic risk (MiCA Art. 23 + EBA guidelines).

**SSS Mapping:** `FLAG_SPEND_POLICY` (bit 1) enforces a per-transaction transfer cap via `max_transfer_amount` stored in `StablecoinConfig`.

| MiCA Requirement | SSS Feature |
|---|---|
| Per-transfer cap enforceable | `FLAG_SPEND_POLICY` + `set_spend_limit(amount)` |
| Cap enforced on-chain (not off-chain) | Transfer hook program rejects over-limit transfers |
| Cap adjustable by authority | `update_spend_limit()` — authority-gated |

**Configuration:**

```typescript
// Enable spend policy with MiCA-compliant daily limit
// Example: €10,000 equivalent per transaction (MiCA Art. 23 EBA threshold)
const MICA_SPEND_LIMIT = 10_000 * 1_000_000; // 10,000 USDC in lamport-equivalent

await featureFlags.setSpendLimit({
  maxTransferAmount: BigInt(MICA_SPEND_LIMIT),
});
// FLAG_SPEND_POLICY is enabled atomically by set_spend_limit
```

> **Note:** For issuers not designated as "significant" under MiCA Art. 43, `FLAG_SPEND_POLICY` is optional but recommended as a proactive safeguard.

---

### Art. 34 — Reserve Segregation

**Requirement:** Reserve assets must be legally segregated from the issuer's own assets and held in custody by a qualified custodian (credit institution or crypto-asset service provider under MiCA).

**SSS Mapping:** SSS-3 vault is an on-chain Solana account controlled by a dedicated `vault_authority` keypair, separate from the issuer's mint authority. The vault authority should be held by the custodian, not the issuer.

**Custodian Setup:**

```typescript
// Initialise with separate vault authority (custodian key)
await sss.initialize({
  preset: 3,
  mintAuthority: ISSUER_KEYPAIR.publicKey,      // Issuer controls minting
  vaultAuthority: CUSTODIAN_KEYPAIR.publicKey,  // Custodian controls reserve
  collateralRatio: 10200,
  // ...
});
```

**Key Segregation Table:**

| Authority | Controls | Who Holds the Key |
|---|---|---|
| `mint_authority` | Mint / burn tokens | Issuer (or timelock DAO) |
| `vault_authority` | Deposit / withdraw reserve assets | Qualified custodian |
| `compliance_authority` | Blacklist / freeze addresses | Compliance officer |
| `admin_authority` | Update config params | Issuer + timelock |

> **Recommendation:** Use SSS-113 authority timelock for all authority operations. Any vault withdrawal requires a 48h timelock window, giving regulators and auditors visibility before funds move.

---

### Art. 22 — Whitepaper Disclosure

**Requirement:** Issuers must publish an approved crypto-asset whitepaper before token issuance.

**SSS Mapping:** Not enforced on-chain — this is a legal obligation. However, SSS's `StablecoinConfig` includes an optional `whitepaper_uri` field that can store an immutable IPFS hash of the published whitepaper for on-chain auditability.

```typescript
await sss.initialize({
  // ...
  whitepaperUri: 'ipfs://QmXxxx...', // IPFS hash of approved whitepaper
});
```

---

## Monthly Attestation Workflow (Art. 36 + Art. 23)

MiCA requires periodic reserve attestations. SSS-123 provides cryptographic Proof of Reserves that satisfies this requirement.

### Step-by-Step

1. **Generate snapshot** — at month end, call `POST /api/proof-of-reserves`:
   ```bash
   curl -X POST https://your-backend/api/proof-of-reserves \
     -H "Authorization: Bearer $ADMIN_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"tag": "mica-monthly-2026-03"}'
   ```

2. **Response includes:**
   - `merkle_root` — cryptographic commitment to circulating supply
   - `slot` — Solana slot at which snapshot was taken
   - `total_supply` — total tokens in circulation
   - `reserve_balance` — on-chain vault balance
   - `collateral_ratio` — computed ratio at snapshot time

3. **Publish attestation** — include `merkle_root` + `slot` in your monthly report to the competent authority. Independent auditors can verify it without backend access.

4. **Archive** — all snapshots are stored in the compliance audit log (immutable append-only log at `GET /api/compliance-audit-log`).

---

## Sample Compliant `initialize` Config

```typescript
import { SSS } from '@sss/sdk';

const sss = new SSS(provider);

await sss.initialize({
  // Preset — SSS-3 for collateral-backed EMT
  preset: 3,

  // Authorities — segregated per Art. 34
  mintAuthority: ISSUER_KEYPAIR.publicKey,
  vaultAuthority: CUSTODIAN_KEYPAIR.publicKey,
  complianceAuthority: COMPLIANCE_OFFICER_KEYPAIR.publicKey,
  adminAuthority: ADMIN_MULTISIG_KEYPAIR.publicKey,

  // Reserve — 102% ratio (Art. 36 buffer)
  collateralRatio: 10200,
  reserveAsset: USDC_MINT,

  // Redemption — 24h SLA (Art. 45)
  redemptionFee: 0,

  // Feature flags — Art. 23 spend limits + ZK compliance
  featureFlags:
    FLAG_SPEND_POLICY |     // Per-transfer limits
    FLAG_ZK_COMPLIANCE |    // ZK proof of compliance status
    FLAG_CIRCUIT_BREAKER,   // Emergency pause (report to authority if triggered)

  // Spend limit — €10,000 equivalent (Art. 23)
  maxTransferAmount: BigInt(10_000 * 1_000_000),

  // Whitepaper — immutable reference (Art. 22)
  whitepaperUri: 'ipfs://QmYourApprovedWhitepaperHash',
});
```

---

## What SSS Does NOT Cover

The following MiCA obligations fall **outside** the SSS protocol and must be handled by the issuer:

| Obligation | MiCA Article | Notes |
|---|---|---|
| Legal entity authorisation | Art. 17 | Must be a credit institution or authorised e-money institution in an EU member state |
| Whitepaper approval by competent authority | Art. 17(1) | Filed with national regulator (e.g., BaFin, AMF, CBI) before issuance |
| CASP registration | Art. 59 | If operating a crypto-asset trading platform or custody service |
| Ongoing supervisory reporting | Art. 22(4) | Quarterly reports to competent authority |
| Recovery plan | Art. 42 | Written plan for orderly wind-down; not enforceable on-chain |
| Business continuity plan | Art. 74 | Operational resilience; covered by your DevOps, not SSS |
| AML/CFT compliance | Art. 83–85 | Travel Rule, KYC — integrate with a VASP compliance provider |

---

## References

- [MiCA Regulation (EU) 2023/1114](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32023R1114)
- [EBA Guidelines on ART/EMT reserve assets](https://www.eba.europa.eu/regulation-and-policy/crypto-assets)
- [SSS-3 Architecture](./SSS-3.md)
- [Proof of Reserves](./PROOF-OF-RESERVES.md)
- [Feature Flags Reference](./feature-flags.md)
- [Compliance Module SDK](./compliance-module.md)
- [Compliance Audit Log](./compliance-audit-log.md)
- [Security Model — Authority Timelock](./SECURITY.md)

# GENIUS Act Compliance Guide for SSS Issuers

_Author: sss-docs | Task: SSS-148 | Date: 2026-03-25_
_Enforcement target: Q3 2026_

> ⚠️ **Legal disclaimer**: This document maps SSS technical capabilities to GENIUS Act requirements. It is **not legal advice**. You must obtain independent legal counsel and may need federal/state regulatory approval before issuing a payment stablecoin in the United States. SSS provides the technical infrastructure; legal entity formation, charter, OCC/state approval, and licensing remain entirely the issuer's responsibility.

---

## Table of Contents

1. [Overview — What is the GENIUS Act?](#1-overview)
2. [Reserve Requirements (Section 4)](#2-reserve-requirements)
3. [Monthly Attestation Workflow](#3-monthly-attestation-workflow)
4. [Freeze / Seize / Burn Capability (Section 4 Mandate)](#4-freezeseizeburn-capability)
5. [AML / BSA Classification](#5-amlbsa-classification)
6. [No Interest Prohibition](#6-no-interest-prohibition)
7. [Private Key Custody](#7-private-key-custody)
8. [Sample Compliant `initialize` Configuration](#8-sample-compliant-initialize-configuration)
9. [What SSS Does NOT Cover](#9-what-sss-does-not-cover)
10. [Compliance Checker Script](#10-compliance-checker-script)

---

## 1. Overview

The **Guiding and Establishing National Innovation for US Stablecoins (GENIUS) Act** establishes the first comprehensive US federal framework for payment stablecoin issuers. Key pillars:

| Requirement | GENIUS Act Section | SSS Capability |
|---|---|---|
| 1:1 reserve backing | §4(a) | SSS-3 PoR + reserve vault |
| Monthly attestation | §4(c) | SSS-123 reserve reporting |
| Freeze/seize/burn | §4(d) | Transfer hook + blacklist + burn |
| AML/BSA compliance | §5 | SSS-128 sanctions oracle + transfer hook |
| No yield to holders | §6 | Default behaviour (no yield distribution) |
| Regulated key custody | §7 | Squads V4 multisig (FLAG_SQUADS_AUTHORITY) |
| Redemption guarantee | §4(e) | SSS-125 redemption pool |

This guide focuses on **SSS-3** (Regulated Stablecoin) and **SSS-4-Institutional** presets, which include the required compliance features.

---

## 2. Reserve Requirements

### GENIUS Act §4(a): 1:1 Backing

The Act requires payment stablecoins to be backed 1:1 by:
- US dollars (cash/demand deposits at FDIC-insured institutions)
- Treasury bills with ≤ 93-day maturity
- Repos backed by Treasuries
- Central bank reserves

**Prohibited:** rehypothecation, lending of reserves, illiquid assets.

### SSS Mapping

| Requirement | SSS Component | Reference |
|---|---|---|
| Reserve segregation | `StablecoinConfig.reserve_vault` — standalone keypair, separate from program authority | [SSS-3.md](./SSS-3.md) |
| Bankruptcy-remote account | Issuer must hold reserves at FDIC member bank in segregated trust account; SSS `reserve_amount` mirrors this balance | [PROOF-OF-RESERVES.md](./PROOF-OF-RESERVES.md) |
| 1:1 ratio enforcement | `FLAG_POR_HALT_ON_BREACH` — minting halts if `reserve_amount < circulating_supply` | [SUPPLY-CAP-POR-HALT.md](./SUPPLY-CAP-POR-HALT.md) |
| No rehypothecation | SSS does not hold off-chain assets; the reserve vault holds lamports as deployment collateral only. Real-world USD reserves are custodied externally. Document that reserves are **not** deployed into DeFi protocols | — |

### Required Initialization Flags

```bash
FLAG_POR_HALT_ON_BREACH=1   # halts minting on reserve breach
FLAG_SQUADS_AUTHORITY=1     # multisig-controlled admin ops
```

### Reserve Vault Setup

The reserve vault must be a **dedicated Solana keypair** whose corresponding off-chain bank account holds the 1:1 USD/T-bill reserves:

```bash
# Generate reserve vault keypair (store securely!)
solana-keygen new --outfile reserve-vault.json --no-passphrase

# The public key is submitted as reserve_vault in initialize
solana-keygen pubkey reserve-vault.json
```

Cross-reference: [PROOF-OF-RESERVES.md §3](./PROOF-OF-RESERVES.md) — attestation submission process.

---

## 3. Monthly Attestation Workflow

### GENIUS Act §4(c): Attestation Requirements

- Monthly reserve attestation by a **registered public accounting firm**
- CEO/CFO certification alongside the attestation
- Publication within 10 business days of month-end

### SSS SSS-123 Attestation Flow

```
1. Month ends
   ↓
2. Auditor performs off-chain reserve verification
   (bank statements, T-bill holdings, FDIC confirmation)
   ↓
3. Auditor signs attestation report (PDF, hash recorded on-chain)
   ↓
4. CEO/CFO counter-certifies (separate key, Squads V4 transaction)
   ↓
5. Backend submits reserve_amount update via:
   POST /api/admin/reserve-report
   { amount: <usd_cents>, attestation_hash: <sha256>, period: "2026-02" }
   ↓
6. On-chain: update_reserve_amount instruction executed via Squads multisig
   ↓
7. Publish attestation report URL + tx signature to public endpoint
   (required by GENIUS §4(c)(3))
   ↓
8. GENIUS Act deadline: within 10 business days of month-end
```

### CEO/CFO Certification Process

The Squads V4 multisig should require **both** the CEO and CFO keys as signers on the `update_reserve_amount` transaction to satisfy joint certification:

```toml
# Squads V4 multisig configuration for GENIUS compliance
threshold = 2        # CEO + CFO must both sign
members = [
  "CEO_PUBKEY",
  "CFO_PUBKEY",
  "TECHNICAL_LEAD_PUBKEY",   # optional third key for operational use
]
# For reserve attestation transactions only: require CEO+CFO specifically
# Implement via Squads V4 role-gated vault
```

Reference: [PROOF-OF-RESERVES.md](./PROOF-OF-RESERVES.md), [RESERVE-REPORTING.md](./RESERVE-REPORTING.md).

---

## 4. Freeze / Seize / Burn Capability

### GENIUS Act §4(d): Technical Mandate

The Act requires issuers to have technical capability to:
1. **Freeze** balances associated with illicit activity (on lawful order)
2. **Seize** and transfer frozen balances to government-designated wallet
3. **Burn** seized tokens after transfer

This is a hard technical requirement — issuers **cannot** waive it contractually.

### SSS Mapping

#### Freeze (Blacklist)

```bash
# Blacklist a wallet (freeze transfers to/from)
POST /api/admin/blacklist
{ "wallet": "WALLET_PUBKEY", "reason": "OFAC SDN match", "order_ref": "USG-2026-001" }

# On-chain: add_to_blacklist instruction via Squads multisig
```

The Token-2022 transfer hook checks the blacklist on every transfer. A blacklisted account cannot send or receive tokens. Reference: [SANCTIONS-ORACLE.md](./SANCTIONS-ORACLE.md).

#### Seize (Transfer + Burn)

```bash
# Step 1: Admin seizes balance to government-designated wallet
POST /api/admin/seize
{
  "from_wallet": "FROZEN_WALLET",
  "to_wallet": "GOVT_DESIGNATED_WALLET",
  "amount": 1000000,
  "order_ref": "DOJ-2026-CIV-007"
}

# Step 2: Burn seized tokens from the government wallet
POST /api/admin/burn
{
  "from_wallet": "GOVT_DESIGNATED_WALLET",
  "amount": 1000000,
  "tx_signature": "<seize_tx_sig>"
}
```

Both operations require the Squads V4 multisig approval flow. All actions are logged in the compliance audit log. Reference: [compliance-audit-log.md](./compliance-audit-log.md).

#### Emergency Pause

For systemic freeze (e.g., smart contract exploit or systemic compliance breach):

```bash
POST /api/admin/pause
{ "reason": "GENIUS Act §4(d)(2) systemic halt" }
```

Reference: [GUARDIAN-PAUSE.md](./GUARDIAN-PAUSE.md).

---

## 5. AML / BSA Classification

### GENIUS Act §5: AML/BSA Requirements

GENIUS Act issuers are treated as **money services businesses (MSBs)** under the Bank Secrecy Act. Requirements:
- FinCEN MSB registration
- Sanctions screening (OFAC SDN, EU, UN lists)
- Transaction monitoring (SAR/CTR filing)
- Travel Rule compliance for transfers ≥ $3,000 (US threshold)

### SSS Mapping

| AML/BSA Requirement | SSS Feature | Flag |
|---|---|---|
| Sanctions screening | SSS-128 Sanctions Oracle — checks every transfer against oracle-maintained blocklist | `FLAG_SANCTIONS_ORACLE=1` |
| Transfer monitoring | Transfer hook emits structured events for every on-chain transfer; indexer ingests for SAR/CTR analysis | — |
| Travel Rule | SSS-127 Travel Rule compliance — originator/beneficiary data for transfers ≥ threshold | `FLAG_TRAVEL_RULE=1` |
| ZK-enhanced KYC | SSS-129 ZK credentials — privacy-preserving KYC attestation on-chain | `FLAG_ZK_CREDENTIALS=1` (optional) |

### Sanctions Oracle Configuration

```bash
# Configure sanctions oracle endpoint in initialize:
sanctions_oracle_endpoint = "https://your-sanctions-provider.com/api/v1/screen"

# The oracle is called via CPI on every transfer; a positive match halts the tx.
# See: docs/SANCTIONS-ORACLE.md for oracle provider integration
```

### Travel Rule Configuration

```bash
# Enable Travel Rule enforcement
FLAG_TRAVEL_RULE=1
travel_rule_threshold_usd = 3000   # US GENIUS Act threshold
```

Reference: [TRAVEL-RULE.md](./TRAVEL-RULE.md), [SANCTIONS-ORACLE.md](./SANCTIONS-ORACLE.md).

---

## 6. No Interest Prohibition

### GENIUS Act §6: Yield Prohibition

The Act prohibits payment stablecoin issuers from paying **interest, yield, or return** to token holders based on holding the stablecoin.

### SSS Default Behaviour

SSS **does not distribute yield to token holders** by default. Specifically:
- There is no yield accrual mechanism in the token state
- The stability fee (if enabled) flows **to the issuer**, not to holders
- The insurance fund accrues to the issuer backstop pool
- AMM liquidity rewards are earned by liquidity providers, not passive holders

**What you must NOT do:**
```
❌ Do not wrap SSS tokens in a yield-bearing vault and market it as a "savings stablecoin"
❌ Do not distribute staking rewards proportionally to SSS holders
❌ Do not implement rebasing mechanics that increase holder balances over time
```

**What is permitted:**
```
✅ Stability fee charged to minters (borrowers), paid to issuer
✅ Insurance fund contributions from fee revenue
✅ Liquidity providers earning AMM fees (they are providing a service, not passively holding)
```

No SSS feature flags need to be disabled — the default configuration is compliant.

---

## 7. Private Key Custody

### GENIUS Act §7: Regulated Custody

The Act requires private keys controlling payment stablecoins to be held by **federally or state-chartered regulated entities** (national banks, state money transmitters with qualifying custody licenses).

### SSS Approach: Squads V4 Multisig

SSS uses **Squads V4** (`FLAG_SQUADS_AUTHORITY`) for all admin key management:

```
┌──────────────────────────────────────────────────┐
│              Squads V4 Multisig Vault            │
│                                                  │
│  Signers: CEO key (regulated custodian A)        │
│           CFO key (regulated custodian B)        │
│           Legal key (regulated custodian C)      │
│                                                  │
│  Threshold: 2-of-3                               │
│  Timelock: 48h for critical ops (BUG-010)        │
└──────────────────────────────────────────────────┘
              ↓ approves
    SSS admin instructions (mint, burn, pause,
    reserve update, blacklist, authority rotation)
```

Each signer key must be held by a **qualified custodian** meeting GENIUS §7 requirements. Options:
- National bank with trust powers
- State-chartered trust company
- Federally insured credit union
- FinCEN-registered MSB with custody licence

> **Note:** Squads V4 is a smart contract on Solana. The individual signer keys within the multisig must be custodied by regulated entities. The smart contract itself does not provide regulatory custody — it enforces the threshold logic.

Reference: [on-chain-sdk-admin-timelock.md](./on-chain-sdk-admin-timelock.md), [AUTHORITY-ROTATION.md](./AUTHORITY-ROTATION.md).

---

## 8. Sample Compliant `initialize` Configuration

This configuration targets GENIUS Act compliance using the SSS-3 (Regulated Stablecoin) preset.

```typescript
import { initializeStablecoin } from '@sss/on-chain-sdk';

const GENIUS_COMPLIANT_CONFIG = {
  // Preset: SSS-3 Regulated Stablecoin
  preset: 3,

  // Token parameters
  name: "USD StableToken",
  symbol: "USDST",
  decimals: 6,
  max_supply: 1_000_000_000_000_000n,  // 1B USDST (6 decimals); NEVER set to 0

  // Reserve (1:1 backing — GENIUS §4(a))
  reserve_vault: RESERVE_VAULT_PUBKEY,  // corresponds to FDIC bank account
  initial_reserve_amount: 0,            // set after first attestation

  // Governance (regulated custody — GENIUS §7)
  squads_multisig: SQUADS_V4_MULTISIG_PUBKEY,  // 2-of-3, all keys at regulated custodians
  guardian_pubkeys: [GUARDIAN_1, GUARDIAN_2, GUARDIAN_3],

  // Oracle
  pyth_feed: "0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a", // USDC/USD
  oracle_staleness_threshold_s: 60,
  oracle_confidence_bps: 100,

  // Feature flags (GENIUS compliance set)
  feature_flags:
    FLAG_CIRCUIT_BREAKER |       // emergency halt (§4(d))
    FLAG_TRAVEL_RULE |           // AML/BSA (§5)
    FLAG_SANCTIONS_ORACLE |      // OFAC screening (§5)
    FLAG_WALLET_RATE_LIMITS |    // fraud control
    FLAG_SQUADS_AUTHORITY |      // regulated custody (§7) — IRREVERSIBLE
    FLAG_POR_HALT_ON_BREACH |    // 1:1 enforcement (§4(a))
    FLAG_MARKET_MAKER_HOOKS,     // liquidity management

  // Sanctions oracle (§5)
  sanctions_oracle_endpoint: "https://compliance.yourprovider.com/v1/screen",

  // Travel Rule threshold (§5 — US $3,000)
  travel_rule_threshold_usd: 3000,

  // Minter cap (prevent uncapped minting)
  minter_cap: 10_000_000_000_000n,  // 10M USDST per authorized minter
};

// Deploy using wizard (SSS-155):
// npx ts-node scripts/deploy-wizard.ts
// Or programmatically:
await initializeStablecoin(connection, deployerKeypair, GENIUS_COMPLIANT_CONFIG);
```

---

## 9. What SSS Does NOT Cover

The following are **outside SSS's scope** and require independent legal/regulatory action:

| Item | Why It's Out of Scope | Action Required |
|---|---|---|
| Legal entity formation | SSS is a protocol, not a legal entity | Incorporate as a qualified payment stablecoin issuer (GENIUS §3) |
| Federal/state licensing | The GENIUS Act requires OCC approval (federal) or state licence (with federal non-objection) | Engage regulatory counsel; apply for GENIUS-compliant licence |
| FinCEN MSB registration | Required under BSA §5 | Register at fincen.gov before token issuance |
| SAR/CTR filing system | SSS emits events but does not file reports | Integrate with a BSA/AML compliance platform (e.g., Chainalysis, Elliptic) |
| Reserve bank account | SSS records the reserve amount but does not hold USD | Open segregated trust account at FDIC-insured institution |
| Auditor engagement | SSS does not perform attestations | Engage a registered public accounting firm for monthly attestations |
| Consumer disclosures | GENIUS §8 disclosure requirements | Prepare required disclosures with legal counsel |
| Token offering registration | May require SEC/state securities analysis | Obtain securities law opinion before public issuance |

---

## 10. Compliance Checker Script

Run the automated GENIUS compliance checker against a deployed mint:

```bash
npx ts-node scripts/check-genius-compliance.ts --mint <MINT_PUBKEY> [--rpc <RPC_URL>]
```

The script checks:
- ✅ `FLAG_POR_HALT_ON_BREACH` enabled
- ✅ `FLAG_SQUADS_AUTHORITY` enabled
- ✅ `FLAG_SANCTIONS_ORACLE` enabled
- ✅ `FLAG_TRAVEL_RULE` enabled
- ✅ `max_supply > 0` (not uncapped)
- ✅ `reserve_vault` set (non-default pubkey)
- ✅ Reserve ratio ≥ 100% (`reserve_amount ≥ circulating_supply`)
- ✅ Squads multisig on-chain (valid account)
- ✅ Last attestation within 35 days (monthly cadence)
- ⚠️ Warns on missing optional flags (ZK credentials, circuit breaker)

See [scripts/check-genius-compliance.ts](../scripts/check-genius-compliance.ts) for full source.

---

_Last updated: 2026-03-25 | Next review: Q2 2026 (before GENIUS enforcement date)_

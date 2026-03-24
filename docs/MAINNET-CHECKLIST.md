# SSS Mainnet Launch Checklist

_Task: SSS-109 | Author: sss-docs | Date: 2026-03-16_  
_Reference: GAPS-ANALYSIS-ANCHOR.md, devnet-deploy.md, audit/sss-030-mainnet-readiness_

> **This is the canonical go-live gate.** Every item below must be ✅ before deploying to Mainnet-Beta with real TVL. Items marked ⚠️ are required but carry known caveats. Items marked 🔲 are unchecked.

---

## 0. Prerequisites

| Item | Owner | Status |
|------|-------|--------|
| Independent security audit complete (OtterSec / Sec3 / Neodyme) | DAO / Team | 🔲 |
| Bug bounty program live (Immunefi or equivalent) | Team | 🔲 |
| Squads v4 multisig created (3-of-5 or higher) | Team | 🔲 |
| Multisig signers confirmed, keys secured offline | Signers | 🔲 |
| Emergency contact list compiled (all signers reachable 24/7) | Team | 🔲 |
| Devnet full smoke test passing (`npm run smoke:devnet`) | QA | 🔲 |

---

## 1. Program Build & Deployment

### 1.1 Build Verification

```bash
# Clean build from fresh checkout
git clean -fdx
anchor build

# Verify binary sizes
ls -lh target/deploy/*.so
# sss_token.so      expected ~300–600 KB
# sss_transfer_hook.so  expected ~100–300 KB

# Reproduce hash — compare with team-published checksums
sha256sum target/deploy/sss_token.so
sha256sum target/deploy/sss_transfer_hook.so
```

| Item | Status |
|------|--------|
| Build reproducible from clean checkout | 🔲 |
| Binary checksums match team-published hashes | 🔲 |
| No `TODO`, `FIXME`, `HACK` in `programs/` source | ✅ (SSS-030 scan clean) |
| `[programs.mainnet]` section added to `Anchor.toml` | 🔲 |
| `[provider] cluster = "Mainnet"` set in `Anchor.toml` | 🔲 |

### 1.2 Deploy to Mainnet-Beta

```bash
# Switch CLI to mainnet
solana config set --url mainnet-beta

# Fund deployer wallet (need ~10 SOL for buffers)
solana balance

# Deploy — DO NOT use --upgrade-authority with deployer key;
# deploy to a buffer first, then upgrade via multisig
anchor deploy --provider.cluster mainnet-beta

# Record program IDs immediately
solana program show <PROGRAM_ID>
```

| Item | Status |
|------|--------|
| `sss_token` deployed to mainnet | 🔲 |
| `sss_transfer_hook` deployed to mainnet | 🔲 |
| Mainnet program IDs recorded in `deploy/mainnet-latest.json` | 🔲 |
| `declare_id!` updated to mainnet IDs and programs rebuilt | 🔲 |
| Buffer sizes ≥ 2× current binary (room for future upgrades) | 🔲 |

---

## 2. Upgrade Authority → Squads Multisig

> **Critical.** If the deployer keypair remains upgrade authority, a single key compromise gives an attacker full program control.

> **⚠️ Audit finding H-1 — No on-chain upgrade timelock (checklist-only).** Solana's BPF loader does not enforce a timelock on program upgrades. The SSS admin timelock (Section 5f of DEPLOYMENT-GUIDE.md) only applies to `admin` instructions — it does **not** block an instantaneous BPF upgrade once the multisig threshold is reached. This is a platform limitation. All signers must understand this: approving an upgrade proposal in Squads replaces the program immediately. Use a high multisig threshold (4-of-5 or 5-of-5) for upgrade proposals and monitor for upgrade authority changes via your alerting pipeline (see Section 11 below).

```bash
# Transfer sss_token upgrade authority to multisig
solana program set-upgrade-authority <SSS_TOKEN_MAINNET_ID> \
  --new-upgrade-authority <SQUADS_MULTISIG_PUBKEY> \
  --keypair ~/.config/solana/deployer.json

# Transfer sss_transfer_hook upgrade authority
solana program set-upgrade-authority <TRANSFER_HOOK_MAINNET_ID> \
  --new-upgrade-authority <SQUADS_MULTISIG_PUBKEY> \
  --keypair ~/.config/solana/deployer.json

# Verify — output must show multisig as upgrade authority
solana program show <SSS_TOKEN_MAINNET_ID>
solana program show <TRANSFER_HOOK_MAINNET_ID>
```

| Item | Status |
|------|--------|
| `sss_token` upgrade authority → Squads multisig | 🔲 |
| `sss_transfer_hook` upgrade authority → Squads multisig | 🔲 |
| Deployer keypair upgrade authority revoked | 🔲 |
| `solana program show` confirms multisig on both programs | 🔲 |
| Upgrade multisig threshold set to 4-of-5 or higher (not same as operational threshold) | 🔲 |
| Team briefed: BPF upgrades take effect immediately with no on-chain timelock | 🔲 |
| **[Regulated/SSS-4 issuers only]** Immutable deployment (`--final`) considered and decision documented | 🔲 |

---

## 3. Admin Authority Transfer

> Transfer on-chain `authority` and `compliance_authority` from deployer to multisig via the two-step pattern.

```typescript
// Step 1 — Propose transfer (call as current authority)
await stablecoin.updateRoles({ pendingAuthority: squadsPubkey });

// Step 2 — Accept (call as multisig via Squads proposal)
await stablecoin.acceptAuthority();

// Repeat for compliance authority
await stablecoin.updateRoles({ pendingComplianceAuthority: complianceMultisig });
await stablecoin.acceptComplianceAuthority();
```

| Item | Status |
|------|--------|
| `authority` transferred to Squads multisig | 🔲 |
| `compliance_authority` transferred to compliance multisig | 🔲 |
| Deployer wallet retains no on-chain authority | 🔲 |
| All authority transfers verified on-chain via `getConfig()` | 🔲 |

---

## 4. Pyth Oracle Validation

> SSS-3 CDPs depend on Pyth price feeds. Stale or wide-confidence feeds must be rejected.

### 4.1 Feed Validation Pre-Launch

```bash
# Verify Pyth feed IDs for each collateral asset
# SOL/USD:  0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d
# USDC/USD: 0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a

# Check feed is publishing on mainnet (use Pyth Explorer)
# https://pyth.network/price-feeds

# Test staleness window
# StablecoinConfig.max_oracle_staleness_secs should be ≤ 60s for mainnet
```

| Item | Status |
|------|--------|
| Pyth feed IDs verified for each supported collateral | 🔲 |
| Feeds confirmed publishing on Pyth mainnet | 🔲 |
| `max_oracle_staleness_secs` set (≤ 60s recommended) | 🔲 |
| `max_oracle_conf_bps` set (≤ 100 = 1% recommended) | 🔲 |
| `get_price_no_older_than` staleness check active in program | 🔲 |
| Confidence interval check active in program | 🔲 |
| Manual test: stale feed → `OracleStalePriceFeed` error returned | 🔲 |
| Manual test: wide conf interval → `OracleConfidenceTooWide` error | 🔲 |

### 4.2 Pyth Feed Monitoring Setup

| Item | Status |
|------|--------|
| Alert configured: Pyth feed stale > 30s → PagerDuty / Discord | 🔲 |
| Alert configured: Pyth confidence spike > 2% | 🔲 |
| Fallback oracle plan documented (Switchboard / Chainlink) | 🔲 |

---

## 5. Circuit Breaker Tuning

> The `pause` / `unpause` authority is the primary circuit breaker. Parameters must be set conservatively at launch.

### 5.1 CDP Borrow Parameters

| Parameter | Recommended Mainnet Value | Rationale | Status |
|-----------|--------------------------|-----------|--------|
| `min_collateral_ratio_bps` | 15000 (150%) | Conservative for launch | 🔲 |
| `liquidation_threshold_bps` | 12000 (120%) | 30% buffer above minimum | 🔲 |
| `liquidation_bonus_bps` | 500–1000 (5–10%) | 5% min; raise to 10% if liquidation bots insufficient | 🔲 |
| `debt_ceiling` (per config) | Start low (e.g. $1M) | Scale up as protocol proves stability | 🔲 |
| `max_oracle_staleness_secs` | 60 | See Section 4 | 🔲 |
| `max_oracle_conf_bps` | 100 | See Section 4 | 🔲 |

### 5.2 Pause Triggers (Document Before Launch)

Define clear criteria for the multisig to call `pause()` immediately:

- [ ] Oracle price deviation > 10% in a single slot
- [ ] Pyth feed stale > 60 seconds
- [ ] Unexpected mint/burn volume spike > 5× hourly average
- [ ] Any on-chain exploit alert from security monitoring
- [ ] Cluster-level Solana incident (validator outage, fork)

| Item | Status |
|------|--------|
| Pause criteria documented and shared with all multisig signers | 🔲 |
| Pause response drill completed (all signers can pause within 5 min) | 🔲 |
| Unpause requires DAO proposal or 4-of-5 multisig approval | 🔲 |

---

## 6. Backstop Fund Seeding

> A surplus/backstop vault absorbs bad debt when CDP liquidations are unprofitable. See GAP-003.

| Item | Status |
|------|--------|
| `SurplusVault` PDA initialized on mainnet | 🔲 |
| Initial backstop seed deposited (recommend ≥ 1% of target TVL) | 🔲 |
| Stability fee routing to `SurplusVault` active and tested | 🔲 |
| Backstop balance monitoring alert configured (< 0.5% TVL → alert) | 🔲 |
| Bad debt write-off threshold documented (> $X → governance proposal) | 🔲 |

---

## 7. DAO / Governance Setup

| Item | Status |
|------|--------|
| DAO program deployed (SPL Governance or equivalent) | 🔲 |
| Governance token (if applicable) minted and distributed | 🔲 |
| Treasury multisig configured as DAO treasury | 🔲 |
| Quorum and threshold parameters set and announced | 🔲 |
| First governance proposal: ratify mainnet parameters | 🔲 |
| Timelock on all privileged instructions (min 24h recommended) | 🔲 |
| Emergency bypass procedure (multisig can act within timelock if exploit) | 🔲 |
| DAO docs published (`GOVERNANCE.md` or equivalent) | 🔲 |

---

## 8. ZK Verifier Whitelisting

> SSS-2 compliance hooks use ZK proofs. Only whitelisted verifier programs should be trusted.

| Item | Status |
|------|--------|
| Verifier program IDs audited | 🔲 |
| Only audited verifier IDs whitelisted in `BlacklistState` / transfer hook config | 🔲 |
| No test/mock verifier IDs present on mainnet config | 🔲 |
| Verifier program upgrade authority also transferred to multisig | 🔲 |
| ZK proof format version pinned (breaking change policy documented) | 🔲 |
| End-to-end ZK compliance flow tested on mainnet with real proof | 🔲 |

---

## 9. Blacklist / Compliance Sanity Checks

| Item | Status |
|------|--------|
| Initial blacklist populated with OFAC-sanctioned addresses (if required) | 🔲 |
| Blacklist cap (100 entries) acknowledged; scaling plan documented | 🔲 |
| `compliance_authority` is a compliance-team multisig (not same as protocol authority) | 🔲 |
| Transfer hook verified active on SSS-2 mint | 🔲 |

---

## 10. Reserve Vault Ownership (SSS-3)

| Item | Status |
|------|--------|
| Reserve vault token account authority = config PDA (not deployer) | 🔲 |
| Verified: no external withdrawal possible outside `redeem` instruction | 🔲 |
| Collateral mint is the expected stablecoin (USDC mainnet address: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`) | 🔲 |
| `total_collateral` accounting tested against actual vault balance | 🔲 |

---

## 11. Monitoring & Alerting

| Item | Status |
|------|--------|
| On-chain event indexer live (WebSocket `/events` endpoint) | 🔲 |
| Dashboard: total supply, CDPs open, collateral ratio distribution | 🔲 |
| Alert: any CDP below 130% CR | 🔲 |
| Alert: total supply change > 5% in 1 hour | 🔲 |
| Alert: reserve vault balance diverges from `total_collateral` by > 0.1% | 🔲 |
| Alert: program upgrade authority change detected | 🔲 |
| PagerDuty / on-call rotation configured for P0 alerts | 🔲 |

---

## 12. Incident Response

- See **[INCIDENT-RESPONSE.md](./INCIDENT-RESPONSE.md)** for the full runbook.
- All multisig signers must read the runbook before launch.
- Response drills must be completed for: oracle failure, circuit breaker trigger, admin key compromise.

---

## 13. Final Pre-Launch Sign-Off

| Signer | Role | Signature | Date |
|--------|------|-----------|------|
| | Lead Engineer | | |
| | Security Lead | | |
| | DAO / Governance | | |
| | Compliance Officer | | |

> **Launch is blocked until all 🔲 items are resolved or explicitly waived with written justification.**

---

## Appendix A — Known Gaps at Launch (Accepted Risk)

These items from GAPS-ANALYSIS-ANCHOR.md are **not** blocking launch if debt ceiling is set low, but must be resolved before scaling TVL:

| Gap | Risk | TVL Threshold to Fix |
|-----|------|---------------------|
| GAP-001: No TWAP smoothing | Flash-crash oracle manipulation | $5M TVL |
| GAP-002: No stability fee accrual | Zero protocol revenue | $1M TVL |
| GAP-003: No surplus buffer on-chain | Bad debt with no coverage | $1M TVL |
| GAP-005: Full liquidation only (no partial) | Borrower UX, liquidation efficiency | $5M TVL |
| Blacklist 100-entry cap | Compliance scaling | When > 80 addresses blacklisted |

---

_Last updated: 2026-03-16 by sss-docs_

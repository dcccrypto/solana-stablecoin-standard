# SSS Recovery Plan Template

_Author: sss-docs | Task: SSS-149 | Date: 2026-03-25_
_Regulatory basis: MiCA Art. 46 (recovery plans) + Art. 45 (liquidity requirements)_
_For: Significant ARTs and significant e-money tokens under MiCA_

> **Instructions for Issuers:** This is a fill-in-the-blank template. Replace all `[PLACEHOLDER]` items with your specific details before submission to your national competent authority (NCA). Retain a copy; update at least annually and after any material change to your stablecoin or organisation.
>
> **Legal disclaimer:** This template is provided for technical orientation only and does not constitute legal or regulatory advice. Consult qualified EU regulatory counsel before submitting to any NCA.

---

## Document Header

| Field | Value |
|---|---|
| **Issuer legal name** | [LEGAL_ENTITY_NAME] |
| **Token name / symbol** | [TOKEN_NAME] / [SYMBOL] |
| **Competent authority** | [NCA_NAME], [MEMBER_STATE] |
| **Plan version** | [VERSION e.g. 1.0] |
| **Effective date** | [DATE] |
| **Approved by** | [BOARD_RESOLUTION_REF] |
| **Next review date** | [DATE + 1 year] |

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Trigger Scenarios](#2-trigger-scenarios)
3. [Escalation Procedures](#3-escalation-procedures)
4. [Guardian Multisig Emergency Actions](#4-guardian-multisig-emergency-actions)
5. [Communication Templates](#5-communication-templates)
6. [Regulator Notification Timeline](#6-regulator-notification-timeline)
7. [Recovery Measures by Scenario](#7-recovery-measures-by-scenario)
8. [Contacts and Responsibilities](#8-contacts-and-responsibilities)
9. [Testing and Maintenance](#9-testing-and-maintenance)
10. [Appendices](#10-appendices)

---

## 1. Executive Summary

[ISSUER_NAME] issues [TOKEN_NAME] ([SYMBOL]), an [ART / e-money token] on the Solana blockchain, using the Solana Stablecoin Standard (SSS) protocol. This recovery plan describes the measures the issuer will take in the event of a material stress or disruption that threatens the stability, solvency, or orderly wind-down of the token.

This plan is prepared in accordance with MiCA Article 46 and the EBA Guidelines on recovery plans for ARTs and e-money tokens. It is subject to NCA review and approval.

**Token overview:**
- Blockchain: Solana mainnet
- Reserve composition: [e.g., 60% T-bills, 30% USDC, 10% cash at [BANK]]
- Total issuance cap: [MAX_SUPPLY]
- Current TVL at plan date: [TVL]
- Significant token status: [Yes / No — if Yes, EBA supervision applies]

---

## 2. Trigger Scenarios

The following scenarios trigger this recovery plan. Each scenario maps to a **Severity Level** (1–3):

| Level | Description | Threshold |
|---|---|---|
| **1 — Watch** | Early warning; monitoring elevated | See per-scenario below |
| **2 — Alert** | Material stress; management action required | See per-scenario below |
| **3 — Crisis** | Immediate escalation; guardian multisig activated; NCA notification | See per-scenario below |

### Scenario A: Peg Break

| Level | Trigger |
|---|---|
| 1 | Token trades >0.5% off peg for >15 minutes on any major venue |
| 2 | Token trades >2% off peg for >1 hour |
| 3 | Token trades >5% off peg for >4 hours, or flash crash >10% |

**Likely causes:** oracle staleness, AMM liquidity drain, coordinated sell, market maker withdrawal, external event (issuer insolvency rumour).

### Scenario B: Reserve Shortfall

| Level | Trigger |
|---|---|
| 1 | Reserve ratio 95–100% (on-chain `reserve_amount < circulating_supply * 0.97`) |
| 2 | Reserve ratio 90–95% |
| 3 | Reserve ratio <90%, or on-chain `FLAG_POR_HALT_ON_BREACH` triggers minting halt |

**Likely causes:** bank failure, custodian freeze, collateral valuation error, attestation error.

### Scenario C: Oracle Failure

| Level | Trigger |
|---|---|
| 1 | Primary oracle (Pyth) stale >60s |
| 2 | Primary oracle stale >5 min; fallback oracle not responding |
| 3 | Both oracles offline >15 min; on-chain circuit breaker tripped |

**Likely causes:** Pyth network outage, validator issues, upstream data provider failure.

### Scenario D: Key Compromise or Smart Contract Exploit

| Level | Trigger |
|---|---|
| 1 | Suspicious admin transaction detected; unusual mint/burn activity |
| 2 | Confirmed unauthorised admin operation; funds moved without approval |
| 3 | Smart contract exploit confirmed; significant loss of funds |

**Likely causes:** private key exfiltration, supply chain attack, protocol bug.

### Scenario E: Redemption Rush

| Level | Trigger |
|---|---|
| 1 | Redemption requests >10% of TVL in 24 hours |
| 2 | Redemption requests >25% of TVL in 24 hours; pool drawdown >50% |
| 3 | Pool drain imminent (<12 hours); SLA breach likely |

**Likely causes:** macro shock, issuer reputational event, regulatory action rumour.

---

## 3. Escalation Procedures

### Level 1 — Watch

1. Automated monitoring alert to **on-call engineer** (PagerDuty / equivalent)
2. On-call engineer validates alert, posts to `#ops-alerts` channel
3. Monitoring frequency increases to every 60 seconds
4. **No public communication required**; internal only

### Level 2 — Alert

1. On-call engineer escalates to **Incident Commander** (see Section 8)
2. Incident Commander convenes **Crisis Team** (bridge call within 15 minutes)
3. Crisis Team assesses root cause; decides on containment measures
4. Squads multisig operators placed on standby
5. Legal/Compliance notified; NCA pre-notification call placed (if Level 2 sustained >2 hours)
6. Internal status page updated

### Level 3 — Crisis

1. Incident Commander declares Level 3; **Guardian Multisig** activated
2. All non-essential write operations paused via `guardian_pause`
3. NCA notification within **2 hours** (see Section 6)
4. Public communication within **4 hours** (see Section 5)
5. Board notified immediately
6. External crisis communications firm engaged (see Section 8)
7. Hourly status updates until resolution

---

## 4. Guardian Multisig Emergency Actions

All emergency actions are executed via the **Squads V4 multisig** (threshold: [THRESHOLD]-of-[TOTAL]). Time-sensitive operations bypass the standard [48h] timelock under the `guardian_emergency` instruction.

### A. Emergency Pause (All Operations)

```bash
# Pause all minting, burning, and transfers
POST /api/admin/pause
{ "reason": "MiCA Art.46 recovery plan — Level 3 activated", "incident_ref": "[INCIDENT_ID]" }

# On-chain: guardian_pause instruction via Squads multisig
# Required signers: [MIN_GUARDIAN_SIGNERS]-of-[TOTAL_GUARDIANS]
```

Reference: [GUARDIAN-PAUSE.md](./GUARDIAN-PAUSE.md)

### B. Redemption Rate Limiting

```bash
# Reduce wallet redemption limit to manage run
POST /api/admin/update-rate-limit
{ "redemption_daily_cap_usd": 50000, "incident_ref": "[INCIDENT_ID]" }
```

Reference: [WALLET-RATE-LIMIT.md](./WALLET-RATE-LIMIT.md)

> **MiCA Art. 45 note:** Rate limits must be disclosed; they cannot be used to permanently prevent redemption at par.

### C. Oracle Fallback Activation

```bash
# Switch to backup oracle endpoint
POST /api/admin/update-oracle
{ "primary": "[FALLBACK_ORACLE_PUBKEY]", "incident_ref": "[INCIDENT_ID]" }
```

Reference: [ORACLE-ABSTRACTION.md](./ORACLE-ABSTRACTION.md)

### D. Reserve Top-Up

```bash
# Submit updated reserve amount after emergency top-up
POST /api/admin/reserve-report
{ "amount": [NEW_RESERVE_USD_CENTS], "attestation_hash": "[HASH]", "emergency": true }
```

### E. Authority Rotation (Key Compromise)

```bash
# Rotate compromised admin key to new secure key
POST /api/admin/rotate-authority
{ "new_authority": "[NEW_PUBKEY]", "reason": "key compromise — MiCA recovery", "incident_ref": "[INCIDENT_ID]" }
```

Reference: [AUTHORITY-ROTATION.md](./AUTHORITY-ROTATION.md)

### F. Orderly Wind-Down (Last Resort)

If recovery is not possible, the following sequence initiates orderly wind-down per MiCA Art. 47:

```
1. Halt all new minting
2. Announce 30-day redemption window (all holders notified)
3. Maintain 1:1 redemption at par for all outstanding tokens
4. Burn all redeemed tokens
5. Liquidate remaining reserves; pay out to remaining holders pro-rata
6. Notify NCA of wind-down completion
7. Revoke token registration under MiCA Art. 47(3)
```

---

## 5. Communication Templates

### Template A: Initial Public Incident Notice (Level 2+)

> **[TOKEN_NAME] — Service Notice — [DATE TIME UTC]**
>
> We are aware of [brief description, e.g., "elevated redemption requests / price deviation / technical issue"] affecting [TOKEN_NAME]. Our team is actively investigating. All user funds are safe. We will provide an update within [1/2/4] hours.
>
> — [ISSUER_NAME] Operations Team

**Channels:** Token website, official X account, [DISCORD_SERVER], [TELEGRAM_CHANNEL].

### Template B: Level 3 Crisis Notice

> **[TOKEN_NAME] — Important Update — [DATE TIME UTC]**
>
> [TOKEN_NAME] is currently experiencing [description of issue]. We have activated our recovery plan and are taking the following steps:
> - [ACTION 1]
> - [ACTION 2]
> - Redemptions at par remain [available / temporarily rate-limited as per our terms]
>
> Our reserve ratio is currently [X]%. All reserve assets are held at [CUSTODIAN].
>
> We have notified [NCA_NAME] and are cooperating fully with regulators. Next update: [TIME].
>
> — [CEO_NAME], [ISSUER_NAME]

### Template C: All-Clear Notice

> **[TOKEN_NAME] — Resolved — [DATE TIME UTC]**
>
> The incident affecting [TOKEN_NAME] has been resolved. [Brief summary of what happened and how it was fixed.] Token trading and redemptions have returned to normal. A full post-mortem report will be published within 7 days.
>
> — [ISSUER_NAME] Operations Team

### Template D: NCA Notification Email (see Section 6 for full template)

---

## 6. Regulator Notification Timeline

### ESMA / EBA and NCA Obligations

Under MiCA and EBA Guidelines:

| Event | Deadline | Recipient | Form |
|---|---|---|---|
| Level 3 declared | Within **2 hours** | NCA: [NCA_EMAIL] | Phone call + email (Template D below) |
| Initial written report | Within **24 hours** | NCA + EBA (if significant issuer) | Formal notification |
| Ongoing updates | Every **24 hours** during crisis | NCA | Email |
| Post-incident report | Within **30 days** | NCA + EBA | Full RCA + lessons learned |

### Template D: NCA Initial Notification Email

```
Subject: [TOKEN_NAME] — MiCA Art. 46 Recovery Plan Activation — [DATE]

Dear [NCA_CONTACT_NAME],

[ISSUER_NAME] hereby notifies [NCA_NAME] of the activation of our MiCA Article 46
recovery plan for [TOKEN_NAME] ([SYMBOL]).

Incident ID:       [INCIDENT_ID]
Activation time:   [UTC_TIMESTAMP]
Trigger scenario:  [SCENARIO_LETTER AND DESCRIPTION]
Severity level:    Level 3

Current status:
- Reserve ratio: [X]%
- Circulating supply: [AMOUNT]
- Peg deviation: [X]% (if applicable)

Actions taken:
1. [ACTION]
2. [ACTION]

Estimated time to resolution: [ESTIMATE or UNKNOWN]

Incident commander: [NAME], [PHONE], [EMAIL]

We will provide hourly updates until resolution.

[AUTHORISED SIGNATORY]
[TITLE]
[ISSUER_NAME]
```

### NCA Emergency Contacts

| Authority | Contact | Phone |
|---|---|---|
| [NCA_NAME] | [NCA_CONTACT_NAME] ([NCA_EMAIL]) | [PHONE] |
| EBA (if significant issuer) | [EBA_CONTACT] | [PHONE] |
| ESMA (cross-border) | [ESMA_CONTACT] | [PHONE] |

---

## 7. Recovery Measures by Scenario

### Scenario A — Peg Break Recovery

1. **Investigate cause:** oracle price vs CEX price; AMM depth; order flow
2. **If oracle stale:** activate fallback oracle (Section 4C)
3. **If AMM illiquid:** engage [MARKET_MAKER_NAME] under SLA (max response time: [X] hours); reference [MARKET-MAKER-HOOKS.md](./MARKET-MAKER-HOOKS.md)
4. **If sell pressure from macro:** communicate reserve status publicly; provide real-time reserve dashboard link
5. **If >5% deviation persists >4h:** pause minting (not redemption); rate-limit redemptions if run risk
6. **Arbitage self-healing:** 1:1 redemption at par creates arbitrage floor; ensure redemption API is operational

### Scenario B — Reserve Shortfall Recovery

1. **Identify shortfall source:** bank wire delay vs actual loss vs attestation error
2. **Emergency top-up:** transfer additional reserves from [EMERGENCY_RESERVE_FACILITY] within [X] hours
3. **If bank failure:** activate [BACKUP_CUSTODIAN] reserve facility; update `reserve_vault` pubkey
4. **Submit emergency attestation:** engage auditor for emergency attestation within 24h
5. **If ratio <90% for >24h:** notify NCA; publish daily reserve updates; MiCA Art. 45 cooling-off may apply
6. **Worst case:** halt minting; maintain redemption at par from existing reserves

### Scenario C — Oracle Failure Recovery

1. **Pyth timeout <5min:** automated fallback to secondary oracle; no action required
2. **Both oracles down >15min:** circuit breaker trips; minting/burning suspended until oracles restore
3. **If oracle infrastructure is compromised:** escalate to Pyth team ([PYTH_ESCALATION_CONTACT]); use on-chain TWAP as temporary measure
4. **Resume:** re-enable when primary oracle resumes with <30s staleness; monitor for 1h before full resume

### Scenario D — Key Compromise / Exploit

1. **Immediate:** pause ALL operations (guardian_pause)
2. **Rotate** all potentially compromised keys (Section 4E)
3. **Audit:** engage [SECURITY_FIRM] for emergency audit of on-chain state within 6h
4. **Quarantine:** blacklist any wallets that received unauthorised transfers
5. **Remediation:** patch contract (if bug) via governance + timelock; note: timelock bypass requires guardian multisig
6. **Disclose:** full disclosure to NCA within 2h; public disclosure within 24h
7. **Post-mortem:** root cause analysis; update controls

### Scenario E — Redemption Rush

1. **Level 1:** Monitor; pre-position liquidity in redemption pool
2. **Level 2:** Engage [LIQUIDITY_PROVIDER] for emergency liquidity line; reference [REDEMPTION-POOL.md](./REDEMPTION-POOL.md) + [LIQUIDITY-GUIDE.md](./LIQUIDITY-GUIDE.md)
3. **Level 3:** Rate-limit individual redemptions (not total redemption); communicate estimated processing time
4. **Run the liquidity stress test:** `npx ts-node scripts/liquidity-stress-test.ts --tvl [TVL] --rate [RATE]`
5. **Last resort:** pause new minting; burn from insurance fund to top up redemption pool; see [REDEMPTION-GUARANTEE.md](./REDEMPTION-GUARANTEE.md)

---

## 8. Contacts and Responsibilities

| Role | Name | Phone | Email | Backup |
|---|---|---|---|---|
| Incident Commander | [NAME] | [PHONE] | [EMAIL] | [BACKUP_NAME] |
| CEO | [NAME] | [PHONE] | [EMAIL] | — |
| CFO | [NAME] | [PHONE] | [EMAIL] | — |
| CTO / Tech Lead | [NAME] | [PHONE] | [EMAIL] | [BACKUP] |
| Legal / Compliance | [NAME] | [PHONE] | [EMAIL] | [BACKUP] |
| PR / Comms | [NAME] | [PHONE] | [EMAIL] | [BACKUP] |
| Guardian Key Holder 1 | [NAME / CUSTODIAN] | [PHONE] | [EMAIL] | — |
| Guardian Key Holder 2 | [NAME / CUSTODIAN] | [PHONE] | [EMAIL] | — |
| Guardian Key Holder 3 | [NAME / CUSTODIAN] | [PHONE] | [EMAIL] | — |
| Market Maker | [MM_NAME] | [PHONE] | [EMAIL] | [BACKUP_MM] |
| Reserve Custodian | [BANK_NAME] | [PHONE] | [RELATIONSHIP_MANAGER] | — |
| Audit Firm | [FIRM_NAME] | [PHONE] | [EMAIL] | — |
| Security Firm | [FIRM_NAME] | [PHONE] | [EMAIL] | — |
| NCA Contact | [NAME] | [PHONE] | [EMAIL] | — |

---

## 9. Testing and Maintenance

### Annual Tabletop Exercise

The issuer will conduct an annual tabletop simulation of at least two trigger scenarios (one redemption rush, one key compromise) covering:
- Escalation procedure drill
- Guardian multisig signing ceremony on testnet
- Communication template rehearsal
- NCA notification simulation

**Last exercise:** [DATE]
**Next exercise:** [DATE]

### Plan Updates

This plan must be updated:
- Annually (at minimum)
- After any Level 3 incident
- After any material change to: token architecture, reserve composition, key custodians, NCA requirements, or MiCA implementing acts

**Version history:**

| Version | Date | Change summary | Approved by |
|---|---|---|---|
| 1.0 | [DATE] | Initial plan | [NAME] |

---

## 10. Appendices

### Appendix A: SSS Feature Flag Reference

| Flag | Bit | Purpose in Recovery |
|---|---|---|
| `FLAG_CIRCUIT_BREAKER` | 0 | Emergency halt all operations |
| `FLAG_GUARDIAN_PAUSE` | — | Guardian-multisig-controlled subset pause |
| `FLAG_POR_HALT_ON_BREACH` | 16 | Auto-halts minting if reserve ratio <100% |
| `FLAG_WALLET_RATE_LIMITS` | 12 | Rate-limit individual redemptions |
| `FLAG_SQUADS_AUTHORITY` | 13 | Multisig controls all admin ops |

### Appendix B: Liquidity Stress Test

Run before activating redemption rate limits:

```bash
npx ts-node scripts/liquidity-stress-test.ts \
  --tvl [TVL_USD] \
  --pool-size [POOL_USD] \
  --insurance [INSURANCE_FUND_USD] \
  --rate [DAILY_REDEMPTION_RATE_PERCENT]
```

Reference: [scripts/liquidity-stress-test.ts](../scripts/liquidity-stress-test.ts)

### Appendix C: On-Chain State Snapshot Command

```bash
# Capture full on-chain state for NCA submission
npx ts-node scripts/check-deployment.ts --mint [MINT_PUBKEY] --rpc [MAINNET_RPC] --json > incident-state-$(date +%Y%m%dT%H%M%S).json
```

---

_Template version 1.0 | SSS-149 | 2026-03-25_
_MiCA Art. 46 / Art. 45 | EBA Guidelines on recovery plans_

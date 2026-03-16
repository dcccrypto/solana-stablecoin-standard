# SSS Incident Response Runbook

_Task: SSS-109 | Author: sss-docs | Date: 2026-03-16_  
_Reference: GAPS-ANALYSIS-ANCHOR.md, MAINNET-CHECKLIST.md_

> **Who must read this:** All multisig signers, the on-call engineer, and anyone with `pause` authority.  
> Keep a printed copy offline. Discord/Telegram can be down during an incident.

---

## 0. Incident Severity Levels

| Level | Description | Response Time | Action |
|-------|-------------|---------------|--------|
| **P0** | Active exploit, fund loss occurring | < 5 minutes | Pause protocol immediately |
| **P1** | Imminent risk (oracle failure, circuit breaker near trigger) | < 15 minutes | Assemble team, assess pause |
| **P2** | Degraded operation (monitoring gaps, slow liquidations) | < 1 hour | Diagnose, patch plan |
| **P3** | Non-urgent issue (docs, minor bug, config drift) | Next business day | Triage |

---

## 1. Oracle Failure

**Symptoms:**
- Pyth feed not updating (staleness alert fires)
- Confidence interval spiking > 2%
- `OracleStalePriceFeed` or `OracleConfidenceTooWide` errors in program logs
- CDP borrows / liquidations reverting unexpectedly

### Runbook

**Step 1 — Confirm the failure**
```bash
# Check Pyth publisher status
curl https://hermes.pyth.network/v2/updates/price/latest?ids[]=<FEED_ID>
# Check publish_time vs current UNIX timestamp — gap > 60s = stale

# Check Solana explorer for recent program errors
# https://explorer.solana.com/address/<PROGRAM_ID>?cluster=mainnet-beta
```

**Step 2 — Assess severity**
- Feed stale 1–5 min, no CDPs near liquidation threshold → **P1**, monitor closely
- Feed stale > 5 min, CDPs < 130% CR exist → **P0**, proceed to Step 3 immediately
- Feed publishing but confidence wide → check if `max_oracle_conf_bps` gate is rejecting transactions

**Step 3 — Pause if P0**
```typescript
// Call as multisig via Squads proposal (expedited 1-of-5 for P0)
await stablecoin.pause();
// Confirm: all mint/burn/borrow/liquidate instructions now fail
```

**Step 4 — Communicate**
- Post in `#incidents` Discord channel within 10 minutes
- Notify all multisig signers
- Template: _"[INCIDENT] Oracle failure detected for [FEED]. Protocol paused at [TIME]. CDPs are frozen. Investigating."_

**Step 5 — Resolve**
- If Pyth feed recovers and staleness < 60s → verify confidence interval is normal
- If Pyth feed down > 30 min → escalate to fallback oracle plan (see below)
- Multisig proposes `unpause()` only after feed confirmed healthy for > 5 min continuously

**Fallback Oracle Plan (if Pyth unavailable > 1 hour):**
1. Assess whether a Switchboard or Chainlink feed is available for the asset
2. Multisig votes to update `expected_pyth_feed` to fallback feed ID via `update_oracle_params`
3. Announce feed change in Discord + on-chain event
4. Monitor closely for 1 hour post-switch
5. Switch back to Pyth when recovered

**Post-Incident:**
- [ ] Write incident report (timeline, root cause, resolution)
- [ ] File issue: implement dual-oracle fallback (GAP-001)
- [ ] Update alert thresholds if needed

---

## 2. Circuit Breaker Trigger

**Symptoms:**
- CDP collateral ratio distribution shifting toward liquidation threshold
- Rapid collateral price drop (> 10% in 1 hour)
- Liquidation volume spike
- Backstop vault balance falling

### Runbook

**Step 1 — Assess market conditions**
```bash
# Check collateral price on CoinGecko / Pyth
# Estimate how many CDPs are below 130% CR
# Check liquidation bot activity (are bots running?)
```

**Step 2 — Decision matrix**

| Collateral Price Drop | CDPs Below 130% CR | Action |
|-----------------------|--------------------|--------|
| < 10% | < 5% of TVL | Monitor; alert team |
| 10–20% | 5–20% of TVL | Assemble team; prepare to pause |
| > 20% | > 20% of TVL | **Pause immediately** |

**Step 3 — Manual liquidation sweep (if bots not running)**
```bash
# Run liquidation bot manually
cd ~/repos/sss-liquidator   # or equivalent
npm run liquidate:mainnet -- --min-cr 125 --dry-run
# Verify output, then run without --dry-run
npm run liquidate:mainnet -- --min-cr 125
```

**Step 4 — Pause if needed**
```typescript
await stablecoin.pause();
```

**Step 5 — Assess bad debt**
```typescript
// After pause, enumerate underwater CDPs
const config = await stablecoin.getConfig();
const positions = await stablecoin.getAllCdpPositions();
const price = await stablecoin.getCurrentOraclePrice();

const badDebt = positions
  .filter(p => p.collateralValue(price) < p.debtAmount)
  .reduce((sum, p) => sum + p.debtAmount - p.collateralValue(price), 0);

console.log(`Bad debt: ${badDebt} SSS tokens`);
console.log(`Backstop balance: ${await stablecoin.getBackstopBalance()} SSS tokens`);
```

**Step 6 — Bad debt resolution**
- If `badDebt < backstopBalance` → write off via `socialize_bad_debt` (if implemented), or governance proposal
- If `badDebt > backstopBalance` → **Emergency Protocol** (see Section 5)

**Step 7 — Unpause criteria**
- [ ] Collateral price stabilized > 30 min
- [ ] All CDPs above 130% CR (or underwater CDPs liquidated)
- [ ] Backstop balance > 0.5% of total supply
- [ ] Liquidation bots confirmed running
- [ ] 4-of-5 multisig approval for unpause

---

## 3. Bad Debt Event

**Symptoms:**
- Liquidation bot logs show positions where collateral value < debt
- `cdp_liquidate` calls reverting (liquidators not profitable)
- Backstop vault balance declining
- Total supply > reserve vault balance (SSS-3)

### Runbook

**Step 1 — Quantify**
```typescript
// Get all CDP positions
const underwater = positions.filter(p => 
  p.collateralValue(currentPrice) < p.debtAmount
);
const totalBadDebt = underwater.reduce((s, p) => s + p.debtAmount, 0n);
const backstop = await getBackstopBalance();

console.log(`Bad debt: ${totalBadDebt}, Backstop: ${backstop}`);
console.log(`Coverage ratio: ${Number(backstop) / Number(totalBadDebt) * 100}%`);
```

**Step 2 — Triage**
- Bad debt < backstop → covered; proceed to governance proposal to write off
- Bad debt > backstop → protocol insolvent; trigger Emergency Protocol (Section 5)

**Step 3 — Pause new borrows**
```typescript
// Pause only borrow operations if pause is granular
// Otherwise pause entire protocol
await stablecoin.pause();
```

**Step 4 — Governance proposal**
Draft proposal:
1. Socialize bad debt from backstop vault
2. Reduce debt ceiling until cause is fixed
3. If oracle-caused: fix oracle params before unpause
4. If liquidation-caused: increase liquidation bonus BPS before unpause

**Step 5 — Unpause after fix**
- Same criteria as Section 2 Step 7

---

## 4. Admin Key Compromise

**Symptoms:**
- Unexpected `update_roles`, `pause`, `update_minter`, or `revoke_minter` transactions
- Authority transferred to unknown address
- Minter cap removed or set to max
- Large unexpected mints

### Runbook

> **Time-critical. Every second matters.**

**Step 1 — Verify on-chain (15 seconds)**
```bash
# Check current authority on mainnet
solana account <CONFIG_PDA_ADDRESS> --output json | jq '.account.data'
# Compare authority field with known multisig address
```

**Step 2 — Pause immediately (target: < 2 minutes)**
- If multisig is intact: submit emergency `pause()` proposal (expedited 1-of-5)
- If multisig is compromised: contact Squads support for emergency freeze
- If unable to pause: publicly announce exploit on Twitter / Discord immediately to warn users

```typescript
// Emergency pause via Squads expedited proposal
const squads = new SquadsClient(connection);
await squads.createProposal({
  multisig: SQUADS_MULTISIG_PDA,
  instruction: pauseInstruction,
  expedited: true,
});
```

**Step 3 — Revoke compromised key**
- If deployer key compromised: key cannot be un-revoked, but it has no on-chain authority (if Section 2 of MAINNET-CHECKLIST done)
- If multisig signer compromised: initiate signer rotation via Squads (requires remaining quorum)
- If compliance authority compromised: authority requires `accept_compliance_authority` from new address — propose rotation via multisig

**Step 4 — Assess damage**
```bash
# Check total supply change since compromise
spl-token supply <MINT_ADDRESS>

# Check recent large mints/burns
# Use on-chain event indexer or Solana FM
```

**Step 5 — Communicate**
- Post on Discord, Twitter, Telegram immediately
- Template: _"[SECURITY] We detected unauthorized activity on SSS protocol at [TIME]. Protocol is paused. Funds in existing CDPs and vaults are frozen (not accessible to attacker while paused). We are investigating. Do NOT interact with the protocol."_

**Step 6 — Post-compromise**
- [ ] Rotate all multisig signers
- [ ] Deploy new program version with fresh authority if program itself was modified
- [ ] Conduct post-mortem (key management, operational security review)
- [ ] Engage security firm for forensic review

---

## 5. Emergency Protocol — Global Settlement

> Use when: protocol is insolvent (bad debt > backstop) AND cannot be made solvent without harming users disproportionately.

**Decision threshold:** Bad debt > 2× backstop balance AND no viable path to recapitalization within 72 hours.

**This requires:** DAO governance vote (or 5-of-5 multisig in extreme emergency).

### Settlement Process

**Phase 1 — Freeze (Day 0)**
```typescript
await stablecoin.pause(); // All operations frozen
// Announce: "Protocol entering controlled wind-down"
```

**Phase 2 — Snapshot (Day 0–1)**
```typescript
// Take snapshot of all positions
const snapshot = {
  timestamp: Date.now(),
  totalSupply: await getTokenSupply(),
  reserveBalance: await getReserveVaultBalance(),
  cdpPositions: await getAllCdpPositions(),
  backstopBalance: await getBackstopBalance(),
};
// Publish snapshot to IPFS / Arweave
```

**Phase 3 — Pro-rata redemption (Day 1–7)**
- Calculate recovery rate: `(reserveBalance + backstopBalance) / totalSupply`
- Deploy emergency redemption contract (or use existing `redeem` with pro-rata accounting)
- SSS token holders can redeem at recovery rate
- CDP borrowers: collateral returned net of pro-rata share of bad debt

**Phase 4 — Final settlement (Day 7–30)**
- Unclaimed collateral transferred to DAO treasury after 30 days
- Protocol declared wound down
- Post-mortem published

---

## 6. Devnet → Mainnet Migration Rollback

**When to rollback:** Critical bug discovered in mainnet program that was not caught on devnet.

### Runbook

**Step 1 — Assess rollback scope**
- Bug in program logic → upgrade to patched version (requires multisig)
- Bug in config parameters → update via `update_oracle_params` or equivalent
- Data migration needed → cannot rollback on-chain state; forward-fix only

**Step 2 — Patch and upgrade**
```bash
# Fix bug in programs/
anchor build

# Verify patched binary
sha256sum target/deploy/sss_token.so

# Propose upgrade via Squads
# Upload buffer
solana program write-buffer target/deploy/sss_token.so
# Note BUFFER_ADDRESS from output

# Propose upgrade in Squads UI or via CLI
solana program set-buffer-authority <BUFFER_ADDRESS> --new-buffer-authority <SQUADS_MULTISIG>
```

**Step 3 — Staged rollout**
1. Deploy fix to devnet; run full test suite
2. Multisig approves devnet results
3. Deploy fix to mainnet (buffer upgrade via Squads)
4. Verify fix on-chain with smoke test
5. Unpause if paused

**Step 4 — Communicate**
- Announce upgrade on Discord / Twitter before executing
- Post transaction ID of upgrade after completion
- Update `docs/devnet-deploy.md` with new program IDs if they changed

---

## 7. Contact & Escalation

| Role | Contact | Availability |
|------|---------|--------------|
| On-call Engineer | [To be filled] | 24/7 for P0/P1 |
| Security Lead | [To be filled] | 24/7 for P0 |
| Squads Multisig Signer 1 | [To be filled] | 24/7 for P0 |
| Squads Multisig Signer 2 | [To be filled] | 24/7 for P0 |
| Squads Multisig Signer 3 | [To be filled] | Business hours |
| Pyth Network Support | support@pyth.network / Discord | Business hours |
| Squads Protocol Support | Discord: squads.so | Business hours |

---

## 8. Incident Report Template

After every P0/P1 incident, publish a report within 48 hours:

```markdown
# Incident Report — [TITLE]

**Date:** YYYY-MM-DD  
**Severity:** P0 / P1  
**Duration:** X hours Y minutes  
**Impact:** [TVL at risk, operations affected]

## Timeline
- HH:MM UTC — [Event]
- HH:MM UTC — [Action taken]
- HH:MM UTC — [Resolution]

## Root Cause
[1–2 paragraphs]

## Resolution
[What was done to fix it]

## Prevention
- [ ] [Action item with owner and due date]
- [ ] [Action item with owner and due date]
```

---

_Last updated: 2026-03-16 by sss-docs_

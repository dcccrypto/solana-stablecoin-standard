# Compliance Guide

This document covers regulatory considerations, the audit trail format, and how SSS-2 enables compliance workflows for stablecoin issuers.

## Regulatory Context

Stablecoin issuers operating in regulated jurisdictions typically need to:

1. **Screen wallets against sanctions lists** (OFAC, EU, UN) before allowing transfers.
2. **Block sanctioned wallets** from sending or receiving the token.
3. **Freeze individual accounts** when required by law enforcement.
4. **Maintain an audit trail** of all compliance actions.
5. **Report on-chain activity** to regulators on demand.

SSS-2 provides the on-chain primitives to implement these requirements. The actual screening logic (matching wallets to sanctions lists) is off-chain — SSS-2 provides the enforcement mechanism.

---

## Compliance Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    Off-Chain                              │
│                                                          │
│  ┌─────────────┐    ┌───────────────┐    ┌────────────┐ │
│  │ Sanctions    │───>│ Screening     │───>│ Admin      │ │
│  │ Lists (OFAC) │    │ Service       │    │ Dashboard  │ │
│  └─────────────┘    └───────────────┘    └─────┬──────┘ │
│                                                │        │
└────────────────────────────────────────────────┼────────┘
                                                 │
                    CLI / SDK / Demo              │
                    blacklist add/remove          │
                                                 ▼
┌──────────────────────────────────────────────────────────┐
│                    On-Chain                               │
│                                                          │
│  Token-2022 ──CPI──> Blacklist Hook Program              │
│                      ├── Config PDA (admin authority)    │
│                      ├── BlacklistEntry PDAs (per wallet)│
│                      └── ExtraAccountMetaList PDA        │
│                                                          │
│  Every TransferChecked:                                  │
│    1. Resolve extra accounts                             │
│    2. Check source blacklist PDA                         │
│    3. Check destination blacklist PDA                    │
│    4. Allow or reject                                    │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### Workflow

1. **Screening service** (off-chain) monitors wallets against sanctions databases.
2. When a match is found, the compliance officer uses the CLI, SDK, or demo to call `blacklist add`.
3. The on-chain BlacklistEntry PDA is created/updated with `blocked = true`.
4. All subsequent transfers involving that wallet are rejected at the protocol level by Token-2022.
5. When a wallet is cleared, the officer calls `blacklist remove`, setting `blocked = false`.

---

## Audit Trail

### On-Chain Audit Trail

Every compliance action is a Solana transaction with a permanent, immutable signature. The audit trail is the chain itself.

**Actions that produce on-chain signatures:**

| Action | Transaction Contents |
|--------|---------------------|
| `blacklist add <wallet>` | Calls `add_to_blacklist` on the hook program. Creates or updates a BlacklistEntry PDA. |
| `blacklist remove <wallet>` | Calls `remove_from_blacklist` on the hook program. Updates the BlacklistEntry PDA. |
| `freeze <account>` | Calls `FreezeAccount` on Token-2022. |
| `thaw <account>` | Calls `ThawAccount` on Token-2022. |
| `set-authority <type> <new>` | Calls `SetAuthority` on Token-2022. |
| `mint <recipient> <amount>` | Calls `MintTo` on Token-2022. |
| `burn <amount>` | Calls `Burn` on Token-2022. |

### Retrieving the Audit Trail

**CLI:**

```bash
npx sss-token audit-log --limit 100
```

**SDK:**

```typescript
const log = await stable.getAuditLog(100);
for (const entry of log) {
  console.log(entry.signature, entry.blockTime, entry.err ? "FAILED" : "OK");
}
```

**Backend API:**

```
GET /api/v1/audit-log?limit=100
```

### Audit Entry Format

Each audit log entry contains:

```json
{
  "signature": "5DJwAPNtmeSCsUBp9AHzD81C9HkKWAohmpNRfr3CACEDSzF5...",
  "slot": 345678901,
  "err": null,
  "blockTime": "2026-03-12T21:00:00.000Z"
}
```

For deeper inspection, use `getTransaction(signature)` to see the full instruction log, including which program was called and which accounts were modified.

### Exporting for Regulators

To produce a compliance report:

1. Fetch the full audit log via `getSignaturesForAddress` for the mint.
2. For each signature, call `getTransaction` to get instruction details.
3. Filter for compliance-relevant instructions (blacklist add/remove, freeze/thaw).
4. Cross-reference with the BlacklistEntry PDAs to get current blocked status.
5. Export as CSV/JSON with timestamps, wallet addresses, action types, and transaction signatures.

---

## Blacklist Status Verification

Anyone can verify whether a wallet is blacklisted by reading the BlacklistEntry PDA:

**On-chain (direct):**

```typescript
const [pda] = PublicKey.findProgramAddressSync(
  [Buffer.from("blacklist"), wallet.toBuffer()],
  hookProgramId,
);
const info = await connection.getAccountInfo(pda);
// Anchor layout: 8-byte discriminator + 32-byte wallet + 1-byte blocked + 1-byte bump
const blocked = info && info.data.length >= 41 ? info.data[40] !== 0 : false;
```

**CLI:**

```bash
npx sss-token blacklist check <wallet>
```

**SDK:**

```typescript
const status = await stable.compliance.isBlacklisted(walletPubkey);
console.log(status.blocked); // true or false
```

---

## Freeze vs. Blacklist

SSS provides two mechanisms for restricting accounts:

| Mechanism | Scope | Enforcement | Reversible | Available in |
|-----------|-------|-------------|------------|-------------|
| **Freeze** | Single token account (ATA) | Token-2022 native | Yes (thaw) | SSS-1, SSS-2 |
| **Blacklist** | Wallet (all transfers) | Transfer hook CPI | Yes (remove) | SSS-2 only |

**When to use Freeze:**
- Target a specific token account.
- Emergency response — immediate effect.
- Compatible with SSS-1 (no hook program needed).

**When to use Blacklist:**
- Target a wallet — blocks all transfers to/from regardless of which ATA is used.
- Sanctions compliance — works with the screening workflow.
- Requires SSS-2.

Both can be used together. A blacklisted wallet whose ATA is also frozen is doubly restricted.

---

## Webhook Integration

The backend service can notify external systems of on-chain events:

```bash
# Register a webhook for all events
curl -X POST http://localhost:3000/api/v1/webhooks \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://compliance-system.example.com/webhook",
    "events": ["transaction.confirmed", "transaction.failed"],
    "secret": "shared-secret-for-verification"
  }'
```

The webhook payload includes the transaction signature, slot, and mint address. Your compliance system can then fetch the full transaction details and log them internally.

---

## Regulatory Mapping

| Requirement | SSS Feature |
|-------------|------------|
| KYC/AML screening | Off-chain screening + on-chain blacklist |
| Sanctions enforcement | Blacklist transfer hook (SSS-2) |
| Account freezing | Freeze authority (SSS-1/SSS-2) |
| Issuance controls | Mint authority with optional revocation |
| Audit trail | On-chain transaction history |
| Real-time monitoring | Backend event listener + webhooks |
| Regulator reporting | Audit log export (CLI/SDK/API) |
| Emergency procedures | Pause (optional), freeze, blacklist |

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
│                      ├── BlacklistEntry PDAs (per mint+wallet)│
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

### compliance_enabled Flag

The SSS-Core program has a `compliance_enabled` boolean on the `StablecoinConfig` PDA that controls whether blacklist checks are enforced during minting:

- **When `true`**: `mint_tokens` requires the recipient's `BlacklistEntry` PDA (`recipient_blacklist_entry`) as a **mandatory account** in the instruction context — not in `remaining_accounts`. This prevents bypassing the check by omitting the account. Minting to a blacklisted wallet is rejected with `RecipientBlacklisted`.
- **When `false`**: No blacklist check is performed during minting.

The flag is set at `initialize` time and can be toggled at any time by the authority via the `set_compliance` instruction.

**CLI (via SDK):**

```typescript
await stable.core.setCompliance(authorityKeypair, true);  // enable
await stable.core.setCompliance(authorityKeypair, false); // disable
```

This replaces the previous hardcoded `preset == PRESET_SSS2` check, giving issuers runtime control over compliance enforcement.

> **Note**: This flag only controls the blacklist check during `mint_tokens`. The transfer hook enforces blacklist checks on all `TransferChecked` calls independently of this flag.

### Workflow

1. **Screening service** (off-chain) monitors wallets against sanctions databases.
2. When a match is found, the compliance officer uses the CLI, SDK, or demo to call `compliance add` (or `blacklist add`).
3. The on-chain BlacklistEntry PDA is created/updated with `blocked = true`.
4. All subsequent transfers involving that wallet are rejected at the protocol level by Token-2022.
5. When `compliance_enabled` is true on SSS-Core, minting to the wallet is also blocked.
6. When a wallet is cleared, the officer calls `compliance remove`, setting `blocked = false`.

---

## Audit Trail

### On-Chain Audit Trail

Every compliance action is a Solana transaction with a permanent, immutable signature. The audit trail is the chain itself.

**Actions that produce on-chain signatures:**

| Action | Transaction Contents |
|--------|---------------------|
| `compliance add <wallet>` | Calls `add_to_blacklist` on the hook program. Creates or updates a BlacklistEntry PDA. The `reason` string (max 128 chars) is **stored on-chain in the PDA** for audit compliance, not just emitted in events. |
| `compliance remove <wallet>` | Calls `remove_from_blacklist` on the hook program. Updates the BlacklistEntry PDA. |
| `compliance close <wallet>` | Calls `close_blacklist_entry`. Reclaims rent for an unblocked entry. |
| `compliance transfer-admin` | Calls `transfer_admin`. Nominates a new blacklist admin. |
| `compliance accept-admin` | Calls `accept_admin`. Finalizes the two-step admin transfer. |
| `admin freeze <account>` | Calls `FreezeAccount` on Token-2022. |
| `admin thaw <account>` | Calls `ThawAccount` on Token-2022. |
| `admin set-authority <type> <new>` | Calls `SetAuthority` on Token-2022. |
| `operate mint <recipient> <amount>` | Calls `MintTo` on Token-2022. |
| `operate burn <amount>` | Calls `Burn` on Token-2022. |
| `set_compliance(enabled)` | Toggles `compliance_enabled` on the SSS-Core config PDA. |
| `attest_reserve(reserve_amount, source, uri)` | Creates or updates the ReserveAttestation PDA with proof-of-reserve data. Emits `ReserveAttested` event. |

### Retrieving the Audit Trail

**CLI:**

```bash
npx solana-stable inspect audit-log --limit 100
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
  [Buffer.from("blacklist"), mint.toBuffer(), wallet.toBuffer()],
  hookProgramId,
);
const info = await connection.getAccountInfo(pda);
// Anchor layout: 8-byte discriminator + 32-byte wallet + 32-byte mint + 1-byte blocked + 1-byte bump + reason (String, max 128 chars)
const blocked = info && info.data.length >= 73 ? info.data[72] !== 0 : false;
// reason is stored in the PDA for audit compliance
```

**CLI:**

```bash
npx solana-stable compliance check <wallet>
```

**SDK:**

```typescript
const status = await stable.compliance.isBlacklisted(walletPubkey);
console.log(status.blocked); // true or false
console.log(status.reason);  // optional: reason string from PDA (when blocked)
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

## Proof-of-Reserve Attestation

The SSS-Core program supports **reserve attestation** — on-chain recording of proof-of-reserve data. This helps issuers demonstrate reserve backing and supports regulatory frameworks such as the U.S. GENIUS Act.

**How it works:**

1. The authority grants `ROLE_ATTESTOR` (role value 6) to a designated attestor (e.g., auditor or compliance officer).
2. The attestor calls `attest_reserve(reserve_amount, source, uri)` to create or update the `ReserveAttestation` PDA.
3. The PDA stores: `reserve_amount` (total backing), `source` (description of reserve type, max 128 chars), `uri` (link to off-chain proof document, max 256 chars), and `timestamp`.
4. Each attestation emits a `ReserveAttested` event.
5. Anyone can read the latest attestation via `view_reserve()` (simulate, no signer required).

**Regulatory value:**

- **Transparency**: On-chain attestation provides verifiable, timestamped records of reserve levels.
- **Audit trail**: The `uri` field links to detailed off-chain audit reports (PDFs, attestation letters) while keeping the chain lean.
- **Periodic updates**: Issuers can update attestations periodically (e.g., monthly) to reflect current reserve levels.

---

## Regulatory Mapping

| Requirement | SSS Feature |
|-------------|------------|
| KYC/AML screening | Off-chain screening + on-chain blacklist |
| Sanctions enforcement | Blacklist transfer hook (SSS-2) |
| Proof-of-reserve / GENIUS Act | Reserve attestation (`attest_reserve`, `view_reserve`) |
| Mint-time compliance | `compliance_enabled` flag + `set_compliance` instruction |
| Account freezing | Freeze authority (SSS-1/SSS-2) |
| Issuance controls | Mint authority with optional revocation |
| Audit trail | On-chain transaction history |
| Real-time monitoring | Backend event listener + webhooks |
| Regulator reporting | Audit log export (CLI/SDK/API) |
| Emergency procedures | Pause (optional), freeze, blacklist |

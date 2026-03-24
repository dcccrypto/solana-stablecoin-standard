# Reserve Reporting Standard — SSS-124

## Overview

SSS-124 extends the **Proof of Reserves (SSS-123)** infrastructure with an on-chain reserve composition breakdown. Regulated stablecoin issuers can publish a verifiable, tamper-evident record of how their backing assets are allocated, expressed in **basis points** (bps, where 10 000 = 100%).

This complements SSS-123's single `reserve_amount` attestation with a four-category asset-type breakdown, enabling transparency for holders, auditors, and on-chain analytics tools.

---

## Concepts

### ReserveComposition PDA

Each stablecoin mint may have one `ReserveComposition` PDA at seeds:

```
[b"reserve-composition", mint_pubkey]
```

Fields:

| Field | Type | Description |
|---|---|---|
| `sss_mint` | `Pubkey` | The stablecoin mint this record belongs to |
| `cash_bps` | `u16` | Cash & cash equivalents (0–10 000) |
| `t_bills_bps` | `u16` | US Treasury Bills (0–10 000) |
| `crypto_bps` | `u16` | Crypto assets (0–10 000) |
| `other_bps` | `u16` | Other assets (0–10 000) |
| `last_updated_slot` | `u64` | Solana slot of the most recent update |
| `last_updated_by` | `Pubkey` | Authority who submitted the last update |

**Invariant:** `cash_bps + t_bills_bps + crypto_bps + other_bps == 10 000`

---

## Instructions

### `update_reserve_composition`

```
authority: Signer (must be stablecoin authority)
config: StablecoinConfig PDA
reserve_composition: ReserveComposition PDA (init_if_needed)
system_program: System
```

Parameters (`ReserveCompositionParams`):

```rust
pub struct ReserveCompositionParams {
    pub cash_bps:    u16,  // cash & equivalents
    pub t_bills_bps: u16,  // T-bills
    pub crypto_bps:  u16,  // crypto collateral
    pub other_bps:   u16,  // other assets
}
```

- Validates sum == 10 000. Returns `InvalidCompositionBps` error otherwise.
- Creates the PDA on first call (`init_if_needed`); subsequent calls update it.
- Emits `ReserveCompositionUpdated` event.

### `get_reserve_composition`

```
config: StablecoinConfig PDA (read-only)
reserve_composition: ReserveComposition PDA (read-only)
```

- Callable by **anyone** (no signer required beyond the transaction fee payer).
- Logs the current breakdown via `msg!`.
- Intended for keepers, dashboards, and monitoring services.

---

## Events

### `ReserveCompositionUpdated`

Emitted on every successful `update_reserve_composition` call.

```rust
pub struct ReserveCompositionUpdated {
    pub mint:        Pubkey,
    pub updated_by:  Pubkey,
    pub cash_bps:    u16,
    pub t_bills_bps: u16,
    pub crypto_bps:  u16,
    pub other_bps:   u16,
    pub slot:        u64,
}
```

Subscribe via the Anchor event listener API to receive real-time composition change notifications.

---

## How Regulated Issuers Should Use This

1. **Monthly reporting cycle** — Update `reserve_composition` at the same cadence as your attestor submits a `submit_reserve_attestation` (SSS-123). Regulators and auditors can then cross-reference the on-chain composition against the off-chain audit report.

2. **Category definitions** — Follow standard stablecoin reserve disclosure norms:
   - **Cash** — bank deposits, overnight repos, money market funds.
   - **T-Bills** — US Treasury securities with maturity ≤ 1 year.
   - **Crypto** — on-chain crypto collateral (SOL, BTC, ETH, etc.).
   - **Other** — corporate bonds, commercial paper, anything not in the above.

3. **Transparency dashboard** — Expose the PDA data via your public API or integrate with the `ReserveCompositionModule` (SDK) for front-end display.

4. **Attestor vs. composition** — Note that `reserve_composition` is updated by the **stablecoin authority**, not the attestor whitelist. This is intentional: the composition reflects the issuer's declared policy, while attestations reflect the custodian's signed confirmation.

---

## SDK Usage

```typescript
import { ReserveCompositionModule } from '@sss/sdk';
import { Connection, PublicKey } from '@solana/web3.js';

const connection = new Connection('https://api.mainnet-beta.solana.com');
const programId = new PublicKey('<SSS_PROGRAM_ID>');

const mod = new ReserveCompositionModule(connection, programId);
const composition = await mod.fetchReserveComposition(mintPublicKey);

if (composition) {
  console.log(`Cash:    ${composition.cashBps / 100}%`);
  console.log(`T-Bills: ${composition.tBillsBps / 100}%`);
  console.log(`Crypto:  ${composition.cryptoBps / 100}%`);
  console.log(`Other:   ${composition.otherBps / 100}%`);
  console.log(`Last updated slot: ${composition.lastUpdatedSlot}`);
} else {
  console.log('No composition record found — issuer has not yet published breakdown.');
}
```

---

## Error Reference

| Error | Code | Meaning |
|---|---|---|
| `InvalidCompositionBps` | — | `cash_bps + t_bills_bps + crypto_bps + other_bps ≠ 10 000` |
| `Unauthorized` | — | Signer is not the stablecoin authority |
| `InvalidVault` | — | PDA `sss_mint` field does not match `config.mint` |

---

## Relationship to SSS-123

| Feature | SSS-123 | SSS-124 |
|---|---|---|
| What it proves | Total reserve amount | Asset type breakdown |
| Who can update | Authority + attestor whitelist | Authority only |
| Validation | `reserve_amount > 0` | sum of bps == 10 000 |
| Frequency | As often as needed | At least monthly |
| PDA | `proof-of-reserves` | `reserve-composition` |

Both PDAs are optional. SSS-124 depends on SSS-123 (the `StablecoinConfig` is shared), but the `ReserveComposition` PDA is independent.

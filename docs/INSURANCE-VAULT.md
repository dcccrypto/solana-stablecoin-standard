# Insurance Vault (SSS-151)

> **First-loss protocol reserve for liquidation cascades.**
> Distinct from the bad-debt backstop (`insurance_fund_pubkey`): this vault is seeded upfront and absorbs losses before they reach bad-debt territory.

---

## Overview

The `InsuranceVault` PDA is an on-chain, collateral-backed reserve that must be adequately seeded before minting is enabled (when `FLAG_INSURANCE_VAULT_REQUIRED` is set, bit 21). Governance controls draws; community replenishment is permissionless.

**Key invariants:**
- One vault per stablecoin mint.
- Mint is blocked until `adequately_seeded = true` (balance ≥ `min_seed_bps` of net supply).
- Per-event draw capped at `max_draw_per_event_bps` of net supply (0 = no cap).
- Draws require authority + DAO quorum when `FLAG_DAO_COMMITTEE` is active.

---

## State

**PDA seeds:** `[b"insurance-vault", sss_mint]`

| Field | Type | Description |
|---|---|---|
| `sss_mint` | `Pubkey` | Associated stablecoin mint |
| `vault_token_account` | `Pubkey` | Collateral token account (PDA-owned) |
| `min_seed_bps` | `u16` | Minimum required balance as bps of net supply (0 = no minimum) |
| `current_balance` | `u64` | Mirrored vault balance |
| `total_drawn` | `u64` | Cumulative draws since vault creation |
| `max_draw_per_event_bps` | `u16` | Per-event draw cap in bps of net supply (0 = no cap) |
| `adequately_seeded` | `bool` | True when `current_balance ≥ required_seed_amount(net_supply)` |
| `bump` | `u8` | PDA bump |

**Helper:**
```rust
pub fn required_seed_amount(&self, net_supply: u64) -> u64 {
    ((net_supply as u128) * (self.min_seed_bps as u128) / 10_000) as u64
}
```

---

## Flag

| Flag | Bit | Description |
|---|---|---|
| `FLAG_INSURANCE_VAULT_REQUIRED` | 21 | Minting blocked until vault is adequately seeded |

Set automatically by `init_insurance_vault`. Cleared only via timelock.

---

## Instructions

### `init_insurance_vault`

**Authority-only.** Creates the `InsuranceVault` PDA and enables `FLAG_INSURANCE_VAULT_REQUIRED`.

```typescript
await program.methods
  .initInsuranceVault(
    500,   // min_seed_bps: 5% of net supply required
    100    // max_draw_per_event_bps: max 1% per event
  )
  .accounts({
    authority,
    config,
    sssVault: insuranceVaultPda,
    collateralMint,
    vaultTokenAccount,
    systemProgram,
    tokenProgram,
    rent,
  })
  .rpc();
```

**Preconditions:**
- Caller must be `config.authority`.
- Config must be preset 3 (`PRESET_INSTITUTIONAL`).
- Vault PDA must not already exist.

---

### `seed_insurance_vault`

**Permissionless.** Deposits collateral into the vault; updates `adequately_seeded`.

```typescript
await program.methods
  .seedInsuranceVault(new BN(1_000_000_000)) // 1,000 USDC (6 decimals)
  .accounts({
    depositor,
    config,
    insuranceVault: insuranceVaultPda,
    depositorTokenAccount,
    vaultTokenAccount,
    collateralMint,
    tokenProgram,
  })
  .rpc();
```

**Effect:**
- Transfers `amount` from depositor → vault token account.
- Updates `current_balance` and rechecks `adequately_seeded`.
- Emits `InsuranceVaultSeeded`.

---

### `draw_insurance`

**Governance-controlled.** Draws collateral from the vault to cover protocol losses.

```typescript
await program.methods
  .drawInsurance(
    new BN(500_000_000),     // amount
    Array.from(reasonHash)   // [u8; 32] — e.g. keccak256("liquidation-cascade-2026-03-25")
  )
  .accounts({
    authority,
    config,
    insuranceVault: insuranceVaultPda,
    vaultTokenAccount,
    recipientTokenAccount,
    collateralMint,
    tokenProgram,
  })
  .rpc();
```

**Preconditions:**
- Caller is `config.authority`.
- When `FLAG_DAO_COMMITTEE` is active: DAO quorum also required.
- Amount ≤ `current_balance`.
- If `max_draw_per_event_bps > 0`: amount ≤ that bps of current net supply.

**Effect:**
- Transfers `amount` from vault → recipient.
- Decrements `current_balance`, increments `total_drawn`.
- Rechecks `adequately_seeded`.
- Emits `InsuranceDrawn`.

---

### `replenish_insurance_vault`

**Permissionless.** Community replenishment after a draw event.

```typescript
await program.methods
  .replenishInsuranceVault(new BN(500_000_000))
  .accounts({
    contributor,
    config,
    insuranceVault: insuranceVaultPda,
    contributorTokenAccount,
    vaultTokenAccount,
    collateralMint,
    tokenProgram,
  })
  .rpc();
```

**Effect:**
- Same deposit flow as `seed_insurance_vault` but labelled as a replenishment.
- Emits `InsuranceVaultReplenished`.

---

## Mint Gate Integration

When `FLAG_INSURANCE_VAULT_REQUIRED` is set on the config, the `mint` instruction requires the `InsuranceVault` PDA to be passed in `remaining_accounts`. If `adequately_seeded = false`, minting reverts with `InsuranceVaultNotSeeded`.

```typescript
// When building the mint transaction:
const remainingAccounts = flagRequiresVault
  ? [{ pubkey: insuranceVaultPda, isWritable: false, isSigner: false }]
  : [];

await program.methods
  .mintTo(amount)
  .accounts({ /* ... */ })
  .remainingAccounts(remainingAccounts)
  .rpc();
```

---

## Events

| Event | Emitted By | Key Fields |
|---|---|---|
| `InsuranceVaultSeeded` | `seed_insurance_vault` | `sss_mint`, `amount`, `current_balance`, `adequately_seeded` |
| `InsuranceDrawn` | `draw_insurance` | `sss_mint`, `amount`, `reason_hash`, `remaining_balance`, `total_drawn` |
| `InsuranceVaultReplenished` | `replenish_insurance_vault` | `sss_mint`, `amount`, `contributor`, `new_balance` |

Subscribe via Helius or the indexer (see [Indexer Integration Guide](INDEXER-GUIDE.md)).

---

## Relationship to `insurance_fund_pubkey`

| | Insurance Vault (SSS-151) | Bad-Debt Backstop (`insurance_fund_pubkey`) |
|---|---|---|
| **Purpose** | Absorb liquidation cascades before bad debt occurs | Cover residual bad debt after individual liquidations |
| **Funding** | Seeded upfront by issuer; community replenishment | External fund, issuer-controlled |
| **Governance** | On-chain PDA; draws require authority (+ DAO) | Off-chain pointer |
| **Mint gate** | Yes — blocks minting until adequately seeded | No |

---

## Operational Runbook

### Setup (new stablecoin)

1. Deploy and initialise `StablecoinConfig` with preset 3.
2. Call `init_insurance_vault(min_seed_bps, max_draw_per_event_bps)`.
3. Seed with `seed_insurance_vault(amount)` until `adequately_seeded = true`.
4. Verify `adequately_seeded` before announcing mint availability.

### Monitoring

Watch for `InsuranceVaultSeeded` / `InsuranceDrawn` / `InsuranceVaultReplenished` events:

```bash
# Check vault state
sss-token insurance-vault status --mint <MINT>

# Alert if balance drops below 120% of min required
sss-token insurance-vault balance --mint <MINT> --alert-threshold 1.2
```

Key alert thresholds:
- `adequately_seeded` transitions to `false` → **critical** (minting will halt).
- `current_balance` < 2× `required_seed_amount` → **warning** (replenishment needed).
- Any `InsuranceDrawn` event → **incident** (root-cause required before replenishment).

### After a Draw

1. File incident report (use `reason_hash` to correlate on-chain).
2. Analyse cascade root cause.
3. Call `replenish_insurance_vault` to restore `adequately_seeded`.
4. Post-mortem: consider increasing `min_seed_bps`.

---

## Test Coverage

15 tests in `tests/sss-151-insurance-vault.ts`:
- Init vault with various `min_seed_bps` / `max_draw_per_event_bps` combinations.
- Seed: partial → `adequately_seeded=false`; threshold → `adequately_seeded=true`.
- Draw: normal, per-event cap enforcement, draw-to-zero, DAO quorum gate.
- Replenish: restores `adequately_seeded` after draw.
- Mint gate: blocked when not seeded, unblocked when seeded.
- Unauthorized draw: rejected.

---

*Source: `programs/sss-token/src/instructions/insurance_vault.rs`, `programs/sss-token/src/state.rs` (commit ec00251) — SSS-151.*

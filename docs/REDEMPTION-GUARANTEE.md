# Redemption Guarantee at Par (SSS-125)

> **Status:** Live on mainnet candidate branch  
> **Program instruction set:** `register_redemption_pool`, `request_redemption`, `fulfill_redemption`, `claim_expired_redemption`

## Overview

SSS-125 adds an on-chain, enforceable redemption guarantee: a user who submits a redemption request is guaranteed to receive collateral at **1:1 par** within a configurable SLA window (~3 minutes at default settings). If the issuer fails to fulfill within the SLA, the user recovers their stable tokens **plus a 10% penalty** drawn from the on-chain insurance fund.

This mechanism is fully non-custodial — stable tokens are locked in a program-controlled escrow PDA the moment a request is submitted, so the issuer cannot block or confiscate them.

---

## Key Design Properties

| Property | Value |
|---|---|
| SLA default | 450 slots (~3 min at 400 ms/slot) |
| Redemption rate | 1:1 par (no slippage, no fee) |
| Daily limit | Configurable per pool (`max_daily_redemption`) |
| SLA breach penalty | 10% of redeemed amount (`PENALTY_BPS = 1_000`) |
| Penalty source | `config.insurance_fund_pubkey` (collateral token) |
| Escrow authority | `RedemptionGuarantee` PDA (program-controlled) |

---

## PDAs

### `RedemptionGuarantee`
Seeds: `[b"redemption-guarantee", sss_mint]`

One per stablecoin mint. Stores pool configuration.

```
pub struct RedemptionGuarantee {
    pub sss_mint: Pubkey,
    pub reserve_vault: Pubkey,      // collateral source
    pub max_daily_redemption: u64,  // native token units
    pub daily_redeemed: u64,        // resets each day-window
    pub day_start_slot: u64,
    pub sla_slots: u64,             // default 450
    pub last_updated_slot: u64,
    pub bump: u8,
}
```

### `RedemptionRequest`
Seeds: `[b"redemption-request", sss_mint, user]`

One per active request (one per user at a time). Cleared after fulfillment or SLA breach claim.

```
pub struct RedemptionRequest {
    pub sss_mint: Pubkey,
    pub user: Pubkey,
    pub amount: u64,
    pub requested_slot: u64,
    pub expiry_slot: u64,     // requested_slot + sla_slots
    pub fulfilled: bool,
    pub sla_breached: bool,
    pub bump: u8,
}
```

---

## Instructions

### `register_redemption_pool`

Called by the stablecoin authority to initialize or update the redemption pool.

**Required accounts:**
- `authority` — stablecoin config authority (signer)
- `config` — `StablecoinConfig` PDA
- `reserve_vault` — token account that backs collateral payouts
- `redemption_guarantee` — pool PDA (init or update)

**Parameters:**
- `max_daily_redemption: u64` — maximum stable tokens redeemable in a 24h window

```typescript
await program.methods
  .registerRedemptionPool(new BN(1_000_000 * 1e6)) // 1M tokens/day
  .accounts({
    authority: wallet.publicKey,
    config: configPda,
    reserveVault: reserveVaultAta,
    redemptionGuarantee: guaranteePda,
    systemProgram: SystemProgram.programId,
  })
  .rpc();
```

---

### `request_redemption`

User initiates a redemption. Stable tokens are transferred from the user's ATA into the escrow PDA atomically.

**Required accounts:**
- `user` — signer
- `config`, `redemption_guarantee`
- `user_stable_ata` — source of stable tokens
- `escrow_stable` — program-controlled escrow (`[b"redemption-escrow", mint]`)
- `redemption_request` — new PDA (init)
- `stable_mint`, `token_program`

**Parameters:**
- `amount: u64` — amount to redeem (native token units)

**Constraints checked:**
- Daily limit not exceeded (rolling 24h window by slot count)
- `amount > 0`

```typescript
await program.methods
  .requestRedemption(new BN(100 * 1e6)) // 100 tokens
  .accounts({
    user: wallet.publicKey,
    config: configPda,
    redemptionGuarantee: guaranteePda,
    userStableAta: userStableAta,
    escrowStable: escrowPda,
    redemptionRequest: requestPda,
    stableMint: stableMint,
    tokenProgram: TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  })
  .rpc();
```

---

### `fulfill_redemption`

Issuer (or keeper) fulfills the request within the SLA window. Stable tokens move from escrow → burn destination; collateral moves from reserve vault → user.

**Required accounts:**
- `fulfiller` — signer with authority over `reserve_vault`
- `config`, `redemption_guarantee`, `redemption_request`
- `escrow_stable` — source of locked stable tokens
- `reserve_vault` — collateral source (must match registered vault)
- `user_collateral_ata` — user receives collateral here
- `burn_destination` — where stable tokens are transferred for burning
- `stable_mint`, `collateral_mint`, `token_program`

**Constraints:**
- Current slot ≤ `expiry_slot` (within SLA)
- Request not already fulfilled or breached

**Events emitted:** `RedemptionFulfilled { mint, user, amount, requested_slot, fulfilled_slot, sla_slots_used }`

```typescript
await program.methods
  .fulfillRedemption()
  .accounts({
    fulfiller: issuerWallet.publicKey,
    config: configPda,
    redemptionGuarantee: guaranteePda,
    redemptionRequest: requestPda,
    escrowStable: escrowPda,
    reserveVault: reserveVaultAta,
    userCollateralAta: userCollateralAta,
    burnDestination: burnDestAta,
    stableMint: stableMint,
    collateralMint: collateralMint,
    tokenProgram: TOKEN_PROGRAM_ID,
  })
  .rpc();
```

---

### `claim_expired_redemption`

Called by the user after the SLA window has passed without fulfillment. Returns stable tokens to user and pays a 10% penalty from the insurance fund.

**Required accounts:**
- `user` — signer (must match `redemption_request.user`)
- `config`, `redemption_guarantee`, `redemption_request`
- `escrow_stable` — locked stable tokens returned here
- `user_stable_ata` — user receives stable tokens back
- `insurance_fund` — must match `config.insurance_fund_pubkey`
- `user_collateral_ata` — user receives penalty payout
- `stable_mint`, `penalty_mint`, `token_program`

**Constraints:**
- `clock.slot > expiry_slot` (SLA must be expired)
- `config.insurance_fund_pubkey != Pubkey::default()` (fund must be configured)

**Penalty calculation:**
```
penalty = min(amount * 10% , insurance_fund.balance)
```

**Events emitted:** `RedemptionSLABreached { mint, user, amount, requested_slot, expiry_slot, claim_slot, penalty_paid }`

```typescript
await program.methods
  .claimExpiredRedemption()
  .accounts({
    user: wallet.publicKey,
    config: configPda,
    redemptionGuarantee: guaranteePda,
    redemptionRequest: requestPda,
    escrowStable: escrowPda,
    userStableAta: userStableAta,
    insuranceFund: insuranceFundAta,
    userCollateralAta: userCollateralAta,
    stableMint: stableMint,
    penaltyMint: collateralMint,
    tokenProgram: TOKEN_PROGRAM_ID,
  })
  .rpc();
```

---

## State Transitions

```
                ┌──────────────────────────────────────────┐
                │         request_redemption()             │
                │  stable locked in escrow PDA             │
                └──────────────────┬───────────────────────┘
                                   │
                    ┌──────────────┴──────────────┐
                    │                             │
              slot <= expiry              slot > expiry
                    │                             │
     fulfill_redemption()        claim_expired_redemption()
   collateral → user (1:1)       stable returned + 10% penalty
   stable → burn destination     from insurance fund
   fulfilled = true              sla_breached = true
```

---

## Daily Rolling Window

The redemption pool tracks a 24-hour limit using **slot-based windows** (≈ 216,000 slots per day at 400 ms/slot). The counter resets automatically the first time `request_redemption` is called after the window rolls over:

```rust
if clock.slot.saturating_sub(rg.day_start_slot) >= SLOTS_PER_DAY {
    rg.daily_redeemed = 0;
    rg.day_start_slot = clock.slot;
}
```

This is a **soft rolling window** — the limit is checked and enforced at request time, not at fulfillment time.

---

## Error Reference

| Error | Trigger |
|---|---|
| `RedemptionDailyLimitExceeded` | `request_redemption` would push `daily_redeemed` over `max_daily_redemption` |
| `RedemptionAlreadyFulfilled` | `fulfill_redemption` or `claim_expired_redemption` called on an already-fulfilled request |
| `RedemptionSLABreached` | `fulfill_redemption` called after `expiry_slot` |
| `RedemptionNotExpired` | `claim_expired_redemption` called before `expiry_slot` |
| `InsuranceFundNotConfigured` | `claim_expired_redemption` called when `insurance_fund_pubkey == Pubkey::default()` |
| `InvalidVault` | Reserve vault doesn't match registered vault, or guarantee mint mismatch |
| `Unauthorized` | Caller is not the registered stablecoin authority |
| `InvalidAmount` | `amount == 0` or `max_daily_redemption == 0` |

---

## Keeper Integration

Issuers should run a **fulfillment keeper** that monitors for open `RedemptionRequest` PDAs and submits `fulfill_redemption` before the SLA expires. A reference implementation pattern:

```typescript
// Poll for unfulfilled requests (off-chain indexer or getProgramAccounts)
const openRequests = await program.account.redemptionRequest.all([
  { memcmp: { offset: 8 + 32, bytes: mintPubkey.toBase58() } }, // sss_mint filter
]);

for (const req of openRequests) {
  if (!req.account.fulfilled && !req.account.slABreached) {
    const currentSlot = await connection.getSlot();
    if (currentSlot <= req.account.expirySlot.toNumber()) {
      await fulfillRedemption(req); // submit tx
    }
  }
}
```

> ⚠️ The keeper must act before `expiry_slot`. At ~400 ms/slot and a 450-slot SLA, this is a **3-minute window**. Run the keeper with at minimum 30-second polling cadence.

---

## Related Docs

- [PROOF-OF-RESERVES.md](./PROOF-OF-RESERVES.md) — on-chain PoR attestation
- [RESERVE-REPORTING.md](./RESERVE-REPORTING.md) — reserve composition breakdown
- [SECURITY.md](./SECURITY.md) — insurance fund setup and incident response
- [on-chain-sdk-core.md](./on-chain-sdk-core.md) — core SDK reference

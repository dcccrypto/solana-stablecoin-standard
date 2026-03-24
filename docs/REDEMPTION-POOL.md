# On-Chain Redemption Pools (SSS-137)

> **Status:** Live on mainnet candidate branch  
> **Depends on:** SSS-125 (Redemption Guarantee at Par)  
> **Program instructions:** `seed_redemption_pool`, `instant_redemption`, `replenish_redemption_pool`, `drain_redemption_pool`

## Overview

SSS-137 adds an **always-available, instant redemption path**: a pre-funded on-chain liquidity pool that lets holders burn SSS tokens and receive reserve assets immediately — no SLA window, no wait. When the pool is liquid, redemption settles atomically within a single transaction. When the pool is empty, users automatically fall back to the SSS-125 SLA path.

This mechanism is fully on-chain and non-custodial: the pool vault is a program-controlled token account, and the payout is executed by a PDA signer (`vault-authority`) with no authority-gated withdrawal path in the critical redemption instruction.

---

## Design Properties

| Property | Value |
|---|---|
| Redemption rate | 1:1 par (SSS burned : reserve assets paid) |
| Maximum fee | 500 bps (5%) — enforced on-chain |
| Fee rounding | Down (protects pool, not user) |
| Pool cap | Configurable `max_pool_size` (0 = unlimited) |
| Replenishment | Permissionless — any market maker may top up |
| Pool drain | Authority-only, Squads-gated when `FLAG_SQUADS_AUTHORITY` is set |
| Pause respect | `instant_redemption` rejects if `config.paused = true` |
| Fallback | Pool-empty error signals callers to use SSS-125 SLA path |

---

## PDA: `RedemptionPool`

Seeds: `[b"redemption-pool-v2", sss_mint]`

One per stablecoin mint.

```rust
pub struct RedemptionPool {
    pub sss_mint: Pubkey,
    pub reserve_vault: Pubkey,          // locked at first seed; immutable thereafter
    pub max_pool_size: u64,             // 0 = unlimited
    pub current_liquidity: u64,
    pub instant_redemption_fee_bps: u16, // 0–500
    pub utilization_bps: u16,           // lazy snapshot: redeemed / (seeded + replenished)
    pub total_seeded: u64,
    pub total_replenished: u64,
    pub total_redeemed: u64,
    pub bump: u8,
}
```

The `reserve_vault` field is set on first seed and **never changed** — subsequent seeds enforce vault consistency.

---

## Instructions

### `seed_redemption_pool(amount, max_pool_size, fee_bps)`

Authority-only. Creates or tops up the pool. Deposits `amount` reserve assets from the authority's token account into the vault.

- Enforces `FLAG_SQUADS_AUTHORITY` if set.
- Sets `max_pool_size` and `instant_redemption_fee_bps` on each call (can be updated).
- Enforces `fee_bps ≤ 500`.
- Emits `RedemptionPoolSeeded { sss_mint, amount, new_liquidity }`.

### `instant_redemption(amount)`

Any user. Burns `amount` SSS tokens; pays `amount − fee` reserve assets.

- Requires `current_liquidity ≥ amount`; errors with `RedemptionPoolEmpty` otherwise.
- Burns SSS 1:1 via CPI to the token program.
- Transfers payout from vault via vault-authority PDA signer.
- Updates `current_liquidity`, `total_redeemed`, `utilization_bps`.
- Emits `InstantRedemption { sss_mint, user, burned, received, fee, remaining_liquidity }`.

### `replenish_redemption_pool(amount)`

Permissionless. Any account may deposit reserve assets to top up the pool (e.g., market makers). Respects `max_pool_size` cap if set.

- Emits `RedemptionPoolReplenished { sss_mint, replenisher, amount, new_liquidity }`.

### `drain_redemption_pool`

Authority-only. Withdraws all pool liquidity to the authority's token account.

- Enforces `FLAG_SQUADS_AUTHORITY` if set.
- Sets `current_liquidity = 0`.
- Emits `RedemptionPoolDrained { sss_mint, amount }`.

---

## Events

| Event | Fields |
|---|---|
| `RedemptionPoolSeeded` | `sss_mint`, `amount`, `new_liquidity` |
| `InstantRedemption` | `sss_mint`, `user`, `burned`, `received`, `fee`, `remaining_liquidity` |
| `RedemptionPoolReplenished` | `sss_mint`, `replenisher`, `amount`, `new_liquidity` |
| `RedemptionPoolDrained` | `sss_mint`, `amount` |

---

## Error Variants

| Error | Trigger |
|---|---|
| `RedemptionPoolMintMismatch` | Token account mint ≠ `config.mint` |
| `RedemptionPoolVaultMismatch` | Vault account ≠ stored `pool.reserve_vault` |
| `RedemptionPoolFull` | Deposit would exceed `max_pool_size` |
| `RedemptionPoolEmpty` | `current_liquidity < amount` at redemption time |
| `RedemptionFeeTooHigh` | `fee_bps > 500` |

---

## Relationship to SSS-125 (Redemption Guarantee)

SSS-137 is a **fast path** layered on top of the SSS-125 SLA guarantee:

| Path | Speed | Fee | When available |
|---|---|---|---|
| **SSS-137 Instant Pool** | 1 tx (~0.4 s) | 0–5% (configured) | Pool is funded |
| **SSS-125 SLA Guarantee** | ≤450 slots (~3 min) | None | Always |

Clients should attempt `instant_redemption` first; on `RedemptionPoolEmpty`, fall back to `request_redemption` (SSS-125).

---

## Security Notes

- The `reserve_vault` is fixed at pool creation — seeding and replenishment cannot redirect funds to a different vault.
- Drain is authority-only and Squads-gated (when multisig flag set), preventing single-signer pool rug.
- `instant_redemption` checks `config.paused`, so guardian pause halts instant redemptions alongside minting.
- Fee capped at 500 bps on-chain — no instruction path allows higher fees.
- Permissionless replenishment enables market-maker arbitrage, keeping pools liquid without issuer intervention.

---

## Usage Example (TypeScript)

```typescript
// Instant redemption
await program.methods
  .instantRedemption(new BN(1_000_000)) // 1 SSS (6 decimals)
  .accounts({
    user: wallet.publicKey,
    config: configPda,
    redemptionPool: redemptionPoolPda,
    userTokenAccount: userSssAccount,
    reserveVault: poolReserveVault,
    userReserveAccount: userReserveAccount,
    vaultAuthority: vaultAuthorityPda,
    sssMint: sssMint,
    tokenProgram: TOKEN_PROGRAM_ID,
  })
  .rpc();
```

See `tests/sss-137-redemption-pools.ts` for full test coverage (20 tests).

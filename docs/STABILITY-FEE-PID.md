# Stability Fee PID Auto-Adjustment

> SSS-130 · Feature flag: `FLAG_PID_FEE_CONTROL` (bit 11, `0x800`)

The PID (Proportional-Integral-Derivative) controller replaces manual `set_stability_fee` calls with an automatic feedback loop that keeps the stablecoin peg tight by continuously adjusting `stability_fee_bps` based on live price deviation.

---

## Overview

When `FLAG_PID_FEE_CONTROL` is enabled, any permissionless keeper can call `update_stability_fee_pid` with the current oracle price. The on-chain PID controller computes the optimal fee adjustment and writes it directly to `StablecoinConfig.stability_fee_bps`, bounded by the configured floor and ceiling.

---

## PID Formula

All arithmetic is `i64`, gains are scaled by **1,000,000** (so `kp = 1_000` represents a gain of 0.001).

```
error       = target_price − current_price
integral   += error                           (anti-windup: clamped to ±1_000_000_000)
derivative  = error − last_error

raw_output  = kp×error + ki×integral + kd×derivative   (1e6 units)
delta_bps   = raw_output / 1_000_000
new_fee_bps = clamp(current_fee_bps + delta_bps, min_fee_bps, max_fee_bps)
```

Prices are in oracle units (e.g. `1_000_000` = $1.00 with 6 decimals, matching Pyth's USD feeds).

---

## PDA: `PidConfig`

Seeds: `["pid-config", sss_mint]`

| Field             | Type   | Description                                               |
|-------------------|--------|-----------------------------------------------------------|
| `sss_mint`        | Pubkey | The stablecoin mint this config belongs to                |
| `kp`              | i64    | Proportional gain × 1e6                                   |
| `ki`              | i64    | Integral gain × 1e6                                       |
| `kd`              | i64    | Derivative gain × 1e6                                     |
| `target_price`    | u64    | Peg target in oracle units                                |
| `min_fee_bps`     | u16    | Floor: fee never falls below this                         |
| `max_fee_bps`     | u16    | Ceiling: fee never rises above this                       |
| `integral`        | i64    | Accumulated integral term (anti-windup clamped ±1e9)      |
| `last_error`      | i64    | Error from the previous update (for derivative term)      |
| `last_update_slot`| u64    | Slot of the most recent update                            |
| `bump`            | u8     | PDA canonical bump                                        |

---

## Instructions

### `init_pid_config` — authority only

Initialises the `PidConfig` PDA and sets `FLAG_PID_FEE_CONTROL` in `StablecoinConfig.feature_flags`.

**Parameters:**

| Param          | Type | Description                      |
|----------------|------|----------------------------------|
| `kp`           | i64  | Proportional gain × 1e6          |
| `ki`           | i64  | Integral gain × 1e6              |
| `kd`           | i64  | Derivative gain × 1e6            |
| `target_price` | u64  | Peg target in oracle units       |
| `min_fee_bps`  | u16  | Minimum fee (floor)              |
| `max_fee_bps`  | u16  | Maximum fee (ceiling)            |

**Accounts:**

| Account        | Writable | Signer | Description                     |
|----------------|----------|--------|---------------------------------|
| `authority`    | ✓        | ✓      | Stablecoin authority            |
| `config`       | ✓        | –      | `StablecoinConfig` PDA          |
| `pid_config`   | ✓ (init) | –      | `PidConfig` PDA (created here)  |
| `system_program` | –      | –      | System Program                  |

**Validation:** `min_fee_bps ≤ max_fee_bps` — otherwise returns `InvalidPidFeeRange`.

**Event emitted:** `PidConfigInitialised`

---

### `update_stability_fee_pid` — permissionless keeper

Accepts the current oracle price, runs the PID computation, and updates `stability_fee_bps`. Any signer may call this — callers should read from the mint's configured Pyth feed.

**Parameters:**

| Param           | Type | Description                               |
|-----------------|------|-------------------------------------------|
| `current_price` | u64  | Latest oracle price in same units as `target_price` |

**Accounts:**

| Account      | Writable | Signer | Description            |
|--------------|----------|--------|------------------------|
| `caller`     | –        | ✓      | Any permissionless keeper |
| `config`     | ✓        | –      | `StablecoinConfig` PDA |
| `pid_config` | ✓        | –      | `PidConfig` PDA        |

**Requires:** `FLAG_PID_FEE_CONTROL` set — otherwise returns `PidConfigNotFound`.

**Event emitted:** `PidFeeUpdated`

---

## Events

### `PidConfigInitialised`

Emitted once when `init_pid_config` completes.

```rust
pub struct PidConfigInitialised {
    pub mint: Pubkey,
    pub kp: i64,
    pub ki: i64,
    pub kd: i64,
    pub target_price: u64,
    pub min_fee_bps: u16,
    pub max_fee_bps: u16,
}
```

### `PidFeeUpdated`

Emitted on every successful `update_stability_fee_pid` call.

```rust
pub struct PidFeeUpdated {
    pub mint: Pubkey,
    pub old_fee_bps: u16,
    pub new_fee_bps: u16,
    pub current_price: u64,
    pub target_price: u64,
    pub error: i64,
    pub integral: i64,
    pub derivative: i64,
    pub delta_bps: i64,
}
```

---

## Errors

| Error                | Description                                    |
|----------------------|------------------------------------------------|
| `InvalidPidFeeRange` | `min_fee_bps > max_fee_bps` in `init_pid_config` |
| `PidConfigNotFound`  | `FLAG_PID_FEE_CONTROL` not set when calling `update_stability_fee_pid` |
| `Unauthorized`       | Caller is not the stablecoin authority (init only) |

---

## TypeScript Example

```typescript
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";

const [pidConfigPda] = PublicKey.findProgramAddressSync(
  [Buffer.from("pid-config"), mint.toBuffer()],
  program.programId,
);

// --- Authority: initialise PID controller ---
await program.methods
  .initPidConfig({
    kp: new BN(500),          // 0.0005 proportional gain
    ki: new BN(50),           // 0.00005 integral gain
    kd: new BN(100),          // 0.0001 derivative gain
    targetPrice: new BN(1_000_000), // $1.00 (6 decimals)
    minFeeBps: 0,             // 0 bps floor
    maxFeeBps: 100,           // 100 bps (1%) ceiling
  })
  .accounts({
    authority: wallet.publicKey,
    config: stablecoinConfigPda,
    pidConfig: pidConfigPda,
    systemProgram: SystemProgram.programId,
  })
  .rpc();

// --- Keeper: submit Pyth price and update fee ---
const pythPrice = await fetchPythPrice(pythFeed); // e.g. 999_850 ($0.99985)

await program.methods
  .updateStabilityFeePid(new BN(pythPrice))
  .accounts({
    caller: keeperWallet.publicKey,
    config: stablecoinConfigPda,
    pidConfig: pidConfigPda,
  })
  .rpc();
```

---

## Keeper Setup

`update_stability_fee_pid` is permissionless — any signer can call it. A typical keeper loop:

1. Subscribe to the mint's Pyth price feed (or Switchboard).
2. On each new price publish (or on a 30-second heartbeat), call `update_stability_fee_pid(current_price)`.
3. Monitor `PidFeeUpdated` events to track controller behaviour.
4. Alert if `new_fee_bps` stays pinned at `min_fee_bps` or `max_fee_bps` for extended periods — this indicates persistent peg deviation.

> **Security note:** The program does not verify the oracle account on-chain. In production, callers must ensure they read from the canonical Pyth feed for the mint. A future upgrade may add on-chain oracle verification via a stored `oracle_hint` field.

---

## Anti-Windup

The integral accumulator is clamped to `±1,000,000,000` (1e9) before each update. This prevents integral windup during prolonged peg deviations where the fee is already pinned at its ceiling or floor, ensuring the controller responds quickly when the price returns to peg.

---

## Relationship to `set_stability_fee`

When `FLAG_PID_FEE_CONTROL` is active, direct `set_stability_fee` calls should not be used — the PID controller owns `stability_fee_bps`. Turning off the flag (via admin timelock + `ADMIN_OP_CLEAR_FEATURE_FLAG`) returns manual control to the authority.

---

*See also: [README](../README.md) · [RESERVE-REPORTING.md](RESERVE-REPORTING.md)*

# SSS — PSM Fee & Per-Minter Velocity Limits (SSS-093)

> **Anchor instructions:** `set_psm_fee`, `set_mint_velocity_limit`
> **Applies to:** PSM fee — SSS-3 only; velocity limits — all presets

---

## Overview

SSS-093 adds two complementary rate-control mechanisms:

1. **PSM redemption fee** — a basis-point fee retained in the reserve vault on each `redeem` call. Protects against arbitrage drain during peg stress without blocking minting.
2. **Per-minter epoch velocity limit** — a per-epoch cap on how many tokens a registered minter may mint. Prevents flash-mint attacks regardless of the minter's lifetime cap.

Both controls are authority-only to configure and take effect immediately on the next relevant instruction.

---

## PSM Redemption Fee

### How it works

When a user calls `redeem`, the on-chain handler:
1. Reads `StablecoinConfig.redemption_fee_bps`
2. Computes `fee_amount = redeem_amount × fee_bps / 10_000`
3. Burns the **full** `redeem_amount` from the redeemer's SSS account
4. Releases `redeem_amount − fee_amount` collateral from the reserve vault to the redeemer
5. The `fee_amount` of collateral **remains in the vault** (not returned to redeemer)

The fee thus accrues inside the reserve vault, increasing the reserve ratio over time.

### Fee limits

| Parameter | Min | Max |
|---|---|---|
| `redemption_fee_bps` | 0 (no fee) | 1000 (10%) |

### Events

`PsmFeeUpdated` is emitted on every `set_psm_fee` call:

```
PsmFeeUpdated { mint, old_fee_bps, new_fee_bps, authority }
```

`PsmSwapEvent` is emitted on every `redeem`:

```
PsmSwapEvent { mint, redeemer, sss_burned, collateral_out, fee_collected, fee_bps }
```

### On-Chain State

`StablecoinConfig` field:

| Field | Type | Description |
|---|---|---|
| `redemption_fee_bps` | `u16` | Current PSM fee. 0 = no fee |

### `set_psm_fee` Instruction

Authority-only. Sets the PSM redemption fee. SSS-3 preset required.

**Accounts:**

| Account | Writable | Signer | Description |
|---|---|---|---|
| `authority` | — | ✅ | Stablecoin authority |
| `config` | ✅ | — | `StablecoinConfig` PDA |
| `mint` | — | — | SSS-3 mint (validates `config.mint`) |

**Arguments:**

| Arg | Type | Description |
|---|---|---|
| `fee_bps` | `u16` | Redemption fee in bps (0–1000). 0 disables the fee |

**Errors:** `InvalidPsmFee` if `fee_bps > 1000`, `Unauthorized` if signer ≠ authority, `InvalidPreset` if not SSS-3.

---

## Per-Minter Epoch Velocity Limit

### How it works

Each `MinterInfo` PDA tracks epoch-level minting:

- `max_mint_per_epoch` — configured limit (0 = unlimited)
- `minted_this_epoch` — tokens minted in the current Solana epoch
- `last_epoch_reset` — the Solana epoch number when the counter was last reset

On every `mint` call:
1. If `clock.epoch != last_epoch_reset` (or `last_epoch_reset == 0`), the counter resets to 0
2. If `max_mint_per_epoch > 0`, the call fails with `MintVelocityExceeded` if `minted_this_epoch + amount > max_mint_per_epoch`
3. `minted_this_epoch` is incremented regardless of whether a limit is set (enables auditing)

**Solana epoch** ≈ 2–3 days (slot-based). This makes velocity limits a coarse but effective flash-mint guard.

### Events

`MintVelocityUpdated` is emitted on every `set_mint_velocity_limit` call:

```
MintVelocityUpdated { mint, minter, max_mint_per_epoch, authority }
```

### On-Chain State

`MinterInfo` PDA (seed `"minter-info"`):

| Field | Type | Description |
|---|---|---|
| `max_mint_per_epoch` | `u64` | Per-epoch cap. 0 = unlimited |
| `minted_this_epoch` | `u64` | Tokens minted in current epoch |
| `last_epoch_reset` | `u64` | Epoch number of last counter reset |

### `set_mint_velocity_limit` Instruction

Authority-only. Sets `max_mint_per_epoch` for a specific registered minter.

**Accounts:**

| Account | Writable | Signer | Description |
|---|---|---|---|
| `authority` | — | ✅ | Stablecoin authority |
| `config` | — | — | `StablecoinConfig` PDA |
| `mint` | — | — | SSS token mint |
| `minter` | — | — | The minter's wallet pubkey |
| `minter_info` | ✅ | — | `MinterInfo` PDA for `(config, minter)` |

**Arguments:**

| Arg | Type | Description |
|---|---|---|
| `max_mint_per_epoch` | `u64` | Per-epoch cap in native token units. 0 = unlimited (disables limit) |

**Errors:** `Unauthorized` if signer ≠ authority, `NotAMinter` if `minter_info` does not belong to the given config or minter.

---

## SDK

SSS-093 instructions are accessible via the `AdminModule` (or directly via Anchor IDL). No dedicated module was added for SSS-093; use the Anchor client directly:

```ts
import { Program } from '@coral-xyz/anchor';
import { SssToken } from '@stbr/sss-token';

const program = new Program<SssToken>(idl, programId, provider);

// Set PSM fee to 0.5% (50 bps)
await program.methods
  .setPsmFee(50)
  .accounts({ authority, config, mint })
  .rpc();

// Set velocity limit: 1_000_000 tokens per epoch for a minter
await program.methods
  .setMintVelocityLimit(new BN(1_000_000_000_000)) // adjust for decimals
  .accounts({ authority, config, mint, minter, minterInfo })
  .rpc();
```

### Deriving PDAs

```ts
import { PublicKey } from '@solana/web3.js';

// StablecoinConfig PDA
const [configPda] = PublicKey.findProgramAddressSync(
  [Buffer.from('stablecoin-config'), mint.toBuffer()],
  SSS_PROGRAM_ID,
);

// MinterInfo PDA
const [minterInfoPda] = PublicKey.findProgramAddressSync(
  [Buffer.from('minter-info'), configPda.toBuffer(), minterPubkey.toBuffer()],
  SSS_PROGRAM_ID,
);
```

---

## Design Notes

### Fee accounting

- `total_burned` is incremented by the **full** `redeem_amount` (not `amount - fee`). The fee stays as collateral in the vault; it does not appear in `total_collateral` reduction.
- This means `reserve_ratio` rises over time as fees accumulate, improving protocol solvency.

### Epoch resets are lazy

The counter reset happens inside `mint`, not in a separate crank. A minter that goes dormant for many epochs will have their counter reset automatically on next activity — no admin action needed.

### Velocity vs. lifetime cap

Both limits are independent:
- **Lifetime cap** (`MinterInfo.cap`) — maximum total tokens ever minted by this minter (cumulative)
- **Epoch velocity** (`max_mint_per_epoch`) — maximum per epoch; resets automatically

Set both for defence-in-depth on high-trust minters. Set only the epoch limit for minters where flash-mint risk dominates.

---

## Related

- [stability-fee.md](./stability-fee.md) — CDP stability fee (SSS-092)
- [on-chain-sdk-cdp.md](./on-chain-sdk-cdp.md) — CDP borrow/repay/liquidate
- [SSS-3.md](./SSS-3.md) — Reserve-backed preset overview
- [rate-limiting.md](./rate-limiting.md) — API / backend rate limiting

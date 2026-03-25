# SSS-133: Per-Wallet Rate Limiting

## Overview

SSS-133 adds **per-address, rolling-window transfer controls** to SSS stablecoins.
An authority may cap any wallet's outbound transfers to a configured maximum within
a configurable slot window.  The cap is enforced atomically in the transfer hook —
no off-chain monitoring required.

**Primary use case:** Corporate treasury controls, programmatic allowances,
and regulatory spend caps for institutional holders.

### Comparison with FLAG_SPEND_POLICY

| Concern | FLAG_SPEND_POLICY (SSS-083) | FLAG_WALLET_RATE_LIMITS (SSS-133) |
|---------|----------------------------|------------------------------------|
| Scope   | Every transfer             | Per-address only (opt-in per wallet) |
| Limit   | Per-transaction cap        | Rolling cumulative window            |
| PDA     | StablecoinConfig field     | WalletRateLimit PDA per wallet       |

Both flags may be active simultaneously; **both checks must pass** on every transfer.

---

## Feature Flag

**Bit 14** (`FLAG_WALLET_RATE_LIMITS = 1 << 14 = 16384`)

When this flag is set, the transfer hook looks for a `WalletRateLimit` PDA for
the sender of every transfer.  If no PDA exists for a given wallet, the wallet
is **not rate-limited** — the PDA is opt-in per wallet.

---

## PDA: `WalletRateLimit`

Seeds: `[b"wallet-rate-limit", sss_mint, wallet]`

| Field                     | Type   | Description                                              |
|---------------------------|--------|----------------------------------------------------------|
| `sss_mint`                | Pubkey | The SSS stablecoin mint                                  |
| `wallet`                  | Pubkey | Token account owner being rate-limited                   |
| `max_transfer_per_window` | u64    | Maximum tokens the wallet may transfer per window        |
| `window_slots`            | u64    | Rolling window duration in slots (e.g. ~216 000 ≈ 1 day)|
| `transferred_this_window` | u64    | Tokens transferred so far in the current window          |
| `window_start_slot`       | u64    | Slot at which the current window started                 |
| `bump`                    | u8     | PDA bump seed                                            |

**Note:** `transferred_this_window` and `window_start_slot` are mutated by the
transfer hook on every transfer; the PDA must be passed as **writable** in
`remaining_accounts`.

### Window reset logic

```
if current_slot < window_start_slot + window_slots:
    # still in same window
    require transferred_this_window + amount <= max_transfer_per_window
    transferred_this_window += amount
else:
    # window elapsed — reset
    window_start_slot = current_slot
    transferred_this_window = amount
    require transferred_this_window <= max_transfer_per_window
```

---

## Instructions

### `set_wallet_rate_limit`

Creates or overwrites a `WalletRateLimit` PDA for a given wallet. Authority-only.

Resets `transferred_this_window` and `window_start_slot` to 0 on every call
(window begins fresh on the next transfer).

```rust
pub struct SetWalletRateLimitParams {
    pub wallet: Pubkey,
    pub max_transfer_per_window: u64,
    pub window_slots: u64,
}
```

**Constraints:**
- `FLAG_WALLET_RATE_LIMITS` must be set on `StablecoinConfig`
- `max_transfer_per_window > 0`
- `window_slots > 0`

Emits: `WalletRateLimitSet`

---

### `remove_wallet_rate_limit`

Closes the `WalletRateLimit` PDA for `wallet`, reclaiming rent to authority.
After removal, the wallet faces no rate limit (unless the PDA is re-created).

Authority-only.

Emits: `WalletRateLimitRemoved`

---

## Transfer Hook Enforcement

When `FLAG_WALLET_RATE_LIMITS` is set and a transfer fires, the transfer hook:

1. Inspects `remaining_accounts` for a writable PDA matching
   `[b"wallet-rate-limit", sss_mint, sender_wallet]`.
2. If **no PDA found** → transfer is **rejected** (`WalletRateLimitAccountMissing`).
   Omitting the PDA is not a bypass — the hook enforces its presence when the flag is set.
3. If **PDA found (not writable)** → returns `WalletRateLimitAccountNotWritable`.
4. If **PDA found (writable)**:
   - Evaluates the rolling-window check (see logic above).
   - If limit exceeded → returns `WalletRateLimitExceeded`.
   - Otherwise → updates `transferred_this_window` and `window_start_slot` in place,
     emits `WalletRateLimitEnforced`.

**Client responsibility:** Any client transferring from a rate-limited wallet **must**
include the `WalletRateLimit` PDA as a writable account in `remaining_accounts`.
Omitting it will cause the transfer to fail.
The SDK helper (see below) handles this automatically.

> **Security note (v1):** The hook currently reads/writes the WRL PDA via direct
> `try_borrow_mut_data`. A future upgrade will migrate to a CPI-based write path
> to avoid the sss-token program ownership assumption on the PDA data.

---

## Events

### `WalletRateLimitSet`
Emitted on `set_wallet_rate_limit`. Contains `mint`, `wallet`,
`max_transfer_per_window`, `window_slots`, `authority`.

### `WalletRateLimitRemoved`
Emitted on `remove_wallet_rate_limit`. Contains `mint`, `wallet`, `authority`.

### `WalletRateLimitEnforced`
Emitted by the transfer hook on every enforced transfer.

| Field                    | Description                                                |
|--------------------------|------------------------------------------------------------|
| `mint`                   | SSS mint                                                   |
| `wallet`                 | Rate-limited sender                                        |
| `amount`                 | Amount transferred in this tx                              |
| `transferred_this_window`| Cumulative total after this tx                             |
| `remaining_allowance`    | `max_transfer_per_window − transferred_this_window`        |
| `window_reset`           | `true` if a new window was started this tx                 |

---

## Errors

| Error                            | Context            | Meaning                                              |
|----------------------------------|--------------------|------------------------------------------------------|
| `WalletRateLimitsNotEnabled`     | Instruction        | `FLAG_WALLET_RATE_LIMITS` not set                    |
| `InvalidRateLimitAmount`         | Instruction        | `max_transfer_per_window` is 0                       |
| `InvalidRateLimitWindow`         | Instruction        | `window_slots` is 0                                  |
| `WalletRateLimitExceeded`        | Transfer hook      | Cumulative window limit would be exceeded            |
| `WalletRateLimitAccountNotWritable` | Transfer hook   | PDA exists but was not passed as writable            |

---

## Common Window Sizes

| `window_slots` | Approximate duration  | Use case                        |
|----------------|-----------------------|---------------------------------|
| 216 000        | ~1 day (2 slots/sec)  | Daily treasury limit            |
| 1 512 000      | ~1 week               | Weekly institutional allowance  |
| 6 480 000      | ~1 month              | Monthly compliance budget       |
| 432 000        | ~2 days / 1 epoch     | Aligned to admin timelock epoch |

*(Assumes ~2 slots/second average.)*

---

## TypeScript SDK

```typescript
import { PublicKey, BN } from "@coral-xyz/anchor";

// Derive the WalletRateLimit PDA for a wallet
function getWalletRateLimitPda(
  sssMint: PublicKey,
  wallet: PublicKey,
  programId: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("wallet-rate-limit"), sssMint.toBuffer(), wallet.toBuffer()],
    programId,
  );
}

// Set a rate limit for a wallet (~1 day window, 100k token cap)
async function setWalletRateLimit(
  program: Program<SssToken>,
  sssMint: PublicKey,
  wallet: PublicKey,
  maxPerWindow: BN,
  windowSlots: BN,
) {
  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("stablecoin-config"), sssMint.toBuffer()],
    program.programId,
  );
  const [wrlPda] = getWalletRateLimitPda(sssMint, wallet, program.programId);

  await program.methods
    .setWalletRateLimit({ wallet, maxTransferPerWindow: maxPerWindow, windowSlots })
    .accounts({ config: configPda, mint: sssMint, walletRateLimit: wrlPda })
    .rpc();
}

// Build a transfer instruction that passes the WalletRateLimit PDA
async function buildRateLimitedTransfer(
  program: Program<SssToken>,
  sssMint: PublicKey,
  senderWallet: PublicKey,   // token account owner
  fromAta: PublicKey,
  toAta: PublicKey,
  amount: BN,
) {
  const [wrlPda] = getWalletRateLimitPda(sssMint, senderWallet, program.programId);
  const wrlInfo = await program.provider.connection.getAccountInfo(wrlPda);

  const remainingAccounts = wrlInfo
    ? [{ pubkey: wrlPda, isWritable: true, isSigner: false }]
    : [];

  return program.methods
    .transfer(amount)
    .accounts({ from: fromAta, to: toAta, owner: senderWallet })
    .remainingAccounts(remainingAccounts)
    .instruction();
}
```

---

## Relationship to Other Controls

```
Transfer (Token-2022 transfer hook)
  └── FLAG_SPEND_POLICY check (global per-tx ceiling)      ← SSS-083
  └── FLAG_WALLET_RATE_LIMITS check (per-wallet window)    ← SSS-133
  └── FLAG_BLOCKED_ACCOUNTS check (blocklist)              ← SSS-062
  └── FLAG_SANCTIONS_ORACLE check (OFAC screening)         ← SSS-128
```

All enabled flag checks run on every transfer.  A transfer only succeeds if all
checks pass.

---

*SSS-133 | Status: Implemented | PR: feat/sss-133-wallet-rate-limits*

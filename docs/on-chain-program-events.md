# SSS — On-Chain Program Events

> **Program:** `sss-token`
> **Program ID:** `AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat`
> **Feature scope:** All presets (SSS-1 / SSS-2 / SSS-3 / SSS-4)

---

## Overview

The `sss-token` Anchor program emits structured **Anchor events** on every state-changing instruction. Events are logged inside the transaction and can be subscribed to via `program.addEventListener` in the TypeScript SDK, or parsed from transaction logs in any Solana RPC client.

All events are defined in `programs/sss-token/src/events.rs`.

---

## Listening to Events (TypeScript)

```typescript
import { Program, AnchorProvider } from '@coral-xyz/anchor';
import idl from './idl/sss_token.json';

const program = new Program(idl, provider);

// Subscribe
const subscriptionId = program.addEventListener('tokensMinted', (event, slot) => {
  console.log(`Minted ${event.amount} tokens in slot ${slot}`);
  console.log(`  mint:       ${event.mint.toBase58()}`);
  console.log(`  minter:     ${event.minter.toBase58()}`);
  console.log(`  recipient:  ${event.recipient.toBase58()}`);
  console.log(`  total:      ${event.totalMinted.toString()}`);
});

// Unsubscribe when done
await program.removeEventListener(subscriptionId);
```

> **Note:** Event field names in TypeScript use camelCase (`totalMinted`) while Rust uses snake_case (`total_minted`). Anchor handles the conversion automatically.

---

## Event Reference

### `TokenInitialized`

Emitted by `initialize` when a new stablecoin mint is created.

| Field | Type | Description |
|-------|------|-------------|
| `mint` | `Pubkey` | The new Token-2022 mint address |
| `authority` | `Pubkey` | Initial admin authority |
| `preset` | `u8` | Preset identifier (1, 2, 3, or 4) |
| `max_supply` | `u64` | Maximum mintable supply; `0` = unlimited |

```typescript
program.addEventListener('tokenInitialized', (event) => {
  console.log('New stablecoin:', event.mint.toBase58());
  console.log('Preset:', event.preset);
  console.log('Max supply:', event.maxSupply.toString()); // 0 = unlimited
});
```

---

### `TokensMinted`

Emitted by `mint` after a successful mint.

| Field | Type | Description |
|-------|------|-------------|
| `mint` | `Pubkey` | The stablecoin mint |
| `minter` | `Pubkey` | The registered minter that signed |
| `recipient` | `Pubkey` | Recipient token account address |
| `amount` | `u64` | Tokens minted in this instruction |
| `total_minted` | `u64` | Cumulative tokens ever minted (not net supply) |

---

### `TokensBurned`

Emitted by `burn` after a successful burn.

| Field | Type | Description |
|-------|------|-------------|
| `mint` | `Pubkey` | The stablecoin mint |
| `minter` | `Pubkey` | The registered minter that signed |
| `amount` | `u64` | Tokens burned in this instruction |
| `total_burned` | `u64` | Cumulative tokens ever burned |

---

### `AccountFrozen`

Emitted by `freeze_account`.

| Field | Type | Description |
|-------|------|-------------|
| `mint` | `Pubkey` | The stablecoin mint |
| `account` | `Pubkey` | The token account that was frozen |

---

### `AccountThawed`

Emitted by `thaw_account`.

| Field | Type | Description |
|-------|------|-------------|
| `mint` | `Pubkey` | The stablecoin mint |
| `account` | `Pubkey` | The token account that was thawed |

---

### `MintPausedEvent`

Emitted by `pause` and `unpause`.

| Field | Type | Description |
|-------|------|-------------|
| `mint` | `Pubkey` | The stablecoin mint |
| `paused` | `bool` | `true` = paused, `false` = unpaused |

---

### `CollateralDeposited`

Emitted when collateral is deposited into the reserve vault (SSS-3 / SSS-4).

| Field | Type | Description |
|-------|------|-------------|
| `mint` | `Pubkey` | The stablecoin mint |
| `depositor` | `Pubkey` | Account that deposited collateral |
| `amount` | `u64` | Collateral tokens deposited |
| `total_collateral` | `u64` | Total collateral in vault after deposit |

---

### `CollateralRedeemed`

Emitted when collateral is withdrawn from the reserve vault (SSS-3 / SSS-4).

| Field | Type | Description |
|-------|------|-------------|
| `mint` | `Pubkey` | The stablecoin mint |
| `redeemer` | `Pubkey` | Account that redeemed collateral |
| `amount` | `u64` | Collateral tokens redeemed |
| `total_collateral` | `u64` | Total collateral in vault after redemption |

---

### `AuthorityProposed`

Emitted when a new authority is proposed (two-step authority transfer). See [Authority Transfer](#authority-transfer-two-step).

| Field | Type | Description |
|-------|------|-------------|
| `mint` | `Pubkey` | The stablecoin mint |
| `proposed` | `Pubkey` | The proposed new authority |
| `is_compliance` | `bool` | `true` = compliance authority, `false` = admin authority |

---

### `AuthorityAccepted`

Emitted when a pending authority transfer is accepted by the new authority.

| Field | Type | Description |
|-------|------|-------------|
| `mint` | `Pubkey` | The stablecoin mint |
| `new_authority` | `Pubkey` | The authority that accepted |
| `is_compliance` | `bool` | `true` = compliance authority, `false` = admin authority |

---

## Authority Transfer (Two-Step)

The program stores `pending_authority` and `pending_compliance_authority` fields on `StablecoinConfig`. A safe authority handoff requires two transactions:

1. **Propose** — current authority calls `update_roles` with the new address. The `AuthorityProposed` event fires and the pending field is set.
2. **Accept** — new authority calls `accept_authority`. The `AuthorityAccepted` event fires and the authority field is atomically swapped.

This prevents accidentally transferring control to a key that the recipient doesn't control.

```
Current authority                    New authority
      │                                    │
      │── update_roles(new: X) ──────────>│  (AuthorityProposed emitted)
      │                                    │
      │                         accept() ──│  (AuthorityAccepted emitted)
      │                                    │
      ✗  (no longer in control)           ✓  (now in control)
```

---

## Parsing Events from Logs (Non-TypeScript)

Anchor events are encoded in the transaction log as base64 8-byte discriminator + borsh body. To parse without the Anchor SDK:

1. Find log lines matching `Program data: <base64>`.
2. Decode each line from base64.
3. Match the first 8 bytes against the Anchor discriminator for each event (SHA-256 of `"event:<EventName>"`).
4. Borsh-deserialize the remainder using the event's field layout.

Most integrators should use the TypeScript SDK's `program.addEventListener` instead.

---

## Related Docs

- [On-Chain SDK Core](./on-chain-sdk-core.md) — mint, burn, freeze/thaw via TypeScript
- [SSS-3 Reserve-Backed Preset](./sss3-reserve-backed.md) — collateral deposit/redeem
- [Transfer Hook](./transfer-hook.md) — SSS-2 blacklist enforcement
- [Compliance Module](./compliance-module.md) — ComplianceModule SDK reference

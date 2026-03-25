# SSS-135: Cross-Chain Bridge Hooks

Wormhole + LayerZero integration for SSS stablecoins.

---

## Overview

SSS-135 adds native cross-chain bridge hooks to the SSS on-chain program.  When `FLAG_BRIDGE_ENABLED` is set on a stablecoin config, token holders can:

- **Bridge out** (`bridge_out`): burn tokens on Solana and emit a bridge message carrying the recipient address on the target EVM chain.
- **Bridge in** (`bridge_in`): verify a Wormhole VAA or LayerZero proof and mint tokens to a Solana recipient.

All bridge operations respect existing protocol safeguards: circuit breaker, pause, blacklist (via transfer hook), and supply cap.

---

## Feature Flag

| Constant | Bit | Value |
|---|---|---|
| `FLAG_BRIDGE_ENABLED` | 13 | `1 << 13` = `0x2000` |

Enable via `set_feature_flag` (subject to admin timelock):

```typescript
await program.methods
  .setFeatureFlag(new BN(1).shln(17))
  .accounts({ authority, config })
  .rpc();
```

---

## BridgeConfig PDA

Seeds: `["bridge-config", sss_mint]`

| Field | Type | Description |
|---|---|---|
| `sss_mint` | `Pubkey` | The SSS stablecoin mint |
| `bridge_type` | `u8` | 1 = Wormhole, 2 = LayerZero |
| `bridge_program` | `Pubkey` | Wormhole core bridge or LZ endpoint program ID |
| `max_bridge_amount_per_tx` | `u64` | Per-tx bridge cap (0 = unlimited) |
| `bridge_fee_bps` | `u16` | Fee in bps deducted from `bridge_out` (max 1000) |
| `fee_vault` | `Pubkey` | Token account that receives bridge fee |
| `total_bridged_out` | `u64` | Cumulative net tokens bridged out |
| `total_bridged_in` | `u64` | Cumulative tokens bridged in |

---

## Instructions

### `init_bridge_config`

Initialize the `BridgeConfig` PDA.  **Authority-only**.  Does not enable bridging — the issuer must call `set_feature_flag(FLAG_BRIDGE_ENABLED)` separately (timelock-guarded).

```typescript
await program.methods
  .initBridgeConfig(
    1,                       // bridge_type: 1 = Wormhole
    wormholeProgramId,       // bridge_program
    new BN(500_000_000),     // max_bridge_amount_per_tx (500 tokens @ 6 dec)
    10,                      // bridge_fee_bps (0.1%)
    feeVaultTokenAccount     // fee_vault
  )
  .accounts({ authority, config, mint, bridgeConfig, systemProgram })
  .rpc();
```

### `bridge_out`

Burns `amount` tokens from the sender's token account and emits a `BridgeOut` event.  The off-chain relayer or bridge program reads the event and submits the cross-chain message.

```typescript
const recipientEvm = new Uint8Array(32); // left-pad EVM address to 32 bytes
recipientEvm.set(Buffer.from(evmAddress.slice(2), 'hex'), 12);

await program.methods
  .bridgeOut(
    new BN(100_000_000),   // amount (100 tokens @ 6 dec)
    2,                      // target_chain (Wormhole chain ID: 2 = Ethereum)
    Array.from(recipientEvm)
  )
  .accounts({ sender, config, bridgeConfig, mint, senderTokenAccount, feeVault, tokenProgram })
  .rpc();
```

**Guards checked:**
- `amount > 0`
- `!config.paused`
- `FLAG_CIRCUIT_BREAKER` not set
- `FLAG_BRIDGE_ENABLED` set
- `amount ≤ max_bridge_amount_per_tx` (if limit > 0)

**Fee model:** `fee_amount = floor(amount × bridge_fee_bps / 10_000)`.  The full `amount` is burned (deflationary); `total_bridged_out` records `amount − fee_amount`.  Integrators can modify this to route the fee to the fee vault instead.

### `bridge_in`

Verifies a bridge proof and mints `amount` tokens to the recipient.

```typescript
const proof = {
  proofBytes: vaaBytes,   // Wormhole VAA or LZ proof
  sourceChain: 2,          // source chain ID
  verified: true,          // set by bridge program CPI in production
};

await program.methods
  .bridgeIn(proof, new BN(100_000_000), recipientPubkey)
  .accounts({ relayer, config, bridgeConfig, mint, recipientTokenAccount, tokenProgram })
  .rpc();
```

**Guards checked:**
- `amount > 0`
- `!config.paused`
- `FLAG_CIRCUIT_BREAKER` not set
- `FLAG_BRIDGE_ENABLED` set
- `proof.proof_bytes.len() >= 32` (minimum proof size enforced; empty or trivially short proofs rejected)
- `bridge_config.authority != Pubkey::default()` (bridge must have a configured authority before accepting inbound transfers)
- `proof.verified` flag is **not** checked on-chain — verification relies on the authority being a trusted, hardware-secured key (see Security Model §3)
- `recipient_token_account.owner == recipient`
- `config.max_supply` cap respected

---

## Bridge Chain IDs

| Chain | Wormhole ID | LayerZero ID |
|---|---|---|
| Ethereum | 2 | 101 |
| BNB Chain | 4 | 102 |
| Polygon | 5 | 109 |
| Avalanche | 6 | 106 |
| Arbitrum | 23 | 110 |
| Optimism | 24 | 111 |
| Base | 30 | 184 |

---

## Security Model

1. **Burn-and-mint**: tokens are burned on Solana before any cross-chain message is emitted.  No double-spend is possible on the Solana side.
2. **Supply invariant**: `bridge_in` respects `max_supply`.  Total supply (minted − burned) is preserved across chains only if the EVM-side contract enforces the same invariant.
3. **Proof verification**: `bridge_in` requires `proof_bytes.len() >= 32` and `bridge_config.authority != Pubkey::default()`.  The `verified` flag in the proof struct is **ignored** on-chain — security currently depends on `bridge_config.authority` being a hardware-secured multisig or HSM key that validates the proof off-chain before submitting.  Full on-chain CPI verification (Wormhole `parseAndVerifyVM` or LayerZero `verifyPacket`) is required before mainnet deployment.  **Authority MUST be rotated to a Squads multisig before mainnet.**
4. **Pause / circuit breaker**: both `bridge_out` and `bridge_in` check `paused` and `FLAG_CIRCUIT_BREAKER`.  A single `pause()` call halts all cross-chain activity.
5. **Blacklist**: outbound transfers are subject to the Token-2022 transfer hook (SSS-2 mints), which enforces the blacklist.  Bridge_out burns from the sender ATA; a blacklisted account cannot hold tokens to burn.
6. **Per-tx limit**: `max_bridge_amount_per_tx` limits individual bridge-out transactions to prevent large flash exits.
7. **Fee cap**: `bridge_fee_bps` is capped at 1000 bps (10%) to prevent governance abuse.
8. **Admin timelock**: enabling `FLAG_BRIDGE_ENABLED` is subject to the same 2-epoch admin timelock as all other feature flag changes.

---

## Events

### `BridgeOut`
| Field | Type |
|---|---|
| `sss_mint` | `Pubkey` |
| `sender` | `Pubkey` |
| `amount` | `u64` (net of fee) |
| `fee_amount` | `u64` |
| `target_chain` | `u16` |
| `recipient_address` | `[u8; 32]` |
| `bridge_type` | `u8` |

### `BridgeIn`
| Field | Type |
|---|---|
| `sss_mint` | `Pubkey` |
| `recipient` | `Pubkey` |
| `amount` | `u64` |
| `source_chain` | `u16` |
| `bridge_type` | `u8` |

---

## Deployment Guide

1. Deploy updated program (with SSS-135 instructions).
2. Call `init_bridge_config` with the appropriate bridge type and program ID.
3. Wait for admin timelock, then call `set_feature_flag(FLAG_BRIDGE_ENABLED)`.
4. Deploy the corresponding EVM bridge contract (references the Wormhole/LZ protocol).
5. Register the Solana program as the trusted emitter on the EVM side.
6. Run the relayer service that listens for `BridgeOut` events and submits to Wormhole/LZ.

---

## Depends On

- SSS-122 (upgrade path / `version` guard)
- SSS-134 (FLAG bits registry — bit 17 allocated here)

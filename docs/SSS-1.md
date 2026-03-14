# SSS-1: Minimal Stablecoin Preset

> **Preset identifier:** `1`
> **Use case:** Internal tokens, DAO treasuries, ecosystem settlement layers, test environments
> **Token-2022 extensions:** Freeze authority · Metadata

---

## What SSS-1 Is

SSS-1 is the minimal viable stablecoin preset. It creates a Token-2022 mint with the essentials for any production token:

- **Freeze authority** — the compliance authority can freeze and thaw individual token accounts
- **Metadata extension** — name, symbol, and URI stored on-chain in the mint account itself
- **Pause / unpause** — the overall authority can halt all minting and burning
- **Minter caps** — registered minters are limited to a configurable token ceiling

There is no transfer hook, no blacklist, no permanent delegate. Transfers are unrestricted at the Token-2022 level.

---

## When to Use SSS-1

Choose SSS-1 when:

- You do not need on-chain blacklist enforcement (you trust your distribution pipeline)
- You want the lowest transaction overhead per transfer
- The stablecoin is for an internal use case (settlement between known parties, DAO treasury)
- You want to add compliance later — SSS-1 can be upgraded to SSS-2 by deploying the transfer hook and re-initializing

Choose SSS-2 when you need on-chain compliance enforcement. See [SSS-2.md](./SSS-2.md).

---

## Initialization

### Using the SDK

```typescript
import { SolanaStablecoin, sss1Config } from '@stbr/sss-token';

const stablecoin = await SolanaStablecoin.create(provider, sss1Config({
  name: 'My Stable',
  symbol: 'MST',
  decimals: 6,         // optional, default 6
  uri: 'https://...',  // optional metadata URI
}));

console.log('Mint:', stablecoin.mint.toBase58());
```

### What `create()` does

1. Generates a new mint keypair
2. Creates the Token-2022 mint account with freeze authority + metadata extension
3. Calls `sss-token::initialize` with `preset = 1`
4. Creates the `StablecoinConfig` PDA recording the preset, authority, and compliance authority

### `StablecoinConfig` after init (SSS-1)

| Field | Value |
|-------|-------|
| `preset` | `1` |
| `paused` | `false` |
| `transfer_hook_program` | `Pubkey::default()` (all zeros) |
| `authority` | caller |
| `compliance_authority` | caller |

---

## Operations

### Mint tokens

```typescript
await stablecoin.mintTo({
  mint: stablecoin.mint,
  amount: 1_000_000n,      // 1 token at 6 decimals
  recipient: recipientPubkey,
});
```

The caller must be a registered minter. If a cap is set, `minted + amount ≤ cap` is checked on-chain.

### Burn tokens

```typescript
await stablecoin.burn({
  mint: stablecoin.mint,
  amount: 500_000n,
  source: sourceTokenAccount,
});
```

### Freeze / Thaw a token account

```typescript
// Using the SDK directly (Token-2022 path)
import { ComplianceModule } from '@stbr/sss-token';

const compliance = new ComplianceModule(provider, stablecoin.mint, PublicKey.default());
await compliance.freezeAccount(targetTokenAccount);
await compliance.thawAccount(targetTokenAccount);
```

Only the `compliance_authority` can freeze/thaw. For SSS-1 this defaults to the initializer.

### Pause / Unpause

```typescript
await stablecoin.pause(stablecoin.mint);
await stablecoin.unpause(stablecoin.mint);
```

Only the `authority` can pause/unpause. While paused, all `mint` and `burn` instructions fail with `MintPaused`.

### Manage minters

```typescript
// Register a minter with a cap of 10M tokens
await stablecoin.updateMinter(stablecoin.mint, minterPubkey, 10_000_000_000_000n);

// Revoke a minter
await stablecoin.revokeMinter(stablecoin.mint, minterPubkey);
```

---

## On-Chain Accounts

### `StablecoinConfig` PDA

```
seeds: ["stablecoin-config", mint]
program: sss-token
```

| Field | Type | Description |
|-------|------|-------------|
| `mint` | `Pubkey` | The Token-2022 mint |
| `authority` | `Pubkey` | Can update roles, manage minters, pause/unpause |
| `compliance_authority` | `Pubkey` | Can freeze/thaw token accounts |
| `preset` | `u8` | `1` for SSS-1 |
| `paused` | `bool` | Whether minting/burning is currently paused |
| `total_minted` | `u64` | Cumulative tokens minted (not net of burns) |
| `total_burned` | `u64` | Cumulative tokens burned |
| `transfer_hook_program` | `Pubkey` | `default()` for SSS-1 |

### `MinterInfo` PDA

```
seeds: ["minter-info", config, minter]
program: sss-token
```

| Field | Type | Description |
|-------|------|-------------|
| `config` | `Pubkey` | The `StablecoinConfig` this minter belongs to |
| `minter` | `Pubkey` | The minter wallet |
| `cap` | `u64` | Max tokens this minter can mint (0 = unlimited) |
| `minted` | `u64` | Tokens minted so far by this minter |

---

## Error Codes

| Error | Description |
|-------|-------------|
| `Unauthorized` | Caller is not the authority or compliance authority |
| `MintPaused` | Attempted mint/burn while paused |
| `MinterCapExceeded` | Mint would exceed the minter's cap |
| `MinterNotFound` | No `MinterInfo` PDA exists for this minter |

---

## Token-2022 Extensions Used

| Extension | Purpose |
|-----------|---------|
| `FreezeAuthority` | Enables `freeze_account` / `thaw_account` |
| `MetadataPointer` + `TokenMetadata` | Stores name/symbol/URI in the mint account |

No transfer hook is registered for SSS-1 mints — Token-2022 transfers proceed without any hook invocation.

---

## Related Docs

- [SSS-2.md](./SSS-2.md) — compliant preset with on-chain blacklist enforcement
- [on-chain-sdk-core.md](./on-chain-sdk-core.md) — full `SolanaStablecoin` SDK reference
- [ARCHITECTURE.md](./ARCHITECTURE.md) — system architecture overview

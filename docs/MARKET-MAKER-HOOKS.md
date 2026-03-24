# Market Maker Hooks — SSS-138

> **Feature flag:** `FLAG_MARKET_MAKER_HOOKS` (bit 18)  
> **Requires:** `init_market_maker_config` to be called after enabling the flag.

---

## Overview

Market Maker Hooks give whitelisted market makers (MMs) the ability to mint and burn tokens programmatically to maintain the $1.00 peg. MM operations:

- **Bypass stability fees** — MMs pay no fee on `mm_mint` or `mm_burn`.
- **Are rate-limited per slot** — separate limits for minting and burning reset automatically each slot.
- **Require oracle spread confirmation** — operations are blocked if the oracle price deviates beyond `spread_bps` from peg.

This feature is designed for institutional liquidity providers who actively arbitrage the secondary market to keep the token on peg.

---

## Architecture

```
StablecoinConfig (per-mint)
    └── MarketMakerConfig PDA [b"mm-config", mint]
            ├── whitelisted_mms: Vec<Pubkey> (max 10)
            ├── mm_mint_limit_per_slot: u64
            ├── mm_burn_limit_per_slot: u64
            ├── spread_bps: u16
            ├── last_mint_slot / mm_minted_this_slot
            └── last_burn_slot / mm_burned_this_slot
```

The `MarketMakerConfig` PDA is seeded `[b"mm-config", mint_pubkey]`. It holds the whitelist and per-slot usage counters. Counters reset automatically when the current slot advances past `last_*_slot`.

---

## Prerequisites

1. Enable the flag before calling `init_market_maker_config`:

```typescript
await program.methods
  .setFeatureFlag(new BN(FLAG_MARKET_MAKER_HOOKS))
  .accounts({ authority, config, mint })
  .rpc();
```

2. If `FLAG_SQUADS_AUTHORITY` is also active, the authority must be the Squads multisig PDA on all authority-gated instructions (`init_market_maker_config`, `register_market_maker`).

---

## Instructions

### `init_market_maker_config`

Authority-only. Creates the `MarketMakerConfig` PDA with an empty whitelist.

**Params:**

| Field | Type | Description |
|---|---|---|
| `mm_mint_limit_per_slot` | `u64` | Max tokens all MMs combined may mint per slot |
| `mm_burn_limit_per_slot` | `u64` | Max tokens all MMs combined may burn per slot |
| `spread_bps` | `u16` | Oracle spread tolerance in basis points (e.g. `50` = 0.5%) |

**Accounts:**

| Account | Writable | Signer | Description |
|---|---|---|---|
| `authority` | ✓ | ✓ | Stablecoin authority |
| `config` | ✓ | — | StablecoinConfig PDA |
| `mint` | — | — | Stablecoin mint |
| `mm_config` | ✓ (init) | — | MarketMakerConfig PDA (created) |
| `system_program` | — | — | System program |

**Events:** `MarketMakerConfigInitialized { mint, mm_mint_limit_per_slot, mm_burn_limit_per_slot, spread_bps, authority }`

**Errors:** `MarketMakerHooksNotEnabled`, `Unauthorized`

---

### `register_market_maker`

Authority-only. Adds a pubkey to the whitelist (max 10 entries).

**Params:**

| Field | Type | Description |
|---|---|---|
| `mm_pubkey` | `Pubkey` | The market maker's wallet/program address |

**Accounts:**

| Account | Writable | Signer | Description |
|---|---|---|---|
| `authority` | — | ✓ | Stablecoin authority |
| `config` | — | — | StablecoinConfig PDA |
| `mint` | — | — | Stablecoin mint |
| `mm_config` | ✓ | — | MarketMakerConfig PDA |

**Events:** `MarketMakerRegistered { mint, market_maker, authority }`

**Errors:** `Unauthorized`, `MarketMakerAlreadyRegistered`, `MarketMakerListFull`

---

### `mm_mint`

Whitelisted MM mints tokens. Bypasses stability fee. Subject to per-slot rate limit and oracle spread check.

**Params:** `amount: u64`

**Accounts:**

| Account | Writable | Signer | Description |
|---|---|---|---|
| `market_maker` | — | ✓ | Whitelisted MM wallet |
| `config` | — | — | StablecoinConfig PDA |
| `mint` | ✓ | — | Stablecoin mint |
| `mm_config` | ✓ | — | MarketMakerConfig PDA |
| `mm_token_account` | ✓ | — | MM's token account (receives minted tokens) |
| `oracle_feed` | — | — | Oracle price feed (pass default pubkey if unconfigured) |
| `token_program` | — | — | Token-2022 program |

**Events:** `MmMint { mint, market_maker, amount, slot }`

**Errors:** `ZeroAmount`, `NotWhitelistedMarketMaker`, `OraclePriceOutsideSpread`, `MmMintLimitExceeded`, `MintPaused`

---

### `mm_burn`

Whitelisted MM burns tokens. Subject to per-slot rate limit and oracle spread check.

**Params:** `amount: u64`

**Accounts:**

| Account | Writable | Signer | Description |
|---|---|---|---|
| `market_maker` | — | ✓ | Whitelisted MM wallet |
| `config` | — | — | StablecoinConfig PDA |
| `mint` | ✓ | — | Stablecoin mint |
| `mm_config` | ✓ | — | MarketMakerConfig PDA |
| `mm_token_account` | ✓ | — | MM's token account (tokens burned from here) |
| `oracle_feed` | — | — | Oracle price feed |
| `token_program` | — | — | Token-2022 program |

**Events:** `MmBurn { mint, market_maker, amount, slot }`

**Errors:** `ZeroAmount`, `NotWhitelistedMarketMaker`, `OraclePriceOutsideSpread`, `MmBurnLimitExceeded`, `MintPaused`

---

### `get_mm_capacity`

Read-only. Emits remaining mint and burn capacity for the current slot.

**Accounts:**

| Account | Writable | Signer | Description |
|---|---|---|---|
| `mm_config` | — | — | MarketMakerConfig PDA |
| `mint` | — | — | Stablecoin mint |

**Events:** `MmCapacity { mint, mint_remaining, burn_remaining, slot }`

---

## Oracle Spread Check

The oracle spread check runs on every `mm_mint` and `mm_burn` call:

1. Reads oracle price in µUSD (6 decimal places) via the SSS oracle abstraction layer.
2. Computes deviation from peg: `|oracle_price_µUSD − 1_000_000|`.
3. Tolerates up to `spread_bps × 10` µUSD deviation (e.g. `spread_bps=50` → 500 µUSD = $0.0005).
4. **Skipped** if `oracle_feed == Pubkey::default()` — useful for tests; always configure a feed on mainnet.

---

## Per-Slot Rate Limits

Limits apply **collectively** across all registered MMs:

- `mm_mint_limit_per_slot`: total tokens that may be minted across all MM `mm_mint` calls in a slot.
- `mm_burn_limit_per_slot`: total tokens that may be burned across all MM `mm_burn` calls in a slot.
- Counters reset to 0 when the slot number advances.

---

## Events Reference

| Event | Emitted By | Fields |
|---|---|---|
| `MarketMakerConfigInitialized` | `init_market_maker_config` | `mint`, `mm_mint_limit_per_slot`, `mm_burn_limit_per_slot`, `spread_bps`, `authority` |
| `MarketMakerRegistered` | `register_market_maker` | `mint`, `market_maker`, `authority` |
| `MmMint` | `mm_mint` | `mint`, `market_maker`, `amount`, `slot` |
| `MmBurn` | `mm_burn` | `mint`, `market_maker`, `amount`, `slot` |
| `MmCapacity` | `get_mm_capacity` | `mint`, `mint_remaining`, `burn_remaining`, `slot` |

---

## Errors Reference

| Error | Instruction | Meaning |
|---|---|---|
| `MarketMakerHooksNotEnabled` | `init_market_maker_config` | `FLAG_MARKET_MAKER_HOOKS` (bit 18) not set |
| `NotWhitelistedMarketMaker` | `mm_mint`, `mm_burn` | Signer not in whitelist |
| `MarketMakerAlreadyRegistered` | `register_market_maker` | Pubkey already in whitelist |
| `MarketMakerListFull` | `register_market_maker` | Whitelist at 10-entry capacity |
| `MmMintLimitExceeded` | `mm_mint` | Slot mint limit reached |
| `MmBurnLimitExceeded` | `mm_burn` | Slot burn limit reached |
| `OraclePriceOutsideSpread` | `mm_mint`, `mm_burn` | Oracle price too far from $1 peg |

---

## TypeScript Example

```typescript
import { PublicKey, BN } from "@coral-xyz/anchor";

const FLAG_MARKET_MAKER_HOOKS = new BN(1).shln(18);

// 1. Enable flag
await program.methods
  .setFeatureFlag(FLAG_MARKET_MAKER_HOOKS)
  .accounts({ authority, config, mint })
  .rpc();

// 2. Init MM config
const [mmConfig] = PublicKey.findProgramAddressSync(
  [Buffer.from("mm-config"), mint.toBuffer()],
  program.programId
);

await program.methods
  .initMarketMakerConfig({
    mmMintLimitPerSlot: new BN(1_000_000_000), // 1000 tokens (6dp)
    mmBurnLimitPerSlot: new BN(1_000_000_000),
    spreadBps: 50,                              // 0.5%
  })
  .accounts({ authority, config, mint, mmConfig, systemProgram })
  .rpc();

// 3. Register a market maker
await program.methods
  .registerMarketMaker(mmWallet.publicKey)
  .accounts({ authority, config, mint, mmConfig })
  .rpc();

// 4. MM mints (from MM's keypair)
await program.methods
  .mmMint(new BN(500_000_000)) // 500 tokens
  .accounts({
    marketMaker: mmWallet.publicKey,
    config,
    mint,
    mmConfig,
    mmTokenAccount,
    oracleFeed: oracleFeedPubkey,
    tokenProgram: TOKEN_2022_PROGRAM_ID,
  })
  .signers([mmWallet])
  .rpc();

// 5. Query remaining capacity
await program.methods
  .getMmCapacity()
  .accounts({ mmConfig, mint })
  .rpc();
// → emits MmCapacity event with mint_remaining / burn_remaining
```

---

## Security Considerations

- **Whitelist cap** (10 entries) prevents unbounded PDA growth.
- **Collective rate limits** prevent a single MM from monopolising slot capacity.
- **Oracle skip in tests** — the `oracle_feed == Pubkey::default()` bypass is intentional for devnet/tests. On mainnet, always configure a live Pyth feed; the check enforces `OraclePriceOutsideSpread` otherwise.
- **Fee bypass** is explicit and by design; MMs are institutional partners expected to be KYC'd.
- **Squads integration** — when `FLAG_SQUADS_AUTHORITY` is active, both `init_market_maker_config` and `register_market_maker` enforce the Squads multisig.
- **Paused state** — `mm_mint` and `mm_burn` both check `!config.paused`; a guardian pause blocks MM activity.

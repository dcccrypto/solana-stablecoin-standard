# sss-cpi

**Rust CPI client library for integrating with the Solana Stablecoin Standard.**

Use this crate to invoke `sss-token` instructions from your own Solana program via CPI (Cross-Program Invocation).

---

## Installation

Add to your program's `Cargo.toml`:

```toml
[dependencies]
sss-cpi = { path = "../../crates/sss-cpi" }

# For full Anchor CPI module (auto-generated from IDL):
sss-cpi = { path = "../../crates/sss-cpi", features = ["cpi"] }
```

---

## What's Included

| Module | Description |
|---|---|
| `pda` | PDA derivation helpers for all SSS account types |
| `flags` | Feature flag bit constants (`FLAG_CIRCUIT_BREAKER_V2`, `FLAG_SPEND_POLICY`, etc.) |
| `discriminators` | Instruction discriminator bytes |
| `cpi` (feature-gated) | Full Anchor-generated CPI module for `sss-token` |

---

## Usage

### PDA Derivation

```rust
use sss_cpi::pda;

let (config_pda, bump) = pda::find_stablecoin_config(&mint_pubkey);
let (minter_pda, bump) = pda::find_minter_config(&mint_pubkey, &minter_pubkey);
```

### Feature Flag Checks

```rust
use sss_cpi::flags;

let is_cb_active = config.feature_flags & flags::FLAG_CIRCUIT_BREAKER_V2 != 0;
let is_dao_active = config.feature_flags & flags::FLAG_DAO_COMMITTEE != 0;
```

### CPI Mint/Burn

```rust
use sss_cpi::cpi;

// CPI mint through sss-token program
cpi::cpi_mint(ctx, amount)?;

// CPI burn through sss-token program
cpi::cpi_burn(ctx, amount)?;
```

---

## Feature Flags

| Flag | Constant | Bit |
|---|---|---|
| Circuit Breaker v2 | `FLAG_CIRCUIT_BREAKER_V2` | 0 |
| Spend Policy | `FLAG_SPEND_POLICY` | 1 |
| DAO Committee | `FLAG_DAO_COMMITTEE` | 2 |
| Yield Collateral | `FLAG_YIELD_COLLATERAL` | 3 |
| ZK Compliance | `FLAG_ZK_COMPLIANCE` | 4 |
| Redemption Queue | `FLAG_REDEMPTION_QUEUE` | 23 |
| Legal Entity Registry | `FLAG_LEGAL_REGISTRY` | 24 |

---

## License

MIT OR Apache-2.0

# SSS — Rust CPI Library (`sss-cpi`)

> **Crate:** `crates/sss-cpi/`
> **Version:** 0.1.0
> **Added:** SSS-143

---

## Overview

`sss-cpi` is a Rust CPI client library that lets any Solana program compose with the SSS on-chain program without depending on the full `sss-token` crate. It provides:

- Typed instruction builders for `cpi_mint` and `cpi_burn`
- PDA derivation helpers for all 30+ SSS on-chain accounts
- Feature flag constants (all 17 bits, `FLAGS` bits 0–16)
- Discriminator constants for CPI entrypoints and core instructions
- Interface version compatibility checking (`InterfaceVersion` PDA)
- Zero clippy warnings; 31 unit tests + 2 doc tests

---

## Installation

Add to your program's `Cargo.toml`:

```toml
[dependencies]
sss-cpi = { git = "https://github.com/dcccrypto/solana-stablecoin-standard" }
```

To get the full Anchor IDL-derived CPI module (optional):

```toml
sss-cpi = { git = "...", features = ["cpi"] }
```

---

## Quick Start

### Deriving PDAs

```rust
use sss_cpi::pda::{find_config, find_minter_info, find_interface_version};
use anchor_lang::prelude::Pubkey;

let mint = Pubkey::new_unique();
let minter = Pubkey::new_unique();

let (config_pda, _bump)       = find_config(&mint);
let (minter_info_pda, _bump)  = find_minter_info(&config_pda, &minter);
let (iv_pda, _bump)           = find_interface_version(&mint);
```

### Building a `cpi_mint` Instruction

```rust
use sss_cpi::instructions::{build_cpi_mint_ix, CpiMintArgs};
use sss_cpi::CURRENT_INTERFACE_VERSION;

let ix = build_cpi_mint_ix(CpiMintArgs {
    minter,
    config: config_pda,
    minter_info: minter_info_pda,
    mint,
    recipient_token_account: recipient_ata,
    interface_version_pda: iv_pda,
    token_program: spl_token_2022::ID,
    amount: 1_000_000,               // base units
    required_version: CURRENT_INTERFACE_VERSION,
});

// invoke from within your Anchor instruction handler:
anchor_lang::solana_program::program::invoke(&ix, &[...])?;
```

### Building a `cpi_burn` Instruction

```rust
use sss_cpi::instructions::{build_cpi_burn_ix, CpiBurnArgs};

let ix = build_cpi_burn_ix(CpiBurnArgs {
    burner,
    config: config_pda,
    minter_info: minter_info_pda,
    mint,
    source_token_account: burner_ata,
    interface_version_pda: iv_pda,
    token_program: spl_token_2022::ID,
    amount: 500_000,
    required_version: CURRENT_INTERFACE_VERSION,
});
```

---

## PDA Reference

All SSS on-chain PDAs can be derived deterministically. Seeds mirror `programs/sss-token/src/state.rs`.

| Helper | Seeds | Description |
|--------|-------|-------------|
| `find_config(mint)` | `["stablecoin-config", mint]` | Main `StablecoinConfig` PDA |
| `find_minter_info(config, minter)` | `["minter-info", config, minter]` | Per-minter cap and mint tracking |
| `find_interface_version(mint)` | `["interface-version", mint]` | CPI interface version PDA |
| `find_cdp_vault(config, collateral_mint)` | `["cdp-collateral-vault", config, collateral_mint]` | CDP collateral vault |
| `find_cdp_position(config, owner, collateral_mint)` | `["cdp-position", config, owner, collateral_mint]` | Individual CDP position |
| `find_proof_of_reserves(config)` | `["proof-of-reserves", config]` | PoR attestation PDA |
| `find_reserve_composition(config)` | `["reserve-composition", config]` | Reserve composition breakdown |
| `find_redemption_guarantee(config)` | `["redemption-guarantee", config]` | Redemption guarantee config |
| `find_redemption_request(config, requester, id)` | `["redemption-request", config, requester, id]` | Individual redemption request |
| `find_travel_rule_record(config, tx_hash)` | `["travel-rule-record", config, tx_hash]` | Travel Rule compliance record |
| `find_sanctions_record(oracle, wallet)` | `["sanctions-record", oracle, wallet]` | Sanctions oracle screening record |
| `find_credential_registry(config)` | `["credential-registry", config]` | ZK credential registry |
| `find_credential_record(config, holder)` | `["credential-record", config, holder]` | Per-holder ZK credential |
| `find_pid_config(config)` | `["pid-config", config]` | PID stability fee controller |
| `find_guardian_config(config)` | `["guardian-config", config]` | Guardian multisig config |
| `find_pause_proposal(config, id)` | `["pause-proposal", config, id]` | Guardian pause proposal |
| `find_authority_rotation(config)` | `["authority-rotation-request", config]` | Authority rotation request |
| `find_liquidation_bonus_config(config)` | `["liquidation-bonus-config", config]` | Graduated liquidation bonus tiers |
| `find_psm_curve_config(config)` | `["psm-curve-config", config]` | PSM AMM slippage curve config |
| `find_wallet_rate_limit(config, wallet)` | `["wallet-rate-limit", config, wallet]` | Per-wallet rate limit PDA |
| `find_squads_multisig_config(config)` | `["squads-multisig-config", config]` | Squads V4 multisig config |

---

## Feature Flag Constants

All 17 feature flag bits are exported from `sss_cpi::flags`:

```rust
use sss_cpi::flags::{has_flag, FLAG_CIRCUIT_BREAKER, FLAG_POR_HALT_ON_BREACH};

if has_flag(config.feature_flags, FLAG_CIRCUIT_BREAKER) {
    return Err(MyError::ProtocolHalted.into());
}
```

| Constant | Bit | Description |
|----------|-----|-------------|
| `FLAG_CIRCUIT_BREAKER` | 0 | All mint/transfer/burn ops halted |
| `FLAG_SPEND_POLICY` | 1 | Per-tx transfer amount cap |
| `FLAG_DAO_COMMITTEE` | 2 | Admin ops require passed proposal |
| `FLAG_YIELD_COLLATERAL` | 3 | Whitelisted yield-bearing collateral only |
| `FLAG_ZK_COMPLIANCE` | 4 | Transfers require ZK proof |
| `FLAG_CONFIDENTIAL_TRANSFERS` | 5 | Token-2022 confidential transfers enabled |
| `FLAG_PROBABILISTIC_MONEY` | 6 | PBS payment channels enabled |
| `FLAG_AGENT_PAYMENT_CHANNEL` | 7 | APC channel-based escrow enabled |
| `FLAG_TRAVEL_RULE` | 8 | VASP travel-rule compliance records required |
| `FLAG_SANCTIONS_ORACLE` | 9 | On-chain sanctions screening oracle |
| `FLAG_ZK_CREDENTIALS` | 10 | Credential-based transfer authorization |
| `FLAG_PID_FEE_CONTROL` | 11 | PID stability fee controller |
| `FLAG_GRAD_LIQUIDATION_BONUS` | 12 | Graduated liquidation bonuses by collateral health |
| `FLAG_PSM_DYNAMIC_FEES` | 13 | AMM-style PSM slippage curves |
| `FLAG_WALLET_RATE_LIMITS` | 14 | Rolling-window per-wallet spend controls |
| `FLAG_SQUADS_AUTHORITY` | 15 | Squads V4 multisig as program authority (SSS-4) |
| `FLAG_POR_HALT_ON_BREACH` | 16 | Minting halted on PoR breach |

---

## Interface Version Compatibility

`sss-cpi` embeds a compile-time `CURRENT_INTERFACE_VERSION = 1`. Before dispatching a CPI call, the on-chain program reads the `InterfaceVersion` PDA and rejects calls that pin an incompatible version.

```rust
use sss_cpi::version::{is_supported_version, CURRENT_INTERFACE_VERSION, MIN_SUPPORTED_VERSION};

// Check whether an on-chain version is supported by this library:
assert!(is_supported_version(CURRENT_INTERFACE_VERSION)); // true
assert!(!is_supported_version(0));                        // false — pre-v1
```

When SSS bumps the CPI interface (breaking layout change), `CURRENT_INTERFACE_VERSION` will increment. Callers compiled against an older version will receive an on-chain `InterfaceVersionMismatch` error — a clear signal to upgrade, rather than silent misbehaviour.

---

## Example: Lending Protocol CPI

A lending protocol that checks SSS reserve ratio before issuing a loan:

```rust
use anchor_lang::prelude::*;
use sss_cpi::pda::find_proof_of_reserves;

#[derive(Accounts)]
pub struct IssueLoan<'info> {
    // ... your accounts ...
    /// CHECK: verified by seeds below
    #[account(seeds = [b"proof-of-reserves", config.key().as_ref()], bump,
              seeds::program = sss_cpi::sss_program_id())]
    pub por_pda: UncheckedAccount<'info>,
}

pub fn issue_loan(ctx: Context<IssueLoan>, amount: u64) -> Result<()> {
    // Read SSS PoR attestation from account data before issuing loan
    let (expected_pda, _) = find_proof_of_reserves(&ctx.accounts.config.key());
    require_keys_eq!(ctx.accounts.por_pda.key(), expected_pda);
    // ... deserialize and check reserve_ratio_bps >= threshold ...
    Ok(())
}
```

---

## Discriminator Constants

For low-level instruction parsing or routing:

```rust
use sss_cpi::discriminators::{
    DISCRIMINATOR_CPI_MINT,       // [u8; 8] — cpi_mint instruction
    DISCRIMINATOR_CPI_BURN,       // [u8; 8] — cpi_burn instruction
    DISCRIMINATOR_INITIALIZE,     // [u8; 8] — initialize
    DISCRIMINATOR_MINT,           // [u8; 8] — mint
    DISCRIMINATOR_BURN,           // [u8; 8] — burn
};
```

---

## Testing

```bash
cd crates/sss-cpi
cargo test          # 31 unit tests + 2 doc tests
cargo clippy        # zero warnings
```

---

## Related Docs

- [CPI Composability Module (TypeScript SDK)](on-chain-sdk-cpi.md) — TS wrapper for the same CPI interface
- [SSS-3 Trustless Preset](SSS-3.md) — the main program this library targets
- [Feature Flags Reference](feature-flags.md) — full flag documentation
- [Proof of Reserves](PROOF-OF-RESERVES.md) — PoR attestation PDA

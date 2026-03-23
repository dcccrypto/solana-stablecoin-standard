# SSS-Core — Solana Stablecoin Standard Core Program

On-chain Anchor program that defines the **Stablecoin Config PDA** — the foundation of the Solana Stablecoin Standard. It provides RBAC, per-minter quotas, pause/unpause, two-step authority transfer, freeze/thaw, and seize — all enforced on-chain.

## Why This Matters

Without a config PDA program, there is no "standard" — just an SDK wrapper around `@solana/spl-token`. The config PDA is what makes stablecoins created with SSS **identifiable, manageable, and composable**.

## Architecture

```
StablecoinConfig PDA                RoleEntry PDA (per wallet+role)
["sss-config", mint]                ["role", config, grantee, role_type]
┌─────────────────────┐             ┌──────────────────────┐
│ authority            │             │ config               │
│ pending_authority    │             │ authority (grantee)   │
│ mint                 │             │ role: u8              │
│ preset (1=SSS-1,    │             │ granted_at: i64       │
│         2=SSS-2)    │             │ granted_by: Pubkey    │
│                     │             │ bump                  │
│ paused               │             │ _reserved: [u8; 32]   │
│ compliance_enabled   │             └──────────────────────┘
│ total_minted         │
│ total_burned         │
│ total_seized         │
│ supply_cap           │             MinterInfo PDA
│ bump                 │             ["minter", config, minter]
│ transfer_hook_program│
│ _reserved: [u8; 22]  │             ┌──────────────────────┐
└─────────────────────┘             │ config               │
                                    │ minter               │
                                    │ quota: u64            │
                                    │ total_minted: u64     │
                                    │ is_active             │
                                    │ bump                  │
                                    │ _reserved: [u8; 32]   │
                                    └──────────────────────┘

                                    ReserveAttestation PDA
                                    ["reserve", config]
                                    ┌──────────────────────┐
                                    │ config               │
                                    │ attestor             │
                                    │ reserve_amount: u64  │
                                    │ source (max 128)     │
                                    │ uri (max 256)        │
                                    │ timestamp: i64       │
                                    │ bump                 │
                                    │ _reserved: [u8; 32]  │
                                    └──────────────────────┘
```

## Instructions

| Instruction | Signer | Description |
|---|---|---|
| `initialize` | Authority | Create config PDA; transfer mint + freeze authority to PDA. Accepts `complianceEnabled` param. |
| `grant_role` | Authority | Grant a role (PDA per config+grantee+role) |
| `revoke_role` | Authority | Revoke a role (closes PDA, reclaims rent) |
| `set_minter_quota` | Authority | Create or update a minter's quota |
| `mint_tokens` | Minter | Mint tokens (checks role, quota, pause, supply cap, zero-amount). When `compliance_enabled`, checks recipient blacklist via required `recipient_blacklist_entry` account. |
| `burn_tokens` | Burner | Burn tokens from own ATA (checks role, pause, zero-amount) |
| `burn_from` | Burner | Burn from **any** account using permanent delegate (checks ROLE_BURNER, pause, zero-amount) |
| `pause` | Pauser | Pause all operations |
| `unpause` | Pauser | Resume all operations |
| `freeze_token_account` | Freezer | Freeze a token account |
| `thaw_token_account` | Freezer | Thaw a frozen token account |
| `transfer_authority` | Authority | Nominate a new authority (step 1 of 2) |
| `accept_authority` | New authority | Accept authority nomination (step 2 of 2) |
| `seize` | Seizer | Thaw → burn → mint to treasury → re-freeze (zero-amount guard) |
| `update_metadata` | Authority | Update on-mint metadata (name, symbol, uri) via CPI to Token-2022 |
| `set_compliance` | Authority | Toggle `compliance_enabled` flag on config |
| `view_config` | None | Read-only view of config state (call via simulate, no signer required) |
| `view_minter` | None | Read-only view of minter info (call via simulate, no signer required) |
| `attest_reserve` | Attestor | Create or update ReserveAttestation PDA with proof-of-reserve data (source, uri, reserve_amount). Uses init_if_needed — repeated attestations **overwrite** the same PDA (latest-only design; see note below). |
| `view_reserve` | None | Read-only view of the latest attestation (call via simulate, no signer required) |

## Roles

| Role | Value | Capability |
|---|---|---|
| `MINTER` | 0 | Mint tokens (subject to quota) |
| `BURNER` | 1 | Burn own tokens |
| `FREEZER` | 2 | Freeze/thaw token accounts |
| `PAUSER` | 3 | Pause/unpause operations |
| `BLACKLISTER` | 4 | Manage blacklist (via transfer hook program) |
| `SEIZER` | 5 | Seize tokens from frozen accounts |
| `ATTESTOR` | 6 | Record proof-of-reserve attestations |

## Events

All state-changing instructions emit typed events:

- `ConfigInitialized` — Config PDA created
- `TokensMinted` / `TokensBurned` — Supply changes
- `TokensBurnedFrom { config, mint, burner, target, amount, total_burned }` — Burn via permanent delegate
- `StablecoinPaused` / `StablecoinUnpaused`
- `RoleGranted` / `RoleRevoked`
- `MinterQuotaSet`
- `AuthorityNominated` / `AuthorityTransferred`
- `TokensSeized`
- `TokenAccountFrozen` / `TokenAccountThawed`
- `MetadataUpdated { config, mint, authority, field, value }` — On-mint metadata changed
- `ComplianceToggled { config, authority, enabled }` — Compliance enforcement toggled
- `ReserveAttested { config, attestor, reserve_amount, source, uri, timestamp }` — Proof-of-reserve attestation recorded

## Flow

```
1. Create Token-2022 mint (with extensions: PermanentDelegate, etc.)
2. Call `initialize` → config PDA takes over mint + freeze authority
3. Grant roles to operators
4. Set minter quotas
5. Minters mint, burners burn, freezers freeze — all role-gated
```

## Error Codes (6000+)

| Code | Name | Description |
|------|------|-------------|
| 6000 | `Paused` | The stablecoin is paused; operation rejected |
| 6001 | `Unauthorized` | Signer does not have the required authority |
| 6002 | `InvalidRole` | The role value is out of range or does not match the operation |
| 6003 | `QuotaExceeded` | Minter's cumulative minted amount would exceed their quota |
| 6004 | `SupplyCapExceeded` | Net supply would exceed the on-chain supply cap |
| 6005 | `MathOverflow` | Arithmetic overflow in supply accounting |
| 6006 | `NoPendingAuthority` | No pending authority nomination to accept |
| 6007 | `PendingAuthorityMismatch` | Signer does not match the nominated pending authority |
| 6008 | `AlreadyPaused` | The stablecoin is already paused |
| 6009 | `NotPaused` | The stablecoin is not paused; cannot unpause |
| 6010 | `AccountNotFrozen` | The token account is not frozen; cannot thaw or seize |
| 6011 | `AccountFrozen` | The token account is already frozen |
| 6012 | `MinterNotActive` | The minter's MinterInfo has `is_active = false` |
| 6013 | `InvalidPreset` | The preset value is out of range |
| 6014 | `RecipientBlacklisted` | The recipient wallet is on the blacklist (SSS-2 mint check) |
| 6015 | `InvalidMetadataField` | The metadata field name is not one of `name`, `symbol`, or `uri` |
| 6016 | `ComplianceNotEnabled` | Operation requires `compliance_enabled = true` on the config |
| 6017 | `ZeroAmount` | Amount must be greater than zero (mint, burn, burn_from, seize) |
| 6018 | `HookProgramNotSet` | Transfer hook program not set in config |

## ReserveAttestation Design Note

The `attest_reserve` instruction uses a single PDA seeded by `["reserve", config]` — meaning only **one attestation exists at a time** (latest-only). Repeated calls overwrite the previous attestation data.

**Why latest-only?** On-chain storage is expensive. The most recent attestation is the actionable one for downstream consumers. Historical attestations are preserved in the transaction history and events (`ReserveAttested`), which can be indexed off-chain for audit trails.

**Future enhancement (v2):** Add an `index` field to the PDA seed (`["reserve", config, index_le_bytes]`) for historical on-chain records. This would require a counter in `StablecoinConfig` and is a breaking change.

## Feature-Gated Modules

The program uses Cargo features to selectively compile enforcement logic. All features are **enabled by default**.

| Feature | Gate | What it controls |
|---------|------|-----------------|
| `compliance` | `#[cfg(feature = "compliance")]` | Blacklist check on `mint_tokens` when `compliance_enabled` is true |
| `quotas` | `#[cfg(feature = "quotas")]` | Per-minter quota enforcement in `mint_tokens` |
| `supply-cap` | `#[cfg(feature = "supply-cap")]` | Supply cap enforcement in `mint_tokens` |

To build with only a subset of features:

```bash
cargo build --no-default-features --features quotas
cargo build --no-default-features --features "quotas,supply-cap"
```

This allows issuers to strip enforcement modules they don't need, reducing compute budget usage and program size.

## Source Layout

The program follows a modular structure (inspired by [`solana-vault-standard`](https://github.com/solanabr/solana-vault-standard)):

```
src/
├── lib.rs              Thin wrapper — declare_id, module declarations, #[program] delegates
├── constants.rs        PDA seeds (CONFIG_SEED, ROLE_SEED, etc.), role IDs, preset constants
├── error.rs            SssError enum (19 error codes, 6000–6018)
├── events.rs           16 typed Anchor event structs
├── state.rs            StablecoinConfig, RoleEntry, MinterInfo, ReserveAttestation, params
└── instructions/       One file per instruction (or logical group)
    ├── mod.rs           Re-exports all instruction modules
    ├── initialize.rs    initialize
    ├── roles.rs         grant_role, revoke_role
    ├── quota.rs         set_minter_quota
    ├── mint.rs          mint_tokens
    ├── burn.rs          burn_tokens, burn_from
    ├── pause.rs         pause, unpause
    ├── freeze.rs        freeze_token_account, thaw_token_account
    ├── authority.rs     transfer_authority, accept_authority
    ├── seize.rs         seize
    ├── metadata.rs      update_metadata
    ├── compliance.rs    set_compliance
    ├── attest.rs        attest_reserve
    └── view.rs          view_config, view_minter, view_reserve
```

## Build & Test

```bash
cd programs/sss-core
anchor build
anchor test
```

The test suite includes **50 tests** covering initialization, RBAC, mint/burn, freeze/thaw, pause, seize, compliance, metadata, authority transfer, reserve attestation, and negative tests (zero-amount guards, seize overflow, invalid role).

## Fuzz / Invariant Tests

The file `tests/fuzz-invariants.ts` contains stateful fuzz-style tests that execute randomized sequences of operations (mint, burn, freeze, thaw, pause, unpause, seize) and verify global invariants after each step.

### Invariants

| ID | Name | Assertion |
|----|------|-----------|
| INV-1 | Supply consistency | `total_minted - total_burned == on-chain mint supply` |
| INV-2 | Seized ≤ burned | `total_seized <= total_burned` |
| INV-3 | State consistency | On-chain config fields match expected local tracking for `total_minted`, `total_burned`, `total_seized`, and `paused` |
| INV-4 | Quota bounds | `minter.total_minted <= minter.quota` |
| INV-5 | Supply cap | `total_minted - total_burned <= supply_cap` (when set) |

### Test Sequences

1. **Mint → burn cycle** — mints multiple amounts, burns, and checks INV-1 through INV-5 after each step.
2. **Pause blocks mint** — pauses, verifies mint is rejected, unpauses, verifies mint succeeds.
3. **Freeze → seize accounting** — freezes an account, seizes tokens, verifies `total_seized` tracking.
4. **Supply cap enforcement** — mints up to near the cap, then verifies overflow is rejected.
5. **Rapid interleaved operations** — rapid pause/unpause/freeze/thaw to stress state transitions.
6. **Randomized operations loop** — 20 iterations of randomly selected operations (mint, burn, freeze, thaw, pause, unpause, seize) with invariant checks after each successful operation.

Run with:

```bash
cd programs/sss-core
anchor test -- --grep "fuzz invariants"
```

## Program ID

```
4ZFzYcNVDSew79hSAVRdtDuMqe9g4vYh7CFvitPSy5DD
```

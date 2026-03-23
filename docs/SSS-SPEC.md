# Solana Stablecoin Standard — Specification

**Version**: 1.0  
**Status**: Draft  
**Authors**: Solana Stablecoin Standard contributors

---

## Abstract

The Solana Stablecoin Standard (SSS) defines a set of conventions, required extensions, on-chain programs, and tooling for issuing and managing fiat-backed stablecoins on Solana. It is built on **Token-2022** and uses its extension system to embed compliance controls directly into the token's lifecycle.

Two compliance tiers are defined:

| Tier | Name | Description |
|------|------|-------------|
| SSS-1 | Minimal | Mint/burn, freeze, on-mint metadata |
| SSS-2 | Compliant | SSS-1 + transfer-hook blacklist enforcement |

Both tiers may optionally integrate with the **SSS-Core** on-chain program for RBAC, per-minter quotas, supply caps, and protocol-level pause.

---

## 1. Terminology

| Term | Definition |
|------|-----------|
| **Issuer** | The entity deploying and operating the stablecoin |
| **Mint** | The Token-2022 mint account representing the stablecoin |
| **ATA** | Associated Token Account — the canonical token account for a wallet |
| **PDA** | Program Derived Address — a deterministic, off-curve account |
| **Transfer Hook** | A Token-2022 extension that CPIs into a specified program on every `TransferChecked` |
| **Blacklist** | A set of wallet addresses that are blocked from sending or receiving tokens |
| **Config PDA** | The root on-chain configuration account for a program |
| **Role Entry** | A PDA that grants a specific role to a specific public key |
| **Minter Info** | A PDA that tracks per-minter quota and cumulative minted amount |

---

## 2. SSS-1 — Minimal Stablecoin

### 2.1 Token Program

SSS-1 tokens MUST use the **Token-2022** program (`TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`).

### 2.2 Required Extensions

| Extension | Purpose |
|-----------|---------|
| **Metadata Pointer** | Points the mint to itself for on-mint metadata storage (name, symbol, URI) |

### 2.3 Required Authorities

| Authority | Responsibility |
|-----------|---------------|
| **Mint Authority** | Issue new supply via `MintTo` |
| **Freeze Authority** | Freeze/thaw individual token accounts |
| **Metadata Authority** | Update on-mint metadata fields |

### 2.4 Optional Extensions

| Extension | Purpose |
|-----------|---------|
| **Pausable** | Global emergency pause of all token activity |
| **Permanent Delegate** | Irrevocable delegate for seizure/recovery |

### 2.5 Metadata

Issuers MUST initialize on-mint metadata with:

- `name` — Human-readable token name
- `symbol` — Ticker symbol
- `uri` — (Optional) Link to extended metadata JSON

### 2.6 Decimals

Issuers SHOULD use **6 decimals** to match USDC/USDT conventions on Solana.

### 2.7 Deployment Sequence

1. `SystemProgram.createAccount` — allocate space for mint + extensions
2. `createInitializeMetadataPointerInstruction` — point to self
3. (Optional) Extension initializers for Pausable, Permanent Delegate
4. `createInitializeMint2Instruction` — set decimals, mint authority, freeze authority
5. `tokenMetadataInitialize` — write name/symbol/uri (separate transaction)

Steps 1–4 MUST be in a single transaction. Step 5 MUST be a separate transaction (mint must be initialized first).

### 2.8 Operations

| Operation | Signer | Description |
|-----------|--------|-------------|
| Mint | Mint authority | Create new supply, credited to a recipient ATA |
| Burn | Token owner | Destroy tokens from signer's token account |
| Freeze | Freeze authority | Block a token account from all transfers |
| Thaw | Freeze authority | Unblock a frozen token account |
| Pause | Pause authority | (Optional) Global pause via Pausable extension |
| Unpause | Pause authority | (Optional) Resume after pause |
| Set Authority | Current authority | Transfer or revoke any authority |

---

## 3. SSS-2 — Compliant Stablecoin

SSS-2 is a strict superset of SSS-1. Every SSS-1 requirement applies.

### 3.1 Additional Required Extensions

| Extension | Purpose |
|-----------|---------|
| **Transfer Hook** | Points to the blacklist hook program. Token-2022 CPIs into this program on every `TransferChecked`. |
| **DefaultAccountState::Frozen** | All new token accounts start frozen, requiring the issuer to thaw after KYC verification. |

### 3.2 Additional Required Authorities

| Authority | Responsibility |
|-----------|---------------|
| **Blacklist Admin** | Add/remove wallets from the blacklist. Stored in the hook's Config PDA. |

### 3.3 Blacklist Hook Program

The blacklist hook is an Anchor program deployed separately. The mint's Transfer Hook extension MUST point to this program's ID.

#### 3.3.1 Account Layout

| Account | Seeds | Key Fields |
|---------|-------|------------|
| Config | `["config", mint]` | `admin`, `pending_admin`, `mint`, `paused`, `bump`, `_reserved[63]` |
| BlacklistEntry | `["blacklist", mint, wallet]` | `wallet`, `mint`, `blocked`, `reason` (String, max 128 chars), `bump`, `_reserved[32]` |
| ExtraAccountMetaList | `["extra-account-metas", mint]` | TLV-encoded account resolution list |

#### 3.3.2 Instructions

| Instruction | Signer | Effect |
|-------------|--------|--------|
| `initialize_config` | Admin | Creates the Config PDA |
| `initialize_extra_account_meta_list` | Admin | Creates the ExtraAccountMetaList PDA |
| `add_to_blacklist(wallet, reason)` | Admin | Creates/updates BlacklistEntry, sets `blocked = true`. `reason` is stored on-chain. |
| `remove_from_blacklist(wallet)` | Admin | Sets `blocked = false` on existing BlacklistEntry |
| `close_blacklist_entry(wallet)` | Admin | Closes an **unblocked** BlacklistEntry PDA, reclaims rent |
| `transfer_admin(new_admin)` | Admin | Nominates a new admin (two-step) |
| `accept_admin()` | Pending admin | Accepts the admin role |
| `pause_hook` | Admin | Sets `paused = true` on Config PDA; blocks all transfers |
| `unpause_hook` | Admin | Sets `paused = false` on Config PDA; resumes transfers |
| `transfer_hook(amount)` | Token-2022 CPI | Checks pause flag and blacklist; rejects if paused or either side is blocked |

#### 3.3.3 Transfer Hook Execution

1. User calls `TransferChecked` on Token-2022.
2. Token-2022 resolves extra accounts from the ExtraAccountMetaList PDA.
3. Token-2022 CPIs into the hook's `execute` entrypoint.
4. Hook verifies `TransferHookAccount.transferring == true` (prevents direct invocation).
5. Hook unpacks source/destination token accounts to get owner wallets.
6. Hook derives blacklist PDAs: `["blacklist", mint, owner]`.
7. **Missing PDA → not blacklisted** (no pre-initialization required).
8. **PDA exists and `blocked == true` → transfer rejected**.
9. Otherwise, transfer completes.

#### 3.3.4 Per-Mint Isolation

Blacklist PDAs include the mint in their seeds. Blacklisting a wallet on mint A does NOT affect mint B, even when both use the same hook program.

#### 3.3.5 Blacklist Entry Lifecycle

```
[not blacklisted] → add_to_blacklist → [blocked=true]
[blocked=true]    → remove_from_blacklist → [blocked=false, PDA exists]
[blocked=false]   → close_blacklist_entry → [PDA closed, rent reclaimed]
[blocked=false]   → add_to_blacklist → [blocked=true, reuses PDA]
```

---

## 4. SSS-Core Program (Optional)

The SSS-Core Anchor program provides on-chain RBAC, per-minter quotas, supply caps, and protocol-level pause. It can be used with either SSS-1 or SSS-2 tokens.

### 4.1 Account Layout

| Account | Seeds | Key Fields |
|---------|-------|------------|
| StablecoinConfig | `["sss-config", mint]` | `authority`, `pending_authority`, `mint`, `preset`, `paused`, `compliance_enabled`, `total_minted`, `total_burned`, `total_seized`, `supply_cap`, `transfer_hook_program: Option<Pubkey>`, `bump`, `_reserved[22]` |
| RoleEntry | `["role", config, grantee, role_id]` | `config`, `authority`, `role`, `granted_at`, `granted_by`, `bump`, `_reserved[32]` |
| MinterInfo | `["minter", config, minter]` | `config`, `minter`, `quota`, `total_minted`, `is_active`, `bump`, `_reserved[32]` |
| ReserveAttestation | `["reserve", config]` | `config`, `attestor`, `reserve_amount`, `source` (max 128 chars), `uri` (max 256 chars), `timestamp`, `bump`, `_reserved[32]` |

### 4.2 Roles

| ID | Name | Permissions |
|----|------|-------------|
| 0 | Minter | `mint_tokens` |
| 1 | Burner | `burn_tokens` |
| 2 | Freezer | `freeze_token_account`, `thaw_token_account` |
| 3 | Pauser | `pause`, `unpause` |
| 4 | Blacklister | Reserved for blacklist operations |
| 5 | Seizer | `seize` (thaw → burn → mint → re-freeze) |
| 6 | Attestor | `attest_reserve` (record proof-of-reserve attestations) |

### 4.3 Instructions

| Instruction | Signer | Description |
|-------------|--------|-------------|
| `initialize(preset, supply_cap, compliance_enabled)` | Authority | Creates StablecoinConfig, transfers mint authority to config PDA. `compliance_enabled` sets the initial compliance flag. |
| `grant_role(role)` | Authority | Creates RoleEntry PDA for a grantee |
| `revoke_role(role)` | Authority | Closes RoleEntry PDA |
| `set_minter_quota(quota)` | Authority | Creates/updates MinterInfo with per-minter cap |
| `mint_tokens(amount)` | Minter (with role) | RBAC-gated mint, enforces quota, supply cap, and zero-amount guard. When `compliance_enabled`, the recipient is checked against the blacklist via a required `recipient_blacklist_entry` account in the instruction context (not `remaining_accounts`); minting to a blacklisted wallet is rejected with `RecipientBlacklisted`. |
| `burn_tokens(amount)` | Burner (with role) | RBAC-gated burn from the burner's own ATA |
| `burn_from(amount)` | Burner (with role) | Burn from **any** account using the permanent delegate. Requires `ROLE_BURNER`. |
| `freeze_token_account` | Freezer (with role) | RBAC-gated freeze |
| `thaw_token_account` | Freezer (with role) | RBAC-gated thaw |
| `pause` | Pauser (with role) | Sets `paused = true` on config |
| `unpause` | Pauser (with role) | Sets `paused = false` on config |
| `seize(amount)` | Seizer (with role) | Atomic thaw → burn → mint to treasury → re-freeze |
| `transfer_authority(new)` | Authority | Nominates new authority (two-step) |
| `accept_authority` | Pending authority | Accepts authority transfer |
| `update_metadata(field, value)` | Authority | Update on-mint metadata (name, symbol, uri) via CPI to Token-2022. `field` must be one of `"name"`, `"symbol"`, `"uri"`. |
| `set_compliance(enabled)` | Authority | Toggle the `compliance_enabled` flag on the config |
| `view_config()` | None | Read-only view of config state. Intended for use via `simulateTransaction`; no signer required. |
| `view_minter()` | None | Read-only view of minter info. Intended for use via `simulateTransaction`; no signer required. |
| `attest_reserve(reserve_amount, source, uri)` | Attestor (with role) | Create or update the ReserveAttestation PDA with proof-of-reserve data. Uses `init_if_needed` — repeated attestations update the same PDA. Requires `ROLE_ATTESTOR`. |
| `view_reserve()` | None | Read-only view of the latest attestation. Intended for use via `simulateTransaction`; no signer required. |

### 4.4 Events

All state-changing instructions emit typed Anchor events via **`emit_cpi!`**, making them visible to other programs through CPI (not just off-chain indexers). Each instruction context uses the `#[event_cpi]` attribute which appends `event_authority` and `program` accounts.

`ConfigInitialized`, `TokensMinted`, `TokensBurned`, `TokensBurnedFrom`, `StablecoinPaused`, `StablecoinUnpaused`, `RoleGranted`, `RoleRevoked`, `MinterQuotaSet`, `AuthorityNominated`, `AuthorityTransferred`, `TokensSeized`, `TokenAccountFrozen`, `TokenAccountThawed`, `MetadataUpdated`, `ComplianceToggled`, `ReserveAttested`

#### New Event Fields

| Event | Fields |
|-------|--------|
| `TokensBurnedFrom` | `config`, `mint`, `burner`, `target`, `amount`, `total_burned` |
| `MetadataUpdated` | `config`, `mint`, `authority`, `field`, `value` |
| `ComplianceToggled` | `config`, `authority`, `enabled` |
| `ReserveAttested` | `config`, `attestor`, `reserve_amount`, `source`, `uri`, `timestamp` |

### 4.5 Error Codes

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
| 6017 | `ZeroAmount` | Amount must be greater than zero (`mint_tokens`, `burn_tokens`, `burn_from`, `seize`) |
| 6018 | `HookProgramNotSet` | Transfer hook program not set in config |
| 6019 | `DefaultAccountStateNotFrozen` | SSS-2 requires `DefaultAccountState::Frozen` on the mint |
| 6020 | `InvalidBlacklistEntry` | Blacklist entry account failed validation (wrong owner, bad discriminator, or wallet/mint mismatch) |

### 4.6 Supply Cap

If `supply_cap` is `Some(n)`, then `total_minted - total_burned` MUST NOT exceed `n` after any `mint_tokens` call. If `supply_cap` is `None`, there is no on-chain limit.

### 4.7 Quota Enforcement

On `mint_tokens(amount)`:
1. Check `MinterInfo.is_active == true`
2. Check `MinterInfo.total_minted + amount <= MinterInfo.quota`
3. If both pass, increment `MinterInfo.total_minted` and `StablecoinConfig.total_minted`

### 4.8 Compliance Enforcement

The `compliance_enabled` boolean on `StablecoinConfig` controls whether `mint_tokens` checks the recipient's blacklist entry. This replaces the earlier hardcoded `preset == PRESET_SSS2` check.

- When `compliance_enabled = true`, `mint_tokens` expects the recipient's `BlacklistEntry` PDA as a **required** `recipient_blacklist_entry` account in the instruction context (not in `remaining_accounts`) and rejects with `RecipientBlacklisted` if the wallet is blocked. This prevents bypassing the check by omitting the account.
- When `compliance_enabled = false`, no blacklist check is performed during minting.
- The flag is set at `initialize` time via the `complianceEnabled` parameter and can be toggled at any time by the authority via `set_compliance(enabled)`.

### 4.9 Triple Pause Mechanism

SSS supports three independent pause mechanisms at different levels:

| Mechanism | Level | Scope | Use When |
|-----------|-------|-------|----------|
| **Token-2022 `PausableConfig`** | Protocol (runtime) | Blocks **all** token operations: transfers, mints, burns. Enforced by the Solana runtime. | Emergency halt of all token movement. |
| **SSS-Core `config.paused`** | Application (program) | Blocks **program-gated** operations only: mint, burn, seize via `sss-core`. Does **not** block direct `TransferChecked` calls to Token-2022. | Operational pause — stop new issuance and burns while allowing existing holders to transfer. |
| **Blacklist Hook `config.paused`** | Transfer (hook) | Blocks all **transfers** through the hook. Mints and burns still work. | Transfer-level pause — stop all token movement between wallets while the issuer can still mint/burn. |

All three can be used together for defense-in-depth.

### 4.10 Feature-Gated Modules

The SSS-Core program supports compile-time feature flags to selectively include enforcement logic. All features are **enabled by default**.

| Feature | Cargo Flag | Controls |
|---------|-----------|----------|
| `compliance` | `--features compliance` | Blacklist check on `mint_tokens` when `compliance_enabled` is true |
| `quotas` | `--features quotas` | Per-minter quota enforcement in `mint_tokens` |
| `supply-cap` | `--features supply-cap` | Supply cap enforcement in `mint_tokens` |

To build with a subset:

```
cargo build --no-default-features --features "quotas,supply-cap"
```

### 4.11 Auto-Init Flow

When the SDK's `create()` is called with `ssCoreProgramId` in `CreateOptions`, the deployment sequence extends automatically:

1. Deploy the Token-2022 mint (standard flow).
2. Call `sss-core::initialize` to create the `StablecoinConfig` PDA.
3. For SSS-2 preset, `compliance_enabled` is set to `true` automatically.

This means a single `create()` call can produce a fully operational mint with RBAC, quotas, and supply cap ready to use.

### 4.12 Proof-of-Reserve & GENIUS Act Compliance

The **Reserve Attestation** feature enables issuers to record proof-of-reserve data on-chain, supporting regulatory requirements such as the U.S. GENIUS Act (Generating Economic Empowerment for Noncustodial Institutional Users and Self-Custody Act).

**How it works:**

- An **Attestor** (with `ROLE_ATTESTOR`) calls `attest_reserve(reserve_amount, source, uri)` to create or update the `ReserveAttestation` PDA.
- The PDA stores: `reserve_amount` (u64), `source` (string, max 128 chars — describes the reserve source, e.g. "US Treasury Bills"), and `uri` (string, max 256 chars — link to off-chain proof document such as an auditor report).
- Each attestation emits a `ReserveAttested` event and is timestamped on-chain.
- Anyone can read the latest attestation via `view_reserve()` (simulate call, no signer required).

This provides on-chain transparency for reserve backing while keeping detailed audit documents off-chain. Issuers can update attestations periodically (e.g., monthly) to reflect current reserve levels.

### 4.13 Shared Constants Crate (`sss-common`)

Both `sss-core` and `blacklist_hook` depend on a shared Rust crate, `programs/sss-common`, which exports:

- PDA seed constants for both programs (`SSS_CONFIG_SEED`, `ROLE_SEED`, `MINTER_INFO_SEED`, `RESERVE_SEED`, `HOOK_CONFIG_SEED`, `BLACKLIST_SEED`, `EXTRA_ACCOUNT_METAS_SEED`)
- Role identifier constants (`ROLE_MINTER` through `ROLE_ATTESTOR`)
- Preset constants (`PRESET_SSS1`, `PRESET_SSS2`)

Each program re-exports the relevant subset via its own `constants.rs`. This ensures seed/role values never drift between the core RBAC program and the compliance hook.

---

## 5. SDK Interface

Conforming SDK implementations MUST provide:

### 5.1 Static Factories

- `create(connection, options)` — Deploy a new mint with the chosen preset. When `ssCoreProgramId` is provided in options, automatically initializes the SSS-Core config PDA after deployment.
- `load(connection, options)` — Connect to an existing on-chain mint.

### 5.2 Instance Methods

| Method | Description |
|--------|-------------|
| `mintTokens(opts)` | Mint to a recipient |
| `burn(opts)` | Burn from an account |
| `transfer(opts)` | Transfer with hook support |
| `freeze(opts)` | Freeze a token account |
| `thaw(opts)` | Thaw a frozen account |
| `seize(opts)` | Atomic seizure |
| `pause(authority)` | Global pause |
| `unpause(authority)` | Resume |
| `setAuthority(opts)` | Change an authority |
| `getSupply()` | Total supply |
| `getBalance(wallet)` | Wallet balance |
| `getStatus()` | Full token status |
| `getAuditLog(limit?)` | Recent transactions |
| `refresh()` | Reload cached state |
| `getState()` | Return last cached state |

### 5.3 Compliance Namespace

When the token has a transfer hook (SSS-2), a `compliance` property MUST provide:

`blacklistAdd`, `blacklistRemove`, `updateEvidence`, `closeBlacklistEntry`, `isBlacklisted`, `transferAdmin`, `acceptAdmin`, `batchBlacklistAdd`

### 5.4 Core Namespace

When initialized with an SSS-Core program ID, a `core` property MUST provide:

`initialize`, `grantRole`, `revokeRole`, `setMinterQuota`, `mintTokens`, `burnTokens`, `burnFrom`, `pause`, `unpause`, `freezeAccount`, `thawAccount`, `seize`, `transferAuthority`, `acceptAuthority`, `updateMetadata`, `setCompliance`, `fetchConfig`, `fetchMinterInfo`, `refresh`, `getState`. On-chain support for reserve attestation (`attest_reserve`, `view_reserve`) is available; SDK convenience methods may be added in a future release.

### 5.5 Unsigned Transaction Builders

For wallet adapter integration, the SDK SHOULD provide `build*Transaction` variants that return unsigned `Transaction` objects for client-side signing.

---

## 6. CLI Interface

Conforming CLI implementations MUST organize commands into logical groups:

```
solana-stable init --preset <sss-1|sss-2>     Generate a config
solana-stable init --custom <config.toml>      Deploy a mint

# Day-to-day operations
solana-stable operate mint <recipient> <amount>
solana-stable operate burn <amount>
solana-stable operate transfer <recipient> <amount>

# Admin operations
solana-stable admin freeze <token-account>
solana-stable admin thaw <token-account>
solana-stable admin pause
solana-stable admin unpause
solana-stable admin set-authority <type> <pubkey>

# Compliance (SSS-2)
solana-stable compliance add <wallet> [--reason <text>]
solana-stable compliance remove <wallet>
solana-stable compliance check <wallet>
solana-stable compliance close <wallet>
solana-stable compliance transfer-admin <new>
solana-stable compliance accept-admin <keypair>

# Reserve attestation (proof-of-reserve)
solana-stable attest reserve <amount> --source <text> --uri <url>

# Read-only queries
solana-stable inspect status
solana-stable inspect supply
solana-stable inspect balance <wallet>
solana-stable inspect audit-log [--limit <n>]
solana-stable inspect reserve
```

### 6.1 Global Flags

All commands MUST accept:

- `--config <path>` — Config file path (default: `sss-token.config.toml`)
- `--output text|json` — Output format
- `--dry-run` — Build and display the transaction without sending
- `--yes` — Skip confirmation prompts

### 6.2 Backward Compatibility

Flat commands (without the group prefix) MUST remain functional for backward compatibility:

```
solana-stable mint <recipient> <amount>     # equivalent to: solana-stable operate mint ...
solana-stable freeze <token-account>        # equivalent to: solana-stable admin freeze ...
solana-stable status                        # equivalent to: solana-stable inspect status
```

---

## 7. Security Considerations

1. **Authority management**: Mint, freeze, and blacklist authorities SHOULD be multisig wallets in production.
2. **Revocation is permanent**: Setting an authority to `null` cannot be undone.
3. **Two-step transfers**: Both the blacklist admin and the SSS-Core authority use nominate→accept patterns.
4. **Direct invocation prevention**: The transfer hook MUST verify `TransferHookAccount.transferring == true`.
5. **Per-mint isolation**: Blacklist entries and SSS-Core configs are scoped per mint.
6. **Reserved fields**: All PDA structs include `_reserved` bytes for forward compatibility.
7. **Supply cap**: When set, it is enforced on-chain and cannot be bypassed.
8. **Quota enforcement**: Per-minter quotas are enforced on-chain by the SSS-Core program.

---

## 8. Compatibility

SSS-1 and SSS-2 tokens are standard Token-2022 mints. They are compatible with:

- All Solana wallets supporting Token-2022 (Phantom, Solflare, Backpack, etc.)
- Solana Explorer and Solscan
- Any DeFi protocol that supports Token-2022
- The SSS CLI, SDK, backend, and demo

Token-2022 extensions are fixed at mint creation. An SSS-1 mint cannot be retroactively upgraded to SSS-2. Migration requires creating a new mint.

---

## 9. Reference Implementation

The reference implementation is at:

```
solana-stablecoin-standard/
├── programs/sss-core/              SSS-Core Anchor program
├── transfer_hooks/blacklist/       Blacklist hook Anchor program
├── sdk/                            TypeScript SDK (sss-token-sdk)
├── cli/                            CLI (solana-stable / sss-token)
├── backend/                        REST API backend
└── demo/                           React demo with Phantom wallet
```

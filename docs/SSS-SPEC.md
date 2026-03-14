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

### 3.2 Additional Required Authorities

| Authority | Responsibility |
|-----------|---------------|
| **Blacklist Admin** | Add/remove wallets from the blacklist. Stored in the hook's Config PDA. |

### 3.3 Blacklist Hook Program

The blacklist hook is an Anchor program deployed separately. The mint's Transfer Hook extension MUST point to this program's ID.

#### 3.3.1 Account Layout

| Account | Seeds | Key Fields |
|---------|-------|------------|
| Config | `["config", mint]` | `admin`, `pending_admin`, `mint`, `bump`, `_reserved[64]` |
| BlacklistEntry | `["blacklist", mint, wallet]` | `wallet`, `mint`, `blocked`, `bump`, `_reserved[32]` |
| ExtraAccountMetaList | `["extra-account-metas", mint]` | TLV-encoded account resolution list |

#### 3.3.2 Instructions

| Instruction | Signer | Effect |
|-------------|--------|--------|
| `initialize_config` | Admin | Creates the Config PDA |
| `initialize_extra_account_meta_list` | Admin | Creates the ExtraAccountMetaList PDA |
| `add_to_blacklist(wallet)` | Admin | Creates/updates BlacklistEntry, sets `blocked = true` |
| `remove_from_blacklist(wallet)` | Admin | Sets `blocked = false` on existing BlacklistEntry |
| `close_blacklist_entry(wallet)` | Admin | Closes an **unblocked** BlacklistEntry PDA, reclaims rent |
| `transfer_admin(new_admin)` | Admin | Nominates a new admin (two-step) |
| `accept_admin()` | Pending admin | Accepts the admin role |
| `transfer_hook(amount)` | Token-2022 CPI | Checks blacklist; rejects if either side is blocked |

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
| StablecoinConfig | `["sss-config", mint]` | `authority`, `pending_authority`, `mint`, `preset`, `paused`, `total_minted`, `total_burned`, `supply_cap`, `bump`, `_reserved[64]` |
| RoleEntry | `["role", config, grantee, role_id]` | `config`, `authority`, `role`, `granted_at`, `bump`, `_reserved[32]` |
| MinterInfo | `["minter", config, minter]` | `config`, `minter`, `quota`, `total_minted`, `is_active`, `bump`, `_reserved[32]` |

### 4.2 Roles

| ID | Name | Permissions |
|----|------|-------------|
| 0 | Minter | `mint_tokens` |
| 1 | Burner | `burn_tokens` |
| 2 | Freezer | `freeze_token_account`, `thaw_token_account` |
| 3 | Pauser | `pause`, `unpause` |
| 4 | Blacklister | Reserved for blacklist operations |
| 5 | Seizer | `seize` (thaw → burn → mint → re-freeze) |

### 4.3 Instructions

| Instruction | Signer | Description |
|-------------|--------|-------------|
| `initialize(preset, supply_cap)` | Authority | Creates StablecoinConfig, transfers mint authority to config PDA |
| `grant_role(role)` | Authority | Creates RoleEntry PDA for a grantee |
| `revoke_role(role)` | Authority | Closes RoleEntry PDA |
| `set_minter_quota(quota)` | Authority | Creates/updates MinterInfo with per-minter cap |
| `mint_tokens(amount)` | Minter (with role) | RBAC-gated mint, enforces quota and supply cap |
| `burn_tokens(amount)` | Burner (with role) | RBAC-gated burn |
| `freeze_token_account` | Freezer (with role) | RBAC-gated freeze |
| `thaw_token_account` | Freezer (with role) | RBAC-gated thaw |
| `pause` | Pauser (with role) | Sets `paused = true` on config |
| `unpause` | Pauser (with role) | Sets `paused = false` on config |
| `seize(amount)` | Seizer (with role) | Atomic thaw → burn → mint to treasury → re-freeze |
| `transfer_authority(new)` | Authority | Nominates new authority (two-step) |
| `accept_authority` | Pending authority | Accepts authority transfer |

### 4.4 Events

All state-changing instructions emit typed Anchor events:

`ConfigInitialized`, `TokensMinted`, `TokensBurned`, `StablecoinPaused`, `StablecoinUnpaused`, `RoleGranted`, `RoleRevoked`, `MinterQuotaSet`, `AuthorityNominated`, `AuthorityTransferred`, `TokensSeized`, `TokenAccountFrozen`, `TokenAccountThawed`

### 4.5 Supply Cap

If `supply_cap` is `Some(n)`, then `total_minted - total_burned` MUST NOT exceed `n` after any `mint_tokens` call. If `supply_cap` is `None`, there is no on-chain limit.

### 4.6 Quota Enforcement

On `mint_tokens(amount)`:
1. Check `MinterInfo.is_active == true`
2. Check `MinterInfo.total_minted + amount <= MinterInfo.quota`
3. If both pass, increment `MinterInfo.total_minted` and `StablecoinConfig.total_minted`

---

## 5. SDK Interface

Conforming SDK implementations MUST provide:

### 5.1 Static Factories

- `create(connection, options)` — Deploy a new mint with the chosen preset.
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

`blacklistAdd`, `blacklistRemove`, `closeBlacklistEntry`, `isBlacklisted`, `transferAdmin`, `acceptAdmin`

### 5.4 Core Namespace

When initialized with an SSS-Core program ID, a `core` property MUST provide:

`initialize`, `grantRole`, `revokeRole`, `setMinterQuota`, `mintTokens`, `burnTokens`, `pause`, `unpause`, `freezeAccount`, `thawAccount`, `seize`, `transferAuthority`, `acceptAuthority`, `fetchConfig`, `fetchMinterInfo`, `refresh`, `getState`

### 5.5 Unsigned Transaction Builders

For wallet adapter integration, the SDK SHOULD provide `build*Transaction` variants that return unsigned `Transaction` objects for client-side signing.

---

## 6. CLI Interface

Conforming CLI implementations MUST provide:

```
solana-stable init --preset <sss-1|sss-2>     Generate a config
solana-stable init --custom <config.toml>      Deploy a mint

solana-stable mint <recipient> <amount>        Mint tokens
solana-stable burn <amount>                    Burn tokens
solana-stable transfer <recipient> <amount>    Transfer (with hook support)
solana-stable freeze <token-account>           Freeze account
solana-stable thaw <token-account>             Thaw account
solana-stable pause                            Global pause
solana-stable unpause                          Resume
solana-stable status                           Show token info
solana-stable supply                           Show total supply
solana-stable balance <wallet>                 Show wallet balance
solana-stable set-authority <type> <pubkey>     Change authority
solana-stable audit-log [--limit <n>]          Transaction history

# SSS-2 compliance
solana-stable blacklist add <wallet>           Add to blacklist
solana-stable blacklist remove <wallet>        Remove from blacklist
solana-stable blacklist check <wallet>         Check status
solana-stable blacklist close <wallet>         Close entry
solana-stable blacklist transfer-admin <new>   Nominate new admin
solana-stable blacklist accept-admin <keypair> Accept admin role
```

All commands MUST accept `--config <path>` to specify a config file. Default is `sss-token.config.toml` in the working directory.

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

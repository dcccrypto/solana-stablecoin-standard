# Architecture

## System Diagram

```
                          ┌──────────────────────────────────────────┐
                          │            React Demo (Layer 6)           │
                          │  Phantom Wallet ← builds tx client-side  │
                          └────────────────┬─────────────────────────┘
                                           │ HTTP (webhooks only)
                          ┌────────────────▼─────────────────────────┐
                          │        Express Backend (Layer 5)          │
                          │  REST API │ Event Listener │ Webhooks     │
                          └────────────────┬─────────────────────────┘
                                           │ uses SDK
                          ┌────────────────▼─────────────────────────┐
                          │     CLI + TypeScript SDK (Layer 4)        │
                          │  SolanaStablecoin │ SssCoreClient │       │
                          │  Compliance       │ Presets                │
                          └──────┬──────────────────────┬────────────┘
                                 │ RPC                   │ RPC
                   ┌─────────────▼──────┐     ┌─────────▼───────────┐
                   │ SSS-Core Program   │     │  Blacklist Hook     │
                   │ (Layer 3)          │     │  (Layer 2)          │
                   │ RBAC, Quotas,      │     │  Transfer-time      │
                   │ Pause, Seize,      │     │  blacklist check    │
                   │ Metadata, Attest   │     │  (CPI from          │
                   └──────┬─────────────┘     │   Token-2022)       │
                          │ CPI               └──────┬──────────────┘
                   ┌──────▼──────────────────────────▼──────────────┐
                   │       Token-2022 + Extensions (Layer 1)         │
                   │  MetadataPointer │ TransferHook │ Pausable      │
                   │  PermanentDelegate │ DefaultAccountState        │
                   └────────────────────────────────────────────────┘
```

## Layer Model

The Solana Stablecoin Standard is organized in five layers. Each layer depends only on the one below it.

```
┌───────────────────────────────────────────────┐
│  Layer 6 — Demo (React + Phantom)             │  User-facing UI
├───────────────────────────────────────────────┤
│  Layer 5 — Backend (Express REST API)         │  Infrastructure services
├───────────────────────────────────────────────┤
│  Layer 4 — CLI + SDK (TypeScript)             │  Developer tooling
├───────────────────────────────────────────────┤
│  Layer 3 — SSS-Core Program (Anchor/Rust)     │  On-chain stablecoin management
├───────────────────────────────────────────────┤
│  Layer 2 — Blacklist Hook (Anchor/Rust)       │  On-chain compliance
├───────────────────────────────────────────────┤
│  Layer 1 — Token-2022 + Extensions            │  Solana runtime
└───────────────────────────────────────────────┘
```

### Layer 1 — Token-2022

The foundation. Solana's Token-2022 program provides the mint account, token accounts, and extensions. SSS uses:

- **Mint Account**: Holds supply, decimals, authorities (mint, freeze).
- **Metadata Pointer Extension**: Points the mint to itself so name/symbol/URI are stored on-mint, eliminating the need for Metaplex.
- **Transfer Hook Extension**: Registers a program ID that Token-2022 CPIs into on every `TransferChecked`. This is how SSS-2 enforces blacklist checks.

### Layer 2 — Blacklist Hook Program (SSS-2 only)

An Anchor program deployed at a known address. Token-2022 calls it during every transfer of an SSS-2 token. The program maintains:

- **Config PDA** `["config", mint]` — stores the admin authority, pending admin (for two-step transfer), and mint reference.
- **BlacklistEntry PDA** `["blacklist", mint, wallet]` — per-mint, per-wallet blacklist flag. Missing PDAs are treated as "not blacklisted".
- **ExtraAccountMetaList PDA** `["extra-account-metas", mint]` — TLV-encoded list telling Token-2022 which extra accounts to resolve and pass to the hook.

On every transfer, the hook: (1) verifies the `TransferHookAccount.transferring` flag to prevent direct invocation, (2) unpacks token accounts to get owner wallets, (3) derives per-mint blacklist PDAs, and (4) checks if either side is blocked. Missing PDAs (wallet never blacklisted) pass through cleanly.

### Layer 3 — SSS-Core Program

The core on-chain program that defines the **StablecoinConfig PDA** — the foundation of the standard. It provides:

- **RBAC**: PDA-per-role pattern (`["role", config, grantee, role_type]`). Roles: Minter, Burner, Freezer, Pauser, Blacklister, Seizer, Attestor. Each `RoleEntry` records `granted_by` (the authority who granted the role).
- **Transfer Hook Integration**: The `StablecoinConfig` stores the `transfer_hook_program` address, so downstream consumers can discover the hook program without parsing mint extensions.
- **Per-Minter Quotas**: `MinterInfo` PDA tracks cumulative minted amounts against configurable caps.
- **Pause/Unpause**: Protocol-level pause flag on the config PDA. Blocks mint, burn, and seize.
- **Two-Step Authority Transfer**: Nominate → accept pattern prevents accidental loss of admin control.
- **Seize**: Atomic thaw → burn (permanent delegate) → mint to treasury → re-freeze. The `StablecoinConfig` tracks `total_seized` alongside `total_minted` and `total_burned`. Bypasses the transfer hook since seizure is an authority action, not a user transfer.
- **Supply Cap**: Optional on-chain supply ceiling enforced during minting.
- **Compliance Toggle**: `compliance_enabled` boolean on the config PDA. When true, `mint_tokens` checks the recipient's blacklist entry via a **required** `recipient_blacklist_entry` account. This prevents bypassing the check by omitting the account.
- **Metadata Updates**: `update_metadata` instruction updates on-mint metadata (name, symbol, uri) via CPI to Token-2022.
- **Burn From**: `burn_from` burns from any account using the permanent delegate, unlike `burn_tokens` which can only burn from the burner's own ATA.
- **Read-Only Views**: `view_config` and `view_minter` expose config/minter state via `simulateTransaction`, requiring no signer.
- **Typed Events**: All state changes emit Anchor events for on-chain auditability.
- **Feature-Gated Modules**: The program uses Cargo features (`compliance`, `quotas`, `supply-cap`) to selectively compile enforcement logic. All are enabled by default. Issuers can strip modules they don't need to reduce compute and program size.

On `initialize`, the program transfers the mint authority and freeze authority to the config PDA, ensuring all mint/burn/freeze operations must route through the program.

Both on-chain programs follow a modular source layout (inspired by [`solana-vault-standard`](https://github.com/solanabr/solana-vault-standard)):

```
src/
├── lib.rs              Thin wrapper — declare_id, module declarations, #[program] delegates
├── constants.rs        PDA seeds, role IDs, preset constants
├── error.rs            Custom error enum
├── events.rs           Typed Anchor events
├── state.rs            Account structs and instruction params
└── instructions/       One file per instruction (or logical group)
    ├── mod.rs
    ├── initialize.rs
    ├── roles.rs
    ├── mint.rs
    └── ...
```

### Layer 4 — CLI and SDK

Both produce the same on-chain transactions. The CLI is for operators (shell-based workflow with TOML config files). The SDK is for developers (programmatic TypeScript API).

**CLI flow**: `config.toml` → parse → build instructions → sign with local keypair → send to chain.

**SDK flow**: `CreateOptions` / method call → build instructions → sign with provided `Keypair` → send to chain.

Both support all operations: deploy, mint, burn, freeze, thaw, pause, unpause, set-authority, blacklist, and read operations (supply, balance, status, audit log).

### Layer 5 — Backend

An Express server that wraps the SDK and adds:

- **REST API**: All SDK operations exposed as HTTP endpoints.
- **Event Listener**: Polls `getSignaturesForAddress` for the mint, detects new transactions, dispatches to webhooks.
- **Webhook Service**: Registered endpoints receive POST notifications on events with exponential-backoff retries.
- **Structured Logging**: Pino logger with JSON output in production.

The backend is stateless — the blockchain is the source of truth. Only the webhook registry is held in memory.

### Layer 6 — Demo

A React/Vite app with Tailwind CSS and the Solana Wallet Adapter. It builds transactions client-side using `@solana/spl-token` instructions and sends them to Phantom for signing. Read operations go directly to the RPC. The backend is only used for the webhooks tab.

---

## Data Flows

### Mint Tokens (CLI)

```
Operator                CLI                  Solana
   │                     │                     │
   │  solana-stable mint  │                     │
   │  <recipient> <amt>  │                     │
   │────────────────────>│                     │
   │                     │  loadConfig()       │
   │                     │  loadKeypair()      │
   │                     │  getConnection()    │
   │                     │                     │
   │                     │  createAssociatedTokenAccountIdempotent()
   │                     │────────────────────>│
   │                     │                     │ (creates ATA if needed)
   │                     │  mintTo()           │
   │                     │────────────────────>│
   │                     │                     │ (mint authority signs)
   │                     │  tx signature       │
   │                     │<────────────────────│
   │  "Minted. Tx: ..."  │                     │
   │<────────────────────│                     │
```

### Transfer with Blacklist Check (SSS-2)

```
Sender Wallet           Token-2022           Blacklist Hook
     │                       │                     │
     │  transferChecked()    │                     │
     │──────────────────────>│                     │
     │                       │  resolve extra      │
     │                       │  account metas      │
     │                       │  (config, src_bl,   │
     │                       │   dst_bl PDAs)      │
     │                       │                     │
     │                       │  CPI: execute()     │
     │                       │────────────────────>│
     │                       │                     │ unpack source/dest
     │                       │                     │ check src blacklist
     │                       │                     │ check dst blacklist
     │                       │                     │
     │                       │  OK or Error        │
     │                       │<────────────────────│
     │                       │                     │
     │  success / reject     │                     │
     │<──────────────────────│                     │
```

### Demo Mint Flow (Phantom)

```
User (Browser)          Demo App              Phantom            Solana
     │                     │                     │                  │
     │  Click "Mint"       │                     │                  │
     │────────────────────>│                     │                  │
     │                     │  buildMintTx()      │                  │
     │                     │  (ATA check + ix)   │                  │
     │                     │                     │                  │
     │                     │  sendTransaction()  │                  │
     │                     │────────────────────>│                  │
     │                     │                     │  sign popup      │
     │                     │                     │<─── user approves│
     │                     │                     │                  │
     │                     │                     │  send to RPC     │
     │                     │                     │─────────────────>│
     │                     │                     │  tx signature    │
     │                     │                     │<─────────────────│
     │                     │  confirmTransaction │                  │
     │                     │─────────────────────────────────────-->│
     │  "Minted. Tx: ..."  │                     │                  │
     │<────────────────────│                     │                  │
```

---

## Security Model

### Authority Separation

SSS encourages separating authorities across different keypairs:

| Authority | Controls | Can be revoked? |
|-----------|----------|----------------|
| **Mint Authority** | Creating new supply | Yes (`set-authority mint none`) |
| **Freeze Authority** | Freezing/thawing individual token accounts | Yes |
| **Metadata Authority** | Updating on-mint metadata | Yes |
| **Blacklist Admin** (SSS-2) | Adding/removing wallets from the blacklist | Changeable via Config PDA |
| **Pause Authority** (optional) | Halting all transfers | Yes |
| **Permanent Delegate** (optional) | Recovering/seizing tokens from any account | Cannot be revoked once set |

### Triple Pause Mechanism

SSS has three independent pause mechanisms at different levels, and operators should understand when to use each:

| Mechanism | Level | Scope | Use When |
|-----------|-------|-------|----------|
| **Token-2022 `PausableConfig`** | Protocol (runtime) | Blocks **all** token operations: transfers, mints, burns. Enforced by the Solana runtime itself. | Emergency halt of all token movement. No transactions of any kind can occur. |
| **SSS-Core `config.paused`** | Application (program) | Blocks **program-gated** operations only: mint, burn, seize via `sss-core`. Does **not** block direct `TransferChecked` calls to Token-2022. | Operational pause — stop new issuance and burns while allowing existing holders to transfer. |
| **Blacklist Hook `config.paused`** | Transfer (hook) | Blocks all **transfers** through the hook. Mints and burns still work. | Transfer-level pause — stop all token movement between wallets while allowing the issuer to continue minting/burning. |

**Recommended workflow**:
- **Routine maintenance**: Use `sss-core` pause. Holders can still move tokens.
- **Compliance incident (transfers only)**: Use hook `pause_hook`. Stops all transfers but allows minting/burning.
- **Security incident**: Use Token-2022 pause. Nothing moves until the situation is resolved.
- **All three together**: Belt-and-suspenders approach for maximum safety.

The SDK's `pause()` and `unpause()` methods control the **Token-2022** extension (protocol-level). The `SssCoreClient`'s operations respect the **sss-core** `config.paused` flag (application-level). The hook's `pause_hook` / `unpause_hook` instructions control transfer-level pause. The CLI's `admin pause` / `admin unpause` operates on the Token-2022 level.

### On-Chain Enforcement

Blacklist checks are enforced at the protocol level by Token-2022. There is no way to bypass the transfer hook — every `TransferChecked` instruction triggers the CPI to the blacklist program. Direct `Transfer` (non-checked) is not supported by Token-2022 mints with a transfer hook.

### Backend Security

The backend is stateless and holds no secrets beyond the authority keypair (configured via environment variable). In production:

- Run behind a reverse proxy (nginx, Cloudflare) with TLS.
- Add API key authentication or OAuth at the proxy layer.
- Store keypairs in a secrets manager (AWS Secrets Manager, HashiCorp Vault).
- Use the `SOLANA_KEYPAIR_BASE64` env var for containerized deployments instead of file paths.

### Demo Security

The demo never touches private keys. All signing happens in the Phantom wallet extension. The connected wallet must be the relevant authority (mint authority to mint, freeze authority to freeze, etc.).

---

## Design Rationale

### Why the Hook Has Its Own Pause (Not Cross-Program)

The blacklist hook has its own `paused` flag on its Config PDA, rather than reading `sss-core`'s `StablecoinConfig.paused`. This is intentional:

1. **Program independence.** The blacklist hook is a standalone program that works with or without `sss-core`. Coupling it to `sss-core` would mean every issuer MUST deploy `sss-core` even if they only want blacklist enforcement.

2. **No extra account overhead.** Reading `sss-core`'s config PDA during every transfer would require adding it to the `ExtraAccountMetaList`, increasing compute cost for every transfer even when pause is not active. The hook's own config PDA is already resolved.

3. **Granular control.** The three-tier pause (Token-2022 protocol, `sss-core` application, hook transfer-level) gives operators precise control: they can pause transfers without affecting mints/burns (hook pause), pause program operations without affecting transfers (sss-core pause), or halt everything (Token-2022 pause).

### Why Seize Uses Burn + Mint (Not Transfer)

The `seize` instruction performs `thaw → burn → mint-to-treasury → re-freeze` instead of `thaw → transfer → re-freeze`. This is intentional:

1. **Bypass transfer hook.** Seize is an authority action, not a user transfer. The seized funds should move to the treasury regardless of blacklist status — the target is almost certainly blacklisted (that's why they're being seized).

2. **No extra accounts.** A `TransferChecked` through Token-2022 would trigger the hook CPI, requiring the blacklist PDAs for both source and destination. Burn + mint avoids this entirely.

3. **Accurate accounting.** The burn increments `total_burned` and the mint increments `total_minted`, so `total_minted - total_burned` still equals the on-chain supply. The separate `total_seized` counter tracks how much of the burned amount came from seizures.

### Why SSS-2 Uses `DefaultAccountState::Frozen`

When deploying an SSS-2 token, the CLI enables the `DefaultAccountState::Frozen` extension. This means every new Associated Token Account starts frozen. The issuer must explicitly thaw an account before the holder can transact.

This enables **KYC-gated onboarding**: the issuer can verify a wallet off-chain (sanctions screening, identity verification) and only thaw the account after approval. Combined with the blacklist hook, this provides two layers of compliance:

| Layer | What it does | When it applies |
|-------|-------------|-----------------|
| **DefaultAccountState::Frozen** | New accounts can't transact until thawed | Account creation time |
| **Blacklist transfer hook** | Transfers to/from blocked wallets are rejected | Every transfer |

### Security Contact

Both programs embed a `security_txt!` macro (via `solana-security-txt`) with contact information for security researchers. This follows the Solana security best practice established by Neodyme Labs. The security policy is documented in [SECURITY.md](../SECURITY.md).

# Blacklist Transfer Hook

A Token-2022 **transfer-hook** program written in Anchor. The hook is invoked automatically on every `transferChecked` call and blocks the transfer if the source wallet owner or destination wallet owner is present in an on-chain blacklist for that mint.

This program powers the **SSS-2** profile of the [Solana Stablecoin Standard](https://superteam.fun/earn/listing/build-the-solana-stablecoin-standard-bounty) and is managed through the [`solana-stable` CLI](../../cli/README.md).

---

## Architecture

### On-chain accounts (PDAs)

| Account | Seeds | Description |
|---------|-------|-------------|
| **Config** | `["config", mint]` | Stores the admin authority, optional pending admin, mint, pause flag, bump, and reserved space. Created once per mint via `initialize_config`. |
| **BlacklistEntry** | `["blacklist", mint, wallet]` | Per-mint, per-wallet record with `blocked: bool` and bump. Each mint has its own independent blacklist. Created on first `add_to_blacklist`; unblocked by `remove_from_blacklist`; closed by `close_blacklist_entry` when not blocked. |
| **ExtraAccountMetaList** | `["extra-account-metas", mint]` | TLV account that tells Token-2022 which extra accounts the hook's `Execute` entrypoint needs. Created once via `initialize_extra_account_meta_list`. |

### Account layouts

| Account | Layout (bytes) |
|---------|----------------|
| **Config** | admin (32) + pending_admin `Option<Pubkey>` (33) + mint (32) + paused (1) + bump (1) + _reserved (63) |
| **BlacklistEntry** | wallet (32) + mint (32) + blocked (1) + reason `String` (4+N, max 128) + bump (1) + _reserved (32) |

The `_reserved` fields are reserved for future upgrades and must not be used by clients.

### Instructions

| Instruction | Who can call | What it does |
|-------------|-------------|--------------|
| `initialize_config` | Any signer (becomes admin) | Creates the Config PDA, recording the admin and the mint. |
| `initialize_extra_account_meta_list` | Any signer (payer) | Allocates the TLV account so Token-2022 can resolve extra accounts at transfer time. |
| `add_to_blacklist(wallet, reason)` | Admin only | Sets `blocked = true` and stores `reason` (max 128 chars) on the wallet's BlacklistEntry PDA for this mint (creates it if needed via `init_if_needed`). The reason is persisted on-chain for audit compliance and also emitted in the `WalletBlacklisted` event. |
| `remove_from_blacklist(wallet)` | Admin only | Sets `blocked = false` on the BlacklistEntry PDA. Does **not** close the account. |
| `close_blacklist_entry(wallet)` | Admin only | Closes the BlacklistEntry PDA and reclaims rent to the admin. **Fails** if the entry is still blocked. |
| `transfer_admin(new_admin)` | Admin only | Nominates a new admin. The new admin must call `accept_admin` to complete the handover. |
| `accept_admin` | Pending admin only | Accepts the admin role. Completes the two-step admin transfer. |
| `pause_hook` | Admin only | Sets `paused = true` on the Config PDA. All subsequent transfers are rejected with `TransfersPaused`. |
| `unpause_hook` | Admin only | Sets `paused = false` on the Config PDA. Transfers resume. |
| `transfer_hook(amount)` | Token-2022 CPI | Called automatically during `transferChecked`. Validates invocation context, checks the pause flag, reads source/destination owners, derives BlacklistEntry PDAs, and returns an error if paused or either side is blocked. |

### Transfer hook flow

```
User calls transferChecked (Token-2022)
  │
  ├─ Token-2022 resolves ExtraAccountMetaList for the mint
  │   → config PDA, source blacklist PDA, destination blacklist PDA
  │   (Blacklist PDAs derived as ["blacklist", mint, owner])
  │
  └─ Token-2022 CPIs into blacklist_hook::transfer_hook
       │
       ├─ Validates ExtraAccountMetaList PDA
       ├─ Checks config.paused → if true, error: TransfersPaused
       ├─ Unpacks source & destination token-account data (owner at offset 32)
       ├─ Verifies TransferHookAccount.transferring on source → prevents direct invocation
       ├─ Derives expected BlacklistEntry PDAs: ["blacklist", mint, owner]
       ├─ For each blacklist account: if data_is_empty() or owner != program → not blacklisted
       ├─ If either entry has blocked == true → error: SenderBlacklisted / RecipientBlacklisted
       └─ Otherwise → transfer proceeds
```

### PDA derivation examples

**Config** (per mint):

```
seeds = ["config", mint_pubkey]
program_id = blacklist_hook program
```

**BlacklistEntry** (per mint, per wallet):

```
seeds = ["blacklist", mint_pubkey, wallet_pubkey]
program_id = blacklist_hook program
```

Example (pseudocode):

```
config_pda = PDA(program_id, ["config", mint])
blacklist_entry_pda = PDA(program_id, ["blacklist", mint, wallet])
```

### Missing blacklist PDAs = not blacklisted

Wallets that were **never** added to the blacklist do not need pre-initialized PDAs. The hook checks each blacklist account with `data_is_empty() || owner != program` and treats such accounts as **not blacklisted**. This avoids requiring every possible sender/recipient to have a PDA created upfront.

### Direct invocation prevention

The hook verifies `TransferHookAccount.transferring` on the source token account. If this flag is not set, the hook returns `NotTransferring`. This ensures the hook is only invoked via CPI from Token-2022 during a real transfer, not by arbitrary direct calls.

### Why blacklist by wallet owner, not token account

The hook reads the **owner** field from the raw token-account data at offset `32..64` and derives the BlacklistEntry PDA from the owner's pubkey. A single blacklist entry covers **all** token accounts owned by that wallet for the given mint.

### Why per-mint blacklists

BlacklistEntry PDAs use seeds `["blacklist", mint, wallet]`, so each mint has its own independent blacklist. One project's stablecoin blacklist does not affect another's. The same wallet can be blacklisted for mint A but not for mint B.

### Two-step admin transfer

Admin rotation uses `transfer_admin(new_admin)` followed by `accept_admin()`. The current admin nominates a new admin; the new admin must sign `accept_admin` to complete the handover. This prevents bricking the hook if the admin key is lost by accident—the pending admin can still accept.

### Close blacklist entry

`close_blacklist_entry(wallet)` closes the BlacklistEntry PDA and returns rent to the admin. It **fails** with `CannotCloseBlockedEntry` if the entry is still blocked. Unblock the wallet with `remove_from_blacklist` first, then close to reclaim rent.

---

## Events

The program emits typed Anchor events on every state change:

| Event | When |
|-------|------|
| `ConfigInitialized` | Config PDA created |
| `WalletBlacklisted` | Wallet added to blacklist. Fields: `wallet: Pubkey`, `mint: Pubkey`, `reason: String`. |
| `WalletUnblacklisted` | Wallet removed from blacklist |
| `BlacklistEntryClosed` | BlacklistEntry PDA closed |
| `AdminTransferNominated` | New admin nominated via `transfer_admin` |
| `AdminTransferred` | Admin handover completed via `accept_admin` |

These events can be indexed off-chain for compliance dashboards and analytics.

---

## Error codes (6000+)

| Code | Name | Description |
|------|------|-------------|
| 6000 | Unauthorized | Caller is not the admin (or pending admin, where applicable) |
| 6001 | SenderBlacklisted | Source wallet owner is blacklisted |
| 6002 | RecipientBlacklisted | Destination wallet owner is blacklisted |
| 6003 | MintMismatch | Mint does not match config or token accounts |
| 6004 | InvalidTokenAccount | Token account data invalid or unparseable |
| 6005 | InvalidBlacklistAccount | Blacklist PDA derivation mismatch |
| 6006 | InvalidExtraAccountMetaList | ExtraAccountMetaList PDA mismatch |
| 6007 | NotTransferring | Hook invoked outside a token transfer (direct call) |
| 6008 | NoPendingAdmin | No pending admin nomination to accept |
| 6009 | CannotCloseBlockedEntry | Cannot close a blacklist entry that is still blocked |
| 6010 | TransfersPaused | Transfers are paused via `pause_hook` |
| 6011 | AlreadyPaused | Transfers are already paused |
| 6012 | NotPaused | Transfers are not paused; cannot unpause |

---

## Using with the CLI

The `solana-stable` CLI (`../../cli/`) wraps this program so you don't need to build Anchor transactions manually.

```bash
# Deploy an SSS-2 stablecoin (creates mint + initializes hook PDAs)
solana-stable init --preset sss-2
# ... edit config: set extensions.transferHook.programId ...
solana-stable init --custom sss-token.config.toml

# Manage the blacklist
solana-stable blacklist add <wallet> --reason "OFAC SDN"
solana-stable blacklist remove <wallet>
solana-stable blacklist check <wallet>
```

See the [CLI README](../../cli/README.md) for full details.

---

## Source Layout

The program follows a modular structure (inspired by [`solana-vault-standard`](https://github.com/solanabr/solana-vault-standard)):

```
src/
├── lib.rs              Thin wrapper — declare_id, module declarations, #[program] delegates, fallback
├── constants.rs        PDA seeds (CONFIG_SEED, BLACKLIST_SEED, EXTRA_ACCOUNT_METAS_SEED)
├── error.rs            BlacklistError enum (13 error codes, 6000–6012)
├── events.rs           8 typed Anchor event structs
├── state.rs            Config (with paused flag), BlacklistEntry (with on-chain reason field)
└── instructions/       One file per instruction group
    ├── mod.rs           Re-exports all instruction modules
    ├── initialize.rs    initialize_config, initialize_extra_account_meta_list
    ├── blacklist.rs     add_to_blacklist, remove_from_blacklist, close_blacklist_entry
    ├── admin.rs         transfer_admin, accept_admin
    ├── pause.rs         pause_hook, unpause_hook
    └── transfer_hook.rs transfer_hook (CPI entrypoint, includes pause check)
```

The `fallback` function remains in `lib.rs` because it references the generated `__private::__global::transfer_hook` dispatcher for the `spl-transfer-hook-interface` `Execute` entrypoint.

---

## Run locally (standalone)

1. Install a matching toolchain:
   - Anchor CLI `0.32.x`
   - `@coral-xyz/anchor` `0.32.x`
   - a recent Solana toolchain compatible with your Anchor install

2. In the workspace root (`transfer_hooks/blacklist/`):

```bash
npm install
anchor build
anchor test
```

---

## Test suite

The test suite includes **26 tests** in `tests/blacklist-hook.ts` covering:

- Creating a Token-2022 mint with the TransferHook extension pointing at this program
- Initializing the Config and ExtraAccountMetaList PDAs
- Verifying a transfer succeeds when neither party is blacklisted (no pre-initialized PDAs needed)
- Blacklisting a **recipient** and verifying the transfer is blocked
- Blacklisting a **sender** and verifying the transfer is blocked
- Removing a sender from the blacklist and verifying transfers resume
- Admin transfer flow (`transfer_admin` + `accept_admin`)
- `close_blacklist_entry` for unblocked entries

---

## Production hardening ideas

- Add an allowlist mode beside the blocklist mode
- Optionally combine with default-frozen / freeze-authority controls for issuer-operated compliance
- Add per-jurisdiction policy logic to extend the existing `reason` field on BlacklistEntry

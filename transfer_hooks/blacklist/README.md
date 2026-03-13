# Blacklist Transfer Hook

A Token-2022 **transfer-hook** program written in Anchor. The hook is invoked automatically on every `transferChecked` call and blocks the transfer if the source wallet owner or destination wallet owner is present in an on-chain blacklist.

This program powers the **SSS-2** profile of the [Solana Stablecoin Standard](https://superteam.fun/earn/listing/build-the-solana-stablecoin-standard-bounty) and is managed through the [`sss-token` CLI](../../cli/README.md).

---

## Architecture

### On-chain accounts (PDAs)

| Account | Seeds | Description |
|---------|-------|-------------|
| **Config** | `["config", mint]` | Stores the admin authority pubkey, the mint pubkey, and a bump. Created once per mint via `initialize_config`. |
| **BlacklistEntry** | `["blacklist", wallet]` | Per-wallet record with a `blocked: bool` flag and a bump. Created on first `add_to_blacklist` call; toggled (not closed) by `remove_from_blacklist`. |
| **ExtraAccountMetaList** | `["extra-account-metas", mint]` | TLV account that tells Token-2022 which extra accounts the hook's `Execute` entrypoint needs. Created once via `initialize_extra_account_meta_list`. |

### Instructions

| Instruction | Who can call | What it does |
|-------------|-------------|--------------|
| `initialize_config` | Any signer (becomes admin) | Creates the Config PDA, recording the admin and the mint. |
| `initialize_extra_account_meta_list` | Any signer (payer) | Allocates the TLV account so Token-2022 can resolve extra accounts at transfer time. |
| `add_to_blacklist(wallet)` | Admin only | Sets `blocked = true` on the wallet's BlacklistEntry PDA (creates it if needed via `init_if_needed`). |
| `remove_from_blacklist(wallet)` | Admin only | Sets `blocked = false` on the wallet's BlacklistEntry PDA (does **not** close the account so the hook can still resolve it). |
| `transfer_hook(amount)` | Token-2022 CPI | Called automatically during `transferChecked`. Reads source/destination token-account owners, derives their BlacklistEntry PDAs, and returns an error if either is blocked. |

### Transfer hook flow

```
User calls transferChecked (Token-2022)
  │
  ├─ Token-2022 resolves ExtraAccountMetaList for the mint
  │   → config PDA, source blacklist PDA, destination blacklist PDA
  │
  └─ Token-2022 CPIs into blacklist_hook::transfer_hook
       │
       ├─ Unpacks source & destination token-account data (owner at offset 32)
       ├─ Derives expected BlacklistEntry PDAs from owner pubkeys
       ├─ If either entry has blocked == true → error: Blacklisted
       └─ Otherwise → transfer proceeds
```

### Why blacklist by wallet owner, not token account

The hook reads the **owner** field from the raw token-account data at offset `32..64` and derives the BlacklistEntry PDA from the owner's pubkey. This means a single blacklist entry covers **all** token accounts owned by that wallet, not just one specific ATA.

### Why `remove_from_blacklist` does not close the PDA

The ExtraAccountMetaList tells Token-2022 to resolve BlacklistEntry PDAs from on-chain data at transfer time. If the PDA is closed (account doesn't exist), the resolution fails and every transfer would break. Keeping the PDA alive with `blocked = false` avoids this problem and makes re-blacklisting cheaper (no new allocation).

---

## Using with the CLI

The `sss-token` CLI (`../../cli/`) wraps this program so you don't need to build Anchor transactions manually.

```bash
# Deploy an SSS-2 stablecoin (creates mint + initializes hook PDAs)
sss-token init --preset sss-2
# ... edit config: set extensions.transferHook.programId ...
sss-token init --custom sss-token.config.toml

# Manage the blacklist
sss-token blacklist add <wallet>
sss-token blacklist remove <wallet>
sss-token blacklist check <wallet>
```

See the [CLI README](../../cli/README.md) for full details.

---

## Run locally (standalone)

1. Install a matching toolchain:
   - Anchor CLI `0.31.x`
   - `@coral-xyz/anchor` `0.31.x`
   - a recent Solana toolchain compatible with your Anchor install

2. In the workspace root (`transfer_hooks/blacklist/`):

```bash
npm install
anchor build
anchor test
```

---

## Test suite

The integration tests in `tests/blacklist-hook.ts` cover:

- Creating a Token-2022 mint with the TransferHook extension pointing at this program
- Initializing the Config and ExtraAccountMetaList PDAs
- Initializing BlacklistEntry PDAs for test wallets
- Verifying a transfer succeeds when neither party is blacklisted
- Blacklisting a **recipient** and verifying the transfer is blocked
- Blacklisting a **sender** and verifying the transfer is blocked
- Removing a sender from the blacklist and verifying transfers resume

---

## Production hardening ideas

- Add `set_admin` / `accept_admin` flow for admin rotation
- Emit Anchor events on blacklist changes for off-chain indexing
- Add an allowlist mode beside the blocklist mode
- Optionally combine with default-frozen / freeze-authority controls for issuer-operated compliance
- Add per-jurisdiction policy logic or reason codes to BlacklistEntry

# SSS-2 — Compliant Stablecoin Standard

## Summary

SSS-2 extends SSS-1 with on-chain compliance enforcement. It adds a transfer hook that checks a per-mint, per-wallet blacklist on every transfer, enabling issuers to meet regulatory requirements (sanctions screening, AML) at the protocol level.

SSS-2 is a strict superset of SSS-1. Every SSS-1 operation works identically on an SSS-2 token.

## Specification

### Token Program

SSS-2 tokens MUST be created using **Token-2022**.

### Required Extensions

| Extension | Purpose |
|-----------|---------|
| **Metadata Pointer** | On-mint metadata (same as SSS-1) |
| **Transfer Hook** | Points to the blacklist hook program. Token-2022 CPIs into this program on every `TransferChecked`, enforcing blacklist checks. |
| **DefaultAccountState::Frozen** | All new token accounts start frozen. The issuer must thaw an account before the holder can transact, enabling KYC-gated onboarding. |

### Required Authorities

All SSS-1 authorities, plus:

| Authority | Role |
|-----------|------|
| **Blacklist Admin** | Can add/remove wallets from the blacklist. Stored in the hook program's Config PDA. Supports two-step transfer. |

### Blacklist Hook Program

The blacklist hook is an Anchor program that must be deployed before the SSS-2 token is created. The Transfer Hook extension on the mint points to this program's ID.

#### Program Accounts (PDAs)

| Account | Seeds | Fields | Purpose |
|---------|-------|--------|---------|
| **Config** | `["config", mint]` | `admin`, `pending_admin`, `mint`, `bump`, `_reserved[64]` | Admin authority, two-step transfer state |
| **BlacklistEntry** | `["blacklist", mint, wallet]` | `wallet`, `mint`, `blocked`, `reason` (String, max 128), `evidence_hash` ([u8; 32]), `evidence_uri` (String, max 256), `bump` | Per-wallet, per-mint blacklist flag with evidence chain for audit compliance |
| **ExtraAccountMetaList** | `["extra-account-metas", mint]` | TLV-encoded list | Tells Token-2022 which extra accounts to resolve for the hook |

**Per-mint scoping**: Blacklist PDAs include the mint in their seeds, so each SSS-2 token has an independent blacklist. Blacklisting a wallet on one mint does NOT affect other mints using the same hook program.

#### Instructions

| Instruction | Signer | Description |
|-------------|--------|-------------|
| `initialize_config` | Admin (payer) | Creates the Config PDA |
| `initialize_extra_account_meta_list` | Admin (payer) | Creates the ExtraAccountMetaList PDA |
| `add_to_blacklist(wallet, reason, evidence_hash, evidence_uri)` | Admin | Creates/updates a BlacklistEntry PDA, sets `blocked = true`. Stores reason, evidence hash, and URI on-chain. |
| `remove_from_blacklist(wallet)` | Admin | Updates a BlacklistEntry PDA, sets `blocked = false` |
| `update_blacklist_evidence(wallet, new_evidence_hash, new_evidence_uri)` | Admin | Updates evidence on a blocked entry. Emits `EvidenceUpdated` with `previous_hash` for immutable audit trail. |
| `close_blacklist_entry(wallet)` | Admin | Closes an unblocked BlacklistEntry PDA, reclaims rent |
| `transfer_admin(new_admin)` | Admin | Nominates a new admin (two-step) |
| `accept_admin()` | Pending admin | Accepts the admin role |
| `pause_hook` | Admin | Sets `paused = true` on the Config PDA; blocks all transfers |
| `unpause_hook` | Admin | Sets `paused = false` on the Config PDA; resumes transfers |
| `transfer_hook(amount)` | Token-2022 (CPI) | Checks pause flag and blacklist; rejects if paused or either side is blocked |

#### Events

| Event | Emitted When |
|-------|-------------|
| `ConfigInitialized` | Config PDA created |
| `WalletBlacklisted` | Wallet added to blacklist. Includes `reason`, `evidence_hash`, `evidence_uri`. |
| `WalletUnblacklisted` | Wallet removed from blacklist |
| `EvidenceUpdated` | Evidence updated on a blocked entry. Includes `previous_hash`, `new_hash`, `evidence_uri` for audit trail. |
| `BlacklistEntryClosed` | Blacklist entry PDA closed |
| `AdminTransferNominated` | New admin nominated |
| `AdminTransferred` | New admin accepted |
| `TransfersPaused` | Transfers paused via `pause_hook` |
| `TransfersUnpaused` | Transfers unpaused via `unpause_hook` |

#### Transfer Hook Execution Flow

1. A user calls `TransferChecked` on Token-2022.
2. Token-2022 resolves the extra accounts from the ExtraAccountMetaList PDA.
3. Token-2022 CPIs into the hook program's `execute` entrypoint.
4. The hook validates the ExtraAccountMetaList PDA and config mint.
5. **If `config.paused == true`**, the hook returns `TransfersPaused`.
6. The hook verifies `TransferHookAccount.transferring == true` on the source token account (prevents direct invocation).
7. It unpacks source and destination token accounts to get owner wallets.
8. It derives the expected blacklist PDAs using `["blacklist", mint, owner]`.
9. **If a blacklist PDA doesn't exist** (wallet was never blacklisted), it is treated as not blacklisted.
10. **If a blacklist PDA exists** and `blocked == true`, the hook returns an error.
11. If neither side is blocked, the transfer completes.

#### Blacklist Model

The blacklist uses **persistent PDAs with a boolean flag**:

- `add_to_blacklist(wallet, reason)` uses `init_if_needed` — creates the PDA on first blacklist, sets `blocked = true` on subsequent calls. The `reason` string is stored on-chain and emitted in the `WalletBlacklisted` event.
- `remove_from_blacklist` sets `blocked = false` but does NOT close the PDA.
- `close_blacklist_entry` closes an unblocked PDA to reclaim rent. Cannot close a blocked entry.
- **Missing PDAs are treated as "not blacklisted"** — wallets that were never added to the blacklist can transfer freely without pre-initialized PDAs.

---

## Deployment Sequence

SSS-2 deployment extends SSS-1 with additional steps:

1. **Create mint account** with space for MetadataPointer + TransferHook extensions.
2. **Initialize Metadata Pointer** — point to self.
3. **Initialize Transfer Hook** — `createInitializeTransferHookInstruction` with the hook program ID.
4. **Initialize Mint** — set decimals, mint authority, freeze authority.
5. **Initialize Metadata** — write name, symbol, URI (separate transaction).
6. **Initialize Config PDA** — `initialize_config` on the hook program.
7. **Initialize ExtraAccountMetaList PDA** — `initialize_extra_account_meta_list` on the hook program.

Steps 1–4 are a single transaction. Steps 5, 6, and 7 are separate transactions.

---

## Operations

### All SSS-1 operations

Mint, burn, freeze, thaw, pause, unpause, set-authority, supply, balance, status, audit log — all work identically.

### Transfer (SSS-2)

SSS-2 tokens require `createTransferCheckedWithTransferHookInstruction` instead of a plain `transferChecked`. The SDK provides a `transfer()` method that handles this automatically.

### Compliance Operations

| Operation | Who | CLI | SDK |
|-----------|-----|-----|-----|
| Add to blacklist | Admin | `solana-stable blacklist add <wallet> --reason "OFAC SDN"` | `stable.compliance.blacklistAdd(wallet, admin, "OFAC SDN")` |
| Remove from blacklist | Admin | `solana-stable blacklist remove <wallet>` | `stable.compliance.blacklistRemove(wallet, admin)` |
| Check blacklist status | Anyone | `solana-stable blacklist check <wallet>` | `stable.compliance.isBlacklisted(wallet)` |
| Update evidence | Admin | — | `stable.compliance.updateEvidence(wallet, admin, newHash, newUri)` |
| Batch blacklist add | Admin | — | `stable.compliance.batchBlacklistAdd(admin, entries)` |
| Close entry (reclaim rent) | Admin | — | `stable.compliance.closeBlacklistEntry(wallet, admin)` |
| Transfer admin | Admin | — | `stable.compliance.transferAdmin(newAdmin, currentAdmin)` |
| Accept admin | Pending admin | — | `stable.compliance.acceptAdmin(newAdmin)` |

---

### Zero-Amount Guards

The SSS-Core program rejects zero-amount operations with `ZeroAmount` (6017). `mint_tokens`, `burn_tokens`, `burn_from`, and `seize` all require `amount > 0`.

### Blacklist Check on Mint (Required Account)

When `compliance_enabled` is true, SSS-Core's `mint_tokens` instruction requires `recipient_blacklist_entry` as a **required** `UncheckedAccount` in the instruction context — not in `remaining_accounts`. This prevents bypassing the blacklist check by omitting the account.

### Evidence Chain

Each `BlacklistEntry` stores `evidence_hash` ([u8; 32]) and `evidence_uri` (String, max 256 chars). When blacklisting, the admin provides initial evidence. Subsequent updates via `update_blacklist_evidence` emit an `EvidenceUpdated` event containing the `previous_hash`, creating an immutable audit trail — off-chain systems can reconstruct the full evidence history by replaying events.

### CPI Events

All instructions in both `sss-core` and `blacklist_hook` use `emit_cpi!` (Anchor's CPI event emission) instead of `emit!`. This makes events visible to other on-chain programs through CPI, not just off-chain indexers. The `#[event_cpi]` attribute adds two trailing accounts to each instruction: `event_authority` (PDA: `["__event_authority"]`) and the program ID itself.

### Shared Constants (`sss-common`)

Both programs import shared seed, role, and preset constants from `programs/sss-common`. This ensures PDA derivation is consistent across the RBAC core and the compliance hook.

---

## Error Codes

| Code | Name | Description |
|------|------|-------------|
| 6000 | `Unauthorized` | Signer is not the admin in the Config PDA |
| 6001 | `SenderBlacklisted` | Source wallet is on the blacklist |
| 6002 | `RecipientBlacklisted` | Destination wallet is on the blacklist |
| 6003 | `MintMismatch` | Config PDA mint doesn't match the transfer's mint |
| 6004 | `InvalidTokenAccount` | Could not unpack the token account data |
| 6005 | `InvalidBlacklistAccount` | BlacklistEntry PDA derivation mismatch |
| 6006 | `InvalidExtraAccountMetaList` | ExtraAccountMetaList PDA is missing or invalid |
| 6007 | `NotTransferring` | Transfer hook invoked outside of a token transfer |
| 6008 | `NoPendingAdmin` | No pending admin nomination to accept |
| 6009 | `CannotCloseBlockedEntry` | Cannot close a blacklist entry that is still blocked |
| 6010 | `TransfersPaused` | Transfers are paused via `pause_hook` |
| 6011 | `AlreadyPaused` | Transfers are already paused |
| 6012 | `NotPaused` | Transfers are not paused; cannot unpause |
| 6013 | `WalletNotBlocked` | Evidence update requires a blocked entry |
| 6017 | `ZeroAmount` | `mint_tokens`, `burn_tokens`, `burn_from`, or `seize` was called with `amount == 0` (SSS-Core) |
| 6018 | `HookProgramNotSet` | Transfer hook program not set on StablecoinConfig (SSS-Core) |
| 6019 | `DefaultAccountStateNotFrozen` | SSS-2 requires `DefaultAccountState::Frozen` on the mint (SSS-Core) |
| 6020 | `InvalidBlacklistEntry` | Blacklist entry failed validation: wrong owner, bad discriminator, or wallet/mint mismatch (SSS-Core) |

---

## Upgrading from SSS-1

Token-2022 extensions are fixed at mint creation time. You cannot add a Transfer Hook to an existing SSS-1 mint.

To upgrade:

1. Deploy the blacklist hook program (if not already deployed).
2. Create a new SSS-2 mint with both Metadata Pointer and Transfer Hook extensions.
3. Migrate token holders: mint equivalent amounts on the new SSS-2 mint, then burn/freeze the old SSS-1 supply.
4. Update all references to the new mint address.

---

## Security Considerations

All SSS-1 security considerations apply. When used with the SSS-Core program, RBAC enforces role-based separation (Blacklister role required for blacklist management, Seizer role for seizure, etc.). Additionally:

- **Blacklist admin key**: This is the most sensitive SSS-2 key. It controls who can send/receive the token. Store in an HSM or multisig.
- **Two-step admin transfer**: The admin can be safely transferred via `transfer_admin` + `accept_admin`. This prevents accidental loss of admin control.
- **Direct invocation prevention**: The hook checks `TransferHookAccount.transferring` to ensure it's only called via CPI from Token-2022 during a genuine transfer.
- **Transfer hook is protocol-enforced**: There is no way to bypass it. Every `TransferChecked` triggers the hook.
- **Per-mint isolation**: Each mint has its own blacklist namespace. Blacklisting a wallet on one mint doesn't affect another.
- **Missing PDAs**: Wallets that were never added to the blacklist can transfer freely — no pre-initialization required.
- **`_reserved` fields**: All account structs include reserved space for future upgrades without account migration.

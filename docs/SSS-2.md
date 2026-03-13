# SSS-2 — Compliant Stablecoin Standard

## Summary

SSS-2 extends SSS-1 with on-chain compliance enforcement. It adds a transfer hook that checks a per-wallet blacklist on every transfer, enabling issuers to meet regulatory requirements (sanctions screening, AML) at the protocol level.

SSS-2 is a strict superset of SSS-1. Every SSS-1 operation works identically on an SSS-2 token.

## Specification

### Token Program

SSS-2 tokens MUST be created using **Token-2022**.

### Required Extensions

| Extension | Purpose |
|-----------|---------|
| **Metadata Pointer** | On-mint metadata (same as SSS-1) |
| **Transfer Hook** | Points to the blacklist hook program. Token-2022 CPIs into this program on every `TransferChecked`, enforcing blacklist checks. |

### Required Authorities

All SSS-1 authorities, plus:

| Authority | Role |
|-----------|------|
| **Blacklist Admin** | Can add/remove wallets from the blacklist. Stored in the hook program's Config PDA. |

### Blacklist Hook Program

The blacklist hook is an Anchor program that must be deployed before the SSS-2 token is created. The Transfer Hook extension on the mint points to this program's ID.

#### Program Accounts (PDAs)

| Account | Seeds | Fields | Purpose |
|---------|-------|--------|---------|
| **Config** | `["config", mint]` | `admin: Pubkey`, `mint: Pubkey`, `bump: u8` | Stores the admin authority and mint reference |
| **BlacklistEntry** | `["blacklist", wallet]` | `wallet: Pubkey`, `blocked: bool`, `bump: u8` | Per-wallet blacklist flag |
| **ExtraAccountMetaList** | `["extra-account-metas", mint]` | TLV-encoded list | Tells Token-2022 which extra accounts to resolve for the hook |

#### Instructions

| Instruction | Signer | Description |
|-------------|--------|-------------|
| `initialize_config` | Admin (payer) | Creates the Config PDA with the admin authority |
| `initialize_extra_account_meta_list` | Admin (payer) | Creates the ExtraAccountMetaList PDA with three entries: Config, source BlacklistEntry, destination BlacklistEntry |
| `add_to_blacklist(wallet)` | Admin | Creates or updates a BlacklistEntry PDA, sets `blocked = true` |
| `remove_from_blacklist(wallet)` | Admin | Updates a BlacklistEntry PDA, sets `blocked = false` |
| `transfer_hook(amount)` | Token-2022 (CPI) | Checks source and destination blacklist PDAs; rejects if either is blocked |

#### Transfer Hook Execution Flow

1. A user calls `TransferChecked` on Token-2022.
2. Token-2022 resolves the extra accounts from the ExtraAccountMetaList PDA.
3. Token-2022 CPIs into the hook program's `execute` entrypoint with: source token account, mint, destination token account, authority, ExtraAccountMetaList PDA, Config PDA, source BlacklistEntry PDA, destination BlacklistEntry PDA.
4. The hook unpacks the source and destination token accounts to get the owner wallets.
5. It reads each BlacklistEntry PDA. If the PDA exists and `blocked == true`, the hook returns `Error::Blacklisted`.
6. If neither side is blocked, the hook returns OK and the transfer completes.

#### Blacklist Model

The blacklist uses **persistent PDAs with a boolean flag**:

- `add_to_blacklist` uses `init_if_needed` — creates the PDA on first blacklist, sets `blocked = true` on subsequent calls.
- `remove_from_blacklist` sets `blocked = false` but does NOT close the PDA.
- This ensures the PDA always exists after the first interaction, which is required by the transfer hook (it expects all extra accounts to be present).

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

### Compliance Operations

| Operation | Who | CLI | SDK |
|-----------|-----|-----|-----|
| Add to blacklist | Blacklist admin | `sss-token blacklist add <wallet>` | `stable.compliance.blacklistAdd(wallet, admin)` |
| Remove from blacklist | Blacklist admin | `sss-token blacklist remove <wallet>` | `stable.compliance.blacklistRemove(wallet, admin)` |
| Check blacklist status | Anyone | `sss-token blacklist check <wallet>` | `stable.compliance.isBlacklisted(wallet)` |

---

## Error Codes

| Code | Name | Description |
|------|------|-------------|
| 6000 | `Unauthorized` | Signer is not the admin in the Config PDA |
| 6001 | `Blacklisted` | Source or destination wallet is on the blacklist |
| 6002 | `MintMismatch` | Config PDA mint doesn't match the transfer's mint |
| 6003 | `InvalidTokenAccount` | Could not unpack the token account data |
| 6004 | `InvalidBlacklistAccount` | BlacklistEntry PDA data is malformed |
| 6005 | `InvalidExtraAccountMetaList` | ExtraAccountMetaList PDA is missing or invalid |

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

All SSS-1 security considerations apply, plus:

- **Blacklist admin key**: This is the most sensitive SSS-2 key. It controls who can send/receive the token. Store in an HSM or multisig.
- **Transfer hook is protocol-enforced**: There is no way to bypass it. Every `TransferChecked` triggers the hook. This is a feature, not a bug.
- **BlacklistEntry PDAs persist**: Once created, they remain on-chain even after removal. This is intentional — the transfer hook always expects the PDA accounts to be present.
- **Admin cannot be changed directly**: The admin is set during `initialize_config`. To change it, deploy a new Config PDA (requires program modification). Plan the admin keypair carefully.

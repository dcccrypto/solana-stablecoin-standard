# SSS-1 — Minimal Stablecoin Standard

## Summary

SSS-1 defines the minimum viable feature set for a stablecoin on Solana. It uses Token-2022 with the Metadata Pointer extension to create a self-describing token with issuer controls.

## Specification

### Token Program

SSS-1 tokens MUST be created using the **Token-2022** program (`TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`).

### Required Extensions

| Extension | Purpose |
|-----------|---------|
| **Metadata Pointer** | Points the mint account to itself, enabling on-mint storage of name, symbol, and URI without a separate Metaplex account. |

### Required Authorities

| Authority | Role |
|-----------|------|
| **Mint Authority** | Can create new supply via `MintTo`. Should be a multisig or HSM in production. |
| **Freeze Authority** | Can freeze/thaw individual token accounts to block transfers on a per-account basis. |
| **Metadata Authority** | Can update the on-mint metadata (name, symbol, URI). |

### Optional Extensions

These extensions are NOT required by SSS-1 but are compatible:

| Extension | Notes |
|-----------|-------|
| **Pausable** | Global pause. Useful as an emergency kill switch. |
| **Permanent Delegate** | Irrevocable delegate over all token accounts. Enables seizure/recovery. Use with caution. |
| **DefaultAccountState** | New token accounts are created frozen by default. Requires thaw before first transfer — useful for KYC-gated issuance. |

### On-Mint Metadata

SSS-1 tokens MUST initialize on-mint metadata with at minimum:

- **name**: Human-readable token name (e.g., "USD Stablecoin").
- **symbol**: Ticker (e.g., "USDS").
- **uri**: Optional. Can point to a JSON file with extended metadata.

### Decimals

SSS-1 tokens SHOULD use 6 decimals to match USDC/USDT conventions on Solana.

---

## Deployment Sequence

1. **Create account**: `SystemProgram.createAccount` — allocate space for mint + extensions.
2. **Initialize Metadata Pointer**: `createInitializeMetadataPointerInstruction` — point to self.
3. **Initialize Mint**: `createInitializeMint2Instruction` — set decimals, mint authority, freeze authority.
4. **Initialize Metadata**: `tokenMetadataInitialize` — write name, symbol, URI to the mint account (this triggers a realloc).

Steps 1–3 are in a single transaction. Step 4 is a separate transaction because it requires the mint to already be initialized.

---

## SSS-Core Program Integration

When initialized through the SSS-Core program, the config PDA takes ownership of the mint and freeze authorities. This enables:

- **RBAC**: Role-based access control via PDA-per-role. Separate Minter, Burner, Freezer, Pauser, Seizer roles.
- **Per-Minter Quotas**: Configurable caps tracked on-chain.
- **Pause/Unpause**: Protocol-level pause that blocks minting, burning, and seizure.
- **Two-Step Authority Transfer**: Nominate → accept pattern to prevent accidental admin loss.
- **Supply Cap**: Optional on-chain supply ceiling.

See [programs/sss-core/README.md](../programs/sss-core/README.md) for full program documentation.

## Operations

### Core

| Operation | Who can do it | Description |
|-----------|--------------|-------------|
| Mint | Minter (via sss-core) or Mint authority (direct) | Create new supply, credited to a recipient's ATA |
| Burn | Burner (via sss-core) or Token owner (direct) | Destroy tokens from the signer's ATA |
| Freeze | Freezer (via sss-core) or Freeze authority (direct) | Block a specific token account from all transfers |
| Thaw | Freezer (via sss-core) or Freeze authority (direct) | Unblock a frozen token account |
| Set Authority | Current authority | Transfer or revoke any authority |
| Seize | Seizer (via sss-core) | Thaw → burn → mint to treasury → re-freeze |

### Read-only

| Operation | Description |
|-----------|-------------|
| Supply | Total supply from the mint account |
| Balance | Balance of a specific wallet (via ATA) |
| Status | Mint metadata, authorities, supply |
| Audit Log | Recent transaction signatures from `getSignaturesForAddress` |

---

## Security Considerations

- **Mint authority**: In production, this should be a multisig (e.g., Squads) or an HSM. Never leave it as a single file-based keypair.
- **Freeze authority**: Should be held by a compliance officer or automated system. Can be revoked if not needed.
- **Metadata authority**: Typically the same as the main authority. Consider revoking after initial setup to make metadata immutable.
- **Decimals**: Once set at deployment, decimals cannot be changed.
- **Revocation is permanent**: Once an authority is set to `none`, it cannot be restored. Plan accordingly.

---

## Compatibility

SSS-1 tokens are standard Token-2022 mints. They are compatible with:

- All Solana wallets that support Token-2022 (Phantom, Solflare, Backpack, etc.)
- Solana Explorer
- Any DeFi protocol that supports Token-2022
- The SSS CLI, SDK, backend, and demo

An SSS-1 token can be upgraded to SSS-2 by deploying a separate blacklist hook program and creating a new mint with the Transfer Hook extension. Existing SSS-1 mints cannot be retroactively upgraded (Token-2022 extensions are fixed at creation time).

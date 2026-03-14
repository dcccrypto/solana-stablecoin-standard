# SSS-2: Compliant Stablecoin Preset

> **Preset identifier:** `2`
> **Use case:** Regulated stablecoins (USDC/USDT-class), DeFi protocols requiring compliance, any issuer with AML/sanctions obligations
> **Token-2022 extensions:** Freeze authority · Metadata · Permanent delegate · Transfer hook

---

## What SSS-2 Is

SSS-2 is the compliant stablecoin preset. It extends SSS-1 with two additional Token-2022 extensions:

- **Permanent delegate** — enables the compliance authority to move or burn tokens from any account (required for regulatory reclamation)
- **Transfer hook** — registers the `sss-transfer-hook` program, which Token-2022 invokes on every token transfer

The transfer hook provides the core SSS-2 guarantee: **every transfer is checked against an on-chain blacklist at the chain level, not in application code.** A blacklisted address cannot receive or send tokens regardless of which wallet, DEX, or bridge initiates the transfer.

---

## The SSS-2 Compliance Guarantee

```
Any transfer involving a blacklisted address
    → rejected by Token-2022 during transfer CPI
    → error returned on-chain (SenderBlacklisted or ReceiverBlacklisted)
    → transaction fails
    → no tokens move
```

This is not enforced in the backend. It is not enforced in the SDK. It is enforced by the Solana runtime, inside the Token-2022 program, which calls the transfer hook inside the same transaction as the transfer.

There is no off-chain step. There is no middleware to bypass.

---

## When to Use SSS-2

Choose SSS-2 when:

- You have AML, sanctions, or regulatory obligations requiring the ability to block specific addresses
- You need the ability to reclaim tokens from an account (permanent delegate)
- You are building a USDC/USDT-class stablecoin for broader market distribution
- Any token transfer must be auditable and stoppable at the chain level

Choose SSS-1 for internal tokens where on-chain enforcement overhead is not needed.

---

## Initialization

### Using the SDK

```typescript
import { SolanaStablecoin, sss2Config } from '@stbr/sss-token';
import { PublicKey } from '@solana/web3.js';

const TRANSFER_HOOK_PROGRAM_ID = new PublicKey(
  'phAtzRyRUJGpMC3ftAtWzoaX7UkghRe9x5KTig8jPQp', // devnet + localnet
);

const stablecoin = await SolanaStablecoin.create(provider, sss2Config({
  name: 'USD Stable',
  symbol: 'USDS',
  decimals: 6,
  uri: 'https://...',
  transferHookProgram: TRANSFER_HOOK_PROGRAM_ID,
}));
```

### What `create()` does for SSS-2

1. Creates the Token-2022 mint with: freeze authority + metadata + permanent delegate + **transfer hook extension** (pointing at `hookProgramId`)
2. Calls `sss-token::initialize` with `preset = 2` and `transfer_hook_program`
3. Creates the `StablecoinConfig` PDA
4. Calls `sss-transfer-hook::initialize_extra_account_meta_list` to create the `BlacklistState` PDA

After initialization, every Token-2022 transfer on this mint will invoke the transfer hook.

---

## Blacklist Management

Blacklist operations are performed via `ComplianceModule`. See [compliance-module.md](./compliance-module.md) for the full SDK reference.

```typescript
import { ComplianceModule } from '@stbr/sss-token';

const compliance = new ComplianceModule(
  provider,
  stablecoin.mint,
  TRANSFER_HOOK_PROGRAM_ID,
);

// Block an address — takes effect on the next confirmed transfer
await compliance.addToBlacklist(suspectAddress);

// Unblock
await compliance.removeFromBlacklist(suspectAddress);

// Check
const blocked = await compliance.isBlacklisted(suspectAddress);
```

Blacklist mutations require the `compliance_authority` (set during `initialize`).

---

## Freeze vs. Blacklist

SSS-2 provides two distinct enforcement tools:

| | Freeze | Blacklist |
|-|--------|-----------|
| **Granularity** | Specific token account | All token accounts owned by a wallet |
| **Mechanism** | Token-2022 freeze authority | Transfer hook `BlacklistState` PDA |
| **Effect** | Account cannot send or receive | All transfers involving the wallet fail |
| **Reversible?** | Yes (`thaw_account`) | Yes (`removeFromBlacklist`) |
| **Use case** | Surgical hold during investigation | Sanctions / AML block |

---

## Permanent Delegate

The permanent delegate (set to the `compliance_authority` during init) allows the compliance authority to:

- Transfer tokens out of any account (reclamation)
- Burn tokens from any account (forced burn)

This is a Token-2022 feature enforced by the SPL Token-2022 program. It is used for regulatory reclamation scenarios (e.g., court order requiring frozen assets to be returned to an escrow).

---

## On-Chain Accounts

### `StablecoinConfig` PDA (SSS-2)

Same structure as SSS-1, with:

| Field | Value |
|-------|-------|
| `preset` | `2` |
| `transfer_hook_program` | `phAtzRyRUJGpMC3ftAtWzoaX7UkghRe9x5KTig8jPQp` |

### `BlacklistState` PDA

```
seeds: ["blacklist-state", mint]
program: sss-transfer-hook
```

| Field | Type | Description |
|-------|------|-------------|
| `mint` | `Pubkey` | The Token-2022 mint |
| `authority` | `Pubkey` | Authority that can manage the blacklist |
| `blacklisted` | `Vec<Pubkey>` | Up to 100 blacklisted addresses |
| `bump` | `u8` | PDA bump seed |

Space: `8 + 32 + 32 + 4 + (100 × 32) + 1 = 3,277 bytes`

---

## Token-2022 Extensions Used

| Extension | Purpose |
|-----------|---------|
| `FreezeAuthority` | Enables `freeze_account` / `thaw_account` |
| `MetadataPointer` + `TokenMetadata` | Stores name/symbol/URI on-chain |
| `PermanentDelegate` | Compliance authority can move/burn any account's tokens |
| `TransferHook` | Registers `sss-transfer-hook`; invoked on every transfer |

---

## Error Codes

From `sss-token`:

| Error | Description |
|-------|-------------|
| `Unauthorized` | Caller is not the required authority |
| `MintPaused` | Mint/burn attempted while paused |
| `MinterCapExceeded` | Mint would exceed minter cap |

From `sss-transfer-hook` (returned inside transfer transactions):

| Error | Code | Description |
|-------|------|-------------|
| `SenderBlacklisted` | 6000 | Transfer sender is on the blacklist |
| `ReceiverBlacklisted` | 6001 | Transfer receiver is on the blacklist |
| `Unauthorized` | 6002 | Blacklist mutation by non-authority |

---

## REST API

The backend compliance API exposes blacklist and audit operations via authenticated REST endpoints. See [api.md](./api.md) and [compliance-audit-log.md](./compliance-audit-log.md).

---

## Related Docs

- [compliance-module.md](./compliance-module.md) — `ComplianceModule` SDK reference
- [transfer-hook.md](./transfer-hook.md) — `sss-transfer-hook` program reference
- [SSS-1.md](./SSS-1.md) — minimal preset (no blacklist)
- [ARCHITECTURE.md](./ARCHITECTURE.md) — system architecture

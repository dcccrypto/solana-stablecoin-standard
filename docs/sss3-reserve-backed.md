# SSS-3 — Reserve-Backed Preset

> **Preset:** SSS-3
> **Program:** `sss-token` (`AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat`)
> **Inherits:** SSS-1 (Token-2022 mint, freeze authority, metadata)
> **Added:** Collateral reserve vault · max supply cap · `net_supply()` · `reserve_ratio_bps()`

---

## Overview

SSS-3 is the **reserve-backed preset**. Every token minted must be backed by collateral held in a designated on-chain vault. The program enforces the reserve constraint at mint time — no off-chain oracle or middleware can bypass it.

```
Collateral vault balance ≥ net circulating supply   (enforced on every mint)
```

SSS-3 does **not** include a transfer hook (that is SSS-2 / SSS-4). It is appropriate for reserve-backed stablecoins that do not require on-chain blacklist enforcement.

---

## Comparison with Other Presets

| Feature | SSS-1 | SSS-2 | SSS-3 | SSS-4 |
|---------|-------|-------|-------|-------|
| Token-2022 mint | ✅ | ✅ | ✅ | ✅ |
| Freeze/thaw | ✅ | ✅ | ✅ | ✅ |
| Minter roles | ✅ | ✅ | ✅ | ✅ |
| Max supply cap | ✅ | ✅ | ✅ | ✅ |
| Transfer hook (blacklist) | ❌ | ✅ | ❌ | ✅ |
| Reserve vault | ❌ | ❌ | ✅ | ✅ |
| Pause/unpause | ❌ | ✅ | ✅ | ✅ |

---

## Initializing an SSS-3 Stablecoin

### On-Chain Instruction: `initialize`

SSS-3 requires two additional fields in `InitializeParams`:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `preset` | `u8` | ✅ | Must be `3` |
| `collateral_mint` | `Option<Pubkey>` | ✅ | Token-2022 or SPL mint for the collateral asset |
| `reserve_vault` | `Option<Pubkey>` | ✅ | Token account that will hold collateral |
| `max_supply` | `u64` | Optional | Max mintable supply; `0` = unlimited |
| `transfer_hook_program` | `Option<Pubkey>` | ❌ | Not used for SSS-3 |

The program validates at init:
- `collateral_mint` must be `Some(_)` for preset 3.
- `reserve_vault` must be `Some(_)` for preset 3.
- `transfer_hook_program` is ignored (no hook on SSS-3).

### Rust (Anchor test)

```rust
let params = InitializeParams {
    preset: 3,
    decimals: 6,
    name: "USD Reserve".to_string(),
    symbol: "USDR".to_string(),
    uri: "https://example.com/metadata.json".to_string(),
    transfer_hook_program: None,
    collateral_mint: Some(usdc_mint.key()),
    reserve_vault: Some(reserve_vault.key()),
    max_supply: 1_000_000_000_000, // 1 billion (with 6 decimals)
};

program
    .request()
    .accounts(accounts::Initialize { /* ... */ })
    .args(instruction::Initialize { params })
    .send()
    .await?;
```

---

## Reserve Enforcement

### How It Works

On every `mint` call for an SSS-3 stablecoin, the program:

1. Reads the current balance of the `reserve_vault` token account by borrowing its account data and parsing the u64 at byte offset 64 (the SPL token account amount field).
2. Computes the **post-mint net supply**: `net_supply() + amount`.
3. Requires `vault_balance ≥ post_mint_net_supply`.

```
vault_balance ≥ total_minted - total_burned + amount_being_minted
```

If the vault has insufficient balance, the instruction returns `InsufficientReserves`.

### Reserve Account Data Layout

The program reads the vault balance directly from account data using the Token-2022 / SPL token account layout:

```
Offset  Length  Field
0       32      mint (Pubkey)
32      32      owner (Pubkey)
64      8       amount (u64, little-endian)   ← reserve check reads here
72      ...     (delegate, state, etc.)
```

### `net_supply()`

```rust
/// Net circulating supply (total_minted - total_burned). Never underflows.
pub fn net_supply(&self) -> u64 {
    self.total_minted.saturating_sub(self.total_burned)
}
```

### `reserve_ratio_bps()`

Returns the current collateralization ratio in **basis points** (10 000 = 100%). If net supply is 0, returns 10 000 (fully collateralized by definition).

```rust
pub fn reserve_ratio_bps(&self) -> u64 {
    let supply = self.net_supply();
    if supply == 0 { return 10_000; }
    let ratio = (self.total_collateral as u128)
        .saturating_mul(10_000)
        / (supply as u128);
    ratio.min(u64::MAX as u128) as u64
}
```

Example: 150% over-collateralized → `15_000 bps`.

---

## Max Supply Cap

All presets (including SSS-3) support an optional maximum supply cap set at initialization. When `max_supply > 0`, every `mint` call checks:

```
net_supply() + amount ≤ max_supply
```

If exceeded, the instruction returns `MaxSupplyExceeded`. Setting `max_supply = 0` disables the cap (unlimited).

---

## Mint Instruction (SSS-3)

### Additional Account: `reserve_vault`

For SSS-3 and SSS-4, the `mint` instruction requires a `reserve_vault` account:

```rust
pub struct MintTokens<'info> {
    // ... standard accounts ...

    /// Reserve vault — required for SSS-3 and SSS-4.
    /// Must match config.reserve_vault.
    /// CHECK: Validated in handler.
    pub reserve_vault: Option<AccountInfo<'info>>,

    pub token_program: Interface<'info, TokenInterface>,
}
```

The handler validates:
- `reserve_vault` account key equals `config.reserve_vault`.
- Vault balance ≥ post-mint net supply.

### TypeScript (via Anchor)

```typescript
const tx = await program.methods
  .mint(new BN(1_000_000)) // 1 USDR (6 decimals)
  .accounts({
    config: configPda,
    mint: mintKeypair.publicKey,
    minterInfo: minterInfoPda,
    minter: wallet.publicKey,
    recipientTokenAccount: recipientAta,
    reserveVault: reserveVaultAddress, // required for SSS-3
    tokenProgram: TOKEN_2022_PROGRAM_ID,
  })
  .rpc();
```

---

## Error Codes (SSS-3 specific)

| Error | Code | When thrown |
|-------|------|-------------|
| `InsufficientReserves` | — | Vault balance < post-mint net supply |
| `InvalidCollateralMint` | — | `collateral_mint` missing on SSS-3 init |
| `InvalidVault` | — | `reserve_vault` missing on SSS-3 init, or key mismatch at mint |
| `ReserveVaultRequired` | — | SSS-3/4 mint called without passing `reserve_vault` account |
| `MaxSupplyExceeded` | — | Mint would push net supply past `max_supply` |

---

## StablecoinConfig Fields (SSS-3)

The `StablecoinConfig` PDA includes these reserve-specific fields:

| Field | Type | Description |
|-------|------|-------------|
| `collateral_mint` | `Pubkey` | Collateral asset mint (e.g. USDC) |
| `reserve_vault` | `Pubkey` | Token account holding collateral |
| `total_collateral` | `u64` | Total collateral deposited (cumulative) |
| `max_supply` | `u64` | Max mintable; `0` = unlimited |

Helper predicates on `StablecoinConfig`:

```rust
config.has_reserve()   // true for SSS-3 and SSS-4
config.has_hook()      // true for SSS-2 and SSS-4
config.net_supply()    // total_minted - total_burned
config.reserve_ratio_bps() // collateral / net_supply * 10_000
```

---

## Events

SSS-3 emits the standard events plus collateral-specific ones. See [on-chain-program-events.md](./on-chain-program-events.md) for the full reference.

| Event | When |
|-------|------|
| `TokenInitialized` | On `initialize` |
| `TokensMinted` | On `mint` |
| `TokensBurned` | On `burn` |
| `CollateralDeposited` | When collateral is deposited |
| `CollateralRedeemed` | When collateral is redeemed |

---

## Depositing Collateral: `deposit_collateral`

Before minting SSS-3 tokens, collateral must be deposited into the reserve vault. Anyone can deposit (depositor just needs a funded collateral token account).

### Accounts

| Account | Mut | Description |
|---------|-----|-------------|
| `depositor` | signer | Funds the collateral transfer |
| `config` | ✅ | StablecoinConfig PDA |
| `sss_mint` | — | The SSS stablecoin mint |
| `collateral_mint` | — | The collateral token mint (e.g. USDC) |
| `depositor_collateral` | ✅ | Depositor's collateral token account (source) |
| `reserve_vault` | ✅ | Vault token account (destination) |
| `token_program` | — | Token or Token-2022 program |

The program validates:
- `config.has_reserve()` — must be preset 3 or 4.
- `collateral_mint.key() == config.collateral_mint` — correct collateral asset.
- `reserve_vault.key() == config.reserve_vault` — correct vault account.
- `amount > 0`.

### TypeScript

```typescript
const tx = await program.methods
  .depositCollateral(new BN(1_000_000_000)) // 1000 USDC (6 decimals)
  .accounts({
    depositor: wallet.publicKey,
    config: configPda,
    sssMint: mintKeypair.publicKey,
    collateralMint: usdcMint,
    depositorCollateral: depositorUsdcAta,
    reserveVault: reserveVaultAddress,
    tokenProgram: TOKEN_2022_PROGRAM_ID, // or TOKEN_PROGRAM_ID for SPL collateral
  })
  .rpc();
```

---

## Redeeming Collateral: `redeem`

Redeem burns the caller's SSS stablecoin tokens and releases an equal amount of collateral from the vault. The config PDA signs the vault transfer.

> **1:1 redemption** — `amount` SSS tokens burned → `amount` collateral tokens released. Assumes the same decimal precision for both.

### Accounts

| Account | Mut | Description |
|---------|-----|-------------|
| `redeemer` | signer | Burns SSS tokens, receives collateral |
| `config` | ✅ | StablecoinConfig PDA |
| `sss_mint` | ✅ | The SSS stablecoin mint (burn authority: config PDA) |
| `redeemer_sss_account` | ✅ | Redeemer's SSS token account (tokens burned from here) |
| `collateral_mint` | — | The collateral token mint |
| `reserve_vault` | ✅ | Vault token account (releases collateral) |
| `redeemer_collateral` | ✅ | Redeemer's collateral token account (receives collateral) |
| `sss_token_program` | — | Token-2022 program (for SSS burn) |
| `collateral_token_program` | — | Token or Token-2022 program (for collateral transfer) |

### Validation

- `config.has_reserve()` — preset 3 or 4 only.
- `!config.paused` — redemption blocked while paused.
- `reserve_vault.amount >= amount` — vault has enough to release.
- `amount > 0`.

### Execution Flow

```
1. burn_checked(amount, sss_mint)                    // SSS tokens destroyed
2. transfer_checked(amount, reserve_vault → redeemer) // collateral released; config PDA signs
3. config.total_burned += amount
4. config.total_collateral -= amount
emit CollateralRedeemed { ... }
```

### TypeScript

```typescript
const tx = await program.methods
  .redeem(new BN(500_000_000)) // Redeem 500 USDR → receive 500 USDC
  .accounts({
    redeemer: wallet.publicKey,
    config: configPda,
    sssMint: mintKeypair.publicKey,
    redeemerSssAccount: redeemerSssAta,
    collateralMint: usdcMint,
    reserveVault: reserveVaultAddress,
    redeemerCollateral: redeemerUsdcAta,
    sssTokenProgram: TOKEN_2022_PROGRAM_ID,
    collateralTokenProgram: TOKEN_PROGRAM_ID,
  })
  .rpc();
```

---

## SSS-4: Reserve-Backed + Compliant

SSS-4 combines SSS-2 (transfer hook / blacklist) with SSS-3 (reserve vault). It requires both `transfer_hook_program` and `collateral_mint` + `reserve_vault` at initialization. All SSS-3 reserve mechanics apply. See [transfer-hook.md](./transfer-hook.md) for the SSS-2 hook details.

---

## Related Docs

- [On-Chain Program Events](./on-chain-program-events.md) — Anchor event reference
- [On-Chain SDK Core](./on-chain-sdk-core.md) — TypeScript SDK methods
- [Transfer Hook](./transfer-hook.md) — SSS-2 / SSS-4 blacklist enforcement
- [Architecture](./ARCHITECTURE.md) — Preset overview and design rationale

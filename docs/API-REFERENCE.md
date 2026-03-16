# SSS Program — Complete API Reference

> **Program ID:** `AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat`  
> **Standard:** SSS-1 (Minimal) · SSS-2 (Compliant) · SSS-3 (Reserve-Backed)  
> **Framework:** Anchor · Token-2022

---

## Table of Contents

1. [Account Schemas](#account-schemas)
2. [Instructions](#instructions)
   - [Core: Initialize & Token Ops](#core-initialize--token-ops)
   - [CDP: Multi-Collateral Debt Positions](#cdp-multi-collateral-debt-positions)
   - [PSM: Peg Stability Module](#psm-peg-stability-module)
   - [CPI Composability Standard](#cpi-composability-standard)
   - [Feature Flags](#feature-flags)
   - [DAO Committee Governance](#dao-committee-governance)
   - [Yield-Bearing Collateral](#yield-bearing-collateral)
   - [ZK Compliance](#zk-compliance)
   - [Admin Timelock](#admin-timelock)
   - [Oracle Parameters](#oracle-parameters)
   - [Stability Fee](#stability-fee)
   - [Bad Debt Backstop](#bad-debt-backstop)
   - [CollateralConfig PDA](#collateralconfig-pda)
3. [Events](#events)
4. [Errors](#errors)
5. [Feature Flag Constants](#feature-flag-constants)

---

## Account Schemas

### `StablecoinConfig`

Global configuration PDA for a stablecoin instance. One per mint.

**Seeds:** `["stablecoin-config", mint]`

| Field | Type | Description |
|-------|------|-------------|
| `mint` | `Pubkey` | Token-2022 mint address |
| `authority` | `Pubkey` | Admin authority (can update roles, minters) |
| `compliance_authority` | `Pubkey` | Compliance authority (can freeze/thaw) |
| `preset` | `u8` | `1` = SSS-1 · `2` = SSS-2 · `3` = SSS-3 |
| `paused` | `bool` | When true, all mint/burn ops are blocked |
| `total_minted` | `u64` | Cumulative tokens minted (not net of burns) |
| `total_burned` | `u64` | Cumulative tokens burned |
| `transfer_hook_program` | `Pubkey` | Transfer hook program (SSS-2; default if SSS-1/3) |
| `collateral_mint` | `Pubkey` | Collateral token mint (SSS-3; default otherwise) |
| `reserve_vault` | `Pubkey` | Reserve vault token account (SSS-3; default otherwise) |
| `total_collateral` | `u64` | Total collateral held in reserve vault |
| `max_supply` | `u64` | Maximum token supply (`0` = unlimited) |
| `pending_authority` | `Pubkey` | Two-step authority transfer target (default if none) |
| `pending_compliance_authority` | `Pubkey` | Two-step compliance authority transfer target |
| `feature_flags` | `u64` | Bitmask of enabled feature flags (see [Feature Flag Constants](#feature-flag-constants)) |
| `max_transfer_amount` | `u64` | Per-tx cap when `FLAG_SPEND_POLICY` is set |
| `expected_pyth_feed` | `Pubkey` | Required Pyth price feed for CDP ops (default = no validation) |
| `admin_op_mature_slot` | `u64` | Slot when pending timelock op matures (`0` = none) |
| `admin_op_kind` | `u8` | Pending timelock op discriminant (`0` = none) |
| `admin_op_param` | `u64` | Generic u64 param for pending timelock op |
| `admin_op_target` | `Pubkey` | Target pubkey for pending timelock op |
| `admin_timelock_delay` | `u64` | Min slot delay for admin ops (default `432_000` ≈ 2 epochs) |
| `max_oracle_age_secs` | `u32` | Max Pyth price age in seconds (`0` = default 60s) |
| `max_oracle_conf_bps` | `u16` | Max Pyth confidence as bps of price (`0` = disabled) |
| `stability_fee_bps` | `u16` | Annual CDP stability fee in bps (max 2000 = 20% p.a.) |
| `redemption_fee_bps` | `u16` | PSM redemption fee in bps (max 1000 = 10%) |
| `insurance_fund_pubkey` | `Pubkey` | Insurance fund vault for bad debt backstop |
| `max_backstop_bps` | `u16` | Max backstop draw as % of net supply in bps (`0` = unlimited) |
| `bump` | `u8` | PDA bump |

**Helper methods:**
- `net_supply() → u64` — `total_minted - total_burned`
- `reserve_ratio_bps() → u64` — `(total_collateral / net_supply) * 10_000`
- `has_reserve() → bool` — `reserve_vault != default`
- `has_hook() → bool` — `transfer_hook_program != default`
- `check_feature_flag(flag: u64) → bool` — tests a flag bit

---

### `MinterInfo`

Per-minter configuration PDA.

**Seeds:** `["minter-info", config, minter]`

| Field | Type | Description |
|-------|------|-------------|
| `config` | `Pubkey` | Parent `StablecoinConfig` |
| `minter` | `Pubkey` | Minter wallet pubkey |
| `cap` | `u64` | Max tokens this minter may mint (lifetime; `0` = unlimited) |
| `minted` | `u64` | Cumulative tokens minted by this minter |
| `max_mint_per_epoch` | `u64` | Per-epoch velocity cap (`0` = unlimited) |
| `minted_this_epoch` | `u64` | Tokens minted in the current epoch |
| `last_epoch_reset` | `u64` | Epoch when `minted_this_epoch` was last reset |
| `bump` | `u8` | PDA bump |

---

### `CollateralVault`

Per-(user, collateral_mint) CDP collateral vault.

**Seeds:** `["cdp-collateral-vault", user, collateral_mint]`

| Field | Type | Description |
|-------|------|-------------|
| `owner` | `Pubkey` | User who owns this vault |
| `collateral_mint` | `Pubkey` | SPL token mint for this collateral |
| `vault_token_account` | `Pubkey` | Token account holding collateral (owned by vault PDA) |
| `deposited_amount` | `u64` | Total collateral deposited |
| `bump` | `u8` | PDA bump |

---

### `CdpPosition`

Per-(user, sss_mint) CDP debt position. Single-collateral per position (SSS-054).

**Seeds:** `["cdp-position", sss_mint, user]`

| Field | Type | Description |
|-------|------|-------------|
| `config` | `Pubkey` | Parent `StablecoinConfig` |
| `sss_mint` | `Pubkey` | The SSS stablecoin mint |
| `owner` | `Pubkey` | CDP owner |
| `debt_amount` | `u64` | Outstanding SSS-3 debt |
| `collateral_mint` | `Pubkey` | Locked collateral type (immutable after first borrow) |
| `last_fee_accrual` | `i64` | Unix timestamp of last stability fee accrual |
| `accrued_fees` | `u64` | Stability fees accrued but not yet collected |
| `bump` | `u8` | PDA bump |

**Constants:**
- `MIN_COLLATERAL_RATIO_BPS = 15_000` (150% — minimum to borrow)
- `LIQUIDATION_THRESHOLD_BPS = 12_000` (120% — liquidation trigger)
- `LIQUIDATION_BONUS_BPS = 500` (5% — liquidator discount)

---

### `CollateralConfig`

Per-(sss_mint, collateral_mint) configuration for accepted collateral types.

**Seeds:** `["collateral-config", sss_mint, collateral_mint]`

| Field | Type | Description |
|-------|------|-------------|
| `sss_mint` | `Pubkey` | The SSS-3 mint |
| `collateral_mint` | `Pubkey` | The collateral token mint |
| `whitelisted` | `bool` | When `false`, deposits are rejected |
| `max_ltv_bps` | `u16` | Max loan-to-value ratio in bps (e.g. `7500` = 75%) |
| `liquidation_threshold_bps` | `u16` | Ratio below which position is liquidatable; must be > `max_ltv_bps` |
| `liquidation_bonus_bps` | `u16` | Extra collateral for liquidators in bps (max 5000 = 50%) |
| `max_deposit_cap` | `u64` | Max total deposited amount (`0` = unlimited) |
| `total_deposited` | `u64` | Running total deposited through CDP |
| `bump` | `u8` | PDA bump |

---

### `InterfaceVersion`

CPI composability version PDA. External callers check before invoking SSS via CPI.

**Seeds:** `["interface-version", sss_mint]`

| Field | Type | Description |
|-------|------|-------------|
| `mint` | `Pubkey` | SSS mint |
| `version` | `u8` | Current interface version (`1` = initial) |
| `active` | `bool` | `false` = deprecated, use new program |
| `namespace` | `[u8; 32]` | Namespace for discriminator derivation |
| `bump` | `u8` | PDA bump |

**Constants:**
- `CURRENT_VERSION = 1`
- `NAMESPACE = "sss_mint_interface"`

---

### `YieldCollateralConfig`

Whitelist of yield-bearing SPL token mints for CDP collateral.

**Seeds:** `["yield-collateral", sss_mint]`

| Field | Type | Description |
|-------|------|-------------|
| `sss_mint` | `Pubkey` | SSS mint |
| `whitelisted_mints` | `Vec<Pubkey>` | Up to 8 whitelisted yield token mints |
| `bump` | `u8` | PDA bump |

**Constraint:** `MAX_MINTS = 8`

---

### `DaoCommitteeConfig`

Governance committee configuration for a stablecoin.

**Seeds:** `["dao-committee", config]`

| Field | Type | Description |
|-------|------|-------------|
| `config` | `Pubkey` | Parent `StablecoinConfig` |
| `members` | `Vec<Pubkey>` | Committee member pubkeys (max 10) |
| `quorum` | `u8` | Min YES votes required to pass |
| `next_proposal_id` | `u64` | Auto-incrementing proposal counter |
| `bump` | `u8` | PDA bump |

---

### `ProposalPda`

On-chain DAO governance proposal.

**Seeds:** `["dao-proposal", config, proposal_id.to_le_bytes()]`

| Field | Type | Description |
|-------|------|-------------|
| `config` | `Pubkey` | Parent `StablecoinConfig` |
| `proposal_id` | `u64` | Unique proposal index |
| `proposer` | `Pubkey` | Authority who created the proposal |
| `action` | `ProposalAction` | Action to execute on pass |
| `param` | `u64` | Generic param (flag bits / cap) |
| `target` | `Pubkey` | Target pubkey (minter key, etc.) |
| `votes` | `Vec<Pubkey>` | Committee members who voted YES (max 10) |
| `quorum` | `u8` | Required YES votes |
| `executed` | `bool` | Whether the proposal has been executed |
| `cancelled` | `bool` | Whether the proposal has been cancelled |
| `bump` | `u8` | PDA bump |

**`ProposalAction` enum:**

| Variant | Value | Description |
|---------|-------|-------------|
| `Pause` | `0` | Pause the stablecoin mint |
| `Unpause` | `1` | Unpause the stablecoin mint |
| `SetFeatureFlag` | `2` | Enable a feature flag (`param` = flag bits) |
| `ClearFeatureFlag` | `3` | Disable a feature flag (`param` = flag bits) |
| `UpdateMinter` | `4` | Update minter cap (`param` = new cap, `target` = minter) |
| `RevokeMinter` | `5` | Revoke a minter (`target` = minter) |

---

### `ZkComplianceConfig`

Protocol-wide ZK proof settings. SSS-2 only.

**Seeds:** `["zk-compliance-config", sss_mint]`

| Field | Type | Description |
|-------|------|-------------|
| `sss_mint` | `Pubkey` | SSS mint |
| `ttl_slots` | `u64` | Proof validity window in slots (default `1500` ≈ 10 min) |
| `verifier_pubkey` | `Option<Pubkey>` | Co-signer required for proof submission (None = anyone may submit) |
| `bump` | `u8` | PDA bump |

---

### `VerificationRecord`

Per-(mint, user) ZK compliance proof record.

**Seeds:** `["zk-verification", sss_mint, user]`

| Field | Type | Description |
|-------|------|-------------|
| `sss_mint` | `Pubkey` | SSS mint |
| `user` | `Pubkey` | Wallet that submitted the proof |
| `expires_at_slot` | `u64` | Record is valid while `Clock::slot < expires_at_slot` |
| `bump` | `u8` | PDA bump |

---

## Instructions

---

### Core: Initialize & Token Ops

---

#### `initialize`

Initialize a new stablecoin (SSS-1, SSS-2, or SSS-3).

**Params:**

| Field | Type | Description |
|-------|------|-------------|
| `preset` | `u8` | `1` = SSS-1, `2` = SSS-2, `3` = SSS-3 |
| `decimals` | `u8` | Token decimals |
| `name` | `String` | Human-readable token name |
| `symbol` | `String` | Token symbol (e.g. `USDC`) |
| `uri` | `String` | Metadata URI |
| `transfer_hook_program` | `Option<Pubkey>` | Required for SSS-2; rejected for SSS-1/3 |
| `collateral_mint` | `Option<Pubkey>` | SSS-3 only: collateral token mint |
| `reserve_vault` | `Option<Pubkey>` | SSS-3 only: reserve vault token account |
| `max_supply` | `Option<u64>` | Max supply (`None`/`0` = unlimited) |

**Accounts:**

| Account | Writable | Signer | Description |
|---------|----------|--------|-------------|
| `config` | ✓ | | `StablecoinConfig` PDA (init) |
| `mint` | ✓ | ✓ | New Token-2022 mint |
| `authority` | | ✓ | Stablecoin authority |
| `system_program` | | | |
| `token_program` | | | Token-2022 program |

**Constraints:**
- `preset` must be 1, 2, or 3
- SSS-2 requires `transfer_hook_program`
- SSS-3 requires `collateral_mint` and `reserve_vault`

**Events emitted:** `TokenInitialized`

**Errors:** `InvalidPreset`, `MissingTransferHook`, `ReserveVaultRequired`

---

#### `mint`

Mint tokens to a recipient. Caller must be a registered minter.

**Params:** `amount: u64`

**Accounts:**

| Account | Writable | Signer | Description |
|---------|----------|--------|-------------|
| `config` | ✓ | | `StablecoinConfig` PDA |
| `minter_info` | ✓ | | `MinterInfo` PDA for caller |
| `mint` | ✓ | | Token-2022 mint |
| `recipient_token_account` | ✓ | | Destination token account |
| `minter` | | ✓ | Minter wallet |
| `token_program` | | | Token-2022 program |

**Constraints:**
- `amount > 0`
- Mint not paused
- Circuit breaker not active
- `minter_info.minted + amount <= minter_info.cap` (if cap > 0)
- `total_minted + amount <= max_supply` (if max_supply > 0)
- Epoch velocity limit not exceeded (if `max_mint_per_epoch > 0`)

**Events emitted:** `TokensMinted`

**Errors:** `ZeroAmount`, `MintPaused`, `CircuitBreakerActive`, `MinterCapExceeded`, `MaxSupplyExceeded`, `MintVelocityExceeded`, `NotAMinter`

---

#### `burn`

Burn tokens from source. Caller must be a registered minter.

**Params:** `amount: u64`

**Accounts:**

| Account | Writable | Signer | Description |
|---------|----------|--------|-------------|
| `config` | ✓ | | `StablecoinConfig` PDA |
| `minter_info` | | | `MinterInfo` PDA for caller |
| `mint` | ✓ | | Token-2022 mint |
| `source_token_account` | ✓ | | Source token account |
| `minter` | | ✓ | Minter wallet |
| `token_program` | | | Token-2022 program |

**Constraints:**
- `amount > 0`
- Mint not paused
- Circuit breaker not active

**Events emitted:** `TokensBurned`

**Errors:** `ZeroAmount`, `MintPaused`, `CircuitBreakerActive`, `NotAMinter`

---

#### `freeze_account`

Freeze a token account (compliance action).

**Accounts:**

| Account | Writable | Signer | Description |
|---------|----------|--------|-------------|
| `config` | | | `StablecoinConfig` PDA |
| `mint` | | | Token-2022 mint |
| `target_account` | ✓ | | Token account to freeze |
| `compliance_authority` | | ✓ | Must match `config.compliance_authority` |
| `token_program` | | | Token-2022 program |

**Events emitted:** `AccountFrozen`

**Errors:** `UnauthorizedCompliance`

---

#### `thaw_account`

Thaw a frozen token account.

**Accounts:** Same as `freeze_account`.

**Events emitted:** `AccountThawed`

**Errors:** `UnauthorizedCompliance`

---

#### `pause`

Pause the entire mint. No minting/burning while paused. SSS-2+ only.

**Accounts:**

| Account | Writable | Signer | Description |
|---------|----------|--------|-------------|
| `config` | ✓ | | `StablecoinConfig` PDA |
| `mint` | | | Token-2022 mint |
| `authority` | | ✓ | Must match `config.authority` |

**Constraints:** If `FLAG_DAO_COMMITTEE` is active, requires a passed `Pause` proposal.

**Events emitted:** `MintPausedEvent { paused: true }`

**Errors:** `Unauthorized`, `WrongPreset`, `DaoCommitteeRequired`

---

#### `unpause`

Unpause the mint.

**Accounts:** Same as `pause`.

**Events emitted:** `MintPausedEvent { paused: false }`

---

#### `update_minter`

Register or update a minter with a mint cap. Authority only.

**Params:** `cap: u64`

**Accounts:**

| Account | Writable | Signer | Description |
|---------|----------|--------|-------------|
| `config` | | | `StablecoinConfig` PDA |
| `minter_info` | ✓ | | `MinterInfo` PDA (init or update) |
| `mint` | | | Token-2022 mint |
| `minter_wallet` | | | Minter pubkey to register |
| `authority` | | ✓ | Must match `config.authority` |
| `system_program` | | | |

**Constraints:** If `FLAG_DAO_COMMITTEE` is active, requires a passed `UpdateMinter` proposal.

**Errors:** `Unauthorized`, `DaoCommitteeRequired`

---

#### `revoke_minter`

Revoke a registered minter. Authority only.

**Accounts:**

| Account | Writable | Signer | Description |
|---------|----------|--------|-------------|
| `config` | | | `StablecoinConfig` PDA |
| `minter_info` | ✓ | | `MinterInfo` PDA to close |
| `mint` | | | Token-2022 mint |
| `minter_wallet` | | | Minter pubkey |
| `authority` | | ✓ | Must match `config.authority` |

**Constraints:** If `FLAG_DAO_COMMITTEE` is active, requires a passed `RevokeMinter` proposal.

**Errors:** `Unauthorized`, `DaoCommitteeRequired`

---

#### `update_roles`

Initiate a two-step authority/compliance authority transfer.

**Params:**

| Field | Type | Description |
|-------|------|-------------|
| `new_authority` | `Option<Pubkey>` | Proposed new authority |
| `new_compliance_authority` | `Option<Pubkey>` | Proposed new compliance authority |

**Accounts:**

| Account | Writable | Signer | Description |
|---------|----------|--------|-------------|
| `config` | ✓ | | `StablecoinConfig` PDA |
| `mint` | | | Token-2022 mint |
| `authority` | | ✓ | Must match `config.authority` |

**Events emitted:** `AuthorityProposed` (for each non-None field)

**Errors:** `Unauthorized`

---

#### `accept_authority`

Accept a pending authority transfer (two-step). Caller must be `pending_authority`.

**Accounts:**

| Account | Writable | Signer | Description |
|---------|----------|--------|-------------|
| `config` | ✓ | | `StablecoinConfig` PDA |
| `mint` | | | Token-2022 mint |
| `new_authority` | | ✓ | Must match `config.pending_authority` |

**Events emitted:** `AuthorityAccepted { is_compliance: false }`

**Errors:** `NoPendingAuthority`

---

#### `accept_compliance_authority`

Accept a pending compliance authority transfer. Caller must be `pending_compliance_authority`.

**Accounts:** Same as `accept_authority` (caller must be `pending_compliance_authority`).

**Events emitted:** `AuthorityAccepted { is_compliance: true }`

**Errors:** `NoPendingComplianceAuthority`

---

### PSM: Peg Stability Module

SSS-3 only. The PSM allows depositing collateral to mint stablecoins (fee-free) and burning stablecoins to reclaim collateral (subject to `redemption_fee_bps`).

---

#### `deposit_collateral`

Deposit collateral into the reserve vault and receive SSS-3 tokens. Fee-free.

**Params:** `amount: u64`

**Accounts:**

| Account | Writable | Signer | Description |
|---------|----------|--------|-------------|
| `config` | ✓ | | `StablecoinConfig` PDA (preset 3) |
| `mint` | ✓ | | SSS-3 token mint |
| `collateral_mint` | | | Must match `config.collateral_mint` |
| `user_collateral_account` | ✓ | | User's collateral source token account |
| `reserve_vault` | ✓ | | `config.reserve_vault` token account |
| `user_token_account` | ✓ | | User's SSS-3 destination token account |
| `user` | | ✓ | Depositor |
| `token_program` | | | Token-2022 program |

**Constraints:**
- `amount > 0`
- Mint not paused
- `total_minted + amount <= max_supply` (if max_supply > 0)

**Events emitted:** `CollateralDeposited`

**Errors:** `ZeroAmount`, `MintPaused`, `MaxSupplyExceeded`, `InvalidCollateralMint`, `InvalidVault`

---

#### `redeem`

Burn SSS-3 tokens and receive collateral. Subject to `redemption_fee_bps` (PSM fee).

**Params:** `amount: u64`

**Accounts:**

| Account | Writable | Signer | Description |
|---------|----------|--------|-------------|
| `config` | ✓ | | `StablecoinConfig` PDA (preset 3) |
| `mint` | ✓ | | SSS-3 token mint |
| `collateral_mint` | | | Must match `config.collateral_mint` |
| `user_token_account` | ✓ | | User's SSS-3 source (to burn from) |
| `reserve_vault` | ✓ | | `config.reserve_vault` token account |
| `user_collateral_account` | ✓ | | User's collateral destination |
| `user` | | ✓ | Redeemer |
| `token_program` | | | Token-2022 program |

**Fee logic:**
- `fee = amount * redemption_fee_bps / 10_000`
- `collateral_out = amount - fee` (fee stays in vault)

**Events emitted:** `CollateralRedeemed`, `PsmSwapEvent`

**Errors:** `ZeroAmount`, `MintPaused`, `InsufficientReserves`

---

### CDP: Multi-Collateral Debt Positions

Direction 2. Allows users to deposit SPL token collateral and borrow SSS-3 stablecoins. Requires a Pyth oracle for price feeds.

**Global CDP constants (defaults if no CollateralConfig PDA):**
- Min collateral ratio: **150%** (15,000 bps)
- Liquidation threshold: **120%** (12,000 bps)
- Liquidation bonus: **5%** (500 bps)

---

#### `cdp_deposit_collateral`

Deposit SPL token collateral into a per-user vault.

**Params:** `amount: u64`

**Accounts:**

| Account | Writable | Signer | Description |
|---------|----------|--------|-------------|
| `config` | | | `StablecoinConfig` PDA |
| `collateral_vault` | ✓ | | `CollateralVault` PDA (init if needed) — seeds: `["cdp-collateral-vault", user, collateral_mint]` |
| `vault_token_account` | ✓ | | Token account owned by vault PDA (init if needed) |
| `user_collateral_account` | ✓ | | User's source collateral token account |
| `collateral_mint` | | | SPL token mint for collateral |
| `user` | | ✓ | Depositor |
| `collateral_config` | | | Optional: `CollateralConfig` PDA — if passed, enforces whitelist and deposit cap |
| `system_program` | | | |
| `token_program` | | | |

**Constraints:**
- `amount > 0`
- If `CollateralConfig` PDA passed: collateral must be whitelisted, deposit cap not exceeded

**Errors:** `ZeroAmount`, `CollateralNotWhitelisted`, `DepositCapExceeded`

---

#### `cdp_borrow_stable`

Borrow SSS-3 stablecoins against deposited collateral. Enforces min 150% collateral ratio via Pyth oracle.

**Params:** `amount: u64`

**Accounts:**

| Account | Writable | Signer | Description |
|---------|----------|--------|-------------|
| `config` | ✓ | | `StablecoinConfig` PDA (preset 3) |
| `cdp_position` | ✓ | | `CdpPosition` PDA (init if first borrow) — seeds: `["cdp-position", sss_mint, user]` |
| `collateral_vault` | | | `CollateralVault` PDA for user |
| `sss_mint` | ✓ | | SSS-3 token mint |
| `user_token_account` | ✓ | | User's SSS-3 destination |
| `pyth_price_feed` | | | Pyth price account for collateral/USD |
| `user` | | ✓ | Borrower |
| `system_program` | | | |
| `token_program` | | | Token-2022 program |

**Constraints:**
- `amount > 0`
- Mint not paused, circuit breaker not active
- `max_supply` not exceeded
- Pyth feed: must match `expected_pyth_feed` (if set), price not stale (max `max_oracle_age_secs`), confidence not too wide (if `max_oracle_conf_bps > 0`)
- Post-borrow collateral ratio ≥ 150% (or CollateralConfig `max_ltv_bps`)
- `cdp_position.collateral_mint` locked to `collateral_vault.collateral_mint` after first borrow

**Events emitted:** `TokensMinted`

**Errors:** `ZeroAmount`, `MintPaused`, `CircuitBreakerActive`, `MaxSupplyExceeded`, `InvalidPriceFeed`, `StalePriceFeed`, `InvalidPrice`, `OracleConfidenceTooWide`, `UnexpectedPriceFeed`, `CollateralRatioTooLow`, `WrongCollateralMint`

---

#### `cdp_repay_stable`

Repay CDP debt by burning stablecoins. Proportionally releases collateral.

**Params:** `amount: u64`

**Accounts:**

| Account | Writable | Signer | Description |
|---------|----------|--------|-------------|
| `config` | ✓ | | `StablecoinConfig` PDA |
| `cdp_position` | ✓ | | `CdpPosition` PDA for user |
| `collateral_vault` | ✓ | | `CollateralVault` PDA |
| `vault_token_account` | ✓ | | Token account in vault |
| `sss_mint` | ✓ | | SSS-3 token mint |
| `user_token_account` | ✓ | | User's SSS-3 source (to burn from) |
| `user_collateral_account` | ✓ | | User's collateral destination |
| `user` | | ✓ | Debtor |
| `token_program` | | | Token-2022 program |

**Constraints:**
- `amount > 0`
- `amount <= cdp_position.debt_amount`
- Proportional collateral released: `collateral_release = (amount / debt_amount) * deposited_amount`

**Errors:** `ZeroAmount`, `InsufficientDebt`, `InsufficientCollateral`

---

#### `cdp_liquidate`

Liquidate an undercollateralized CDP position (collateral ratio < 120%). Callable by anyone (permissionless).

**Params:** `min_collateral_amount: u64` — minimum collateral the liquidator expects (slippage protection; `0` = disabled)

**Accounts:**

| Account | Writable | Signer | Description |
|---------|----------|--------|-------------|
| `config` | ✓ | | `StablecoinConfig` PDA |
| `cdp_position` | ✓ | | `CdpPosition` PDA for the underwater position |
| `collateral_vault` | ✓ | | `CollateralVault` PDA of the debtor |
| `vault_token_account` | ✓ | | Token account in debtor's vault |
| `sss_mint` | ✓ | | SSS-3 token mint |
| `liquidator_sss_account` | ✓ | | Liquidator's SSS-3 account (debt burned from here) |
| `liquidator_collateral_account` | ✓ | | Liquidator's collateral destination |
| `pyth_price_feed` | | | Pyth price account |
| `liquidator` | | ✓ | Liquidator wallet |
| `insurance_fund` | ✓ | | Optional: insurance fund vault (required if backstop may trigger) |
| `token_program` | | | Token-2022 program |

**Liquidation mechanics:**
- Liquidator burns full `debt_amount` (+ accrued fees) of SSS-3
- Liquidator receives all collateral at a 5% bonus (or CollateralConfig `liquidation_bonus_bps`)
- If collateral < debt (bad debt), triggers backstop via CPI

**Constraints:**
- Position must be liquidatable: collateral ratio < 120% (or CollateralConfig `liquidation_threshold_bps`)
- Pyth feed validated (same as `cdp_borrow_stable`)
- `collateral_to_liquidator >= min_collateral_amount`

**Events emitted:** `TokensBurned`, `BadDebtTriggered` (if backstop fires)

**Errors:** `CdpNotLiquidatable`, `InvalidPriceFeed`, `StalePriceFeed`, `InvalidPrice`, `OracleConfidenceTooWide`, `UnexpectedPriceFeed`, `SlippageExceeded`

---

#### `collect_stability_fee`

Accrue and burn stability fees on a CDP position. Callable by the debtor or any keeper; debtor must sign to authorize the burn.

**Accounts:**

| Account | Writable | Signer | Description |
|---------|----------|--------|-------------|
| `config` | | | `StablecoinConfig` PDA |
| `cdp_position` | ✓ | | `CdpPosition` PDA |
| `sss_mint` | ✓ | | SSS-3 token mint |
| `debtor_token_account` | ✓ | | Debtor's SSS-3 account (fee burned from here) |
| `debtor` | | ✓ | CDP owner (authorizes burn) |
| `token_program` | | | Token-2022 program |

**Fee calculation:**
- `elapsed = Clock::unix_timestamp - cdp_position.last_fee_accrual`
- `fee = debt_amount * stability_fee_bps / 10_000 * elapsed / 31_536_000` (annualized)
- Fees burned from debtor's account; `accrued_fees` and `last_fee_accrual` updated

**Errors:** `ZeroAmount` (if no fee to collect)

---

### CPI Composability Standard

Direction 3. External programs that integrate SSS should use these standardized entrypoints. The `required_version` guard prevents silent interface breaks.

---

#### `init_interface_version`

Initialize the `InterfaceVersion` PDA for a mint. One-time; authority only.

**Accounts:**

| Account | Writable | Signer | Description |
|---------|----------|--------|-------------|
| `config` | | | `StablecoinConfig` PDA |
| `interface_version` | ✓ | | `InterfaceVersion` PDA (init) |
| `mint` | | | SSS mint |
| `authority` | | ✓ | Must match `config.authority` |
| `system_program` | | | |

**Errors:** `Unauthorized`

---

#### `update_interface_version`

Bump the interface version or deprecate (set `active = false`). Authority only.

**Params:**

| Field | Type | Description |
|-------|------|-------------|
| `new_version` | `Option<u8>` | New version number (must be > current) |
| `active` | `Option<bool>` | `false` = mark as deprecated |

**Accounts:**

| Account | Writable | Signer | Description |
|---------|----------|--------|-------------|
| `config` | | | `StablecoinConfig` PDA |
| `interface_version` | ✓ | | `InterfaceVersion` PDA |
| `mint` | | | SSS mint |
| `authority` | | ✓ | Must match `config.authority` |

**Errors:** `Unauthorized`, `InterfaceNotInitialized`

---

#### `cpi_mint`

Standardized CPI mint entrypoint. Semantically identical to `mint` but validates `InterfaceVersion`.

**Params:**

| Field | Type | Description |
|-------|------|-------------|
| `amount` | `u64` | Tokens to mint |
| `required_version` | `u8` | Must match on-chain `InterfaceVersion.version` |

**Accounts:** Same as `mint`, plus `interface_version` PDA (read-only).

**Errors:** `InterfaceNotInitialized`, `InterfaceVersionMismatch`, `InterfaceDeprecated`, plus all `mint` errors.

---

#### `cpi_burn`

Standardized CPI burn entrypoint. Semantically identical to `burn` but validates `InterfaceVersion`.

**Params:**

| Field | Type | Description |
|-------|------|-------------|
| `amount` | `u64` | Tokens to burn |
| `required_version` | `u8` | Must match on-chain `InterfaceVersion.version` |

**Accounts:** Same as `burn`, plus `interface_version` PDA (read-only).

**Errors:** `InterfaceNotInitialized`, `InterfaceVersionMismatch`, `InterfaceDeprecated`, plus all `burn` errors.

---

### Feature Flags

Feature flags are stored as a bitmask in `StablecoinConfig.feature_flags`. See [Feature Flag Constants](#feature-flag-constants).

---

#### `set_feature_flag`

Enable a feature flag bit. Authority only.

**Params:** `flag: u64` — bitmask of flags to enable (use `FLAG_*` constants)

**Accounts:**

| Account | Writable | Signer | Description |
|---------|----------|--------|-------------|
| `config` | ✓ | | `StablecoinConfig` PDA |
| `mint` | | | SSS mint |
| `authority` | | ✓ | Must match `config.authority` |

**Constraints:** If `FLAG_DAO_COMMITTEE` is active, requires a passed `SetFeatureFlag` proposal.

**Errors:** `Unauthorized`, `DaoCommitteeRequired`

---

#### `clear_feature_flag`

Disable a feature flag bit. Authority only.

**Params:** `flag: u64` — bitmask of flags to disable

**Accounts:** Same as `set_feature_flag`.

**Constraints:** If `FLAG_DAO_COMMITTEE` is active, requires a passed `ClearFeatureFlag` proposal.

**Errors:** `Unauthorized`, `DaoCommitteeRequired`

---

#### `set_spend_limit`

Set the per-tx transfer cap and atomically enable `FLAG_SPEND_POLICY`. Authority only.

**Params:** `max_amount: u64` — must be > 0

**Accounts:**

| Account | Writable | Signer | Description |
|---------|----------|--------|-------------|
| `config` | ✓ | | `StablecoinConfig` PDA |
| `mint` | | | SSS mint |
| `authority` | | ✓ | Must match `config.authority` |

**Errors:** `Unauthorized`, `SpendPolicyNotConfigured` (if `max_amount == 0`)

---

#### `clear_spend_limit`

Clear the spend limit and disable `FLAG_SPEND_POLICY`. Authority only.

**Accounts:** Same as `set_spend_limit`.

**Errors:** `Unauthorized`

---

### DAO Committee Governance

When `FLAG_DAO_COMMITTEE` is set, the following admin operations require a passed on-chain proposal: `pause`, `unpause`, `update_minter`, `revoke_minter`, `set_feature_flag`, `clear_feature_flag`.

---

#### `init_dao_committee`

Initialize the DAO committee. One-time; authority only. Atomically enables `FLAG_DAO_COMMITTEE`.

**Params:**

| Field | Type | Description |
|-------|------|-------------|
| `members` | `Vec<Pubkey>` | Committee member pubkeys (1–10; no duplicates) |
| `quorum` | `u8` | Min YES votes required (1 ≤ quorum ≤ members.len()) |

**Accounts:**

| Account | Writable | Signer | Description |
|---------|----------|--------|-------------|
| `config` | ✓ | | `StablecoinConfig` PDA |
| `dao_committee` | ✓ | | `DaoCommitteeConfig` PDA (init) |
| `mint` | | | SSS mint |
| `authority` | | ✓ | Must match `config.authority` |
| `system_program` | | | |

**Errors:** `Unauthorized`, `InvalidQuorum`, `CommitteeFull`, `DuplicateMember`

---

#### `propose_action`

Open a governance proposal. Authority only.

**Params:**

| Field | Type | Description |
|-------|------|-------------|
| `action` | `ProposalAction` | Action enum variant |
| `param` | `u64` | Generic parameter (flag bits / minter cap; `0` if N/A) |
| `target` | `Pubkey` | Target pubkey (minter key; `Pubkey::default()` if N/A) |

**Accounts:**

| Account | Writable | Signer | Description |
|---------|----------|--------|-------------|
| `config` | | | `StablecoinConfig` PDA |
| `dao_committee` | ✓ | | `DaoCommitteeConfig` PDA |
| `proposal` | ✓ | | `ProposalPda` (init) |
| `mint` | | | SSS mint |
| `authority` | | ✓ | Must match `config.authority` |
| `system_program` | | | |

**Errors:** `Unauthorized`

---

#### `vote_action`

Cast a YES vote on a governance proposal. Caller must be a registered committee member.

**Params:** `proposal_id: u64`

**Accounts:**

| Account | Writable | Signer | Description |
|---------|----------|--------|-------------|
| `config` | | | `StablecoinConfig` PDA |
| `dao_committee` | | | `DaoCommitteeConfig` PDA |
| `proposal` | ✓ | | `ProposalPda` |
| `member` | | ✓ | Committee member wallet |

**Errors:** `NotACommitteeMember`, `AlreadyVoted`, `ProposalAlreadyExecuted`, `ProposalCancelled`

---

#### `execute_action`

Execute a passed governance proposal. Callable by anyone once quorum is reached.

**Params:** `proposal_id: u64`

**Accounts:**

| Account | Writable | Signer | Description |
|---------|----------|--------|-------------|
| `config` | ✓ | | `StablecoinConfig` PDA |
| `dao_committee` | | | `DaoCommitteeConfig` PDA |
| `proposal` | ✓ | | `ProposalPda` |
| `mint` | | | SSS mint |
| `caller` | | ✓ | Any wallet |
| *(additional accounts required per action)* | | | e.g. `minter_info` for `UpdateMinter`/`RevokeMinter` |

**Errors:** `QuorumNotReached`, `ProposalAlreadyExecuted`, `ProposalCancelled`

---

### Yield-Bearing Collateral

When `FLAG_YIELD_COLLATERAL` is enabled, CDP deposits only accept whitelisted yield-bearing mints (e.g. stSOL, mSOL, jitoSOL).

---

#### `init_yield_collateral`

Initialize yield-bearing collateral support. Atomically enables `FLAG_YIELD_COLLATERAL`. SSS-3 only; authority only.

**Params:** `initial_mints: Vec<Pubkey>` — up to 8 mints to whitelist immediately

**Accounts:**

| Account | Writable | Signer | Description |
|---------|----------|--------|-------------|
| `config` | ✓ | | `StablecoinConfig` PDA (preset 3) |
| `yield_collateral_config` | ✓ | | `YieldCollateralConfig` PDA (init) |
| `mint` | | | SSS mint |
| `authority` | | ✓ | Must match `config.authority` |
| `system_program` | | | |

**Errors:** `Unauthorized`, `WrongPreset`, `WhitelistFull`, `MintAlreadyWhitelisted`

---

#### `add_yield_collateral_mint`

Add a yield-bearing mint to the whitelist. `FLAG_YIELD_COLLATERAL` must already be enabled. Authority only.

**Params:** `collateral_mint: Pubkey`

**Accounts:**

| Account | Writable | Signer | Description |
|---------|----------|--------|-------------|
| `config` | | | `StablecoinConfig` PDA |
| `yield_collateral_config` | ✓ | | `YieldCollateralConfig` PDA |
| `mint` | | | SSS mint |
| `authority` | | ✓ | Must match `config.authority` |

**Errors:** `Unauthorized`, `YieldCollateralNotEnabled`, `WhitelistFull`, `MintAlreadyWhitelisted`

---

### ZK Compliance

SSS-2 only. When `FLAG_ZK_COMPLIANCE` is enabled, the transfer hook requires the sender to hold a valid `VerificationRecord` PDA on every transfer.

---

#### `init_zk_compliance`

Initialize ZK compliance. Atomically enables `FLAG_ZK_COMPLIANCE`. SSS-2 only; authority only.

**Params:**

| Field | Type | Description |
|-------|------|-------------|
| `ttl_slots` | `u64` | Proof validity window in slots (`0` = default 1500 ≈ 10 min) |
| `verifier_pubkey` | `Option<Pubkey>` | Required co-signer for proof submission (`None` = anyone may submit) |

**Accounts:**

| Account | Writable | Signer | Description |
|---------|----------|--------|-------------|
| `config` | ✓ | | `StablecoinConfig` PDA (preset 2) |
| `zk_compliance_config` | ✓ | | `ZkComplianceConfig` PDA (init) |
| `mint` | | | SSS mint |
| `authority` | | ✓ | Must match `config.authority` |
| `system_program` | | | |

**Errors:** `Unauthorized`, `WrongPreset`

---

#### `submit_zk_proof`

Submit or refresh a ZK compliance proof. Creates or updates the caller's `VerificationRecord` PDA. Any user may call (or optionally gated by `verifier_pubkey`).

**Accounts:**

| Account | Writable | Signer | Description |
|---------|----------|--------|-------------|
| `config` | | | `StablecoinConfig` PDA |
| `zk_compliance_config` | | | `ZkComplianceConfig` PDA |
| `verification_record` | ✓ | | `VerificationRecord` PDA (init or update) — seeds: `["zk-verification", sss_mint, user]` |
| `mint` | | | SSS mint |
| `user` | | ✓ | Wallet submitting the proof |
| `verifier` | | ✓ | Optional: must match `verifier_pubkey` if set |
| `system_program` | | | |

**Constraints:**
- `FLAG_ZK_COMPLIANCE` must be enabled
- If `verifier_pubkey` is set, `verifier` must sign

**Errors:** `ZkComplianceNotEnabled`, `ZkVerifierRequired`, `ZkVerifierMismatch`

---

#### `close_verification_record`

Close an expired `VerificationRecord` PDA, returning rent to authority. Authority only.

**Accounts:**

| Account | Writable | Signer | Description |
|---------|----------|--------|-------------|
| `config` | | | `StablecoinConfig` PDA |
| `verification_record` | ✓ | | `VerificationRecord` PDA (close) |
| `mint` | | | SSS mint |
| `authority` | | ✓ | Must match `config.authority` — receives rent |

**Constraints:**
- `Clock::slot >= verification_record.expires_at_slot` — record must be expired

**Errors:** `Unauthorized`, `VerificationRecordNotExpired`

---

### Admin Timelock

Critical admin operations (authority transfer, feature flag changes) are delayed by a minimum of `admin_timelock_delay` slots (default `432_000` ≈ 2 Solana epochs ≈ 2 days).

**Op kinds:**

| Kind | Value | Description |
|------|-------|-------------|
| `ADMIN_OP_NONE` | `0` | No pending operation |
| `ADMIN_OP_TRANSFER_AUTHORITY` | `1` | Transfer authority to `admin_op_target` |
| `ADMIN_OP_SET_FEATURE_FLAG` | `2` | Set feature flag bits in `admin_op_param` |
| `ADMIN_OP_CLEAR_FEATURE_FLAG` | `3` | Clear feature flag bits in `admin_op_param` |

---

#### `propose_timelocked_op`

Propose a timelocked admin operation. Starts the delay clock.

**Params:**

| Field | Type | Description |
|-------|------|-------------|
| `op_kind` | `u8` | Op discriminant (see table above) |
| `param` | `u64` | Generic param (flag bits for flag ops; `0` for authority transfer) |
| `target` | `Pubkey` | Target pubkey (new authority for transfer; `default` for flag ops) |

**Accounts:**

| Account | Writable | Signer | Description |
|---------|----------|--------|-------------|
| `config` | ✓ | | `StablecoinConfig` PDA |
| `mint` | | | SSS mint |
| `authority` | | ✓ | Must match `config.authority` |

**Post-state:** `config.admin_op_mature_slot = Clock::slot + admin_timelock_delay`

**Errors:** `Unauthorized`

---

#### `execute_timelocked_op`

Execute a pending timelocked admin operation after the delay has elapsed.

**Accounts:**

| Account | Writable | Signer | Description |
|---------|----------|--------|-------------|
| `config` | ✓ | | `StablecoinConfig` PDA |
| `mint` | | | SSS mint |
| `authority` | | ✓ | Must match `config.authority` |

**Constraints:** `Clock::slot >= config.admin_op_mature_slot`

**Errors:** `Unauthorized`, `NoTimelockPending`, `TimelockNotMature`

---

#### `cancel_timelocked_op`

Cancel a pending timelocked admin operation before execution.

**Accounts:** Same as `execute_timelocked_op`.

**Post-state:** Clears `admin_op_kind`, `admin_op_mature_slot`, `admin_op_param`, `admin_op_target`.

**Errors:** `Unauthorized`, `NoTimelockPending`

---

#### `set_pyth_feed`

Register the expected Pyth price feed pubkey for CDP operations. Authority only.

**Params:** `feed: Pubkey`

**Accounts:**

| Account | Writable | Signer | Description |
|---------|----------|--------|-------------|
| `config` | ✓ | | `StablecoinConfig` PDA |
| `mint` | | | SSS mint |
| `authority` | | ✓ | Must match `config.authority` |

**Errors:** `Unauthorized`

---

### Oracle Parameters

---

#### `set_oracle_params`

Configure oracle staleness and confidence band. Authority only.

**Params:**

| Field | Type | Description |
|-------|------|-------------|
| `max_age_secs` | `u32` | Max Pyth price age in seconds (`0` = default 60s) |
| `max_conf_bps` | `u16` | Max confidence/price ratio in bps (`0` = disabled) |

**Accounts:**

| Account | Writable | Signer | Description |
|---------|----------|--------|-------------|
| `config` | ✓ | | `StablecoinConfig` PDA |
| `mint` | | | SSS mint |
| `authority` | | ✓ | Must match `config.authority` |

**Errors:** `Unauthorized`

---

### Stability Fee

Annual fee accruing on CDP debt. Collected via `collect_stability_fee`. Max 2000 bps (20% p.a.).

---

#### `set_stability_fee`

Set the annual CDP stability fee. Authority only.

**Params:** `fee_bps: u16` — max `2000` (20% p.a.); `0` = no fee

**Accounts:**

| Account | Writable | Signer | Description |
|---------|----------|--------|-------------|
| `config` | ✓ | | `StablecoinConfig` PDA |
| `mint` | | | SSS mint |
| `authority` | | ✓ | Must match `config.authority` |

**Errors:** `Unauthorized`, `StabilityFeeTooHigh`

---

#### `set_psm_fee`

Set the PSM redemption fee. SSS-3 only; authority only.

**Params:** `fee_bps: u16` — max `1000` (10%); `0` = no fee

**Accounts:**

| Account | Writable | Signer | Description |
|---------|----------|--------|-------------|
| `config` | ✓ | | `StablecoinConfig` PDA |
| `mint` | | | SSS mint |
| `authority` | | ✓ | Must match `config.authority` |

**Events emitted:** `PsmFeeUpdated`

**Errors:** `Unauthorized`, `InvalidPsmFee`

---

#### `set_mint_velocity_limit`

Set a per-epoch velocity cap for a registered minter. Authority only.

**Params:** `max_mint_per_epoch: u64` — `0` = unlimited (disables limit)

**Accounts:**

| Account | Writable | Signer | Description |
|---------|----------|--------|-------------|
| `config` | | | `StablecoinConfig` PDA |
| `minter_info` | ✓ | | `MinterInfo` PDA for target minter |
| `mint` | | | SSS mint |
| `authority` | | ✓ | Must match `config.authority` |

**Events emitted:** `MintVelocityUpdated`

**Errors:** `Unauthorized`

---

### Bad Debt Backstop

Triggered automatically by `cdp_liquidate` when collateral < debt. Draws from an insurance fund vault to cover the shortfall.

---

#### `set_backstop_params`

Configure the insurance fund and max backstop draw. Authority only.

**Params:**

| Field | Type | Description |
|-------|------|-------------|
| `insurance_fund_pubkey` | `Pubkey` | Insurance fund vault token account (`Pubkey::default()` = disable backstop) |
| `max_backstop_bps` | `u16` | Max draw as % of net supply in bps (`0` = unlimited; max 10000) |

**Accounts:**

| Account | Writable | Signer | Description |
|---------|----------|--------|-------------|
| `config` | ✓ | | `StablecoinConfig` PDA |
| `mint` | | | SSS mint |
| `authority` | | ✓ | Must match `config.authority` |

**Errors:** `Unauthorized`, `InvalidBackstopBps`

---

#### `trigger_backstop`

Trigger the bad debt backstop after a liquidation leaves a shortfall. Only callable by the config PDA via CPI from `cdp_liquidate`. Emits `BadDebtTriggered`.

**Params:** `shortfall_amount: u64`

**Accounts:**

| Account | Writable | Signer | Description |
|---------|----------|--------|-------------|
| `config` | ✓ | | `StablecoinConfig` PDA (CPI signer) |
| `sss_mint` | ✓ | | SSS-3 token mint |
| `insurance_fund` | ✓ | | Insurance fund vault |
| `backstop_destination` | ✓ | | Token account to receive backstop funds |
| `collateral_mint` | | | Collateral mint |
| `token_program` | | | |

**Constraints:**
- Backstop must be configured (`insurance_fund_pubkey != default`)
- `shortfall_amount > 0`
- Insurance fund balance > 0
- Draw ≤ `max_backstop_bps` of net supply (if `max_backstop_bps > 0`)

**Errors:** `BackstopNotConfigured`, `NoBadDebt`, `InsuranceFundEmpty`, `UnauthorizedBackstopCaller`

---

### CollateralConfig PDA

Per-collateral on-chain configuration. When passed to `cdp_deposit_collateral`, enforces per-asset LTV, thresholds, and caps.

---

#### `register_collateral`

Register a new collateral type with per-collateral params. SSS-3; authority only.

**Params:**

| Field | Type | Description |
|-------|------|-------------|
| `collateral_mint` | `Pubkey` | Collateral token mint to register |
| `whitelisted` | `bool` | Whether deposits are allowed |
| `max_ltv_bps` | `u16` | Max LTV in bps (e.g. `7500` = 75%) |
| `liquidation_threshold_bps` | `u16` | Liquidation trigger in bps; must be > `max_ltv_bps` |
| `liquidation_bonus_bps` | `u16` | Liquidator bonus in bps (max 5000 = 50%) |
| `max_deposit_cap` | `u64` | Max total deposited for this collateral (`0` = unlimited) |

**Accounts:**

| Account | Writable | Signer | Description |
|---------|----------|--------|-------------|
| `config` | | | `StablecoinConfig` PDA |
| `collateral_config` | ✓ | | `CollateralConfig` PDA (init) |
| `mint` | | | SSS mint |
| `authority` | | ✓ | Must match `config.authority` |
| `system_program` | | | |

**Errors:** `Unauthorized`, `InvalidCollateralThreshold`, `InvalidLiquidationBonus`

---

#### `update_collateral_config`

Update an existing `CollateralConfig` PDA. SSS-3; authority only.

**Params:** Same fields as `register_collateral` (all optional updates).

**Accounts:**

| Account | Writable | Signer | Description |
|---------|----------|--------|-------------|
| `config` | | | `StablecoinConfig` PDA |
| `collateral_config` | ✓ | | `CollateralConfig` PDA (existing) |
| `mint` | | | SSS mint |
| `authority` | | ✓ | Must match `config.authority` |

**Errors:** `Unauthorized`, `InvalidCollateralThreshold`, `InvalidLiquidationBonus`

---

## Events

| Event | Emitted By | Fields |
|-------|-----------|--------|
| `TokenInitialized` | `initialize` | `mint`, `authority`, `preset`, `max_supply` |
| `TokensMinted` | `mint`, `cpi_mint`, `cdp_borrow_stable` | `mint`, `minter`, `recipient`, `amount`, `total_minted` |
| `TokensBurned` | `burn`, `cpi_burn`, `cdp_liquidate` | `mint`, `minter`, `amount`, `total_burned` |
| `AccountFrozen` | `freeze_account` | `mint`, `account` |
| `AccountThawed` | `thaw_account` | `mint`, `account` |
| `MintPausedEvent` | `pause`, `unpause` | `mint`, `paused` |
| `CollateralDeposited` | `deposit_collateral` | `mint`, `depositor`, `amount`, `total_collateral` |
| `CollateralRedeemed` | `redeem` | `mint`, `redeemer`, `amount`, `total_collateral` |
| `AuthorityProposed` | `update_roles` | `mint`, `proposed`, `is_compliance` |
| `AuthorityAccepted` | `accept_authority`, `accept_compliance_authority` | `mint`, `new_authority`, `is_compliance` |
| `PsmSwapEvent` | `redeem` | `mint`, `redeemer`, `sss_burned`, `collateral_out`, `fee_collected`, `fee_bps` |
| `PsmFeeUpdated` | `set_psm_fee` | `mint`, `old_fee_bps`, `new_fee_bps`, `authority` |
| `MintVelocityUpdated` | `set_mint_velocity_limit` | `mint`, `minter`, `max_mint_per_epoch`, `authority` |

---

## Errors

| Code | Name | Message |
|------|------|---------|
| 6000 | `Unauthorized` | Unauthorized: caller is not the authority |
| 6001 | `UnauthorizedCompliance` | Unauthorized: caller is not the compliance authority |
| 6002 | `NotAMinter` | Unauthorized: caller is not a registered minter |
| 6003 | `MintPaused` | Mint is paused |
| 6004 | `MinterCapExceeded` | Minter cap exceeded |
| 6005 | `WrongPreset` | SSS-2 feature not available on SSS-1 preset |
| 6006 | `MissingTransferHook` | Transfer hook program required for SSS-2 |
| 6007 | `InvalidPreset` | Invalid preset: must be 1 (SSS-1), 2 (SSS-2), or 3 (SSS-3) |
| 6008 | `ZeroAmount` | Amount must be greater than zero |
| 6009 | `InsufficientReserves` | Insufficient collateral in reserve vault to mint |
| 6010 | `InvalidCollateralMint` | Invalid collateral mint for this stablecoin |
| 6011 | `InvalidVault` | Invalid reserve vault account |
| 6012 | `MaxSupplyExceeded` | Max supply would be exceeded |
| 6013 | `NoPendingAuthority` | No pending authority transfer to accept |
| 6014 | `NoPendingComplianceAuthority` | No pending compliance authority transfer to accept |
| 6015 | `ReserveVaultRequired` | Reserve vault is required for SSS-3 |
| 6016 | `CollateralRatioTooLow` | Collateral ratio too low — minimum 150% required |
| 6017 | `CdpNotLiquidatable` | CDP is healthy — cannot be liquidated (ratio >= 120%) |
| 6018 | `InsufficientDebt` | Insufficient debt to repay requested amount |
| 6019 | `InsufficientCollateral` | Insufficient collateral deposited in vault |
| 6020 | `InvalidPriceFeed` | Invalid Pyth price feed account |
| 6021 | `StalePriceFeed` | Pyth price is stale or unavailable |
| 6022 | `InvalidPrice` | Price is zero or negative — cannot compute ratio |
| 6023 | `WrongCollateralMint` | Collateral mint does not match the position's locked collateral (SSS-054) |
| 6024 | `InterfaceNotInitialized` | InterfaceVersion PDA not initialized |
| 6025 | `InterfaceVersionMismatch` | InterfaceVersion mismatch — caller pinned to incompatible version |
| 6026 | `InterfaceDeprecated` | This SSS interface has been deprecated |
| 6027 | `CircuitBreakerActive` | Circuit breaker is active: mint/burn are halted |
| 6028 | `SpendLimitExceeded` | Spend policy: transfer amount exceeds max_transfer_amount |
| 6029 | `SpendPolicyNotConfigured` | Spend policy: max_transfer_amount must be > 0 before enabling |
| 6030 | `DaoCommitteeRequired` | DAO committee is active: admin op requires a passed proposal |
| 6031 | `NotACommitteeMember` | Caller is not a registered committee member |
| 6032 | `AlreadyVoted` | Committee member has already voted on this proposal |
| 6033 | `ProposalAlreadyExecuted` | Proposal has already been executed |
| 6034 | `ProposalCancelled` | Proposal has been cancelled |
| 6035 | `QuorumNotReached` | Quorum not reached: not enough YES votes |
| 6036 | `InvalidQuorum` | Quorum must be at least 1 and at most members.len() |
| 6037 | `CommitteeFull` | Committee member list is full (max 10) |
| 6038 | `MemberNotFound` | Member not found in committee |
| 6039 | `ProposalActionMismatch` | Proposal action does not match the guarded instruction |
| 6040 | `YieldCollateralNotEnabled` | FLAG_YIELD_COLLATERAL is not enabled |
| 6041 | `CollateralMintNotWhitelisted` | Collateral mint is not on the yield-bearing whitelist |
| 6042 | `WhitelistFull` | Yield collateral whitelist is full (max 8 mints) |
| 6043 | `MintAlreadyWhitelisted` | Collateral mint is already on the whitelist |
| 6044 | `ZkComplianceNotEnabled` | FLAG_ZK_COMPLIANCE is not enabled |
| 6045 | `VerificationExpired` | ZK verification record has expired |
| 6046 | `VerificationRecordNotExpired` | ZK verification record has not expired yet |
| 6047 | `VerificationRecordMissing` | ZK verification record is missing for this user |
| 6048 | `ZkVerifierRequired` | ZK proof submission requires a verifier co-signature |
| 6049 | `ZkVerifierMismatch` | ZK proof verifier account does not match verifier_pubkey |
| 6050 | `UnexpectedPriceFeed` | Price feed account does not match expected_pyth_feed |
| 6051 | `OracleConfidenceTooWide` | Pyth price confidence interval is too wide |
| 6052 | `TimelockNotMature` | Admin timelock: operation not yet mature |
| 6053 | `NoTimelockPending` | No pending timelocked operation to execute |
| 6054 | `DuplicateMember` | Duplicate pubkey in DAO committee member list |
| 6055 | `SlippageExceeded` | Liquidation slippage: collateral received below caller-specified minimum |
| 6056 | `InvalidTokenProgram` | Token program must be Token-2022 |
| 6057 | `StabilityFeeTooHigh` | Stability fee bps exceeds maximum allowed (2000 = 20% p.a.) |
| 6058 | `MintVelocityExceeded` | Minter epoch velocity limit exceeded |
| 6059 | `InvalidPsmFee` | PSM redemption fee too high — max 1000 bps (10%) |
| 6060 | `BackstopNotConfigured` | Bad debt backstop is not configured |
| 6061 | `NoBadDebt` | No bad debt detected — collateral covers outstanding debt |
| 6062 | `InsuranceFundEmpty` | Insurance fund balance is zero |
| 6063 | `InvalidBackstopBps` | max_backstop_bps exceeds maximum allowed (10000 = 100%) |
| 6064 | `UnauthorizedBackstopCaller` | Caller is not the liquidation handler |
| 6065 | `CollateralNotWhitelisted` | Collateral mint is not whitelisted in CollateralConfig |
| 6066 | `DepositCapExceeded` | CollateralConfig deposit cap exceeded |
| 6067 | `InvalidCollateralThreshold` | liquidation_threshold_bps must be > max_ltv_bps |
| 6068 | `InvalidLiquidationBonus` | liquidation_bonus_bps cannot exceed 5000 (50%) |

---

## Feature Flag Constants

Bitmask values for `StablecoinConfig.feature_flags`:

| Constant | Bit | Value | Description |
|----------|-----|-------|-------------|
| `FLAG_CIRCUIT_BREAKER` | 0 | `1` | All mint/transfer/burn ops fail while set |
| `FLAG_SPEND_POLICY` | 1 | `2` | Per-tx transfer capped at `max_transfer_amount` |
| `FLAG_DAO_COMMITTEE` | 2 | `4` | Admin ops require passed governance proposals |
| `FLAG_YIELD_COLLATERAL` | 3 | `8` | CDP only accepts whitelisted yield-bearing mints |
| `FLAG_ZK_COMPLIANCE` | 4 | `16` | Transfers require valid `VerificationRecord` |

---

*Generated from source: `programs/sss-token/src/lib.rs`, `state.rs`, `error.rs`, `events.rs`, and all instruction modules. Last updated: 2026-03-16.*

# SSS Protocol Specification

> **Document type:** Canonical protocol specification
> **Version:** 0.1 (2026-03-16)
> **Status:** Draft — describes the current reference implementation
> **Author:** sss-docs
> **Reference implementation:** `AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat` (sss-token), `phAtzRyRUJGpMC3ftAtWzoaX7UkghRe9x5KTig8jPQp` (sss-transfer-hook)

---

## 1. Scope and Goals

The Solana Stablecoin Standard (SSS) is an on-chain protocol for issuing, managing, and enforcing compliance for stablecoins on Solana using the Token-2022 program. SSS defines:

1. A **preset taxonomy** — three named configurations (SSS-1, SSS-2, SSS-3) each expressing a different trust and compliance posture
2. **On-chain account schemas** — authoritative layouts for all program-derived accounts
3. **Instruction semantics** — preconditions, state transitions, and postconditions for every instruction
4. **Error codes** — exhaustive enumeration of all protocol-level errors
5. **Protocol invariants** — properties the protocol guarantees regardless of caller

This document is the foundation for third-party audits, formal verification, integrator certification, and future SSS Improvement Proposals. For developer integration patterns, see [INTEGRATION-GUIDE.md](./INTEGRATION-GUIDE.md) (forthcoming). For authority management, see [SECURITY.md](./SECURITY.md).

---

## 2. Definitions

| Term | Definition |
|------|-----------|
| **Mint** | A Token-2022 mint account whose lifecycle is governed by an SSS `StablecoinConfig` PDA |
| **StablecoinConfig** | PDA owned by `sss-token` that records the preset, authorities, and global state for a mint |
| **MinterInfo** | PDA per (config, minter) that records the minter's cap and cumulative minted amount |
| **BlacklistState** | PDA owned by `sss-transfer-hook` that records blacklisted addresses for an SSS-2 mint |
| **Preset** | A named combination of Token-2022 extensions + program behavior; currently SSS-1, SSS-2, SSS-3 |
| **Authority** | The Solana keypair permitted to perform administrative operations (update minters, update roles, pause) |
| **Compliance authority** | The Solana keypair permitted to perform compliance operations (freeze, thaw, blacklist management) |
| **Minter** | A Solana keypair registered in `MinterInfo` that can call `mint` and `burn` |
| **Cap** | Maximum tokens a minter may mint in total (0 = unlimited) |
| **Paused** | A boolean flag on `StablecoinConfig`; when true, `mint` and `burn` are rejected |
| **Feature flags** | A bitmask on `StablecoinConfig` enabling optional protocol extensions (circuit breaker, spend policy, DAO governance, yield collateral, ZK compliance) |
| **CDP** | Collateralized Debt Position (SSS-3): a user vault that holds collateral and tracks outstanding borrowed stablecoin debt |
| **CollateralRatio** | (collateral_value / outstanding_debt) × 100, expressed as a percentage |
| **Epoch velocity** | Cumulative mint amount within the current Solana epoch, used for rate-limiting |

---

## 3. Preset Taxonomy

### 3.1 SSS-1 — Minimal

**Preset discriminant:** `1`

A Token-2022 mint with the minimum feature set for any production token.

**Required Token-2022 extensions:** Freeze authority · MetadataPointer + TokenMetadata

**Program behaviors:**
- `mint` and `burn` are available to registered minters
- `pause`/`unpause` halts/resumes `mint` and `burn` globally
- `freeze_account`/`thaw_account` freeze individual token accounts
- Minter caps enforced on-chain: `minted + amount ≤ cap` (when `cap > 0`)
- No transfer restrictions beyond Token-2022 freeze

**Not available on SSS-1:** `blacklist_add`, `blacklist_remove`, any transfer hook behavior

**`transfer_hook_program` field:** `Pubkey::default()` (all zeros)

---

### 3.2 SSS-2 — Compliant

**Preset discriminant:** `2`

Extends SSS-1 with on-chain transfer enforcement via the Token-2022 Transfer Hook interface.

**Required Token-2022 extensions:** Freeze authority · MetadataPointer + TokenMetadata · PermanentDelegate · TransferHook

**Additional program requirements:**
- `transfer_hook_program` must be set to a deployed `sss-transfer-hook` program at initialization
- `sss-transfer-hook::initialize_extra_account_meta_list` must be called after `initialize` to create the `BlacklistState` PDA

**Program behaviors (in addition to SSS-1):**
- Every token transfer on the mint invokes the transfer hook inside the same transaction
- The transfer hook reads `BlacklistState` and rejects if sender or receiver is blacklisted
- Blacklist checks happen at the Token-2022 / runtime level — no application-layer bypass is possible
- `PermanentDelegate` extension allows compliance authority to move or burn tokens from any account

**SSS-2 compliance guarantee:** A blacklisted address cannot send or receive tokens from this mint, regardless of which wallet, DEX, bridge, or program initiates the transfer.

---

### 3.3 SSS-3 — Reserve-Backed (Trustless Collateral)

**Preset discriminant:** `3`

Extends SSS-2 with on-chain collateral reserve enforcement. SSS-3 is the reference design for a trustlessly over-collateralized stablecoin.

**Additional features beyond SSS-2:**
- A `reserve_vault` token account holds collateral; its balance is read by `sss-token` inside the `mint` instruction
- `mint` verifies `(total_minted - total_burned + amount) ≤ total_collateral` before minting; no oracle required
- `deposit_collateral` / `redeem` manage the reserve vault
- CDP module available: users deposit per-collateral vaults and borrow stablecoin against them; Pyth price feed used for collateral valuation
- Confidential transfers (ElGamal ZK proofs) optionally available via Token-2022

**`collateral_mint` field:** SPL token mint used as reserve collateral (e.g., USDC)
**`reserve_vault` field:** Token account holding deposited collateral

---

### 3.4 Feature Flag Extensions (all presets)

Feature flags are enabled/disabled by the authority on any preset. They augment behavior beyond the base preset.

| Flag | Bit | Description |
|------|-----|-------------|
| `FLAG_CIRCUIT_BREAKER` | 0 | Halt all mint/burn/transfer operations immediately |
| `FLAG_SPEND_POLICY` | 1 | Cap per-transfer token amount at `max_transfer_amount` |
| `FLAG_DAO_COMMITTEE` | 2 | Require on-chain quorum proposal for admin operations |
| `FLAG_YIELD_COLLATERAL` | 3 | Restrict CDP collateral to whitelisted yield-bearing tokens (SSS-3) |
| `FLAG_ZK_COMPLIANCE` | 4 | Require valid ZK verification record for transfer-hook approval (SSS-2) |

---

## 4. Account Schemas

### 4.1 `StablecoinConfig`

**Program:** `sss-token`
**Seeds:** `["stablecoin-config", mint]`
**Discriminator:** `[0x7f, 0x19, 0xf4, 0xd5, 0x01, 0xc0, 0x65, 0x06]`

Borsh-serialized layout (all offsets from account data start, discriminator at offset 0):

| Offset | Size | Field | Type | Notes |
|--------|------|-------|------|-------|
| 0 | 8 | discriminator | `[u8; 8]` | Anchor account discriminator |
| 8 | 32 | `mint` | `Pubkey` | Token-2022 mint address |
| 40 | 32 | `authority` | `Pubkey` | Admin authority |
| 72 | 32 | `compliance_authority` | `Pubkey` | Compliance authority |
| 104 | 1 | `preset` | `u8` | 1, 2, or 3 |
| 105 | 1 | `paused` | `bool` | true = mint/burn halted |
| 106 | 8 | `total_minted` | `u64` | Cumulative minted tokens |
| 114 | 8 | `total_burned` | `u64` | Cumulative burned tokens |
| 122 | 32 | `transfer_hook_program` | `Pubkey` | SSS-2/3 only; default all-zeros |
| 154 | 32 | `collateral_mint` | `Pubkey` | SSS-3 only; default all-zeros |
| 186 | 32 | `reserve_vault` | `Pubkey` | SSS-3 only; default all-zeros |
| 218 | 8 | `total_collateral` | `u64` | SSS-3: deposited collateral |
| 226 | 8 | `max_supply` | `u64` | 0 = unlimited |
| 234 | 32 | `pending_authority` | `Pubkey` | Two-step transfer; default all-zeros |
| 266 | 32 | `pending_compliance_authority` | `Pubkey` | Two-step transfer; default all-zeros |
| 298 | 8 | `feature_flags` | `u64` | Bitmask; see §3.4 |
| 306 | 8 | `max_transfer_amount` | `u64` | FLAG_SPEND_POLICY: max tokens/transfer |
| 314 | 32 | `expected_pyth_feed` | `Pubkey` | CDP: pinned Pyth price feed; default = disabled |
| 346 | 8 | `admin_op_mature_slot` | `u64` | Timelock: slot when op matures; 0 = none |
| 354 | 1 | `admin_op_kind` | `u8` | Timelock: 0=none, 1=transfer_authority, 2=set_flag, 3=clear_flag |
| 355 | 8 | `admin_op_param` | `u64` | Timelock: generic parameter |
| 363 | 32 | `admin_op_target` | `Pubkey` | Timelock: target pubkey |
| 395 | 8 | `admin_timelock_delay` | `u64` | Minimum slot delay; default 432,000 (~2 epochs) |
| 403 | 4 | `max_oracle_age_secs` | `u32` | CDP: max Pyth price age; 0 = use default 60s |
| 407 | 2 | `max_oracle_conf_bps` | `u16` | CDP: max Pyth confidence interval bps; 0 = disabled |
| 409 | 2 | `stability_fee_bps` | `u16` | CDP: annual stability fee bps; 0 = no fee |
| 411 | 2 | `redemption_fee_bps` | `u16` | PSM: fee on redeem bps; 0 = no fee |
| 413 | 32 | `insurance_fund_pubkey` | `Pubkey` | Backstop fund vault; default = disabled |

---

### 4.2 `MinterInfo`

**Program:** `sss-token`
**Seeds:** `["minter-info", config, minter]`

| Field | Type | Notes |
|-------|------|-------|
| `config` | `Pubkey` | The `StablecoinConfig` PDA this minter belongs to |
| `minter` | `Pubkey` | The minter's wallet address |
| `cap` | `u64` | Maximum tokens this minter may mint (0 = unlimited) |
| `minted` | `u64` | Cumulative tokens minted by this minter |

**Invariant:** `minted ≤ cap` when `cap > 0`.

---

### 4.3 `BlacklistState`

**Program:** `sss-transfer-hook`
**Seeds:** `["blacklist-state", mint]`

Stores a dynamic set of blacklisted `Pubkey` values. The account is initialized by `initialize_extra_account_meta_list` and managed by `blacklist_add` / `blacklist_remove` (compliance authority only).

**Invariant:** Every transfer on an SSS-2/3 mint that involves a key present in `BlacklistState` is rejected with error `6000` (sender) or `6001` (receiver).

---

## 5. Instruction Semantics

### 5.1 `initialize`

**Program:** `sss-token`
**Authority:** caller (becomes `authority` and `compliance_authority`)

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `preset` | `u8` | ✓ | 1, 2, or 3 |
| `name` | `String` | ✓ | Token metadata name |
| `symbol` | `String` | ✓ | Token metadata symbol |
| `uri` | `String` | ✓ | Metadata URI |
| `decimals` | `u8` | ✓ | Token decimals |
| `transfer_hook_program` | `Pubkey` | SSS-2 only | Must be non-default for preset=2 |
| `collateral_mint` | `Pubkey` | SSS-3 only | Collateral token mint |
| `reserve_vault` | `Pubkey` | SSS-3 only | Pre-created collateral token account |

**Preconditions:**
1. `preset` ∈ {1, 2, 3}; else `InvalidPreset`
2. If `preset = 2`: `transfer_hook_program ≠ Pubkey::default()`; else `MissingTransferHook`
3. If `preset = 3`: `reserve_vault ≠ Pubkey::default()`; else `ReserveVaultRequired`

**State transitions:**
- Creates Token-2022 mint account with appropriate extensions for preset
- Creates `StablecoinConfig` PDA with all fields set per parameters
- `paused = false`, `total_minted = 0`, `total_burned = 0`

---

### 5.2 `mint`

**Program:** `sss-token`
**Authority:** registered minter

**Preconditions (checked in order):**
1. `config.paused = false`; else `MintPaused`
2. `FLAG_CIRCUIT_BREAKER` not set; else `CircuitBreakerActive`
3. Caller has a valid `MinterInfo` PDA; else `NotAMinter`
4. `minter_info.minted + amount ≤ minter_info.cap` when `cap > 0`; else `MinterCapExceeded`
5. `amount > 0`; else `ZeroAmount`
6. If `config.max_supply > 0`: `total_minted - total_burned + amount ≤ max_supply`; else `MaxSupplyExceeded`
7. If `preset = 3` (reserve-backed): `total_minted - total_burned + amount ≤ total_collateral`; else `InsufficientReserves`
8. Epoch velocity: `epoch_minted + amount ≤ epoch_cap` when velocity tracking active; else `MintVelocityExceeded`

**State transitions:**
- CPI → Token-2022 `MintTo`: recipient token account balance += amount
- `config.total_minted += amount`
- `minter_info.minted += amount`

---

### 5.3 `burn`

**Program:** `sss-token`
**Authority:** registered minter

**Preconditions:**
1. `config.paused = false`; else `MintPaused`
2. `FLAG_CIRCUIT_BREAKER` not set; else `CircuitBreakerActive`
3. Caller has a valid `MinterInfo` PDA; else `NotAMinter`
4. `amount > 0`; else `ZeroAmount`

**State transitions:**
- CPI → Token-2022 `Burn`: source token account balance -= amount
- `config.total_burned += amount`

---

### 5.4 `freeze_account` / `thaw_account`

**Program:** `sss-token`
**Authority:** compliance authority

**Preconditions:**
- Caller = `config.compliance_authority`; else `UnauthorizedCompliance`

**State transitions:**
- CPI → Token-2022 `FreezeAccount` / `ThawAccount`

---

### 5.5 `pause` / `unpause`

**Program:** `sss-token`
**Authority:** authority (or DAO committee when `FLAG_DAO_COMMITTEE` is set)

**Preconditions:**
- Caller = `config.authority`; else `Unauthorized`
- If `FLAG_DAO_COMMITTEE` is set: a passed proposal with matching action must exist; else `DaoCommitteeRequired`

**State transitions:**
- `config.paused = true` (`pause`) or `false` (`unpause`)

---

### 5.6 `update_minter`

**Program:** `sss-token`
**Authority:** authority

**Preconditions:**
- Caller = `config.authority`; else `Unauthorized`

**State transitions:**
- Creates or updates `MinterInfo` PDA for `(config, minter)` with `cap = cap`

---

### 5.7 `revoke_minter`

**Program:** `sss-token`
**Authority:** authority

**Preconditions:**
- Caller = `config.authority`; else `Unauthorized`

**State transitions:**
- Closes `MinterInfo` PDA for `(config, minter)`

---

### 5.8 `update_roles`

**Program:** `sss-token`
**Authority:** authority

Initiates a two-step authority transfer. Sets `config.pending_authority` and/or `config.pending_compliance_authority`. The transfer is not complete until the pending key calls `accept_authority` or `accept_compliance_authority`.

**Preconditions:**
- Caller = `config.authority`; else `Unauthorized`

---

### 5.9 `accept_authority` / `accept_compliance_authority`

**Program:** `sss-token`
**Authority:** pending authority

**Preconditions:**
- `config.pending_authority ≠ Pubkey::default()`; else `NoPendingAuthority`
- Caller = `config.pending_authority`; else `Unauthorized`

**State transitions:**
- `config.authority = caller` (or `compliance_authority = caller`)
- `config.pending_authority = Pubkey::default()`

---

### 5.10 `deposit_collateral` (SSS-3)

**Program:** `sss-token`
**Authority:** any caller

**Preconditions:**
- `config.preset = 3`; else `WrongPreset`
- `amount > 0`; else `ZeroAmount`
- Source token account's mint = `config.collateral_mint`; else `InvalidCollateralMint`
- Destination = `config.reserve_vault`; else `InvalidVault`

**State transitions:**
- CPI → Token-2022 `Transfer`: `amount` collateral tokens moved caller → reserve_vault
- `config.total_collateral += amount`

---

### 5.11 `redeem` (SSS-3)

**Program:** `sss-token`
**Authority:** registered minter

**Preconditions:**
- `config.preset = 3`; else `WrongPreset`
- `amount > 0`; else `ZeroAmount`
- `config.total_collateral ≥ amount` (after fee deduction); else `InsufficientCollateral`
- If `redemption_fee_bps > 0`: fee deducted from collateral released; fee remains in vault

**State transitions:**
- Burns `amount` stablecoin tokens from caller
- Releases `amount - fee` collateral from reserve_vault to caller
- `config.total_collateral -= (amount - fee)`
- `config.total_burned += amount`

---

### 5.12 Transfer Hook (SSS-2/3)

**Program:** `sss-transfer-hook`
**Invoked by:** Token-2022 runtime (not directly callable)

**Preconditions evaluated on every token transfer:**
1. If `FLAG_CIRCUIT_BREAKER` set in `StablecoinConfig`: reject `CircuitBreakerActive` (6003, custom)
2. If `FLAG_SPEND_POLICY` set and `amount > max_transfer_amount`: reject `SpendLimitExceeded`
3. If sender in `BlacklistState`: reject `SenderBlacklisted` (error 6000)
4. If receiver in `BlacklistState`: reject `ReceiverBlacklisted` (error 6001)
5. If `FLAG_ZK_COMPLIANCE` set: sender must have a non-expired `VerificationRecord` PDA; else `VerificationExpired` or `VerificationRecordMissing`

**State transitions:** None if all checks pass. Transaction aborts on any failure.

---

## 6. Error Codes

All errors from `sss-token` are `anchor_lang` error codes starting at offset 6000.

| Code | Name | Description |
|------|------|-------------|
| 6000 | `Unauthorized` | Caller is not the authority |
| 6001 | `UnauthorizedCompliance` | Caller is not the compliance authority |
| 6002 | `NotAMinter` | Caller is not a registered minter |
| 6003 | `MintPaused` | Mint is paused |
| 6004 | `MinterCapExceeded` | Minter's cumulative cap exceeded |
| 6005 | `WrongPreset` | Feature not available on this preset |
| 6006 | `MissingTransferHook` | Transfer hook program required for SSS-2 |
| 6007 | `InvalidPreset` | Preset must be 1, 2, or 3 |
| 6008 | `ZeroAmount` | Amount must be > 0 |
| 6009 | `InsufficientReserves` | SSS-3: collateral insufficient to mint |
| 6010 | `InvalidCollateralMint` | Source token is not the registered collateral mint |
| 6011 | `InvalidVault` | Vault account does not match registered reserve_vault |
| 6012 | `MaxSupplyExceeded` | Mint would exceed max_supply |
| 6013 | `NoPendingAuthority` | No pending authority transfer to accept |
| 6014 | `NoPendingComplianceAuthority` | No pending compliance authority transfer to accept |
| 6015 | `ReserveVaultRequired` | SSS-3 requires reserve_vault at init |
| 6016 | `CollateralRatioTooLow` | CDP: min 150% collateral ratio required |
| 6017 | `CdpNotLiquidatable` | CDP ratio ≥ 120%; cannot liquidate |
| 6018 | `InsufficientDebt` | Repay amount exceeds outstanding CDP debt |
| 6019 | `InsufficientCollateral` | Insufficient collateral deposited |
| 6020 | `InvalidPriceFeed` | Pyth price feed account invalid |
| 6021 | `StalePriceFeed` | Pyth price is stale or unavailable |
| 6022 | `InvalidPrice` | Pyth price is zero or negative |
| 6023 | `WrongCollateralMint` | CDP: collateral mint mismatch |
| 6024 | `InterfaceNotInitialized` | CPI: InterfaceVersion PDA not initialized |
| 6025 | `InterfaceVersionMismatch` | CPI: caller pinned to incompatible version |
| 6026 | `InterfaceDeprecated` | CPI: this interface version is deprecated |
| 6027 | `CircuitBreakerActive` | Circuit breaker halted all operations |
| 6028 | `SpendLimitExceeded` | Transfer amount exceeds max_transfer_amount |
| 6029 | `SpendPolicyNotConfigured` | FLAG_SPEND_POLICY requires max_transfer_amount > 0 |
| 6030 | `DaoCommitteeRequired` | Admin op requires on-chain quorum proposal |
| 6031 | `NotACommitteeMember` | Caller not in DAO committee |
| 6032 | `AlreadyVoted` | Committee member already voted on this proposal |
| 6033 | `ProposalAlreadyExecuted` | Proposal already executed |
| 6034 | `ProposalCancelled` | Proposal has been cancelled |
| 6035 | `QuorumNotReached` | Insufficient YES votes |
| 6036 | `InvalidQuorum` | Quorum must be ≥ 1 and ≤ committee size |
| 6037 | `CommitteeFull` | Max 10 committee members |
| 6038 | `MemberNotFound` | Member not in committee |
| 6039 | `ProposalActionMismatch` | Proposal action does not match guarded instruction |
| 6040 | `YieldCollateralNotEnabled` | FLAG_YIELD_COLLATERAL not set |
| 6041 | `CollateralMintNotWhitelisted` | Collateral mint not in yield whitelist |
| 6042 | `WhitelistFull` | Yield collateral whitelist full (max 8) |
| 6043 | `MintAlreadyWhitelisted` | Mint already in yield whitelist |
| 6044 | `ZkComplianceNotEnabled` | FLAG_ZK_COMPLIANCE not set |
| 6045 | `VerificationExpired` | ZK verification record expired |
| 6046 | `VerificationRecordNotExpired` | ZK record not yet expired; cannot close |
| 6047 | `VerificationRecordMissing` | No ZK verification record for this user |
| 6048 | `ZkVerifierRequired` | ZK proof requires verifier co-signature |
| 6049 | `ZkVerifierMismatch` | Verifier account does not match configured verifier_pubkey |
| 6050 | `UnexpectedPriceFeed` | Pyth feed does not match expected_pyth_feed |
| 6051 | `OracleConfidenceTooWide` | Pyth confidence interval exceeds max_oracle_conf_bps |
| 6052 | `TimelockNotMature` | Admin timelock operation not yet matured |
| 6053 | `NoTimelockPending` | No pending timelocked operation to execute |
| 6054 | `DuplicateMember` | Duplicate pubkey in DAO committee |
| 6055 | `SlippageExceeded` | Liquidation collateral received below caller minimum |
| 6056 | `InvalidTokenProgram` | Token program must be Token-2022 |
| 6057 | `StabilityFeeTooHigh` | Stability fee exceeds max 2000 bps (20% p.a.) |
| 6058 | `MintVelocityExceeded` | Epoch mint velocity limit exceeded |
| 6059 | `InvalidPsmFee` | PSM fee exceeds max 1000 bps (10%) |
| 6060 | `BackstopNotConfigured` | Insurance fund not configured |
| 6061 | `NoBadDebt` | No bad debt detected; collateral covers debt |
| 6062 | `InsuranceFundEmpty` | Insurance fund balance is zero |
| 6063 | `InvalidBackstopBps` | max_backstop_bps exceeds 10000 |
| 6064 | `UnauthorizedBackstopCaller` | Only cdp_liquidate may trigger backstop |
| 6065 | `CollateralNotWhitelisted` | Collateral mint not in CollateralConfig whitelist |
| 6066 | `DepositCapExceeded` | CollateralConfig deposit cap exceeded |
| 6067 | `InvalidCollateralThreshold` | liquidation_threshold_bps must be > max_ltv_bps |
| 6068 | `InvalidLiquidationBonus` | liquidation_bonus_bps cannot exceed 5000 (50%) |
| 6069 | `PartialLiquidationInsufficientRepay` | Partial liquidation does not restore healthy ratio |
| 6070 | `InvalidAmount` | Amount exceeds total outstanding debt |

**Transfer hook errors** (from `sss-transfer-hook`):

| Code | Name | Description |
|------|------|-------------|
| 6000 | `SenderBlacklisted` | Transfer sender is blacklisted |
| 6001 | `ReceiverBlacklisted` | Transfer receiver is blacklisted |

---

## 7. Token-2022 Extension Requirements per Preset

| Extension | SSS-1 | SSS-2 | SSS-3 |
|-----------|:-----:|:-----:|:-----:|
| FreezeAuthority | ✅ required | ✅ required | ✅ required |
| MetadataPointer | ✅ required | ✅ required | ✅ required |
| TokenMetadata | ✅ required | ✅ required | ✅ required |
| PermanentDelegate | ❌ | ✅ required | ✅ required |
| TransferHook | ❌ | ✅ required | ✅ required |
| ConfidentialTransfers | ❌ | ❌ | ⚠️ optional |
| DefaultAccountState (Frozen) | ❌ | ⚠️ optional | ⚠️ optional |
| MintCloseAuthority | ❌ | ❌ | ❌ |

---

## 8. Protocol Invariants

The following properties hold for every SSS-compliant mint at all times, regardless of caller or transaction:

| # | Invariant | Enforced by |
|---|-----------|-------------|
| I-1 | `total_minted ≥ total_burned` (no net negative supply) | Anchor checked arithmetic |
| I-2 | `minter_info.minted ≤ minter_info.cap` when `cap > 0` | `mint` precondition |
| I-3 | When `paused = true`, no `mint` or `burn` instruction succeeds | `mint`/`burn` precondition |
| I-4 | When `FLAG_CIRCUIT_BREAKER` is set, no `mint`, `burn`, or token transfer succeeds | `mint`/`burn` precondition + transfer hook |
| I-5 | On SSS-2/3, a blacklisted address cannot send or receive tokens in any transaction | Transfer hook (Token-2022 runtime) |
| I-6 | On SSS-3, `total_minted - total_burned + amount ≤ total_collateral` for any successful `mint` | `mint` precondition |
| I-7 | Authority and compliance authority can only be changed via two-step transfer (propose + accept) | `update_roles` + `accept_authority` |
| I-8 | When `FLAG_DAO_COMMITTEE` is set, admin operations require a passed on-chain proposal | Instruction preconditions |
| I-9 | On SSS-2/3 with `FLAG_ZK_COMPLIANCE`, transfers require a non-expired ZK verification record | Transfer hook |
| I-10 | Timelocked admin operations cannot execute before `admin_op_mature_slot` | `execute_timelocked_op` precondition |

---

## 9. Program Derived Addresses — Canonical Seeds

| Account | Seeds | Program |
|---------|-------|---------|
| `StablecoinConfig` | `["stablecoin-config", mint_pubkey]` | `sss-token` |
| `MinterInfo` | `["minter-info", config_pubkey, minter_pubkey]` | `sss-token` |
| `BlacklistState` | `["blacklist-state", mint_pubkey]` | `sss-transfer-hook` |
| `ExtraAccountMetaList` | (Token-2022 transfer hook standard) | `sss-transfer-hook` |
| `VerificationRecord` | `["zk-verification", config_pubkey, user_pubkey]` | `sss-token` |
| `CollateralVault` (CDP) | `["collateral-vault", config_pubkey, user_pubkey, collateral_mint_pubkey]` | `sss-token` |
| `CollateralConfig` | `["collateral-config", config_pubkey, collateral_mint_pubkey]` | `sss-token` |
| `InterfaceVersion` | `["interface-version", config_pubkey]` | `sss-token` |

---

## 10. Out of Scope

This specification covers the on-chain `sss-token` and `sss-transfer-hook` programs and their derived accounts.

Not covered here:
- REST backend API endpoints — see [api.md](./api.md)
- TypeScript SDK method signatures — see [on-chain-sdk-*.md](./on-chain-sdk-core.md)
- CLI usage — see [sdk-cli.md](./sdk-cli.md)
- Deployment procedures — see [DEPLOYMENT-GUIDE.md](./DEPLOYMENT-GUIDE.md)
- Formal verification proofs — see [formal-verification.md](./formal-verification.md)
- Governance and authority management — see [SECURITY.md](./SECURITY.md)

---

_End of SSS Protocol Specification. For proposed extensions to this spec, follow the SSS Improvement Proposal process described in [SSS-0.md](./SSS-0.md) (forthcoming)._

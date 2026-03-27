use anchor_lang::prelude::*;

// ---------------------------------------------------------------------------
// Feature flag constants — bit positions in StablecoinConfig.feature_flags
// ---------------------------------------------------------------------------
/// Circuit breaker flag (bit 0): when set, all mint/transfer/burn ops fail.
pub const FLAG_CIRCUIT_BREAKER: u64 = 1 << 0;

/// Spend policy flag (bit 1): when set, per-tx transfer amount is capped at
/// `StablecoinConfig.max_transfer_amount`.  Admin instructions:
/// `set_spend_limit` / `clear_spend_limit`.
pub const FLAG_SPEND_POLICY: u64 = 1 << 1;

/// DAO committee flag (bit 2): when set, privileged admin operations
/// (pause, update_minter, update_roles, set/clear feature flags) require
/// a passed on-chain proposal via `propose_action` / `vote_action` / `execute_action`.
pub const FLAG_DAO_COMMITTEE: u64 = 1 << 2;

/// Yield-bearing collateral flag (bit 3): when set, only whitelisted SPL tokens
/// (e.g. stSOL, mSOL) recorded in `YieldCollateralConfig` may be deposited as
/// CDP collateral.  Enables `init_yield_collateral` / `add_yield_collateral_mint`.
/// External protocol risk applies — see docs/FEATURE-FLAGS-RESEARCH.md §Feature 2.
pub const FLAG_YIELD_COLLATERAL: u64 = 1 << 3;

/// ZK compliance flag (bit 4): when set, transfers via the transfer hook require
/// the sender to hold a valid `VerificationRecord` PDA that has not expired.
/// Enables `init_zk_compliance` / `submit_zk_proof` / `close_verification_record`.
/// SSS-2 only.  See docs/FEATURE-FLAGS-RESEARCH.md §Feature 4.
pub const FLAG_ZK_COMPLIANCE: u64 = 1 << 4;

/// Confidential transfers flag (bit 5): when set, the mint was initialized with
/// an auditor ElGamal pubkey stored in `ConfidentialTransferConfig` PDA.
/// Transfers are encrypted (private to observers) but the issuer/auditor can
/// decrypt all amounts via their ElGamal private key.
/// Foundation for Token-2022 ConfidentialTransferMint extension.
/// See docs/confidential-transfers.md for the full compliance model.
pub const FLAG_CONFIDENTIAL_TRANSFERS: u64 = 1 << 5;
/// Travel Rule compliance (SSS-127). Requires travel_rule_threshold to be set.
pub const FLAG_TRAVEL_RULE: u64 = 1 << 6;
/// Sanctions oracle enforcement via transfer hook (SSS-128).
pub const FLAG_SANCTIONS_ORACLE: u64 = 1 << 7;
/// ZK credential enforcement via transfer hook (SSS-129).
pub const FLAG_ZK_CREDENTIALS: u64 = 1 << 8;
/// PID-controlled stability fee (SSS-130).
pub const FLAG_PID_FEE_CONTROL: u64 = 1 << 9;
/// Graduated liquidation bonus tiers (SSS-131).
pub const FLAG_GRAD_LIQUIDATION_BONUS: u64 = 1 << 10;
/// PSM dynamic fees via curve (SSS-132).
pub const FLAG_PSM_DYNAMIC_FEES: u64 = 1 << 11;
/// Per-wallet rate limiting via transfer hook (SSS-133).
pub const FLAG_WALLET_RATE_LIMITS: u64 = 1 << 12;
/// Squads V4 multisig as program authority (SSS-134, irreversible).
pub const FLAG_SQUADS_AUTHORITY: u64 = 1 << 13;
/// BUG-024: Require owner consent for all transfers (bit 15).
/// When set, the transfer hook rejects any permanent-delegate transfer where
/// the signer (ctx.accounts.owner) is not the token account owner (src_owner
/// read from the token account data at offset 32..64).  A permanent delegate
/// can still transfer from wallets that have explicitly whitelisted it via a
/// DelegateConsent PDA (seeds [b"delegate-consent", mint, wallet_owner]).
/// Issuers that need Token-2022 permanent delegate for compliance purposes
/// should leave this flag unset; issuers who want pure owner-consent semantics
/// should enable it.
pub const FLAG_REQUIRE_OWNER_CONSENT: u64 = 1 << 15;
/// Proof-of-Reserves breach halts minting (SSS-123).
pub const FLAG_POR_HALT_ON_BREACH: u64 = 1 << 16;

/// Cross-chain bridge flag (bit 17): when set, `bridge_out` and `bridge_in`
/// instructions are enabled.  Requires a `BridgeConfig` PDA to be initialized
/// via `init_bridge_config`.  See docs/CROSS-CHAIN-BRIDGE.md for details.
pub const FLAG_BRIDGE_ENABLED: u64 = 1 << 17;

/// SSS-138: Market maker hooks flag (bit 18): when set, `mm_mint` and `mm_burn`
/// instructions are available to whitelisted market makers for programmatic peg
/// spread management.  Requires a `MarketMakerConfig` PDA via `init_market_maker_config`.
pub const FLAG_MARKET_MAKER_HOOKS: u64 = 1 << 18;
/// Agent payment channel (future).
pub const FLAG_AGENT_PAYMENT_CHANNEL: u64 = 1 << 19;
/// Probabilistic money market (future).
pub const FLAG_PROBABILISTIC_MONEY: u64 = 1 << 20;
/// SSS-151: Insurance vault required flag (bit 21): when set, minting is blocked
/// until the InsuranceVault PDA is adequately seeded (balance >= min_seed_bps of net_supply).
/// Set by `init_insurance_vault`; cleared only via timelock.
pub const FLAG_INSURANCE_VAULT_REQUIRED: u64 = 1 << 21;

/// SSS-153: Multi-oracle consensus flag (bit 22): when set, `update_oracle_consensus`
/// is the canonical price source for CDP, circuit breaker, and any instruction that
/// reads oracle price.  Requires an `OracleConsensus` PDA via `init_oracle_consensus`.
pub const FLAG_MULTI_ORACLE_CONSENSUS: u64 = 1 << 22;

/// SSS-154: Redemption queue flag (bit 23): when set, the stablecoin supports
/// front-run-protected FIFO redemption queues via `RedemptionQueue` PDA.
pub const FLAG_REDEMPTION_QUEUE: u64 = 1 << 23;

/// SSS-156: Issuer legal entity registry flag (bit 24): when set, an `IssuerRegistry`
/// PDA is present and regulators / on-chain programs can verify the issuer's
/// legal entity details on-chain.
pub const FLAG_LEGAL_REGISTRY: u64 = 1 << 24;

/// PRESET_INSTITUTIONAL (4): all SSS-3 features + Squads V4 multisig authority.
/// Recommended for issuers holding > $1 M in reserves.
pub const PRESET_INSTITUTIONAL: u8 = 4;



// ---------------------------------------------------------------------------
// SSS-085: Admin timelock operation kinds
// ---------------------------------------------------------------------------
/// No pending operation.
pub const ADMIN_OP_NONE: u8 = 0;
/// Pending: transfer authority to `admin_op_target`.
pub const ADMIN_OP_TRANSFER_AUTHORITY: u8 = 1;
/// Pending: set feature flag `admin_op_param` bits.
pub const ADMIN_OP_SET_FEATURE_FLAG: u8 = 2;
/// Pending: clear feature flag `admin_op_param` bits.
pub const ADMIN_OP_CLEAR_FEATURE_FLAG: u8 = 3;
/// Pending: set_pyth_feed — `admin_op_target` = new Pyth feed pubkey.
pub const ADMIN_OP_SET_PYTH_FEED: u8 = 4;
/// Pending: set_oracle_params — `admin_op_param` = (max_age_secs as u64) << 16 | (max_conf_bps as u64).
pub const ADMIN_OP_SET_ORACLE_PARAMS: u8 = 5;
/// Pending: set_stability_fee — `admin_op_param` = fee_bps as u64.
pub const ADMIN_OP_SET_STABILITY_FEE: u8 = 6;
/// Pending: set_psm_fee — `admin_op_param` = fee_bps as u64.
pub const ADMIN_OP_SET_PSM_FEE: u8 = 7;
/// Pending: set_backstop_params — `admin_op_target` = insurance fund vault pubkey,
/// `admin_op_param` = max_backstop_bps as u64.
pub const ADMIN_OP_SET_BACKSTOP_PARAMS: u8 = 8;
/// Pending: set_spend_limit — `admin_op_param` = max_transfer_amount.
pub const ADMIN_OP_SET_SPEND_LIMIT: u8 = 9;
/// Pending: transfer_compliance_authority — `admin_op_target` = new compliance authority.
pub const ADMIN_OP_TRANSFER_COMPLIANCE_AUTHORITY: u8 = 10;
/// Pending: set_oracle_config — `admin_op_param` = oracle_type as u64,
/// `admin_op_target` = oracle_feed pubkey.
pub const ADMIN_OP_SET_ORACLE_CONFIG: u8 = 11;
/// Pending: set_min_reserve_ratio — `admin_op_param` = min_reserve_ratio_bps as u64.
pub const ADMIN_OP_SET_MIN_RESERVE_RATIO: u8 = 12;
/// Pending: set_travel_rule_threshold — `admin_op_param` = threshold in native token units.
pub const ADMIN_OP_SET_TRAVEL_RULE_THRESHOLD: u8 = 13;
/// Pending: set_sanctions_params — `admin_op_target` = sanctions oracle pubkey,
/// `admin_op_param` = max_staleness_slots.
pub const ADMIN_OP_SET_SANCTIONS_PARAMS: u8 = 14;
/// Pending: set_timelock_delay — `admin_op_param` = new delay in slots.
pub const ADMIN_OP_SET_TIMELOCK_DELAY: u8 = 15;
/// Pending: pause the protocol — no additional params.
pub const ADMIN_OP_PAUSE: u8 = 16;
/// Pending: unpause the protocol — no additional params.
pub const ADMIN_OP_UNPAUSE: u8 = 17;

/// Default timelock delay: 2 Solana epochs ≈ 432 000 slots (at 2 days/epoch).
pub const DEFAULT_ADMIN_TIMELOCK_DELAY: u64 = 432_000;

/// Global stablecoin configuration (one per mint).
#[account]
#[derive(InitSpace)]
pub struct StablecoinConfig {
    /// Mint address (Token-2022)
    pub mint: Pubkey,
    /// Overall authority (can update roles, update minters)
    pub authority: Pubkey,
    /// Compliance authority (can freeze/thaw, manages blacklist on-chain)
    pub compliance_authority: Pubkey,
    /// Preset: 1 = SSS-1 (minimal), 2 = SSS-2 (compliant)
    pub preset: u8,
    /// Whether the mint is currently paused (SSS-2 feature)
    pub paused: bool,
    /// Total tokens minted (sum, not accounting for burns)
    pub total_minted: u64,
    /// Total tokens burned
    pub total_burned: u64,
    /// Transfer hook program (SSS-2 only; Pubkey::default if SSS-1/3)
    pub transfer_hook_program: Pubkey,
    /// SSS-3: collateral token mint (e.g. USDC; Pubkey::default if SSS-1/2)
    pub collateral_mint: Pubkey,
    /// SSS-3: reserve vault token account address (Pubkey::default if SSS-1/2)
    pub reserve_vault: Pubkey,
    /// SSS-3: total collateral deposited into the reserve vault
    pub total_collateral: u64,
    /// Maximum token supply (0 = unlimited)
    pub max_supply: u64,
    /// Pending authority for two-step authority transfer (Pubkey::default if none)
    pub pending_authority: Pubkey,
    /// Pending compliance authority for two-step transfer (Pubkey::default if none)
    pub pending_compliance_authority: Pubkey,
    /// Bitmask of enabled feature flags. See FLAG_* constants.
    pub feature_flags: u64,
    /// Maximum tokens per transfer when FLAG_SPEND_POLICY is set (0 = policy
    /// not yet configured; admin must call `set_spend_limit` before enabling).
    pub max_transfer_amount: u64,
    /// SSS-085: Expected Pyth price feed Pubkey for CDP operations.
    /// When non-default, `cdp_borrow_stable` and `cdp_liquidate` reject any
    /// pyth_price_feed account that does not match this key exactly.
    /// Set via `set_pyth_feed` (authority-only).  Default = Pubkey::default()
    /// (validation disabled; set before mainnet).
    pub expected_pyth_feed: Pubkey,
    /// SSS-085: Slot at which the pending timelocked admin operation matures.
    /// 0 = no pending operation.  Set by `propose_timelocked_op`; cleared by
    /// `execute_timelocked_op` or `cancel_timelocked_op`.
    pub admin_op_mature_slot: u64,
    /// SSS-085: Discriminant for the pending timelocked admin operation.
    /// 0 = none; matches AdminOpKind enum.
    pub admin_op_kind: u8,
    /// SSS-085: Generic u64 parameter for the pending timelocked admin op.
    pub admin_op_param: u64,
    /// SSS-085: Target pubkey for the pending timelocked admin op.
    pub admin_op_target: Pubkey,
    /// SSS-085: Minimum slot delay for admin timelock (default 2 epochs ≈ 432 000 slots).
    /// Can be set at init or by authority via `set_timelock_delay`.
    pub admin_timelock_delay: u64,
    /// SSS-090: Maximum Pyth price age in seconds for CDP operations.
    /// 0 = use hardcoded default (60 s).  Set via `set_oracle_params`.
    pub max_oracle_age_secs: u32,
    /// SSS-090: Maximum acceptable Pyth confidence interval as a fraction of price,
    /// expressed in basis points (e.g. 100 = 1%).  0 = disabled (no conf check).
    /// Set via `set_oracle_params`.
    pub max_oracle_conf_bps: u16,
    /// SSS-092: Annual stability fee in basis points (e.g. 50 = 0.5% p.a.).
    /// Accrues on outstanding CDP debt; collected via `collect_stability_fee`.
    /// 0 = no stability fee (default).
    pub stability_fee_bps: u16,
    /// SSS-093: PSM redemption fee in basis points (e.g. 10 = 0.1%).
    /// Deducted from collateral released on `redeem`.  Fee stays in vault.
    /// 0 = no fee (default).  Set via `set_psm_fee` (authority-only).
    pub redemption_fee_bps: u16,
    /// SSS-097: Insurance fund vault — token account that holds backstop reserves.
    /// Pubkey::default() = backstop disabled.  Set via `set_backstop_params` (authority-only).
    pub insurance_fund_pubkey: Pubkey,
    /// SSS-097: Maximum backstop draw as a fraction of total outstanding debt,
    /// expressed in basis points (e.g. 500 = 5% of net supply).
    /// 0 = unlimited (draw full shortfall up to insurance fund balance).
    pub max_backstop_bps: u16,
    /// SSS-106: Auditor ElGamal pubkey for confidential transfers.
    /// All-zero if FLAG_CONFIDENTIAL_TRANSFERS is not enabled.
    pub auditor_elgamal_pubkey: [u8; 32],
    /// SSS-119: Oracle type discriminant. 0=Pyth (default), 1=Switchboard, 2=Custom.
    /// Set via `set_oracle_config` (authority-only).
    pub oracle_type: u8,
    /// SSS-119: Generic oracle feed account address used by the oracle abstraction layer.
    /// For Pyth: the Pyth price feed account (overrides expected_pyth_feed when set).
    /// For Custom: the CustomPriceFeed PDA address.
    /// Pubkey::default() = validation deferred to expected_pyth_feed (backward compat).
    pub oracle_feed: Pubkey,
    /// SSS-147: When true (set at initialize for preset==3), the max_supply / supply_cap
    /// is immutable after initialization.  Prevents the authority from later expanding
    /// the supply cap to defeat the SSS-3 trust-minimized minting invariant.
    pub supply_cap_locked: bool,
    /// Config version — incremented when breaking changes are made to the config layout.
    /// Instructions that require a minimum version check against this field.
    pub version: u8,
    /// SSS-BUG-008: Minimum reserve ratio in basis points (0 = no minimum).
    /// CDP minting is blocked when the reserve ratio drops below this threshold.
    pub min_reserve_ratio_bps: u16,
    /// SSS-127: Travel Rule transfer threshold in native token units.
    /// 0 = Travel Rule disabled regardless of FLAG_TRAVEL_RULE.
    pub travel_rule_threshold: u64,
    /// SSS-128: Sanctions oracle pubkey (compliance provider).
    /// Pubkey::default() = sanctions oracle not configured.
    pub sanctions_oracle: Pubkey,
    /// SSS-128: Maximum age in slots for a SanctionsRecord to be considered fresh.
    /// 0 = use hardcoded default.
    pub sanctions_max_staleness_slots: u64,
    /// BUG-015: Whitelisted stability-fee / circuit-breaker keeper pubkeys (max 8).
    #[max_len(8)]
    pub authorized_keepers: Vec<Pubkey>,
    /// SSS-134: Squads V4 multisig PDA address when FLAG_SQUADS_AUTHORITY is set.
    /// Pubkey::default() = squads authority not configured.
    pub squads_multisig: Pubkey,
    /// SSS-150: Expected BPF upgrade authority pubkey for upgrade guard enforcement.
    /// Pubkey::default() = guard not set.
    pub expected_upgrade_authority: Pubkey,
    pub bump: u8,
}

impl StablecoinConfig {
    pub const SEED: &'static [u8] = b"stablecoin-config";
    /// Maximum number of whitelisted reserve attestors (custodians / Pyth publishers).
    pub const MAX_RESERVE_ATTESTORS: usize = 4;
    /// BUG-015: Maximum number of whitelisted stability-fee keepers.
    pub const MAX_AUTHORIZED_KEEPERS: usize = 8;

    /// Net circulating supply (total_minted - total_burned)
    pub fn net_supply(&self) -> u64 {
        self.total_minted.saturating_sub(self.total_burned)
    }

    /// Reserve ratio in basis points (10_000 = 100% collateralized).
    pub fn reserve_ratio_bps(&self) -> u64 {
        let supply = self.net_supply();
        if supply == 0 {
            return 10_000;
        }
        self.total_collateral.saturating_mul(10_000) / supply
    }

    /// Returns true if this token is SSS-3 (has a reserve vault).
    pub fn has_reserve(&self) -> bool {
        self.reserve_vault != Pubkey::default()
    }

    /// Returns true if this token has a transfer hook (SSS-2).
    pub fn has_hook(&self) -> bool {
        self.transfer_hook_program != Pubkey::default()
    }

    /// Returns true if a given feature flag bit is set.
    pub fn check_feature_flag(&self, flag: u64) -> bool {
        self.feature_flags & flag != 0
    }
}

/// Per-minter configuration — minters are PDAs keyed by [config, minter_pubkey].
#[account]
#[derive(InitSpace)]
pub struct MinterInfo {
    /// The stablecoin config this minter belongs to
    pub config: Pubkey,
    /// Minter wallet
    pub minter: Pubkey,
    /// Maximum tokens this minter is allowed to mint (0 = unlimited)
    pub cap: u64,
    /// Total minted by this minter so far
    pub minted: u64,
    /// SSS-093: Maximum tokens this minter may mint per epoch (0 = unlimited).
    /// Prevents flash-mint attacks by rate-limiting per Solana epoch.
    pub max_mint_per_epoch: u64,
    /// SSS-093: Amount minted in the current epoch (resets when epoch advances).
    pub minted_this_epoch: u64,
    /// SSS-093: The epoch slot-number when `minted_this_epoch` was last reset.
    /// Solana epoch = `clock.epoch` (u64).
    pub last_epoch_reset: u64,
    pub bump: u8,
}

impl MinterInfo {
    pub const SEED: &'static [u8] = b"minter-info";
}

/// Parameters for initializing a new stablecoin.
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitializeParams {
    /// 1 = SSS-1, 2 = SSS-2, 3 = SSS-3 (reserve-backed)
    pub preset: u8,
    /// Token decimals
    pub decimals: u8,
    /// Human-readable token name
    pub name: String,
    /// Token symbol (e.g. USDC)
    pub symbol: String,
    /// Metadata URI
    pub uri: String,
    /// Transfer hook program (required for SSS-2)
    pub transfer_hook_program: Option<Pubkey>,
    /// SSS-3: collateral token mint (e.g. USDC mint address)
    pub collateral_mint: Option<Pubkey>,
    /// SSS-3: reserve vault token account address
    pub reserve_vault: Option<Pubkey>,
    /// Maximum token supply (None or 0 = unlimited)
    pub max_supply: Option<u64>,
    /// Initial feature flags bitmask (see FLAG_* constants). Optional — defaults to 0.
    pub feature_flags: Option<u64>,
    /// Auditor ElGamal pubkey for confidential transfers (required if FLAG_CONFIDENTIAL_TRANSFERS is set)
    pub auditor_elgamal_pubkey: Option<[u8; 32]>,
    /// Override the admin timelock delay (slots). None = use DEFAULT_ADMIN_TIMELOCK_DELAY.
    /// Pass Some(0) in test environments to allow direct admin calls without going
    /// through the propose/execute timelock flow.
    pub admin_timelock_delay: Option<u64>,
    /// SSS-147A: Squads V4 multisig PDA for FLAG_SQUADS_AUTHORITY.
    /// Required when preset == 3 — SSS-3 stablecoins must be governed by a multisig.
    /// Optional for SSS-1 and SSS-2 (but may still be provided to enable FLAG_SQUADS_AUTHORITY).
    pub squads_multisig: Option<Pubkey>,
}

/// Parameters for updating authorities.
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct UpdateRolesParams {
    pub new_authority: Option<Pubkey>,
    pub new_compliance_authority: Option<Pubkey>,
}

// ─── CDP State (Direction 2: Multi-Collateral CDP) ───────────────────────────

/// Collateral vault PDA — one per (user, collateral_mint).
/// Seeds: ["cdp-collateral-vault", user, collateral_mint]
#[account]
#[derive(InitSpace)]
pub struct CollateralVault {
    /// The user who owns this vault
    pub owner: Pubkey,
    /// The SPL token mint for this collateral type
    pub collateral_mint: Pubkey,
    /// The token account that holds collateral (owned by the vault PDA)
    pub vault_token_account: Pubkey,
    /// Total collateral deposited (in collateral token's native units)
    pub deposited_amount: u64,
    pub bump: u8,
}

impl CollateralVault {
    pub const SEED: &'static [u8] = b"cdp-collateral-vault";
}

/// CDP position PDA — one per user, single-collateral per position (SSS-054 fix).
/// Seeds: ["cdp-position", sss_mint, user]
#[account]
#[derive(InitSpace)]
pub struct CdpPosition {
    /// The SSS stablecoin config this CDP borrows against
    pub config: Pubkey,
    /// The SSS stablecoin mint
    pub sss_mint: Pubkey,
    /// The user who owns this CDP
    pub owner: Pubkey,
    /// Total SSS-3 tokens currently borrowed (outstanding debt)
    pub debt_amount: u64,
    /// The single collateral mint for this position (set on first borrow, immutable).
    /// Enforces 1:1 CollateralVault-to-CdpPosition to prevent liquidation insolvency.
    pub collateral_mint: Pubkey,
    /// SSS-092: Unix timestamp of the last stability fee accrual for this position.
    /// Initialised to 0; set on first borrow and updated each time fees are collected.
    pub last_fee_accrual: i64,
    /// SSS-092: Total stability fees accrued (in SSS token native units) but not yet
    /// collected by the protocol.  Debtor must repay principal + accrued_fees.
    pub accrued_fees: u64,
    pub bump: u8,
}

impl CdpPosition {
    pub const SEED: &'static [u8] = b"cdp-position";

    /// MIN collateral ratio (150%) in basis points
    pub const MIN_COLLATERAL_RATIO_BPS: u64 = 15_000;
    /// LIQUIDATION threshold (120%) in basis points
    pub const LIQUIDATION_THRESHOLD_BPS: u64 = 12_000;
    /// Liquidation discount (5%) — liquidator gets collateral at 5% discount
    pub const LIQUIDATION_BONUS_BPS: u64 = 500;
}

// ─── Direction 3: CPI Composability Standard ─────────────────────────────────

/// Interface version PDA — external callers check this before invoking SSS via CPI.
/// Seeds: ["interface-version", sss_mint]
///
/// Callers should read this PDA and verify:
///   - `version` matches their expected version (breaking changes bump version)
///   - `active` is true (protocol not deprecated)
///
/// Breaking interface changes require a new program address per Solana convention,
/// but the version field gives callers a cheap on-chain safety check.
#[account]
#[derive(InitSpace)]
pub struct InterfaceVersion {
    /// The SSS mint this interface applies to
    pub mint: Pubkey,
    /// Current interface version (1 = initial CPI composability standard)
    pub version: u8,
    /// Whether this interface is active; false = deprecated / use new program
    pub active: bool,
    /// Interface namespace used for discriminator derivation
    /// sha256("sss_mint_interface:mint")[..8] => mint discriminator
    /// sha256("sss_mint_interface:burn")[..8] => burn discriminator
    pub namespace: [u8; 32],
    pub bump: u8,
}

impl InterfaceVersion {
    pub const SEED: &'static [u8] = b"interface-version";
    pub const CURRENT_VERSION: u8 = 1;

    /// The canonical namespace string used to derive discriminators.
    pub const NAMESPACE: &'static str = "sss_mint_interface";
}

// ─── SSS-070: Yield-Bearing Collateral ───────────────────────────────────────

/// Yield-collateral config PDA — one per stablecoin mint.
/// Seeds: [b"yield-collateral", sss_mint]
///
/// Stores a whitelist of SPL token mints that may be used as yield-bearing
/// collateral in CDP deposits when FLAG_YIELD_COLLATERAL is enabled.
/// Maximum 8 whitelisted mints — covers all practical yield-token variants
/// (stSOL, mSOL, jitoSOL, bSOL, etc.) without unbounded Vec heap.
#[account]
#[derive(InitSpace)]
pub struct YieldCollateralConfig {
    /// The SSS stablecoin mint this config belongs to
    pub sss_mint: Pubkey,
    /// Whitelisted yield-bearing SPL token mints (max 8)
    #[max_len(8)]
    pub whitelisted_mints: Vec<Pubkey>,
    pub bump: u8,
}

impl YieldCollateralConfig {
    pub const SEED: &'static [u8] = b"yield-collateral";
    /// Maximum number of whitelisted yield-bearing collateral mints
    pub const MAX_MINTS: usize = 8;
}

// ─── SSS-067: DAO Committee Governance ───────────────────────────────────────

/// Action kinds that a DAO committee proposal may authorize.
/// Encoded as a u8 discriminant to keep the PDA small.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum ProposalAction {
    /// Pause the stablecoin mint (privilege: authority)
    Pause = 0,
    /// Unpause the stablecoin mint (privilege: authority)
    Unpause = 1,
    /// Enable a feature flag.  `param` = flag bits.
    SetFeatureFlag = 2,
    /// Clear a feature flag.  `param` = flag bits.
    ClearFeatureFlag = 3,
    /// Update a minter cap.  `param` = new cap (u64); `target` = minter key.
    UpdateMinter = 4,
    /// Revoke a minter.  `target` = minter key.
    RevokeMinter = 5,
    /// Approve an insurance vault draw.  `param` = max draw amount (u64 lamports/tokens).
    /// Used when FLAG_DAO_COMMITTEE is active — draw_insurance verifies a passed
    /// DrawInsurance proposal exists before transferring funds.
    DrawInsurance = 6,
}

/// DAO Governance Proposal PDA.
///
/// Seeds: [b"dao-proposal", config, proposal_id.to_le_bytes()]
/// Created by `propose_action`, voted on by `vote_action`, executed by `execute_action`.
#[account]
#[derive(InitSpace)]
pub struct ProposalPda {
    /// The stablecoin config this proposal governs.
    pub config: Pubkey,
    /// Monotonically increasing proposal index for this config (0-based).
    pub proposal_id: u64,
    /// Who created the proposal (must be the current authority).
    pub proposer: Pubkey,
    /// The action to execute when the proposal passes.
    pub action: ProposalAction,
    /// Generic u64 parameter (flag bits for Set/ClearFeatureFlag; cap for UpdateMinter; 0 otherwise).
    pub param: u64,
    /// Target pubkey (minter key for UpdateMinter/RevokeMinter; default otherwise).
    pub target: Pubkey,
    /// Set of committee member keys that have voted YES (max 10 members).
    /// We store votes inline to avoid extra accounts; for simplicity, duplicate
    /// vote attempts are rejected at the instruction level.
    #[max_len(10)]
    pub votes: Vec<Pubkey>,
    /// Quorum: how many YES votes are required to execute.
    pub quorum: u8,
    /// Whether this proposal has been executed (one-shot).
    pub executed: bool,
    /// Whether this proposal has been cancelled.
    pub cancelled: bool,
    /// Cumulative amount already consumed by draw_insurance calls against this proposal.
    /// Prevents replay: once cumulative_consumed >= param, no further draws are allowed.
    pub cumulative_consumed: u64,
    pub bump: u8,
}

impl ProposalPda {
    pub const SEED: &'static [u8] = b"dao-proposal";
    /// Maximum committee members / votes per proposal.
    pub const MAX_VOTES: usize = 10;
}

/// DAO Committee Config PDA — tracks committee members and proposal counter.
///
/// Seeds: [b"dao-committee", config]
/// Initialized by `init_dao_committee`; managed by authority.
#[account]
#[derive(InitSpace)]
pub struct DaoCommitteeConfig {
    /// The stablecoin config this committee governs.
    pub config: Pubkey,
    /// Ordered list of committee member pubkeys (max 10).
    #[max_len(10)]
    pub members: Vec<Pubkey>,
    /// Minimum YES votes required to pass a proposal (must be ≤ members.len()).
    pub quorum: u8,
    /// Next proposal ID to assign (auto-incremented on `propose_action`).
    pub next_proposal_id: u64,
    pub bump: u8,
}

impl DaoCommitteeConfig {
    pub const SEED: &'static [u8] = b"dao-committee";
    pub const MAX_MEMBERS: usize = 10;
}

// ─── SSS-075: ZK Compliance ───────────────────────────────────────────────────

/// ZK-compliance config PDA — one per stablecoin mint.
/// Seeds: [b"zk-compliance-config", sss_mint]
///
/// Stores protocol-wide settings for ZK proof verification.
/// Created by `init_zk_compliance`; enables FLAG_ZK_COMPLIANCE.
/// SSS-2 only.
#[account]
#[derive(InitSpace)]
pub struct ZkComplianceConfig {
    /// The SSS stablecoin mint this config belongs to.
    pub sss_mint: Pubkey,
    /// Number of slots a VerificationRecord is valid after submission.
    /// Default: 1500 slots (~10 minutes at 400ms/slot).
    pub ttl_slots: u64,
    /// Optional compliance oracle / verifier pubkey.
    ///
    /// When `Some(vk)`, `submit_zk_proof` requires a co-signature from `vk`
    /// to prevent self-issued proofs. When `None`, any caller may submit.
    /// Set during `init_zk_compliance` and cannot be changed after init.
    pub verifier_pubkey: Option<Pubkey>,
    pub bump: u8,
}

impl ZkComplianceConfig {
    pub const SEED: &'static [u8] = b"zk-compliance-config";
    /// Default proof validity window: ~10 minutes at 400ms/slot.
    pub const DEFAULT_TTL_SLOTS: u64 = 1500;
}

/// Per-user ZK verification record PDA — one per (mint, user).
/// Seeds: [b"zk-verification", sss_mint, user]
///
/// Created or refreshed by `submit_zk_proof`.  The transfer hook checks this
/// PDA whenever FLAG_ZK_COMPLIANCE is active: if the record is absent or
/// `expires_at_slot <= Clock::slot`, the transfer is rejected.
///
/// Authority may close expired records via `close_verification_record` to
/// reclaim rent.
#[account]
#[derive(InitSpace)]
pub struct VerificationRecord {
    /// The SSS stablecoin mint this record is scoped to.
    pub sss_mint: Pubkey,
    /// The wallet that submitted the proof.
    pub user: Pubkey,
    /// The slot at which this record expires (exclusive).
    /// Valid while `Clock::get().slot < expires_at_slot`.
    pub expires_at_slot: u64,
    pub bump: u8,
}

impl VerificationRecord {
    pub const SEED: &'static [u8] = b"zk-verification";
}

// ---------------------------------------------------------------------------
// SSS-098: CollateralConfig PDA — per-collateral parameters
// ---------------------------------------------------------------------------

/// Per-collateral configuration PDA.
/// Seeds: [b"collateral-config", sss_mint, collateral_mint]
///
/// Stores per-collateral LTV, liquidation threshold/bonus, deposit cap, and
/// a whitelist flag.  `cdp_deposit_collateral` reads this when it is passed
/// as an optional account.
#[account]
#[derive(InitSpace)]
pub struct CollateralConfig {
    /// The SSS-3 stablecoin mint this config belongs to.
    pub sss_mint: Pubkey,
    /// The collateral token mint.
    pub collateral_mint: Pubkey,
    /// When false, CDP deposits for this mint are rejected.
    pub whitelisted: bool,
    /// Maximum loan-to-value ratio in basis points (e.g. 7500 = 75%).
    pub max_ltv_bps: u16,
    /// Collateral ratio below which a position becomes liquidatable.
    /// Must be > max_ltv_bps.
    pub liquidation_threshold_bps: u16,
    /// Extra collateral awarded to the liquidator, in basis points.
    pub liquidation_bonus_bps: u16,
    /// Maximum total deposited amount for this collateral (0 = unlimited).
    pub max_deposit_cap: u64,
    /// Running total of collateral deposited through CDP (informational).
    pub total_deposited: u64,
    pub bump: u8,
}

impl CollateralConfig {
    pub const SEED: &'static [u8] = b"collateral-config";

    /// Validate params: threshold > ltv, bonus <= 50%.
    pub fn validate(ltv: u16, threshold: u16, bonus: u16) -> anchor_lang::Result<()> {
        use crate::error::SssError;
        require!(threshold > ltv, SssError::InvalidCollateralThreshold);
        require!(bonus <= 5000, SssError::InvalidLiquidationBonus);
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// SSS-106: Confidential Transfers — ConfidentialTransferConfig PDA
// ---------------------------------------------------------------------------

/// Confidential transfer config PDA — one per mint when FLAG_CONFIDENTIAL_TRANSFERS is set.
/// Seeds: [b"ct-config", mint]
///
/// Stores the issuer's auditor ElGamal pubkey for confidential transfers.
/// The auditor can decrypt all transfer amounts; external observers cannot.
/// This is the foundation for Token-2022 ConfidentialTransferMint extension integration.
/// The actual ConfidentialTransferMint extension wiring is a follow-up (SSS-107).
#[account]
#[derive(InitSpace)]
pub struct ConfidentialTransferConfig {
    /// The SSS mint this config belongs to.
    pub mint: Pubkey,
    /// The issuer's ElGamal public key used to audit (decrypt) all transfer amounts.
    /// Must be a valid ElGamal pubkey on the Ristretto255 curve (32 bytes).
    pub auditor_elgamal_pubkey: [u8; 32],
    /// When true, new token accounts are automatically approved for confidential transfers.
    /// When false, the authority must manually approve each account.
    pub auto_approve_new_accounts: bool,
    pub bump: u8,
}

impl ConfidentialTransferConfig {
    pub const SEED: &'static [u8] = b"ct-config";
}

// ---------------------------------------------------------------------------
// SSS-119: CustomPriceFeed — on-chain price maintained by the admin
// ---------------------------------------------------------------------------

/// Custom oracle price feed PDA — one per SSS-3 stablecoin mint.
/// Seeds: [b"custom-price-feed", sss_mint]
///
/// Only the stablecoin authority may update prices via `update_custom_price`.
/// The `custom` oracle adapter verifies `feed.authority == config.authority`
/// (admin signature verification) before trusting the stored price.
#[account]
#[derive(InitSpace)]
pub struct CustomPriceFeed {
    /// The authority (stablecoin config authority) who may update this feed.
    pub authority: Pubkey,
    /// Price value — same semantics as Pyth: raw integer, scaled by 10^expo.
    pub price: i64,
    /// Price exponent — typically negative (e.g. -8 means price in 10^-8 USD).
    pub expo: i32,
    /// Confidence half-interval in the same units as price.
    pub conf: u64,
    /// Slot at which the price was last updated (informational).
    pub last_update_slot: u64,
    /// Unix timestamp (seconds) at which the price was last updated.
    /// Used by the custom oracle adapter to enforce max_oracle_age_secs staleness check.
    pub last_update_unix_timestamp: i64,
    pub bump: u8,
}

impl CustomPriceFeed {
    pub const SEED: &'static [u8] = b"custom-price-feed";
}

// ---------------------------------------------------------------------------
// SSS-120: AuthorityRotationRequest PDA
// ---------------------------------------------------------------------------
/// Stores an in-flight authority rotation proposal.
/// Seeds: [b"authority-rotation", mint.key().as_ref()]
///
/// Lifecycle:
///   propose_authority_rotation → AuthorityRotationRequest created
///   accept_authority_rotation  → PDA closed (after 48-hr timelock)
///   emergency_recover_authority→ PDA closed (after 7-day window)
///   cancel_authority_rotation  → PDA closed immediately (current authority only)
#[account]
pub struct AuthorityRotationRequest {
    /// The stablecoin mint this rotation belongs to.
    pub config_mint: Pubkey,
    /// The authority at proposal time — must still match config.authority at accept/emergency/cancel.
    pub current_authority: Pubkey,
    /// The new authority that must sign `accept_authority_rotation`.
    pub new_authority: Pubkey,
    /// Fallback authority: can claim after `EMERGENCY_RECOVERY_SLOTS` if acceptance never happens.
    pub backup_authority: Pubkey,
    /// Slot at which the proposal was made.
    pub proposed_slot: u64,
    /// Slots that must elapse before `accept_authority_rotation` is valid (≈48 hr).
    pub timelock_slots: u64,
    /// PDA bump.
    pub bump: u8,
}

impl AuthorityRotationRequest {
    pub const SEED: &'static [u8] = b"authority-rotation";
    /// Discriminator(8) + 3×Pubkey(96) + 2×u64(16) + u8(1) + padding(7) = 128
    pub const SPACE: usize = 96 + 16 + 1 + 7;
}

// SSS-121: Guardian Multisig Emergency Pause
// ---------------------------------------------------------------------------

/// GuardianConfig PDA — one per stablecoin config.
/// Seeds: [b"guardian-config", config_pubkey]
///
/// Stores up to 7 guardian pubkeys and a threshold.  Guardians may only
/// pause or unpause the mint — they cannot mint, burn, or alter fees.
#[account]
#[derive(InitSpace)]
pub struct GuardianConfig {
    /// The StablecoinConfig this guardian set governs.
    pub config: Pubkey,
    /// Registered guardian pubkeys (1–7).
    #[max_len(7)]
    pub guardians: Vec<Pubkey>,
    /// Minimum votes required to execute a pause proposal.
    pub threshold: u8,
    /// Auto-incrementing ID assigned to the next PauseProposal.
    pub next_proposal_id: u64,
    /// Votes accumulated for lifting the current pause via full-quorum path.
    /// Reset to empty when the pause is lifted.
    #[max_len(7)]
    pub pending_lift_votes: Vec<Pubkey>,
    /// BUG-018: Set to true when a guardian-quorum pause is active.
    /// Authority alone CANNOT lift the pause while this is true + timelock active.
    pub guardian_pause_active: bool,
    /// BUG-018: Unix timestamp after which authority may lift a guardian-initiated
    /// pause unilaterally (GUARDIAN_PAUSE_AUTHORITY_OVERRIDE_DELAY seconds after pause).
    /// Zero when no guardian pause is active.
    pub guardian_pause_unlocks_at: i64,
    pub bump: u8,
}

impl GuardianConfig {
    pub const SEED: &'static [u8] = b"guardian-config";
    pub const MAX_GUARDIANS: usize = 7;
    /// Authority must wait this many seconds after a guardian-initiated pause
    /// before they can unilaterally override it (BUG-018 fix).
    pub const GUARDIAN_PAUSE_AUTHORITY_OVERRIDE_DELAY: i64 = 86_400; // 24 hours
}

/// PauseProposal PDA — one per proposal.
/// Seeds: [b"pause-proposal", config_pubkey, proposal_id.to_le_bytes()]
///
/// Tracks YES votes on a pending emergency-pause proposal.
/// Once `votes.len() >= threshold` the proposal is auto-executed and
/// `executed` is set to `true`.
#[account]
#[derive(InitSpace)]
pub struct PauseProposal {
    /// The StablecoinConfig this proposal targets.
    pub config: Pubkey,
    /// Sequential ID matching the `GuardianConfig.next_proposal_id` at creation.
    pub proposal_id: u64,
    /// Guardian who opened the proposal (already counted as 1 vote).
    pub proposer: Pubkey,
    /// Freeform reason bytes (e.g. incident hash or ASCII string).
    pub reason: [u8; 32],
    /// Guardians who have voted YES (no duplicates).
    #[max_len(7)]
    pub votes: Vec<Pubkey>,
    /// Voting threshold copied from GuardianConfig at proposal creation.
    pub threshold: u8,
    /// True when the threshold was reached and the pause was applied.
    pub executed: bool,
    pub bump: u8,
}

impl PauseProposal {
    pub const SEED: &'static [u8] = b"pause-proposal";
    pub const MAX_VOTES: usize = 7;
}

// ─── SSS-156: Issuer Legal Entity Registry ───────────────────────────────────

/// On-chain issuer registry for regulatory traceability.
///
/// Seeds: [b"issuer_registry", config_pubkey]
///
/// Optional PDA enabled by FLAG_LEGAL_REGISTRY (bit 24). Allows regulators
/// and on-chain programs to verify the issuer's legal entity details without
/// trusting off-chain data. The `attestor` is a notary or lawyer whose Pubkey
/// co-signs the record via `attest_legal_entity`.
#[account]
#[derive(InitSpace)]
pub struct IssuerRegistry {
    /// StablecoinConfig this registry belongs to.
    pub config: Pubkey,
    /// SHA-256 hash of the legal entity document (e.g. articles of incorporation).
    pub legal_entity_hash: [u8; 32],
    /// ISO 3166-1 alpha-2 country code encoded as UTF-8 bytes, zero-padded to 4.
    pub jurisdiction: [u8; 4],
    /// SHA-256 hash of the jurisdiction registration number (for privacy).
    pub registration_number_hash: [u8; 32],
    /// Pubkey of the notary/lawyer who will attest this record.
    pub attestor: Pubkey,
    /// Slot at which the attestor signed (0 = not yet attested).
    pub attested_slot: u64,
    /// Slot after which this record is considered expired (0 = no expiry).
    pub expiry_slot: u64,
    /// True after `attest_legal_entity` succeeds.
    pub attested: bool,
    pub bump: u8,
}

impl IssuerRegistry {
    pub const SEED: &'static [u8] = b"issuer_registry";
}

// ---------------------------------------------------------------------------
// SSS-BUG-008: ProofOfReserves PDA
// ---------------------------------------------------------------------------

/// On-chain proof-of-reserves attestation record.
/// Seeds: [b"proof-of-reserves", sss_mint]
#[account]
#[derive(InitSpace)]
pub struct ProofOfReserves {
    /// The SSS stablecoin mint this record belongs to.
    pub mint: Pubkey,
    /// Slot at which the last attestation was submitted.
    pub last_attestation_slot: u64,
    /// Verified reserve ratio in basis points at time of last attestation.
    pub last_verified_ratio_bps: u64,
    /// The pubkey of the attester (custodian / Pyth publisher).
    pub attester: Pubkey,
    pub bump: u8,
}

impl ProofOfReserves {
    pub const SEED: &'static [u8] = b"proof-of-reserves";
}

// ---------------------------------------------------------------------------
// SSS-153: Multi-oracle consensus PDAs
// ---------------------------------------------------------------------------

/// A single oracle source entry stored inline in OracleConsensus.
/// oracle_type: 0=Pyth, 1=Switchboard, 2=Custom.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace, Default)]
pub struct OracleSource {
    /// Oracle type: 0=Pyth, 1=Switchboard, 2=Custom.
    pub oracle_type: u8,
    /// The oracle feed account address (Pubkey::default = empty slot).
    pub feed: Pubkey,
}

/// Multi-oracle consensus PDA — aggregates N price sources into a single
/// median/TWAP consensus price.
/// Seeds: [b"oracle-consensus", sss_mint]
#[account]
#[derive(InitSpace)]
pub struct OracleConsensus {
    /// The SSS stablecoin mint this consensus belongs to.
    pub mint: Pubkey,
    /// Minimum number of valid sources required for consensus.
    pub min_oracles: u8,
    /// Maximum deviation in bps before a source is considered an outlier.
    pub outlier_threshold_bps: u16,
    /// Number of currently active sources (non-default feed).
    pub source_count: u8,
    /// Maximum age in slots for a source price to be included in consensus.
    pub max_age_slots: u64,
    /// Fixed-size array of oracle sources (MAX_SOURCES slots).
    #[max_len(8)]
    pub sources: Vec<OracleSource>,
    /// The last computed consensus price (median of valid sources).
    pub last_consensus_price: u64,
    /// Slot at which the consensus was last updated.
    pub last_consensus_slot: u64,
    /// Running TWAP price (exponential moving average).
    pub twap_price: u64,
    /// Slot of last TWAP update.
    pub twap_last_slot: u64,
    pub bump: u8,
}

impl OracleConsensus {
    pub const SEED: &'static [u8] = b"oracle-consensus";
    /// Maximum oracle sources per consensus PDA.
    pub const MAX_SOURCES: usize = 8;

    /// Returns true when at least one source has been configured.
    pub fn config_is_set(&self) -> bool {
        self.source_count > 0
    }
}

// ---------------------------------------------------------------------------
// SSS-128: SanctionsRecord PDA
// ---------------------------------------------------------------------------

/// Per-wallet sanctions screening record.
/// Seeds: [b"sanctions-record", sss_mint, wallet]
#[account]
#[derive(InitSpace)]
pub struct SanctionsRecord {
    /// Whether this wallet is currently sanctioned.
    pub is_sanctioned: bool,
    /// Slot at which the oracle last updated this record.
    pub updated_slot: u64,
    pub bump: u8,
}

impl SanctionsRecord {
    pub const SEED: &'static [u8] = b"sanctions-record";
}

// ---------------------------------------------------------------------------
// SSS-151: InsuranceVault PDA
// ---------------------------------------------------------------------------

/// First-loss insurance vault PDA — holds collateral seeded by the issuer.
/// Seeds: [b"insurance-vault", sss_mint]
#[account]
#[derive(InitSpace)]
pub struct InsuranceVault {
    /// The SSS stablecoin mint this vault protects.
    pub sss_mint: Pubkey,
    /// The token account holding the vault's collateral.
    pub vault_token_account: Pubkey,
    /// Minimum seed as basis points of net_supply (e.g. 200 = 2%).
    pub min_seed_bps: u16,
    /// Current token balance in the vault (in collateral native units).
    pub current_balance: u64,
    /// Total tokens drawn from the vault to cover bad debt.
    pub total_drawn: u64,
    /// Per-event draw cap in bps of net_supply (0 = no cap).
    pub max_draw_per_event_bps: u16,
    /// True when current_balance >= required seed amount.
    pub adequately_seeded: bool,
    pub bump: u8,
}

impl InsuranceVault {
    pub const SEED: &'static [u8] = b"insurance-vault";

    /// Compute the required seed amount given the current net supply.
    pub fn required_seed_amount(&self, net_supply: u64) -> u64 {
        if self.min_seed_bps == 0 {
            return 0;
        }
        ((net_supply as u128)
            .saturating_mul(self.min_seed_bps as u128)
            .checked_div(10_000)
            .unwrap_or(0)) as u64
    }
}

// ---------------------------------------------------------------------------
// SSS-152: KeeperConfig PDA
// ---------------------------------------------------------------------------

/// Permissionless keeper / circuit-breaker configuration.
/// Seeds: [b"keeper-config", sss_mint]
#[account]
#[derive(InitSpace)]
pub struct KeeperConfig {
    /// The SSS stablecoin mint this config governs.
    pub sss_mint: Pubkey,
    /// Peg deviation in bps that triggers the circuit breaker (e.g. 200 = 2%).
    pub deviation_threshold_bps: u16,
    /// SOL reward paid to the keeper on a successful trigger (lamports).
    pub keeper_reward_lamports: u64,
    /// Minimum slots between consecutive circuit-breaker triggers.
    pub min_cooldown_slots: u64,
    /// Slots the peg must stay within threshold before auto-unpause.
    pub sustained_recovery_slots: u64,
    /// Target peg price in oracle units (e.g. 1_000_000 for 1.000000 USD).
    pub target_price: u64,
    /// Slot at which the circuit breaker was last triggered.
    pub last_trigger_slot: u64,
    /// Slot at which the price was last observed within threshold.
    pub last_within_threshold_slot: u64,
    pub bump: u8,
}

impl KeeperConfig {
    pub const SEED: &'static [u8] = b"keeper-config";
}

// ---------------------------------------------------------------------------
// SSS-138: MarketMakerConfig PDA
// ---------------------------------------------------------------------------

/// Market maker hooks configuration PDA.
/// Seeds: [b"market-maker-config", sss_mint]
#[account]
#[derive(InitSpace)]
pub struct MarketMakerConfig {
    /// The SSS stablecoin mint this config governs.
    pub sss_mint: Pubkey,
    /// Whitelisted market maker pubkeys (max 8).
    #[max_len(8)]
    pub whitelisted_mms: Vec<Pubkey>,
    /// Maximum tokens a MM may mint per slot.
    pub mm_mint_limit_per_slot: u64,
    /// Maximum tokens a MM may burn per slot.
    pub mm_burn_limit_per_slot: u64,
    /// Maximum allowed peg spread in bps before mm_mint/mm_burn are blocked.
    pub spread_bps: u16,
    /// Slot in which the last MM mint occurred (for rate limiting).
    pub last_mint_slot: u64,
    /// Total minted by MMs in `last_mint_slot`.
    pub mm_minted_this_slot: u64,
    /// Slot in which the last MM burn occurred (for rate limiting).
    pub last_burn_slot: u64,
    /// Total burned by MMs in `last_burn_slot`.
    pub mm_burned_this_slot: u64,
    pub bump: u8,
}

impl MarketMakerConfig {
    pub const SEED: &'static [u8] = b"market-maker-config";
    pub const MAX_MARKET_MAKERS: usize = 8;
}

// ---------------------------------------------------------------------------
// SSS-Bridge: BridgeConfig and ConsumedMessageId PDAs
// ---------------------------------------------------------------------------

/// Cross-chain bridge configuration PDA.
/// Seeds: [b"bridge-config", sss_mint]
#[account]
#[derive(InitSpace)]
pub struct BridgeConfig {
    /// The SSS stablecoin mint this bridge config belongs to.
    pub sss_mint: Pubkey,
    /// Bridge type: 0 = Wormhole, 1 = LayerZero.
    pub bridge_type: u8,
    /// The registered bridge program pubkey (relayer / VAA verifier).
    pub bridge_program: Pubkey,
    /// Maximum tokens per bridge_out transaction (0 = unlimited).
    pub max_bridge_amount_per_tx: u64,
    /// Bridge fee in basis points deducted on bridge_out.
    pub bridge_fee_bps: u16,
    /// Fee vault token account (receives bridge fees).
    pub fee_vault: Pubkey,
    /// Authority pubkey (matches config.authority at init).
    pub authority: Pubkey,
    /// Cumulative tokens bridged out.
    pub total_bridged_out: u64,
    /// Cumulative tokens bridged in.
    pub total_bridged_in: u64,
    pub bump: u8,
}

impl BridgeConfig {
    pub const SEED: &'static [u8] = b"bridge-config";
    pub const BRIDGE_TYPE_WORMHOLE: u8 = 0;
    pub const BRIDGE_TYPE_LAYERZERO: u8 = 1;
}

/// Replay-protection PDA for inbound bridge messages.
/// Seeds: [b"consumed-message-id", sss_mint, message_id]
#[account]
#[derive(InitSpace)]
pub struct ConsumedMessageId {
    /// The bridge message ID (VAA hash / LayerZero nonce hash).
    pub message_id: [u8; 32],
    /// The SSS stablecoin mint this record belongs to.
    pub sss_mint: Pubkey,
    pub bump: u8,
}

impl ConsumedMessageId {
    pub const SEED: &'static [u8] = b"consumed-message-id";
}

// ---------------------------------------------------------------------------
// SSS-129: ZK Credential PDAs
// ---------------------------------------------------------------------------

/// ZK credential registry — stores issuer Merkle root for Groth16 proofs.
/// Seeds: [b"credential-registry", sss_mint]
#[account]
#[derive(InitSpace)]
pub struct CredentialRegistry {
    /// The SSS stablecoin mint this registry belongs to.
    pub sss_mint: Pubkey,
    /// The designated credential issuer pubkey.
    pub issuer: Pubkey,
    /// Merkle root of the valid credential set (Groth16 verifying key).
    pub merkle_root: [u8; 32],
    /// TTL in slots for issued CredentialRecords.
    pub credential_ttl_slots: u64,
    /// Slot at which the root was last updated.
    pub updated_slot: u64,
    pub bump: u8,
}

impl CredentialRegistry {
    pub const SEED: &'static [u8] = b"credential-registry";
}

/// Per-holder ZK credential record.
/// Seeds: [b"credential-record", sss_mint, holder]
#[account]
#[derive(InitSpace)]
pub struct CredentialRecord {
    /// The SSS stablecoin mint this record is scoped to.
    pub sss_mint: Pubkey,
    /// The wallet that holds this credential.
    pub holder: Pubkey,
    /// Slot at which the credential was issued.
    pub issued_slot: u64,
    /// Slot at which this record expires.
    pub expires_slot: u64,
    /// True if the issuer has revoked this credential.
    pub revoked: bool,
    pub bump: u8,
}

impl CredentialRecord {
    pub const SEED: &'static [u8] = b"credential-record";
}

// ---------------------------------------------------------------------------
// SSS-131: LiquidationBonusConfig PDA
// ---------------------------------------------------------------------------

/// Graduated liquidation bonus tier configuration.
/// Seeds: [b"liquidation-bonus-config", sss_mint]
#[account]
#[derive(InitSpace)]
pub struct LiquidationBonusConfig {
    /// The SSS stablecoin mint this config governs.
    pub sss_mint: Pubkey,
    /// Authority (matches config.authority at init).
    pub authority: Pubkey,
    /// Collateral ratio threshold (in bps) above which tier1 bonus applies.
    pub tier1_threshold_bps: u16,
    /// Bonus in bps awarded when ratio is in tier1 range.
    pub tier1_bonus_bps: u16,
    /// Collateral ratio threshold (in bps) above which tier2 bonus applies.
    pub tier2_threshold_bps: u16,
    /// Bonus in bps awarded when ratio is in tier2 range.
    pub tier2_bonus_bps: u16,
    /// Collateral ratio threshold (in bps) above which tier3 bonus applies.
    pub tier3_threshold_bps: u16,
    /// Bonus in bps awarded when ratio is in tier3 range.
    pub tier3_bonus_bps: u16,
    /// Absolute maximum bonus in bps (safety cap).
    pub max_bonus_bps: u16,
    pub bump: u8,
}

impl LiquidationBonusConfig {
    pub const SEED: &'static [u8] = b"liquidation-bonus-config";
}

// ---------------------------------------------------------------------------
// SSS-130: PidConfig PDA
// ---------------------------------------------------------------------------

/// PID controller configuration for dynamic stability fee adjustment.
/// Seeds: [b"pid-config", sss_mint]
#[account]
#[derive(InitSpace)]
pub struct PidConfig {
    /// The SSS stablecoin mint this config governs.
    pub sss_mint: Pubkey,
    /// Proportional gain (scaled by 1_000_000).
    pub kp: i64,
    /// Integral gain (scaled by 1_000_000).
    pub ki: i64,
    /// Derivative gain (scaled by 1_000_000).
    pub kd: i64,
    /// Target peg price in oracle units (u64 for compatibility with oracle price u64 type).
    pub target_price: u64,
    /// Minimum stability fee in bps.
    pub min_fee_bps: u16,
    /// Maximum stability fee in bps.
    pub max_fee_bps: u16,
    /// Last error term (price deviation), scaled by 1_000_000.
    pub last_error: i64,
    /// Accumulated integral term.
    pub integral: i64,
    /// Slot at which the PID last ran.
    pub last_update_slot: u64,
    pub bump: u8,
}

impl PidConfig {
    pub const SEED: &'static [u8] = b"pid-config";
}

// ---------------------------------------------------------------------------
// SSS-132: PsmCurveConfig PDA
// ---------------------------------------------------------------------------

/// PSM AMM-style dynamic fee curve configuration.
/// Seeds: [b"psm-curve-config", sss_mint]
#[account]
#[derive(InitSpace)]
pub struct PsmCurveConfig {
    /// The SSS stablecoin mint this config governs.
    pub sss_mint: Pubkey,
    /// Authority (matches config.authority at init).
    pub authority: Pubkey,
    /// Base (minimum) fee in bps at perfect 50/50 balance.
    pub base_fee_bps: u16,
    /// Curve steepness parameter (scaled integer).
    pub curve_k: u64,
    /// Maximum fee in bps (safety cap).
    pub max_fee_bps: u16,
    pub bump: u8,
}

impl PsmCurveConfig {
    pub const SEED: &'static [u8] = b"psm-curve-config";
    pub const MAX_FEE_BPS: u16 = 1_000;

    /// Compute the dynamic fee for a swap given current vault balance and total reserves.
    pub fn compute_fee(&self, vault_amount: u64, total_reserves: u64) -> u16 {
        if total_reserves == 0 {
            return self.base_fee_bps;
        }
        let ideal = total_reserves / 2;
        let imbalance = if vault_amount > ideal {
            vault_amount - ideal
        } else {
            ideal - vault_amount
        };
        // fee_bps = base + curve_k * (imbalance / total_reserves)^2
        // Use fixed-point arithmetic to avoid overflow
        let imbalance_ratio = (imbalance as u128)
            .saturating_mul(1_000_000)
            .checked_div(total_reserves as u128)
            .unwrap_or(0);
        let delta = (self.curve_k as u128)
            .saturating_mul(imbalance_ratio)
            .saturating_mul(imbalance_ratio)
            .checked_div(1_000_000_000_000)
            .unwrap_or(0) as u16;
        let fee = self.base_fee_bps.saturating_add(delta);
        fee.min(self.max_fee_bps)
    }
}

// ---------------------------------------------------------------------------
// SSS-154: RedemptionQueue + RedemptionEntry PDAs
// ---------------------------------------------------------------------------

/// Redemption queue PDA — front-run-protected FIFO queue.
/// Seeds: [b"redemption-queue", sss_mint]
#[account]
#[derive(InitSpace)]
pub struct RedemptionQueue {
    /// The SSS stablecoin mint this queue serves.
    pub sss_mint: Pubkey,
    /// Index of the next entry to be fulfilled (FIFO head).
    pub queue_head: u64,
    /// Index of the next entry to be enqueued (tail).
    pub queue_tail: u64,
    /// Minimum slots a request must wait before it can be fulfilled.
    pub min_delay_slots: u64,
    /// Maximum number of pending entries.
    pub max_queue_depth: u64,
    /// Maximum redemption per slot expressed as bps of net_supply (0 = no cap).
    pub max_redemption_per_slot_bps: u16,
    /// Slot at which the last fulfillment occurred (for slot-cap tracking).
    pub last_slot_processed: u64,
    /// Total amount redeemed in `last_slot_processed`.
    pub slot_redemption_total: u64,
    /// SOL reward paid to the keeper who fulfills a redemption entry.
    pub keeper_reward_lamports: u64,
    pub bump: u8,
}

impl RedemptionQueue {
    pub const SEED: &'static [u8] = b"redemption-queue";
    /// Default minimum delay: ~5 minutes at 400ms/slot.
    pub const DEFAULT_MIN_DELAY_SLOTS: u64 = 750;
    /// Default maximum queue depth.
    pub const DEFAULT_MAX_QUEUE_DEPTH: u64 = 1_000;
    /// Default per-slot redemption cap: 1% of net_supply.
    pub const DEFAULT_MAX_REDEMPTION_PER_SLOT_BPS: u16 = 100;
    /// Default keeper reward: 0.001 SOL.
    pub const DEFAULT_KEEPER_REWARD_LAMPORTS: u64 = 1_000_000;
}

/// Individual entry in the redemption queue.
/// Seeds: [b"redemption-entry", sss_mint, queue_index.to_le_bytes()]
#[account]
#[derive(InitSpace)]
pub struct RedemptionEntry {
    /// Index within the queue (matches queue_tail at enqueue time).
    pub queue_index: u64,
    /// The wallet that submitted this redemption.
    pub owner: Pubkey,
    /// Amount of SSS tokens to redeem.
    pub amount: u64,
    /// Slot at which the request was enqueued.
    pub enqueue_slot: u64,
    /// Hash seed used for front-run protection (first 8 bytes of slot hash).
    pub slot_hash_seed: [u8; 8],
    /// True when the redemption has been fulfilled.
    pub fulfilled: bool,
    /// True when the redemption was cancelled by the owner.
    pub cancelled: bool,
    pub bump: u8,
}

impl RedemptionEntry {
    pub const SEED: &'static [u8] = b"redemption-entry";
}

// ---------------------------------------------------------------------------
// SSS-125: RedemptionGuarantee + RedemptionRequest PDAs
// ---------------------------------------------------------------------------

/// Redemption guarantee registry PDA — tracks SLA parameters.
/// Seeds: [b"redemption-guarantee", sss_mint]
#[account]
#[derive(InitSpace)]
pub struct RedemptionGuarantee {
    /// The SSS stablecoin mint this guarantee governs.
    pub sss_mint: Pubkey,
    /// The reserve vault used to source collateral for redemptions.
    pub reserve_vault: Pubkey,
    /// Maximum daily redemption amount in native token units (0 = unlimited).
    pub max_daily_redemption: u64,
    /// Amount redeemed in the current day window.
    pub daily_redeemed: u64,
    /// Slot at which the current day window started.
    pub day_start_slot: u64,
    /// SLA window in slots — redemption must be fulfilled within this window.
    pub sla_slots: u64,
    /// Slot at which this record was last updated.
    pub last_updated_slot: u64,
    pub bump: u8,
}

impl RedemptionGuarantee {
    pub const SEED: &'static [u8] = b"redemption-guarantee";
}

/// Per-user redemption request PDA.
/// Seeds: [b"redemption-request", sss_mint, user]
#[account]
#[derive(InitSpace)]
pub struct RedemptionRequest {
    /// The SSS stablecoin mint this request targets.
    pub sss_mint: Pubkey,
    /// The user who submitted this request.
    pub user: Pubkey,
    /// Amount of SSS tokens to redeem.
    pub amount: u64,
    /// Slot at which the request was submitted.
    pub requested_slot: u64,
    /// Slot at which this request expires (requested_slot + sla_slots).
    pub expiry_slot: u64,
    /// True once the redemption has been fulfilled.
    pub fulfilled: bool,
    /// True if the SLA was breached (expiry elapsed without fulfillment).
    pub sla_breached: bool,
    pub bump: u8,
}

impl RedemptionRequest {
    pub const SEED: &'static [u8] = b"redemption-request";
}

// ---------------------------------------------------------------------------
// SSS-137: RedemptionPool PDA
// ---------------------------------------------------------------------------

/// On-chain redemption pool for always-available par redemptions.
/// Seeds: [b"redemption-pool", sss_mint]
#[account]
#[derive(InitSpace)]
pub struct RedemptionPool {
    /// The SSS stablecoin mint this pool serves.
    pub sss_mint: Pubkey,
    /// The token account holding pool liquidity (collateral).
    pub reserve_vault: Pubkey,
    /// Current liquidity in the pool (in collateral native units).
    pub current_liquidity: u64,
    /// Maximum pool size in collateral native units.
    pub max_pool_size: u64,
    /// Instant redemption fee in basis points.
    pub instant_redemption_fee_bps: u16,
    /// Cumulative collateral seeded into the pool.
    pub total_seeded: u64,
    /// Cumulative SSS tokens redeemed via instant_redemption.
    pub total_redeemed: u64,
    /// Cumulative collateral replenished by permissionless top-ups.
    pub total_replenished: u64,
    /// Pool utilization in bps (current_liquidity / max_pool_size * 10000).
    pub utilization_bps: u16,
    pub bump: u8,
}

impl RedemptionPool {
    pub const SEED: &'static [u8] = b"redemption-pool";
    /// Maximum instant redemption fee: 5% (500 bps).
    pub const MAX_FEE_BPS: u16 = 500;
}

// ---------------------------------------------------------------------------
// SSS-Reserve: ReserveComposition PDA
// ---------------------------------------------------------------------------

/// On-chain reserve composition attestation.
/// Seeds: [b"reserve-composition", sss_mint]
#[account]
#[derive(InitSpace)]
pub struct ReserveComposition {
    /// The SSS stablecoin mint this composition belongs to.
    pub sss_mint: Pubkey,
    /// Cash and cash equivalents in basis points (0–10000).
    pub cash_bps: u16,
    /// US Treasury Bills in basis points (0–10000).
    pub t_bills_bps: u16,
    /// Crypto assets in basis points (0–10000).
    pub crypto_bps: u16,
    /// Other assets in basis points (0–10000).
    pub other_bps: u16,
    /// Slot at which this composition was last updated.
    pub last_updated_slot: u64,
    /// Pubkey that submitted the last update.
    pub last_updated_by: Pubkey,
    pub bump: u8,
}

impl ReserveComposition {
    pub const SEED: &'static [u8] = b"reserve-composition";
}

// ---------------------------------------------------------------------------
// SSS-134: SquadsMultisigConfig PDA
// ---------------------------------------------------------------------------

/// Squads V4 multisig configuration PDA.
/// Seeds: [b"squads-multisig-config", sss_mint]
#[account]
#[derive(InitSpace)]
pub struct SquadsMultisigConfig {
    /// The SSS stablecoin mint this config governs.
    pub sss_mint: Pubkey,
    /// The Squads V4 multisig PDA address.
    pub multisig_pda: Pubkey,
    /// Required approval threshold.
    pub threshold: u8,
    /// Member pubkeys (max 10).
    #[max_len(10)]
    pub members: Vec<Pubkey>,
    pub bump: u8,
}

impl SquadsMultisigConfig {
    pub const SEED: &'static [u8] = b"squads-multisig-config";
    pub const MAX_MEMBERS: usize = 10;

    /// Compute the required account space for a given member count.
    pub fn space(member_count: usize) -> usize {
        // discriminator(8) + sss_mint(32) + multisig_pda(32) + threshold(1) +
        // vec_len(4) + members(32 * member_count) + bump(1)
        8 + 32 + 32 + 1 + 4 + 32 * member_count + 1
    }
}

// ---------------------------------------------------------------------------
// SSS-127: TravelRuleRecord PDA
// ---------------------------------------------------------------------------

/// Travel Rule compliance record for a single transfer.
/// Seeds: [b"travel-rule-record", sss_mint, nonce.to_le_bytes()]
#[account]
#[derive(InitSpace)]
pub struct TravelRuleRecord {
    /// The SSS stablecoin mint this record belongs to.
    pub sss_mint: Pubkey,
    /// Unique nonce for this transfer (e.g. slot + tx index).
    pub nonce: u64,
    /// ECIES-encrypted payload (originator/beneficiary VASP data, 256 bytes).
    pub encrypted_payload: [u8; 256],
    /// Originator VASP pubkey.
    pub originator_vasp: Pubkey,
    /// Beneficiary VASP pubkey.
    pub beneficiary_vasp: Pubkey,
    /// Transfer amount in native token units.
    pub transfer_amount: u64,
    /// Slot at which this record was submitted.
    pub slot: u64,
    pub bump: u8,
}

impl TravelRuleRecord {
    pub const SEED: &'static [u8] = b"travel-rule-record";
}

// ---------------------------------------------------------------------------
// SSS-133: WalletRateLimit PDA
// ---------------------------------------------------------------------------

/// Per-wallet outbound transfer rate limit.
/// Seeds: [b"wallet-rate-limit", sss_mint, wallet]
#[account]
#[derive(InitSpace)]
pub struct WalletRateLimit {
    /// The SSS stablecoin mint this limit applies to.
    pub sss_mint: Pubkey,
    /// The wallet subject to this rate limit.
    pub wallet: Pubkey,
    /// Maximum tokens transferable within any `window_slots`-slot window.
    pub max_transfer_per_window: u64,
    /// Window duration in slots.
    pub window_slots: u64,
    /// Amount transferred in the current window.
    pub transferred_this_window: u64,
    /// Slot at which the current window started.
    pub window_start_slot: u64,
    pub bump: u8,
}

impl WalletRateLimit {
    pub const SEED: &'static [u8] = b"wallet-rate-limit";
}

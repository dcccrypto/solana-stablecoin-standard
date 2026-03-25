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
/// Proof-of-Reserves breach halts minting (SSS-123).
pub const FLAG_POR_HALT_ON_BREACH: u64 = 1 << 16;

/// Cross-chain bridge flag (bit 13): when set, `bridge_out` and `bridge_in`
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

/// SSS-153: Multi-oracle consensus flag (bit 22): when set, `update_oracle_consensus`
/// is the canonical price source for CDP, circuit breaker, and any instruction that
/// reads oracle price.  Requires an `OracleConsensus` PDA via `init_oracle_consensus`.
pub const FLAG_MULTI_ORACLE_CONSENSUS: u64 = 1 << 22;

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
    /// SSS-119: Minimum reserve ratio (basis points) for ReserveBreach event.
    /// 0 = no minimum enforced.  e.g. 10_000 = 100% fully backed required.
    pub min_reserve_ratio_bps: u16,
    /// SSS-119: Whitelisted custodian pubkeys allowed to submit reserve attestations.
    /// Up to MAX_RESERVE_ATTESTORS entries; unused slots are Pubkey::default().
    pub reserve_attestor_whitelist: [Pubkey; StablecoinConfig::MAX_RESERVE_ATTESTORS],
    /// SSS-127: Minimum transfer amount (in token native units) that requires a
    /// TravelRuleRecord PDA when FLAG_TRAVEL_RULE is set.  0 = Travel Rule disabled.
    pub travel_rule_threshold: u64,
    /// SSS-128: Pubkey of the registered sanctions oracle signer.
    /// When non-default, the oracle calls `update_sanctions_record` to write
    /// `SanctionsRecord` PDAs. Transfer hook rejects sanctioned senders when
    /// FLAG_SANCTIONS_ORACLE is set.  Pubkey::default() = sanctions oracle disabled.
    pub sanctions_oracle: Pubkey,
    /// SSS-128: Maximum age in slots for a SanctionsRecord to be considered fresh.
    /// 0 = staleness check disabled (is_sanctioned is authoritative regardless of age).
    /// Recommended: 150 slots (~1 min at 400 ms/slot).
    pub sanctions_max_staleness_slots: u64,
    /// SSS-119: Program config schema version, incremented by `upgrade_config`.
    /// Instructions that require a minimum schema version (e.g. CDP borrow, burn)
    /// check this against `MIN_SUPPORTED_VERSION`.
    pub version: u8,
    /// SSS-119: Oracle type for CDP price reads.
    /// 0 = Pyth, 1 = Switchboard (stub), 2 = Custom (CustomPriceFeed PDA).
    /// Set via `set_oracle_config` (authority-only).
    pub oracle_type: u8,
    /// SSS-119: Oracle feed account address.
    /// For Pyth: the Pyth price feed pubkey.
    /// For Custom: the CustomPriceFeed PDA pubkey.
    /// Pubkey::default() = feed address enforcement disabled.
    pub oracle_feed: Pubkey,
    /// SSS-134: Squads Protocol V4 multisig PDA acting as program authority.
    /// Pubkey::default() = Squads authority not configured.
    /// Set by `init_squads_authority` (irreversible); also sets FLAG_SQUADS_AUTHORITY.
    pub squads_multisig: Pubkey,
    pub bump: u8,
}

impl StablecoinConfig {
    pub const SEED: &'static [u8] = b"stablecoin-config";
    /// Maximum number of whitelisted reserve attestors (custodians / Pyth publishers).
    pub const MAX_RESERVE_ATTESTORS: usize = 4;

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
// SSS-123: Proof of Reserves — trustless on-chain PoR attestation
// ---------------------------------------------------------------------------

/// ProofOfReserves PDA — one per stablecoin mint.
/// Seeds: [b"proof-of-reserves", sss_mint]
///
/// Stores the latest reserve attestation submitted by a whitelisted attestor
/// (authority, Pyth publisher, or custodian pubkey).
/// `verify_reserve_ratio` computes reserve_amount / net_supply and emits events.
#[account]
#[derive(InitSpace)]
pub struct ProofOfReserves {
    /// The SSS stablecoin mint this record belongs to.
    pub sss_mint: Pubkey,
    /// Last submitted reserve amount (in collateral token native units).
    pub reserve_amount: u64,
    /// 32-byte attestation hash (e.g. SHA-256 of off-chain audit report or Pyth price feed id).
    pub attestation_hash: [u8; 32],
    /// Pubkey of the entity that submitted the latest attestation.
    pub attestor: Pubkey,
    /// Solana slot at which the latest attestation was submitted.
    pub last_attestation_slot: u64,
    /// Last computed reserve ratio in basis points (set by verify_reserve_ratio).
    pub last_verified_ratio_bps: u64,
    pub bump: u8,
}

impl ProofOfReserves {
    pub const SEED: &'static [u8] = b"proof-of-reserves";
}

// ---------------------------------------------------------------------------
// SSS-124: Reserve Composition — on-chain breakdown of backing asset types
// ---------------------------------------------------------------------------

/// ReserveComposition PDA — one per stablecoin mint.
/// Seeds: [b"reserve-composition", sss_mint]
///
/// Stores the percentage breakdown of reserve backing assets in basis points.
/// All four fields must sum to exactly 10_000 (100%).
/// Updated by the stablecoin authority via `update_reserve_composition`.
#[account]
#[derive(InitSpace)]
pub struct ReserveComposition {
    /// The SSS stablecoin mint this record belongs to.
    pub sss_mint: Pubkey,
    /// Cash and cash equivalents (basis points, 0–10000).
    pub cash_bps: u16,
    /// US Treasury Bills (basis points, 0–10000).
    pub t_bills_bps: u16,
    /// Crypto assets (basis points, 0–10000).
    pub crypto_bps: u16,
    /// Other assets (basis points, 0–10000).
    pub other_bps: u16,
    /// Solana slot at which composition was last updated.
    pub last_updated_slot: u64,
    /// Authority who last submitted the composition update.
    pub last_updated_by: Pubkey,
    pub bump: u8,
}

impl ReserveComposition {
    pub const SEED: &'static [u8] = b"reserve-composition";

    /// Validate that all four bps fields sum to exactly 10_000.
    pub fn validate(&self) -> bool {
        (self.cash_bps as u32)
            .saturating_add(self.t_bills_bps as u32)
            .saturating_add(self.crypto_bps as u32)
            .saturating_add(self.other_bps as u32)
            == 10_000
    }
}

// ---------------------------------------------------------------------------
// SSS-125: Redemption Guarantee — enforceable redemption SLA
// ---------------------------------------------------------------------------

/// RedemptionGuarantee PDA — one per stablecoin mint.
/// Seeds: [b"redemption-guarantee", sss_mint]
///
/// Stores pool config: which reserve vault backs redemptions, the max daily
/// limit, and the SLA window in slots.
#[account]
#[derive(InitSpace)]
pub struct RedemptionGuarantee {
    /// The SSS stablecoin mint this pool belongs to.
    pub sss_mint: Pubkey,
    /// The reserve vault pubkey (token account) used to pay out redemptions.
    pub reserve_vault: Pubkey,
    /// Maximum total stable tokens redeemable within a single day-window.
    pub max_daily_redemption: u64,
    /// Running total redeemed in the current day-window.
    pub daily_redeemed: u64,
    /// Slot at which the current day-window started.
    pub day_start_slot: u64,
    /// SLA in slots: user must be fulfilled within this many slots of request.
    /// Default: 450 slots (~3 min). Breach triggers penalty from insurance fund.
    pub sla_slots: u64,
    /// Last slot at which pool params were updated.
    pub last_updated_slot: u64,
    pub bump: u8,
}

impl RedemptionGuarantee {
    pub const SEED: &'static [u8] = b"redemption-guarantee";
}

/// RedemptionRequest PDA — one per (mint, user) at a time.
/// Seeds: [b"redemption-request", sss_mint, user]
///
/// Created by `request_redemption`; closed when fulfilled or expired.
#[account]
#[derive(InitSpace)]
pub struct RedemptionRequest {
    /// The SSS stablecoin mint.
    pub sss_mint: Pubkey,
    /// The user who initiated the redemption.
    pub user: Pubkey,
    /// Amount of stable tokens to redeem (in token native units).
    pub amount: u64,
    /// Slot at which the request was made.
    pub requested_slot: u64,
    /// Slot by which the request must be fulfilled (requested_slot + sla_slots).
    pub expiry_slot: u64,
    /// True once `fulfill_redemption` succeeds.
    pub fulfilled: bool,
    /// True once `claim_expired_redemption` fires the SLA breach penalty.
    pub sla_breached: bool,
    pub bump: u8,
}

impl RedemptionRequest {
    pub const SEED: &'static [u8] = b"redemption-request";
}

// ---------------------------------------------------------------------------
// SSS-127: Travel Rule — VASP-to-VASP compliance data sharing
// ---------------------------------------------------------------------------

/// TravelRuleRecord PDA — one per transfer that meets the threshold.
/// Seeds: [b"travel-rule-record", sss_mint, &nonce.to_le_bytes()]
///
/// Created by `submit_travel_rule_record` in the same transaction as a transfer.
/// When FLAG_TRAVEL_RULE is set and amount >= travel_rule_threshold, the transfer
/// hook verifies this PDA exists before allowing the transfer through.
///
/// The `encrypted_payload` field carries VASP-to-VASP data encrypted to the
/// beneficiary VASP's key using an agreed-upon ECIES or similar scheme.
/// The program does not interpret payload contents — it only stores/verifies presence.
#[account]
#[derive(InitSpace)]
pub struct TravelRuleRecord {
    /// The SSS stablecoin mint this record belongs to.
    pub sss_mint: Pubkey,
    /// Monotonic nonce used to derive the PDA seed (caller-chosen, must be unique per transfer).
    pub nonce: u64,
    /// Encrypted originator/beneficiary data (256 bytes, VASP-encrypted, opaque to program).
    pub encrypted_payload: [u8; 256],
    /// Pubkey of the originating VASP.
    pub originator_vasp: Pubkey,
    /// Pubkey of the beneficiary VASP.
    pub beneficiary_vasp: Pubkey,
    /// Transfer amount this record covers (in token native units).
    pub transfer_amount: u64,
    /// Solana slot at which this record was submitted.
    pub slot: u64,
    pub bump: u8,
}

impl TravelRuleRecord {
    pub const SEED: &'static [u8] = b"travel-rule-record";
}

// ---------------------------------------------------------------------------
// SSS-128: Sanctions screening oracle — pluggable OFAC/sanctions list integration
// ---------------------------------------------------------------------------

/// SanctionsRecord PDA — written by the registered oracle signer via
/// `update_sanctions_record`, read by the transfer hook when FLAG_SANCTIONS_ORACLE is set.
///
/// Seeds: [b"sanctions-record", sss_mint, wallet_pubkey]
///
/// Any compliance provider (Chainalysis, Elliptic, TRM) implements the oracle role
/// by calling `update_sanctions_record` as the registered `sanctions_oracle` signer.
/// The program is oracle-agnostic — it only verifies the signer matches
/// `StablecoinConfig.sanctions_oracle`.
#[account]
#[derive(InitSpace)]
pub struct SanctionsRecord {
    /// Whether this wallet is currently on the sanctions list.
    pub is_sanctioned: bool,
    /// Solana slot at which this record was last updated by the oracle.
    pub updated_slot: u64,
    pub bump: u8,
}

impl SanctionsRecord {
    pub const SEED: &'static [u8] = b"sanctions-record";
}

// ---------------------------------------------------------------------------
// SSS-129: ZK credential registry — Groth16-based selective disclosure
// ---------------------------------------------------------------------------

/// CredentialRegistry PDA — one per stablecoin mint when FLAG_ZK_CREDENTIALS is set.
/// Seeds: [b"credential-registry", sss_mint]
///
/// Stores the Groth16 Merkle root of the credential set and the issuer authority.
/// The authority can rotate the `merkle_root` as the credential set evolves.
/// The transfer hook reads this PDA to verify `CredentialRecord` proofs.
#[account]
#[derive(InitSpace)]
pub struct CredentialRegistry {
    /// The SSS stablecoin mint this registry belongs to.
    pub sss_mint: Pubkey,
    /// Authority allowed to rotate the Merkle root and revoke credentials.
    pub issuer: Pubkey,
    /// Groth16 Merkle root of the current credential set (32 bytes).
    pub merkle_root: [u8; 32],
    /// Maximum slots a CredentialRecord remains valid after issuance (0 = never expires).
    pub credential_ttl_slots: u64,
    /// Slot at which the registry was last updated.
    pub updated_slot: u64,
    pub bump: u8,
}

impl CredentialRegistry {
    pub const SEED: &'static [u8] = b"credential-registry";
}

/// CredentialRecord PDA — one per (mint, holder) pair.
/// Seeds: [b"credential-record", sss_mint, holder_pubkey]
///
/// Created by `verify_zk_credential` after on-chain Groth16 proof validation.
/// The transfer hook checks this PDA when FLAG_ZK_CREDENTIALS is set — if absent
/// or expired, the transfer is rejected with CredentialRequired.
#[account]
#[derive(InitSpace)]
pub struct CredentialRecord {
    /// The SSS stablecoin mint this record is scoped to.
    pub sss_mint: Pubkey,
    /// Wallet that holds this credential.
    pub holder: Pubkey,
    /// Slot at which the credential was issued (via verify_zk_credential).
    pub issued_slot: u64,
    /// Slot after which the credential is no longer valid (0 = never expires).
    pub expires_slot: u64,
    /// Whether this credential has been explicitly revoked by the issuer.
    pub revoked: bool,
    pub bump: u8,
}

impl CredentialRecord {
    pub const SEED: &'static [u8] = b"credential-record";

    /// Returns true if the record is currently valid at the given slot.
    pub fn is_valid(&self, current_slot: u64) -> bool {
        if self.revoked {
            return false;
        }
        if self.expires_slot > 0 && current_slot > self.expires_slot {
            return false;
        }
        true
    }
}

// ---------------------------------------------------------------------------
// SSS-130: Stability fee PID auto-adjustment
// ---------------------------------------------------------------------------

/// PidConfig PDA — one per stablecoin mint when FLAG_PID_FEE_CONTROL is set.
/// Seeds: [b"pid-config", sss_mint]
///
/// Stores PID gains and state.  `update_stability_fee_pid` is permissionless:
/// any keeper can call it to push a fresh oracle price and have the controller
/// adjust `stability_fee_bps` in `StablecoinConfig` automatically.
#[account]
#[derive(InitSpace)]
pub struct PidConfig {
    /// The SSS stablecoin mint this config belongs to.
    pub sss_mint: Pubkey,
    /// Proportional gain (scaled by 1_000_000; e.g. 0.001 → 1_000)
    pub kp: i64,
    /// Integral gain (scaled by 1_000_000)
    pub ki: i64,
    /// Derivative gain (scaled by 1_000_000)
    pub kd: i64,
    /// Target peg price in oracle units (e.g. 1_000_000 for $1.00 with 6 dec)
    pub target_price: u64,
    /// Minimum stability fee in bps (floor clamping)
    pub min_fee_bps: u16,
    /// Maximum stability fee in bps (ceiling clamping)
    pub max_fee_bps: u16,
    /// Last error value (target - observed), carried for derivative term
    pub last_error: i64,
    /// Running integral of error (clamped to ±1e9 for anti-windup)
    pub integral: i64,
    /// Slot at which update_stability_fee_pid was last called
    pub last_update_slot: u64,
    pub bump: u8,
}

impl PidConfig {
    pub const SEED: &'static [u8] = b"pid-config";
}

// ---------------------------------------------------------------------------
// SSS-120: Authority rotation request PDA
// ---------------------------------------------------------------------------

/// AuthorityRotationRequest PDA — created by `propose_authority_rotation`.
/// Seeds: [b"authority-rotation-request", sss_mint]
///
/// Stores the pending rotation proposal including new authority, backup authority,
/// and timing constraints.  Closed (reclaimed) on accept, emergency_recover, or cancel.
#[account]
pub struct AuthorityRotationRequest {
    /// The mint this rotation request applies to.
    pub config_mint: Pubkey,
    /// The current authority (must sign the proposal).
    pub current_authority: Pubkey,
    /// The proposed new authority (must accept within timelock window).
    pub new_authority: Pubkey,
    /// Backup authority (can emergency-recover after 7-day window).
    pub backup_authority: Pubkey,
    /// Slot at which the proposal was submitted.
    pub proposed_slot: u64,
    /// Number of slots to wait before new_authority can accept (default: 432_000 = ~48h).
    pub timelock_slots: u64,
    pub bump: u8,
}

impl AuthorityRotationRequest {
    pub const SEED: &'static [u8] = b"authority-rotation-request";
    /// Anchor account space: 32+32+32+32+8+8+1 = 145 bytes
    pub const SPACE: usize = 32 + 32 + 32 + 32 + 8 + 8 + 1;
}

// ---------------------------------------------------------------------------
// SSS-121: Guardian multisig pause config
// ---------------------------------------------------------------------------

/// GuardianConfig PDA — one per stablecoin config when guardians are registered.
/// Seeds: [b"guardian-config", stablecoin_config_pubkey]
///
/// Stores up to MAX_GUARDIANS guardian pubkeys, threshold, and pending lift-vote state.
#[account]
#[derive(InitSpace)]
pub struct GuardianConfig {
    /// The StablecoinConfig this guardian set is attached to.
    pub config: Pubkey,
    /// Up to 7 guardian pubkeys.
    #[max_len(7)]
    pub guardians: Vec<Pubkey>,
    /// Number of YES votes required to pause (e.g. 3 for a 3-of-5 setup).
    pub threshold: u8,
    /// Monotonically increasing proposal ID counter.
    pub next_proposal_id: u64,
    /// Guardians who have voted to lift the current pause (cleared on lift).
    #[max_len(7)]
    pub pending_lift_votes: Vec<Pubkey>,
    pub bump: u8,
}

impl GuardianConfig {
    pub const SEED: &'static [u8] = b"guardian-config";
    /// Maximum number of guardians in a single config.
    pub const MAX_GUARDIANS: usize = 7;
}

/// PauseProposal PDA — one per open pause proposal.
/// Seeds: [b"pause-proposal", stablecoin_config_pubkey, proposal_id_le_bytes]
///
/// Auto-executes (pauses mint) once `votes.len() >= threshold`.
#[account]
#[derive(InitSpace)]
pub struct PauseProposal {
    /// The StablecoinConfig this proposal targets.
    pub config: Pubkey,
    /// Monotonic proposal index.
    pub proposal_id: u64,
    /// Guardian who opened the proposal.
    pub proposer: Pubkey,
    /// UTF-8 reason bytes (fixed 32-byte array, zero-padded).
    pub reason: [u8; 32],
    /// List of guardian pubkeys that have voted YES.
    #[max_len(7)]
    pub votes: Vec<Pubkey>,
    /// Threshold snapshot at proposal time.
    pub threshold: u8,
    /// Whether the proposal has already executed (paused the mint).
    pub executed: bool,
    pub bump: u8,
}

impl PauseProposal {
    pub const SEED: &'static [u8] = b"pause-proposal";
    /// Maximum number of YES votes that can be stored (= MAX_GUARDIANS).
    pub const MAX_VOTES: usize = 7;
}

// ---------------------------------------------------------------------------
// SSS-119: Custom price feed PDA
// ---------------------------------------------------------------------------

/// CustomPriceFeed PDA — authority-maintained price feed for the Custom oracle type.
/// Seeds: [b"custom-price-feed", sss_mint]
///
/// The authority calls `update_custom_price` to publish a new price.
/// `oracle/custom.rs` reads this PDA when oracle_type == ORACLE_CUSTOM.
#[account]
#[derive(InitSpace)]
pub struct CustomPriceFeed {
    /// The authority who may update this feed (must match StablecoinConfig.authority).
    pub authority: Pubkey,
    /// Latest price value (signed, Pyth-compatible). Positive values only are valid.
    /// e.g. price=1_00000000, expo=-8 → $1.00 USD.
    pub price: i64,
    /// Price exponent (e.g. -8 means price * 10^-8 gives the real-world value).
    pub expo: i32,
    /// Confidence half-interval in the same units as `price`. 0 = no uncertainty stated.
    pub conf: u64,
    /// Slot at which `update_custom_price` was last called.
    pub last_update_slot: u64,
    /// Unix timestamp at which `update_custom_price` was last called.
    pub last_update_unix_timestamp: i64,
    pub bump: u8,
}

impl CustomPriceFeed {
    pub const SEED: &'static [u8] = b"custom-price-feed";
}

// ---------------------------------------------------------------------------
// SSS-131: Graduated liquidation bonus PDA
// ---------------------------------------------------------------------------

/// LiquidationBonusConfig PDA — one per stablecoin mint when FLAG_GRAD_LIQUIDATION_BONUS is set.
/// Seeds: [b"liquidation-bonus-config", sss_mint]
///
/// Replaces the flat `CollateralConfig.liquidation_bonus_bps` with a three-tier
/// graduated schedule.  Each tier is activated when the CDP collateral ratio is
/// **below** its threshold (expressed in basis points, e.g. 10000 = 100%).
///
/// Tier evaluation order (most-distressed first):
///   ratio < tier3_threshold_bps  →  tier3_bonus_bps   (e.g. <80% → 12%)
///   ratio < tier2_threshold_bps  →  tier2_bonus_bps   (e.g. <90% → 8%)
///   ratio < tier1_threshold_bps  →  tier1_bonus_bps   (e.g. <100% → 5%)
///
/// All thresholds must satisfy: tier3 < tier2 < tier1 ≤ 15000 (150%).
/// All bonuses must satisfy: tier1 ≤ tier2 ≤ tier3 ≤ max_bonus_bps ≤ 5000 (50%).
#[account]
#[derive(InitSpace)]
pub struct LiquidationBonusConfig {
    /// The stablecoin mint this config belongs to.
    pub sss_mint: Pubkey,
    /// Authority that may update this config (= StablecoinConfig.authority).
    pub authority: Pubkey,

    // --- Tier 1: mildly undercollateralised ---
    /// Collateral-ratio upper threshold for tier 1 (bps, e.g. 10000 = 100%).
    /// A CDP with ratio in [tier2, tier1) gets tier1_bonus_bps.
    pub tier1_threshold_bps: u16,
    /// Bonus awarded in tier 1 (bps, e.g. 500 = 5%).
    pub tier1_bonus_bps: u16,

    // --- Tier 2: moderately undercollateralised ---
    pub tier2_threshold_bps: u16,
    pub tier2_bonus_bps: u16,

    // --- Tier 3: severely undercollateralised ---
    pub tier3_threshold_bps: u16,
    pub tier3_bonus_bps: u16,

    /// Hard ceiling on any bonus regardless of tier (bps, e.g. 2000 = 20%).
    /// The Kani proof `proof_liquidation_bonus_bounded` verifies this invariant.
    pub max_bonus_bps: u16,

    pub bump: u8,
}

impl LiquidationBonusConfig {
    pub const SEED: &'static [u8] = b"liquidation-bonus-config";

    /// Compute the graduated bonus for a given collateral ratio.
    ///
    /// Tier thresholds define upper bounds of distress ranges:
    ///   ratio < tier3_threshold         → tier3 (most distressed, highest bonus)
    ///   tier3 <= ratio < tier2_threshold → tier2 (medium distress)
    ///   tier2 <= ratio < tier1_threshold → tier1 (mild distress, smallest bonus)
    ///   ratio >= tier1_threshold         → 0 (fully collateralized, no bonus)
    ///
    /// The original code returned tier1_bonus for ALL ratios >= tier2_threshold,
    /// including fully-collateralized positions. This fix adds the tier1_threshold
    /// upper bound to return 0 when the position is not in a distressed range.
    #[inline]
    pub fn bonus_for_ratio(&self, ratio_bps: u128) -> u16 {
        let raw = if ratio_bps < self.tier3_threshold_bps as u128 {
            self.tier3_bonus_bps
        } else if ratio_bps < self.tier2_threshold_bps as u128 {
            self.tier2_bonus_bps
        } else if ratio_bps < self.tier1_threshold_bps as u128 {
            self.tier1_bonus_bps
        } else {
            // Above tier1 threshold — fully collateralized, no graduated bonus
            0
        };
        raw.min(self.max_bonus_bps)
    }
}

// ---------------------------------------------------------------------------
// SSS-132: PSM dynamic AMM-style slippage curves
// ---------------------------------------------------------------------------

/// PsmCurveConfig PDA — one per stablecoin mint when FLAG_PSM_DYNAMIC_FEES is set.
/// Seeds: [b"psm-curve-config", sss_mint]
///
/// Replaces the flat `redemption_fee_bps` with a depth-based AMM fee curve:
///
///   fee_bps = base_fee_bps + k * (imbalance / total_reserves)^2
///
/// where imbalance = |vault_amount - ideal_balance|, ideal_balance = total_reserves / 2,
/// and k = `curve_k` (the "steepness" amplifier).  The result is clamped to [0, max_fee_bps].
///
/// When the PSM pool is perfectly balanced (50/50), the fee equals `base_fee_bps`.
/// As the pool becomes one-sided, fees increase quadratically up to `max_fee_bps`.
///
/// The `get_psm_quote` read-only instruction uses this PDA to return a fee estimate
/// for frontends without executing a swap.
#[account]
#[derive(InitSpace)]
pub struct PsmCurveConfig {
    /// The SSS stablecoin mint this config belongs to.
    pub sss_mint: Pubkey,
    /// Authority that may update this config (= StablecoinConfig.authority).
    pub authority: Pubkey,
    /// Base fee in basis points when the pool is perfectly balanced (e.g. 5 = 0.05%).
    /// Must be ≤ max_fee_bps.
    pub base_fee_bps: u16,
    /// Curve steepness amplifier (k).  Fee delta = k * (imbalance_ratio)^2 in bps.
    /// Stored scaled by 1_000_000 so fractional k values are representable.
    /// e.g. k=500_000 means at 100% imbalance, delta = 500_000 * 1 / 1_000_000 = 0.5 bps.
    /// A k of 10_000_000_000 at full imbalance adds 10_000 bps (100%) — clamped to max.
    pub curve_k: u64,
    /// Maximum fee in basis points (ceiling clamping, e.g. 500 = 5%).
    /// Must be ≤ MAX_PSM_CURVE_FEE_BPS (2000 = 20%).
    pub max_fee_bps: u16,
    pub bump: u8,
}

impl PsmCurveConfig {
    pub const SEED: &'static [u8] = b"psm-curve-config";
    /// Absolute ceiling on PSM dynamic fees: 20% (2000 bps).
    pub const MAX_FEE_BPS: u16 = 2_000;

    /// Compute the dynamic PSM fee for a given vault state.
    ///
    /// `vault_amount`:   current collateral held in the PSM reserve vault (native units).
    /// `total_reserves`: total collateral including all sources (used as denominator).
    ///
    /// Returns fee_bps clamped to [base_fee_bps, max_fee_bps].
    ///
    /// If `total_reserves` == 0, returns `base_fee_bps` (no imbalance can be computed).
    pub fn compute_fee(&self, vault_amount: u64, total_reserves: u64) -> u16 {
        if total_reserves == 0 {
            return self.base_fee_bps;
        }

        // ideal_balance = total_reserves / 2 (perfect 50/50 balance point)
        let ideal: u128 = total_reserves as u128 / 2;
        let vault: u128 = vault_amount as u128;

        // imbalance = |vault - ideal| in [0, total_reserves/2]
        let imbalance: u128 = if vault > ideal {
            vault - ideal
        } else {
            ideal - vault
        };

        // imbalance_ratio = imbalance / total_reserves  in [0, 1], scaled as u128 * 1e12
        // imbalance_ratio^2 = imbalance^2 / total_reserves^2, scaled as u128 * 1e12
        // To avoid overflow: we compute (imbalance * 1_000_000)^2 / total_reserves^2
        // but that can overflow. Use 32-bit precision: ratio_1e6 = imbalance * 1_000_000 / total_reserves
        let ratio_1e6: u128 = imbalance
            .saturating_mul(1_000_000)
            .checked_div(total_reserves as u128)
            .unwrap_or(0);

        // ratio_squared_1e12 = ratio_1e6^2 (dimensionless, 1e12 scale)
        let ratio_sq_1e12: u128 = ratio_1e6.saturating_mul(ratio_1e6);

        // fee_delta_bps = curve_k * ratio_sq / 1e12
        // curve_k already encodes the desired bps delta at full imbalance
        let fee_delta_bps: u128 = (self.curve_k as u128)
            .saturating_mul(ratio_sq_1e12)
            .checked_div(1_000_000_000_000u128)
            .unwrap_or(0);

        let raw_fee = (self.base_fee_bps as u128).saturating_add(fee_delta_bps);
        let clamped = raw_fee.min(self.max_fee_bps as u128) as u16;
        clamped
    }
}

// ---------------------------------------------------------------------------
// SSS-133: Per-wallet rate limiting — WalletRateLimit PDA
// ---------------------------------------------------------------------------

/// Per-wallet rolling-window transfer rate limit.
///
/// Seeds: [b"wallet-rate-limit", sss_mint, wallet]
///
/// Created by `set_wallet_rate_limit` (authority-only).
/// Closed by `remove_wallet_rate_limit` (authority-only).
///
/// When FLAG_WALLET_RATE_LIMITS is set and a `WalletRateLimit` PDA exists for
/// the sender, the transfer hook enforces:
///
///   if current_slot < window_start_slot + window_slots:
///       # still in same window
///       require transferred_this_window + amount <= max_transfer_per_window
///       transferred_this_window += amount
///   else:
///       # window elapsed — reset
///       window_start_slot = current_slot
///       transferred_this_window = amount
///       require transferred_this_window <= max_transfer_per_window
///
/// The `transferred_this_window` and `window_start_slot` fields are updated
/// **in the transfer hook** (account must be passed as writable).
#[account]
#[derive(InitSpace)]
pub struct WalletRateLimit {
    /// The SSS mint this limit applies to.
    pub sss_mint: Pubkey,
    /// The wallet (token account owner) being rate-limited.
    pub wallet: Pubkey,
    /// Maximum tokens allowed to transfer per window.
    pub max_transfer_per_window: u64,
    /// Window duration in slots.
    pub window_slots: u64,
    /// Tokens transferred in the current window (reset when window elapses).
    pub transferred_this_window: u64,
    /// Slot at which the current window started.
    pub window_start_slot: u64,
    pub bump: u8,
}

impl WalletRateLimit {
    pub const SEED: &'static [u8] = b"wallet-rate-limit";
}

// ---------------------------------------------------------------------------
// SSS-134: SquadsMultisigConfig PDA — threshold + member list for SDK use
// ---------------------------------------------------------------------------

/// Per-stablecoin metadata for the Squads V4 multisig authority.
///
/// Seeds: [b"squads-multisig-config", sss_mint]
///
/// Created atomically by `init_squads_authority`.
/// Threshold and member list are informational — enforcement is delegated to
/// the Squads on-chain program.  The PDA pubkey itself (`multisig_pda`) is the
/// canonical signer that must be present for authority-gated instructions.
#[account]
pub struct SquadsMultisigConfig {
    /// The SSS mint this multisig config belongs to.
    pub sss_mint: Pubkey,
    /// The Squads V4 multisig PDA — the account that must sign authority ops.
    pub multisig_pda: Pubkey,
    /// Approval threshold (m of n). Informational; enforced by Squads program.
    pub threshold: u8,
    /// Member pubkeys (up to MAX_MEMBERS = 10).
    pub members: Vec<Pubkey>,
    pub bump: u8,
}

impl SquadsMultisigConfig {
    pub const SEED: &'static [u8] = b"squads-multisig-config";
    pub const MAX_MEMBERS: usize = 10;

    /// Returns account space for a given member count (excluding Anchor 8-byte discriminator).
    pub fn space(member_count: usize) -> usize {
        // sss_mint: 32, multisig_pda: 32, threshold: 1,
        // members: 4 (vec len) + 32 * member_count, bump: 1
        32 + 32 + 1 + 4 + 32 * member_count + 1
    }
}

// ---------------------------------------------------------------------------
// SSS-135: Cross-Chain Bridge — BridgeConfig PDA
// ---------------------------------------------------------------------------

/// Cross-chain bridge configuration PDA — one per stablecoin mint.
/// Seeds: [b"bridge-config", sss_mint]
///
/// Stores bridge type, bridge program address, per-tx limits and fee.
/// Created by `init_bridge_config`; activated by enabling FLAG_BRIDGE_ENABLED
/// via `set_feature_flag` (subject to admin timelock).
#[account]
#[derive(InitSpace)]
pub struct BridgeConfig {
    /// The SSS stablecoin mint this config belongs to.
    pub sss_mint: Pubkey,
    /// Bridge type: 1 = Wormhole, 2 = LayerZero.
    pub bridge_type: u8,
    /// Address of the bridge program (Wormhole core bridge or LayerZero endpoint).
    /// `bridge_in` verifies proofs by CPI to this program in production.
    pub bridge_program: Pubkey,
    /// Maximum tokens per bridge_out transaction (0 = unlimited).
    pub max_bridge_amount_per_tx: u64,
    /// Bridge fee in basis points (e.g. 10 = 0.1%). Max 1000 bps (10%).
    /// Deducted from bridge_out amount; fee is sent to fee_vault.
    pub bridge_fee_bps: u16,
    /// Protocol fee vault token account address (receives fee tokens).
    pub fee_vault: Pubkey,
    /// Authorized relayer pubkey — the only signer allowed to call `bridge_in`.
    /// Set to the bridge program's expected relayer / crank authority.
    pub authority: Pubkey,
    /// Running total of tokens bridged out (net of fees).
    pub total_bridged_out: u64,
    /// Running total of tokens bridged in.
    pub total_bridged_in: u64,
    pub bump: u8,
}

impl BridgeConfig {
    pub const SEED: &'static [u8] = b"bridge-config";
    /// Bridge type: Wormhole
    pub const BRIDGE_TYPE_WORMHOLE: u8 = 1;
    /// Bridge type: LayerZero
    pub const BRIDGE_TYPE_LAYERZERO: u8 = 2;
}

/// Replay-protection PDA — one per consumed cross-chain message ID.
/// Seeds: [b"consumed-message", sss_mint, message_id (32 bytes)]
///
/// Existence of this account means the message has been processed.
/// Created atomically when `bridge_in` mints tokens; prevents double-spend.
#[account]
#[derive(InitSpace)]
pub struct ConsumedMessageId {
    /// The bridge message ID (opaque 32-byte identifier from the source chain).
    pub message_id: [u8; 32],
    /// The stablecoin mint this message was bridged into.
    pub sss_mint: Pubkey,
    pub bump: u8,
}

impl ConsumedMessageId {
    pub const SEED: &'static [u8] = b"consumed-message";
}

// ---------------------------------------------------------------------------
// SSS-138: MarketMakerConfig PDA
// ---------------------------------------------------------------------------

/// MarketMakerConfig PDA — one per stablecoin mint when FLAG_MARKET_MAKER_HOOKS is set.
///
/// Whitelisted market makers may call `mm_mint` and `mm_burn` to tighten the peg
/// spread programmatically.  Both instructions:
///   - bypass stability fees
///   - are rate-limited per slot (mm_mint_limit_per_slot / mm_burn_limit_per_slot)
///   - require oracle price within spread_bps of the $1 peg
///
/// Seeds: [b"mm-config", sss_mint]
#[account]
#[derive(InitSpace)]
pub struct MarketMakerConfig {
    /// The SSS stablecoin mint this config belongs to.
    pub sss_mint: Pubkey,
    /// Up to 10 whitelisted market maker pubkeys.
    #[max_len(10)]
    pub whitelisted_mms: Vec<Pubkey>,
    /// Maximum tokens any MM may mint across all MMs per slot.
    pub mm_mint_limit_per_slot: u64,
    /// Maximum tokens any MM may burn across all MMs per slot.
    pub mm_burn_limit_per_slot: u64,
    /// Oracle spread tolerance in basis points (e.g. 50 = 0.5%).
    /// MM ops require |oracle_price - peg| <= spread_bps * 10 (price in µUSD).
    pub spread_bps: u16,
    /// Slot when mm_minted_this_slot was last updated (resets counter on new slot).
    pub last_mint_slot: u64,
    /// Running total of tokens minted by all MMs in last_mint_slot.
    pub mm_minted_this_slot: u64,
    /// Slot when mm_burned_this_slot was last updated (resets counter on new slot).
    pub last_burn_slot: u64,
    /// Running total of tokens burned by all MMs in last_burn_slot.
    pub mm_burned_this_slot: u64,
    pub bump: u8,
}

impl MarketMakerConfig {
    pub const SEED: &'static [u8] = b"mm-config";
}

// ── GuardianConfig ─────────────────────────────────────────────────────────
/// Guardian multisig config — stores guardian pubkeys and threshold.
/// Created by `init_guardian_config`. Seeds: [b"guardian-config", config_pda].
#[account]
pub struct GuardianConfig {
    pub guardians: Vec<Pubkey>,         // up to 7
    pub threshold: u8,
    pub next_proposal_id: u64,
    pub pending_lift_votes: Vec<Pubkey>, // votes to lift guardian pause
}
impl GuardianConfig {
    pub const SEED: &'static [u8] = b"guardian-config";
    pub const MAX_GUARDIANS: usize = 7;
    // space: 4+7*32 + 1 + 8 + 4+7*32 = 4+224+1+8+4+224 = 465
    pub const INIT_SPACE: usize = 4 + 32 * 7 + 1 + 8 + 4 + 32 * 7;
}

// ── PauseProposal ──────────────────────────────────────────────────────────
/// Guardian pause proposal PDA. Seeds: [b"pause-proposal", config_pda, proposal_id.to_le_bytes()].
#[account]
pub struct PauseProposal {
    pub proposal_id: u64,
    pub reason: [u8; 32],
    pub threshold: u8,
    pub votes: Vec<Pubkey>,             // guardians who voted yes
}
impl PauseProposal {
    pub const SEED: &'static [u8] = b"pause-proposal";
    pub const MAX_VOTES: usize = 7;
    // space: 8 + 32 + 1 + 4+7*32 = 8+32+1+4+224 = 269
    pub const INIT_SPACE: usize = 8 + 32 + 1 + 4 + 32 * 7;
}

// ── SquadsMultisigConfig ───────────────────────────────────────────────────
/// Squads V4 multisig config PDA — stores multisig details for SDK.
/// Seeds: [b"squads-multisig-config", mint].
#[account]
pub struct SquadsMultisigConfig {
    pub sss_mint: Pubkey,
    pub multisig_pda: Pubkey,
    pub threshold: u8,
    pub members: Vec<Pubkey>,           // up to 20
    pub bump: u8,
}
impl SquadsMultisigConfig {
    pub const SEED: &'static [u8] = b"squads-multisig-config";
    pub const MAX_MEMBERS: usize = 20;
    pub fn space(member_count: usize) -> usize {
        8 + 32 + 32 + 1 + 4 + 32 * member_count + 1
    }
}

// ── ProofOfReserves ────────────────────────────────────────────────────────
/// Proof-of-Reserves attestation PDA. Seeds: [b"proof-of-reserves", mint].
#[account]
pub struct ProofOfReserves {
    pub sss_mint: Pubkey,
    pub reserve_amount: u64,
    pub attestation_hash: [u8; 32],
    pub attestor: Pubkey,
    pub last_attestation_slot: u64,
    pub last_verified_ratio_bps: u64,
    pub bump: u8,
}
impl ProofOfReserves {
    pub const SEED: &'static [u8] = b"proof-of-reserves";
    // space: 32+8+32+32+8+8+1 = 121
    pub const INIT_SPACE: usize = 32 + 8 + 32 + 32 + 8 + 8 + 1;
}

// ── TravelRuleRecord ───────────────────────────────────────────────────────
/// Per-transfer travel rule record. Seeds: [b"travel-rule", mint, nonce].
#[account]
pub struct TravelRuleRecord {
    pub sss_mint: Pubkey,
    pub nonce: u64,
    pub encrypted_payload: [u8; 256],   // 256-byte VASP payload
    pub originator_vasp: Pubkey,
    pub beneficiary_vasp: Pubkey,
    pub transfer_amount: u64,
    pub slot: u64,
    pub bump: u8,
}
impl TravelRuleRecord {
    pub const SEED: &'static [u8] = b"travel-rule";
    // space: 32+8+256+32+32+8+8+1 = 377
    pub const INIT_SPACE: usize = 32 + 8 + 256 + 32 + 32 + 8 + 8 + 1;
}

// ── SanctionsRecord ────────────────────────────────────────────────────────
/// Sanctions screening record for a wallet. Seeds: [b"sanctions-record", mint, wallet].
#[account]
pub struct SanctionsRecord {
    pub is_sanctioned: bool,
    pub updated_slot: u64,
    pub bump: u8,
}
impl SanctionsRecord {
    pub const SEED: &'static [u8] = b"sanctions-record";
    pub const INIT_SPACE: usize = 1 + 8 + 1;
}

// ── WalletRateLimit ────────────────────────────────────────────────────────
/// Per-wallet rate limit PDA. Seeds: [b"wallet-rate-limit", mint, wallet].
#[account]
pub struct WalletRateLimit {
    pub sss_mint: Pubkey,
    pub wallet: Pubkey,
    pub max_transfer_per_window: u64,
    pub window_slots: u64,
    pub window_start_slot: u64,
    pub transferred_this_window: u64,
    pub bump: u8,
}
impl WalletRateLimit {
    pub const SEED: &'static [u8] = b"wallet-rate-limit";
    pub const INIT_SPACE: usize = 32 + 32 + 8 + 8 + 8 + 8 + 1;
}

// ── PidConfig ─────────────────────────────────────────────────────────────
/// PID controller config for dynamic stability fee (SSS-130).
/// Seeds: [b"pid-config", mint].
#[account]
pub struct PidConfig {
    pub sss_mint: Pubkey,
    pub kp: i64,
    pub ki: i64,
    pub kd: i64,
    pub target_price: u64,
    pub min_fee_bps: u16,
    pub max_fee_bps: u16,
    pub last_error: i64,
    pub integral: i64,
    pub last_update_slot: u64,
    pub bump: u8,
}
impl PidConfig {
    pub const SEED: &'static [u8] = b"pid-config";
    pub const INIT_SPACE: usize = 32 + 8 + 8 + 8 + 8 + 2 + 2 + 8 + 8 + 8 + 1;
}

// ── LiquidationBonusConfig ────────────────────────────────────────────────
/// Graduated liquidation bonus tiers (SSS-131). Seeds: [b"liquidation-bonus-config", mint].
#[account]
pub struct LiquidationBonusConfig {
    pub sss_mint: Pubkey,
    pub authority: Pubkey,
    pub tier1_threshold_bps: u16,
    pub tier1_bonus_bps: u16,
    pub tier2_threshold_bps: u16,
    pub tier2_bonus_bps: u16,
    pub tier3_threshold_bps: u16,
    pub tier3_bonus_bps: u16,
    pub max_bonus_bps: u16,
    pub bump: u8,
}
impl LiquidationBonusConfig {
    pub const SEED: &'static [u8] = b"liquidation-bonus-config";
    // space: 32+32+2+2+2+2+2+2+2+1 = 79
    pub const INIT_SPACE: usize = 32 + 32 + 2 + 2 + 2 + 2 + 2 + 2 + 2 + 1;
}

// ── PsmCurveConfig ────────────────────────────────────────────────────────
/// PSM dynamic fee curve config (SSS-132). Seeds: [b"psm-curve-config", mint].
#[account]
pub struct PsmCurveConfig {
    pub sss_mint: Pubkey,
    pub authority: Pubkey,
    pub base_fee_bps: u16,
    pub curve_k: u64,
    pub max_fee_bps: u16,
    pub bump: u8,
}
impl PsmCurveConfig {
    pub const SEED: &'static [u8] = b"psm-curve-config";
    pub const MAX_FEE_BPS: u16 = 1000;
    pub const INIT_SPACE: usize = 32 + 32 + 2 + 8 + 2 + 1;

    /// Linear fee curve: fee_bps = base_fee + k * (vault / total_reserves).
    /// Returns fee in basis points, clamped to max_fee_bps.
    pub fn compute_fee(&self, vault_amount: u64, total_reserves: u64) -> u16 {
        if total_reserves == 0 {
            return self.base_fee_bps;
        }
        let ratio = (vault_amount as u128)
            .saturating_mul(10_000)
            / total_reserves as u128;
        let dynamic = (self.curve_k as u128)
            .saturating_mul(ratio)
            / 10_000;
        let fee = (self.base_fee_bps as u128).saturating_add(dynamic);
        fee.min(self.max_fee_bps as u128) as u16
    }
}

// ── RedemptionPool ────────────────────────────────────────────────────────
/// Instant redemption pool (SSS-137). Seeds: [b"redemption-pool", mint].
#[account]
pub struct RedemptionPool {
    pub sss_mint: Pubkey,
    pub reserve_vault: Pubkey,
    pub total_seeded: u64,
    pub total_replenished: u64,
    pub total_redeemed: u64,
    pub current_liquidity: u64,
    pub max_pool_size: u64,
    pub instant_redemption_fee_bps: u16,
    pub utilization_bps: u16,
    pub bump: u8,
}
impl RedemptionPool {
    pub const SEED: &'static [u8] = b"redemption-pool";
    pub const MAX_FEE_BPS: u16 = 1000;
    pub const INIT_SPACE: usize = 32 + 32 + 8 + 8 + 8 + 8 + 8 + 2 + 2 + 1;
}

// ── RedemptionRequest ─────────────────────────────────────────────────────
/// Scheduled redemption request. Seeds: [b"redemption-request", mint, user].
#[account]
pub struct RedemptionRequest {
    pub sss_mint: Pubkey,
    pub user: Pubkey,
    pub amount: u64,
    pub requested_slot: u64,
    pub expiry_slot: u64,
    pub fulfilled: bool,
    pub sla_breached: bool,
    pub bump: u8,
}
impl RedemptionRequest {
    pub const SEED: &'static [u8] = b"redemption-request";
    pub const INIT_SPACE: usize = 32 + 32 + 8 + 8 + 8 + 1 + 1 + 1;
}

// ── RedemptionGuarantee ───────────────────────────────────────────────────
/// Redemption SLA guarantee config. Seeds: [b"redemption-guarantee", mint].
#[account]
pub struct RedemptionGuarantee {
    pub sss_mint: Pubkey,
    pub reserve_vault: Pubkey,
    pub max_daily_redemption: u64,
    pub daily_redeemed: u64,
    pub day_start_slot: u64,
    pub sla_slots: u64,
    pub last_updated_slot: u64,
    pub bump: u8,
}
impl RedemptionGuarantee {
    pub const SEED: &'static [u8] = b"redemption-guarantee";
    pub const INIT_SPACE: usize = 32 + 32 + 8 + 8 + 8 + 8 + 8 + 1;
}

// ── ReserveComposition ────────────────────────────────────────────────────
/// Reserve composition enforcement config. Seeds: [b"reserve-composition", mint].
#[account]
pub struct ReserveComposition {
    pub sss_mint: Pubkey,
    pub cash_bps: u16,
    pub t_bills_bps: u16,
    pub crypto_bps: u16,
    pub other_bps: u16,
    pub last_updated_slot: u64,
    pub last_updated_by: Pubkey,
    pub bump: u8,
}
impl ReserveComposition {
    pub const SEED: &'static [u8] = b"reserve-composition";
    pub const INIT_SPACE: usize = 32 + 2 + 2 + 2 + 2 + 8 + 32 + 1;
}

// ── AuthorityRotationRequest ───────────────────────────────────────────────
/// Pending authority rotation request. Seeds: [b"authority-rotation", mint].
#[account]
pub struct AuthorityRotationRequest {
    pub new_authority: Pubkey,
    pub backup_authority: Pubkey,
    pub requested_slot: u64,
    pub bump: u8,
}
impl AuthorityRotationRequest {
    pub const SEED: &'static [u8] = b"authority-rotation";
    pub const INIT_SPACE: usize = 32 + 32 + 8 + 1;
}

// ── CustomPriceFeed ────────────────────────────────────────────────────────
/// On-chain custom price feed PDA (SSS-119). Seeds: [b"custom-price-feed", mint].
#[account]
pub struct CustomPriceFeed {
    pub price: i64,
    pub conf: u64,
    pub expo: i32,
    pub updated_slot: u64,
    pub last_update_slot: u64,
    pub last_update_unix_timestamp: i64,
    pub authority: Pubkey,
    pub bump: u8,
}
impl CustomPriceFeed {
    pub const SEED: &'static [u8] = b"custom-price-feed";
    pub const INIT_SPACE: usize = 8 + 8 + 4 + 8 + 8 + 8 + 32 + 1;
}

// ── CredentialRegistry ────────────────────────────────────────────────────
/// ZK credential registry (SSS-129). Seeds: [b"credential-registry", mint].
#[account]
pub struct CredentialRegistry {
    pub sss_mint: Pubkey,
    pub issuer: Pubkey,
    pub merkle_root: [u8; 32],
    pub credential_ttl_slots: u64,
    pub updated_slot: u64,
    pub bump: u8,
}
impl CredentialRegistry {
    pub const SEED: &'static [u8] = b"credential-registry";
    pub const INIT_SPACE: usize = 32 + 32 + 32 + 8 + 8 + 1;
}

// ── CredentialRecord ──────────────────────────────────────────────────────
/// Per-holder credential record (SSS-129). Seeds: [b"credential-record", mint, holder].
#[account]
pub struct CredentialRecord {
    pub sss_mint: Pubkey,
    pub holder: Pubkey,
    pub issued_slot: u64,
    pub expires_slot: u64,
    pub revoked: bool,
    pub bump: u8,
}
impl CredentialRecord {
    pub const SEED: &'static [u8] = b"credential-record";
    pub const INIT_SPACE: usize = 32 + 32 + 8 + 8 + 1 + 1;
}

// ── SSS-153: Multi-oracle consensus ─────────────────────────────────────────

/// A single oracle source entry stored in OracleConsensus.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default)]
pub struct OracleSource {
    /// Oracle type: 0=Pyth, 1=Switchboard, 2=Custom.
    pub oracle_type: u8,
    /// Price feed account address.
    pub feed: Pubkey,
}

/// OracleConsensus PDA — aggregates N oracle sources into a consensus price.
/// Seeds: [b"oracle-consensus", sss_mint].
#[account]
pub struct OracleConsensus {
    /// The stablecoin mint this consensus config belongs to.
    pub mint: Pubkey,
    /// Minimum number of non-outlier, fresh sources needed for consensus.
    pub min_oracles: u8,
    /// Maximum deviation from median (bps) before a source is rejected as outlier.
    pub outlier_threshold_bps: u16,
    /// Maximum source age in slots.
    pub max_age_slots: u64,
    /// Number of configured source slots (for informational display; real truth = sources[].feed != default).
    pub source_count: u8,
    /// Up to MAX_SOURCES oracle source slots.
    pub sources: [OracleSource; OracleConsensus::MAX_SOURCES],
    /// Last computed consensus price (same units as OraclePrice.price, expo from source).
    pub last_consensus_price: u64,
    /// Slot when last_consensus_price was written.
    pub last_consensus_slot: u64,
    /// TWAP price (EMA, alpha=1/8).
    pub twap_price: u64,
    /// Slot when TWAP was last updated.
    pub twap_last_slot: u64,
    pub bump: u8,
}

impl OracleConsensus {
    pub const SEED: &'static [u8] = b"oracle-consensus";
    /// Maximum number of oracle sources supported.
    pub const MAX_SOURCES: usize = 5;

    // Layout:
    //   mint(32) + min_oracles(1) + outlier_threshold_bps(2) + max_age_slots(8)
    //   + source_count(1) + sources(5 * (1+32)=165) + last_consensus_price(8)
    //   + last_consensus_slot(8) + twap_price(8) + twap_last_slot(8) + bump(1)
    //   = 32+1+2+8+1+165+8+8+8+8+1 = 242
    pub const INIT_SPACE: usize = 242;

    /// Returns true if at least one source is configured.
    pub fn config_is_set(&self) -> bool {
        self.sources.iter().any(|s| s.feed != Pubkey::default())
    }
}

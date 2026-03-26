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
/// SSS-BUG-008 / AUDIT-G6 / AUDIT-H4: When set, minting is halted if the
/// on-chain ProofOfReserves ratio falls below `StablecoinConfig.min_reserve_ratio_bps`.
/// Callers must pass the ProofOfReserves PDA as remaining_accounts[0] on every
/// mint / cpi_mint call while this flag is active.
pub const FLAG_POR_HALT_ON_BREACH: u64 = 1 << 16;

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
    /// SSS-122: config version for migration checks (0 = pre-SSS-122, 1 = current).
    pub version: u8,
    /// SSS-127: Travel Rule threshold in native token units. 0 = disabled.
    pub travel_rule_threshold: u64,
    /// SSS-128: Sanctions oracle signer pubkey. Pubkey::default() = disabled.
    pub sanctions_oracle: Pubkey,
    /// SSS-128: Max staleness in slots for sanctions records. 0 = unlimited.
    pub sanctions_max_staleness_slots: u64,
    /// SSS-134: Squads V4 multisig PDA (set by init_squads_authority). Default = disabled.
    pub squads_multisig: Pubkey,
    /// SSS-BUG-008: Minimum reserve ratio in bps (0 = no minimum). Used with FLAG_POR_HALT_ON_BREACH.
    pub min_reserve_ratio_bps: u16,
    /// BUG-015: Whitelisted stability-fee keeper pubkeys (max 8).
    #[max_len(8)]
    pub authorized_keepers: Vec<Pubkey>,
    /// SSS-150: Expected BPF upgrade authority (for monitoring / guard). Default = unset.
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

// ---------------------------------------------------------------------------
// SSS-BUG-008 / AUDIT-G6: ProofOfReserves PDA
// ---------------------------------------------------------------------------

/// On-chain reserve attestation PDA — one per mint.
/// Seeds: [b"proof-of-reserves", mint]
///
/// The attester (a whitelisted keeper / custodian oracle) periodically calls
/// `attest_proof_of_reserves` to update the verified reserve ratio.  When
/// FLAG_POR_HALT_ON_BREACH is set, every mint/cpi_mint call reads this PDA and
/// rejects if `last_verified_ratio_bps < config.min_reserve_ratio_bps`.
#[account]
#[derive(InitSpace)]
pub struct ProofOfReserves {
    /// The stablecoin mint this attestation applies to.
    pub mint: Pubkey,
    /// Current verified reserve ratio in basis points (10_000 = 100% collateralised).
    pub last_verified_ratio_bps: u64,
    /// Slot at which the most recent attestation was submitted.
    pub last_attestation_slot: u64,
    /// The authorised attester pubkey (set at init, can only be changed by authority).
    pub attester: Pubkey,
    pub bump: u8,
}

impl ProofOfReserves {
    pub const SEED: &'static [u8] = b"proof-of-reserves";
}

// ---------------------------------------------------------------------------
// SSS-153: OracleConsensus PDA — multi-oracle aggregation
// ---------------------------------------------------------------------------

/// Per-source oracle descriptor used in OracleConsensus.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, InitSpace)]
pub struct OracleSource {
    /// 0=Pyth, 1=Switchboard, 2=Custom
    pub oracle_type: u8,
    /// The price feed account address for this source.
    pub feed: Pubkey,
}

/// Multi-oracle consensus PDA — one per stablecoin mint.
/// Seeds: [b"oracle-consensus", sss_mint]
#[account]
#[derive(InitSpace)]
pub struct OracleConsensus {
    /// The stablecoin mint this consensus PDA belongs to.
    pub mint: Pubkey,
    /// Maximum number of oracle sources (fixed-size array).
    #[max_len(5)]
    pub sources: Vec<OracleSource>,
    /// Number of active (non-default) sources.
    pub source_count: u8,
    /// Minimum non-outlier sources required to compute consensus.
    pub min_oracles: u8,
    /// Outlier rejection threshold in bps (e.g. 200 = 2% deviation from median).
    pub outlier_threshold_bps: u16,
    /// Max age in slots for a source price to be considered fresh.
    pub max_age_slots: u64,
    /// Last computed consensus price (raw oracle units).
    pub last_consensus_price: u64,
    /// Slot at which the last consensus was computed.
    pub last_consensus_slot: u64,
    /// TWAP (exponential moving average) of consensus prices.
    pub twap_price: u64,
    /// Slot at which TWAP was last updated.
    pub twap_last_slot: u64,
    pub bump: u8,
}

impl OracleConsensus {
    pub const SEED: &'static [u8] = b"oracle-consensus";
    /// Maximum number of oracle sources per consensus PDA.
    pub const MAX_SOURCES: usize = 5;

    /// Returns true if at least one source is configured.
    pub fn config_is_set(&self) -> bool {
        self.sources.iter().any(|s| s.feed != Pubkey::default())
    }
}

// ---------------------------------------------------------------------------
// SSS-130: PidConfig PDA
// ---------------------------------------------------------------------------

/// PID controller configuration PDA — one per stablecoin mint.
/// Seeds: [b"pid-config", sss_mint]
#[account]
#[derive(InitSpace)]
pub struct PidConfig {
    /// The stablecoin mint this PID config belongs to.
    pub sss_mint: Pubkey,
    /// Proportional gain (scaled by 1_000_000).
    pub kp: i64,
    /// Integral gain (scaled by 1_000_000).
    pub ki: i64,
    /// Derivative gain (scaled by 1_000_000).
    pub kd: i64,
    /// Target peg price in oracle units.
    pub target_price: u64,
    /// Minimum stability fee in bps (floor).
    pub min_fee_bps: u16,
    /// Maximum stability fee in bps (ceiling).
    pub max_fee_bps: u16,
    /// Last PID error value (i64, 1e0 units).
    pub last_error: i64,
    /// Integral accumulator (i64, 1e0 units, clamped to ±1_000_000_000).
    pub integral: i64,
    /// Slot at which the PID was last updated.
    pub last_update_slot: u64,
    pub bump: u8,
}

impl PidConfig {
    pub const SEED: &'static [u8] = b"pid-config";
}

// ---------------------------------------------------------------------------
// SSS-131: LiquidationBonusConfig PDA
// ---------------------------------------------------------------------------

/// Graduated liquidation bonus configuration PDA — one per stablecoin mint.
/// Seeds: [b"liquidation-bonus-config", sss_mint]
#[account]
#[derive(InitSpace)]
pub struct LiquidationBonusConfig {
    /// The stablecoin mint this config belongs to.
    pub sss_mint: Pubkey,
    /// The authority that can update this config.
    pub authority: Pubkey,
    /// Collateral ratio threshold (bps) above which tier1 bonus applies.
    pub tier1_threshold_bps: u16,
    /// Bonus paid at tier1 (bps).
    pub tier1_bonus_bps: u16,
    /// Collateral ratio threshold (bps) above which tier2 bonus applies.
    pub tier2_threshold_bps: u16,
    /// Bonus paid at tier2 (bps).
    pub tier2_bonus_bps: u16,
    /// Collateral ratio threshold (bps) above which tier3 bonus applies.
    pub tier3_threshold_bps: u16,
    /// Bonus paid at tier3 (bps).
    pub tier3_bonus_bps: u16,
    /// Maximum bonus cap (bps, ≤ 5000).
    pub max_bonus_bps: u16,
    pub bump: u8,
}

impl LiquidationBonusConfig {
    pub const SEED: &'static [u8] = b"liquidation-bonus-config";
}

// ---------------------------------------------------------------------------
// SSS-132: PsmCurveConfig PDA
// ---------------------------------------------------------------------------

/// PSM AMM-style slippage curve config PDA — one per stablecoin mint.
/// Seeds: [b"psm-curve-config", sss_mint]
#[account]
#[derive(InitSpace)]
pub struct PsmCurveConfig {
    /// The stablecoin mint this config belongs to.
    pub sss_mint: Pubkey,
    /// The authority that can update this config.
    pub authority: Pubkey,
    /// Base fee in bps when the pool is perfectly balanced.
    pub base_fee_bps: u16,
    /// Curve steepness amplifier k (scaled by 1_000_000).
    pub curve_k: u64,
    /// Maximum fee cap in bps (≤ MAX_FEE_BPS).
    pub max_fee_bps: u16,
    pub bump: u8,
}

impl PsmCurveConfig {
    pub const SEED: &'static [u8] = b"psm-curve-config";
    /// Maximum allowed max_fee_bps (20%).
    pub const MAX_FEE_BPS: u16 = 2_000;

    /// Compute the dynamic fee in bps given current vault amount and total reserves.
    ///
    /// fee_bps = clamp(base_fee_bps + curve_k * (imbalance / total_reserves)^2, base_fee_bps, max_fee_bps)
    ///
    /// where imbalance = |vault_amount - total_reserves / 2|
    pub fn compute_fee(&self, vault_amount: u64, total_reserves: u64) -> u16 {
        if total_reserves == 0 {
            return self.base_fee_bps;
        }
        let ideal = total_reserves / 2;
        let imbalance = if vault_amount >= ideal {
            vault_amount - ideal
        } else {
            ideal - vault_amount
        };
        // ratio = imbalance / total_reserves, in 1e6 fixed point
        let ratio_1e6 = (imbalance as u128)
            .saturating_mul(1_000_000)
            / (total_reserves as u128);
        // delta = curve_k * ratio^2 / 1e12 (bps)
        let delta_bps = (self.curve_k as u128)
            .saturating_mul(ratio_1e6)
            .saturating_mul(ratio_1e6)
            / 1_000_000_000_000u128;
        let fee = (self.base_fee_bps as u128).saturating_add(delta_bps);
        fee.min(self.max_fee_bps as u128) as u16
    }
}

// ---------------------------------------------------------------------------
// SSS-133: WalletRateLimit PDA
// ---------------------------------------------------------------------------

/// Per-wallet rate limit PDA.
/// Seeds: [b"wallet-rate-limit", sss_mint, wallet]
#[account]
#[derive(InitSpace)]
pub struct WalletRateLimit {
    /// The stablecoin mint this rate limit belongs to.
    pub sss_mint: Pubkey,
    /// The wallet (token account owner) being rate-limited.
    pub wallet: Pubkey,
    /// Maximum tokens transferable in one window.
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

// ---------------------------------------------------------------------------
// SSS-134: SquadsMultisigConfig PDA
// ---------------------------------------------------------------------------

/// Squads V4 multisig config PDA — one per stablecoin mint.
/// Seeds: [b"squads-multisig-config", sss_mint]
#[account]
pub struct SquadsMultisigConfig {
    /// The stablecoin mint this config belongs to.
    pub sss_mint: Pubkey,
    /// The Squads V4 multisig PDA that is the program authority.
    pub multisig_pda: Pubkey,
    /// Approval threshold (m of n). Stored for SDK introspection.
    pub threshold: u8,
    /// Member pubkeys (up to MAX_MEMBERS).
    pub members: Vec<Pubkey>,
    pub bump: u8,
}

impl SquadsMultisigConfig {
    pub const SEED: &'static [u8] = b"squads-multisig-config";
    /// Maximum number of members.
    pub const MAX_MEMBERS: usize = 10;

    /// Compute space needed for N members.
    pub fn space(num_members: usize) -> usize {
        // discriminator(8) + sss_mint(32) + multisig_pda(32) + threshold(1)
        // + members vec len prefix(4) + members(32 * n) + bump(1)
        8 + 32 + 32 + 1 + 4 + 32 * num_members + 1
    }
}

// ---------------------------------------------------------------------------
// SSS-127: TravelRuleRecord PDA
// ---------------------------------------------------------------------------

/// Travel Rule compliance record PDA.
/// Seeds: [b"travel-rule-record", sss_mint, nonce.to_le_bytes()]
#[account]
#[derive(InitSpace)]
pub struct TravelRuleRecord {
    pub sss_mint: Pubkey,
    /// Originator VASP pubkey.
    pub originator_vasp: Pubkey,
    /// Beneficiary VASP pubkey.
    pub beneficiary_vasp: Pubkey,
    /// Transfer amount (in native token units).
    pub transfer_amount: u64,
    /// Encrypted VASP-to-VASP payload (256 bytes, ECIES-encrypted).
    pub encrypted_payload: [u8; 256],
    /// Caller-chosen monotonic nonce; unique per transfer.
    pub nonce: u64,
    /// Slot at which this record was submitted.
    pub slot: u64,
    pub bump: u8,
}

impl TravelRuleRecord {
    pub const SEED: &'static [u8] = b"travel-rule-record";
}

// ---------------------------------------------------------------------------
// SSS-128: SanctionsRecord PDA
// ---------------------------------------------------------------------------

/// Sanctions screening record PDA — one per (sss_mint, wallet).
/// Seeds: [b"sanctions-record", sss_mint, wallet]
#[account]
#[derive(InitSpace)]
pub struct SanctionsRecord {
    pub sss_mint: Pubkey,
    pub wallet: Pubkey,
    pub is_sanctioned: bool,
    /// Slot at which this record was last updated.
    pub updated_slot: u64,
    pub bump: u8,
}

impl SanctionsRecord {
    pub const SEED: &'static [u8] = b"sanctions-record";
}

// ---------------------------------------------------------------------------
// SSS-129: CredentialRegistry and CredentialRecord PDAs
// ---------------------------------------------------------------------------

/// Credential registry PDA — one per stablecoin mint.
/// Seeds: [b"credential-registry", sss_mint]
#[account]
#[derive(InitSpace)]
pub struct CredentialRegistry {
    pub sss_mint: Pubkey,
    /// The issuer authority that may rotate the root and revoke credentials.
    pub issuer: Pubkey,
    /// Groth16 Merkle root (32 bytes).
    pub merkle_root: [u8; 32],
    /// How many slots a CredentialRecord stays valid (0 = never expires).
    pub credential_ttl_slots: u64,
    /// Slot at which the root was last updated.
    pub updated_slot: u64,
    pub bump: u8,
}

impl CredentialRegistry {
    pub const SEED: &'static [u8] = b"credential-registry";
}

/// Per-holder credential record PDA.
/// Seeds: [b"credential-record", sss_mint, holder]
#[account]
#[derive(InitSpace)]
pub struct CredentialRecord {
    pub sss_mint: Pubkey,
    pub holder: Pubkey,
    /// Slot at which the credential was issued.
    pub issued_slot: u64,
    /// Slot at which the credential expires (0 = never).
    pub expires_slot: u64,
    /// Whether the credential has been revoked.
    pub revoked: bool,
    pub bump: u8,
}

impl CredentialRecord {
    pub const SEED: &'static [u8] = b"credential-record";
}

// ---------------------------------------------------------------------------
// SSS-125: RedemptionGuarantee and RedemptionRequest PDAs
// ---------------------------------------------------------------------------

/// Redemption guarantee config PDA — one per stablecoin mint.
/// Seeds: [b"redemption-guarantee", sss_mint]
#[account]
#[derive(InitSpace)]
pub struct RedemptionGuarantee {
    pub sss_mint: Pubkey,
    /// Vault token account holding the redemption reserve (matches reserve_vault key).
    pub reserve_vault: Pubkey,
    /// Maximum total redemption allowed per 24h window (native units). 0 = unlimited.
    pub max_daily_redemption: u64,
    /// Amount redeemed in the current daily window.
    pub daily_redeemed: u64,
    /// Slot at which the current daily window started (alias: day_start_slot).
    pub day_start_slot: u64,
    /// Slot at which state was last updated.
    pub last_updated_slot: u64,
    /// SLA in slots — redemptions must be fulfilled within this window.
    pub sla_slots: u64,
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
    pub sss_mint: Pubkey,
    pub user: Pubkey,
    /// Amount of SSS tokens to redeem.
    pub amount: u64,
    /// Slot at which the request was submitted.
    pub requested_slot: u64,
    /// Slot at which the SLA expires (requested_slot + sla_slots).
    pub expiry_slot: u64,
    /// Whether the redemption has been fulfilled.
    pub fulfilled: bool,
    /// Whether the SLA was breached (claim_expired_redemption was called).
    pub sla_breached: bool,
    pub bump: u8,
}

impl RedemptionRequest {
    pub const SEED: &'static [u8] = b"redemption-request";
}

// ---------------------------------------------------------------------------
// SSS-137: RedemptionPool PDA
// ---------------------------------------------------------------------------

/// Redemption pool PDA — one per stablecoin mint.
/// Seeds: [b"redemption-pool", sss_mint]
#[account]
#[derive(InitSpace)]
pub struct RedemptionPool {
    pub sss_mint: Pubkey,
    /// Vault token account holding collateral for instant redemptions.
    pub vault_token_account: Pubkey,
    /// Alias: reserve_vault references the same vault (for compatibility).
    pub reserve_vault: Pubkey,
    /// Maximum pool size (0 = unlimited).
    pub max_pool_size: u64,
    /// Current available liquidity.
    pub current_liquidity: u64,
    /// Instant redemption fee in bps (deducted from payout).
    pub instant_redemption_fee_bps: u16,
    /// Total amount seeded into the pool.
    pub total_seeded: u64,
    /// Total amount replenished into the pool.
    pub total_replenished: u64,
    /// Total amount redeemed from the pool.
    pub total_redeemed: u64,
    /// Utilization in bps (total_redeemed / total_seeded+total_replenished).
    pub utilization_bps: u16,
    pub bump: u8,
}

impl RedemptionPool {
    pub const SEED: &'static [u8] = b"redemption-pool";
    /// Maximum fee for instant redemptions: 5%.
    pub const MAX_FEE_BPS: u16 = 500;
}

// ---------------------------------------------------------------------------
// SSS-125: ReserveComposition PDA
// ---------------------------------------------------------------------------

/// Reserve composition breakdown PDA — one per stablecoin mint.
/// Seeds: [b"reserve-composition", sss_mint]
#[account]
#[derive(InitSpace)]
pub struct ReserveComposition {
    pub sss_mint: Pubkey,
    /// Cash and cash equivalents (bps, 0–10000).
    pub cash_bps: u16,
    /// US Treasury Bills (bps, 0–10000).
    pub t_bills_bps: u16,
    /// Crypto assets (bps, 0–10000).
    pub crypto_bps: u16,
    /// Other assets (bps, 0–10000).
    pub other_bps: u16,
    /// Slot at which this composition was last updated.
    pub last_updated_slot: u64,
    /// Authority who last updated.
    pub last_updated_by: Pubkey,
    pub bump: u8,
}

impl ReserveComposition {
    pub const SEED: &'static [u8] = b"reserve-composition";
}

// ---------------------------------------------------------------------------
// SSS-Bridge: BridgeConfig and ConsumedMessageId PDAs
// ---------------------------------------------------------------------------

/// Bridge configuration PDA — one per stablecoin mint.
/// Seeds: [b"bridge-config", sss_mint]
#[account]
#[derive(InitSpace)]
pub struct BridgeConfig {
    pub sss_mint: Pubkey,
    /// Bridge type: 0=Wormhole, 1=LayerZero.
    pub bridge_type: u8,
    /// Registered bridge program (CPI caller for bridge_in).
    pub bridge_program: Pubkey,
    /// Maximum tokens per bridge_out transaction (0 = unlimited).
    pub max_bridge_amount_per_tx: u64,
    /// Bridge fee in bps (deducted on bridge_out, stays in fee vault).
    pub bridge_fee_bps: u16,
    /// Fee vault token account (receives bridge fees).
    pub fee_vault: Pubkey,
    /// Authority pubkey for relayer/bridge operations.
    pub authority: Pubkey,
    /// Total tokens bridged out.
    pub total_bridged_out: u64,
    /// Total tokens bridged in.
    pub total_bridged_in: u64,
    pub bump: u8,
}

impl BridgeConfig {
    pub const SEED: &'static [u8] = b"bridge-config";
    pub const BRIDGE_TYPE_WORMHOLE: u8 = 0;
    pub const BRIDGE_TYPE_LAYERZERO: u8 = 1;
}

/// Consumed bridge message ID — prevents replay attacks.
/// Seeds: [b"consumed-message", sss_mint, message_id (32 bytes)]
#[account]
#[derive(InitSpace)]
pub struct ConsumedMessageId {
    pub sss_mint: Pubkey,
    pub message_id: [u8; 32],
    pub consumed_slot: u64,
    pub bump: u8,
}

impl ConsumedMessageId {
    pub const SEED: &'static [u8] = b"consumed-message";
}

// ---------------------------------------------------------------------------
// SSS-151: InsuranceVault PDA
// ---------------------------------------------------------------------------

/// Insurance vault PDA — one per stablecoin mint.
/// Seeds: [b"insurance-vault", sss_mint]
#[account]
#[derive(InitSpace)]
pub struct InsuranceVault {
    pub sss_mint: Pubkey,
    /// Vault token account holding the insurance reserve.
    pub vault_token_account: Pubkey,
    /// Minimum seed bps: min % of net_supply that must be deposited.
    pub min_seed_bps: u16,
    /// Current balance in native token units.
    pub current_balance: u64,
    /// Total drawn from the vault.
    pub total_drawn: u64,
    /// Whether the vault has been adequately seeded.
    pub adequately_seeded: bool,
    pub bump: u8,
}

impl InsuranceVault {
    pub const SEED: &'static [u8] = b"insurance-vault";
}

// ---------------------------------------------------------------------------
// SSS-138: MarketMakerConfig PDA
// ---------------------------------------------------------------------------

/// Market maker configuration PDA — one per stablecoin mint.
/// Seeds: [b"mm-config", sss_mint]
#[account]
#[derive(InitSpace)]
pub struct MarketMakerConfig {
    pub sss_mint: Pubkey,
    /// Mint limit per slot (native token units).
    pub mm_mint_limit_per_slot: u64,
    /// Burn limit per slot (native token units).
    pub mm_burn_limit_per_slot: u64,
    /// Allowed spread from peg in bps before market maker ops are blocked.
    pub spread_bps: u16,
    /// Slot at which mm_minted_this_slot was last recorded.
    pub last_mint_slot: u64,
    /// Tokens minted by MMs in the current slot.
    pub mm_minted_this_slot: u64,
    /// Slot at which mm_burned_this_slot was last recorded.
    pub last_burn_slot: u64,
    /// Tokens burned by MMs in the current slot.
    pub mm_burned_this_slot: u64,
    /// Registered market maker pubkeys (max 8).
    #[max_len(8)]
    pub market_makers: Vec<Pubkey>,
    pub bump: u8,
}

impl MarketMakerConfig {
    pub const SEED: &'static [u8] = b"mm-config";
    pub const MAX_MARKET_MAKERS: usize = 8;
}

// ---------------------------------------------------------------------------
// SSS-154: RedemptionQueue and RedemptionEntry PDAs
// ---------------------------------------------------------------------------

/// Redemption queue PDA — one per stablecoin mint.
/// Seeds: [b"redemption-queue", sss_mint]
#[account]
#[derive(InitSpace)]
pub struct RedemptionQueue {
    pub sss_mint: Pubkey,
    /// FIFO head index.
    pub queue_head: u64,
    /// FIFO tail index (next enqueue position).
    pub queue_tail: u64,
    /// Minimum slots between enqueue and process (anti-front-run).
    pub min_delay_slots: u64,
    /// Maximum number of pending entries.
    pub max_queue_depth: u64,
    /// Maximum redemption per slot as a bps of total supply.
    pub max_redemption_per_slot_bps: u16,
    /// Last slot at which redemptions were processed.
    pub last_process_slot: u64,
    /// Lamports paid to keepers per processed redemption.
    pub keeper_reward_lamports: u64,
    pub bump: u8,
}

impl RedemptionQueue {
    pub const SEED: &'static [u8] = b"redemption-queue";
    pub const DEFAULT_MIN_DELAY_SLOTS: u64 = 150; // ~1 min at 400ms/slot
    pub const DEFAULT_MAX_QUEUE_DEPTH: u64 = 100;
    pub const DEFAULT_MAX_REDEMPTION_PER_SLOT_BPS: u16 = 100; // 1% per slot
    pub const DEFAULT_KEEPER_REWARD_LAMPORTS: u64 = 5_000_000; // 0.005 SOL
}

/// Per-entry redemption queue PDA.
/// Seeds: [b"redemption-entry", sss_mint, queue_index.to_le_bytes()]
#[account]
#[derive(InitSpace)]
pub struct RedemptionEntry {
    pub sss_mint: Pubkey,
    /// Entry index in the queue.
    pub queue_index: u64,
    /// Owner requesting the redemption.
    pub owner: Pubkey,
    /// Amount of SSS tokens to redeem.
    pub amount: u64,
    /// Slot at which this entry was enqueued.
    pub enqueue_slot: u64,
    /// Slot hash seed for front-run protection.
    pub slot_hash_seed: [u8; 32],
    pub bump: u8,
}

impl RedemptionEntry {
    pub const SEED: &'static [u8] = b"redemption-entry";
}

// ---------------------------------------------------------------------------
// SSS-152: KeeperConfig PDA
// ---------------------------------------------------------------------------

/// Keeper config PDA — one per stablecoin mint (circuit breaker keeper).
/// Seeds: [b"keeper-config", sss_mint]
#[account]
#[derive(InitSpace)]
pub struct KeeperConfig {
    pub mint: Pubkey,
    /// Price deviation threshold in bps to trigger circuit breaker.
    pub deviation_bps_threshold: u16,
    /// Target peg price in oracle units.
    pub target_price: u64,
    /// Reward lamports paid to keeper on trigger.
    pub keeper_reward_lamports: u64,
    /// Minimum cooldown slots between circuit breaker triggers.
    pub min_cooldown_slots: u64,
    /// Slots the peg must stay within threshold to auto-unpause.
    pub sustained_recovery_slots: u64,
    /// Slot at which circuit breaker was last triggered.
    pub last_trigger_slot: u64,
    /// Recovery slot tracker.
    pub recovery_start_slot: u64,
    pub bump: u8,
}

impl KeeperConfig {
    pub const SEED: &'static [u8] = b"keeper-config";
}

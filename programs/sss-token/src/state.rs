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

/// SSS-109: Probabilistic Balance Standard — enables commit_probabilistic and
/// related PBS instructions for conditional "pay on proof" transfers.
pub const FLAG_PROBABILISTIC_MONEY: u64 = 1 << 6;
/// SSS-110: Agent Payment Channel — enables open_channel and related APC instructions
/// for trustless agent-to-agent payment channels with work proof and dispute resolution.
pub const FLAG_AGENT_PAYMENT_CHANNEL: u64 = 1 << 7;
/// SSS-127: Travel Rule compliance — when set, transfers at or above `travel_rule_threshold`
/// require a corresponding `TravelRuleRecord` PDA to exist in the same transaction.
/// Implements FATF Travel Rule for VASP-to-VASP data sharing.
pub const FLAG_TRAVEL_RULE: u64 = 1 << 8;

/// SSS-128: Sanctions oracle flag (bit 9): when set, the transfer hook reads a
/// `SanctionsRecord` PDA from the sss-token program (written by the configured
/// sanctions oracle signer) and rejects transfers from sanctioned addresses.
/// oracle-agnostic — any compliance provider (Chainalysis, Elliptic, TRM) can
/// call `update_sanctions_record` as the registered oracle signer.
pub const FLAG_SANCTIONS_ORACLE: u64 = 1 << 9;

/// SSS-129: ZK credentials flag (bit 10): when set, the transfer hook requires
/// a valid `CredentialRecord` PDA for the sender — issued by the
/// `CredentialRegistry` and verified against the on-chain Groth16 Merkle root.
/// Enables `init_credential_registry`, `verify_zk_credential`, and
/// `revoke_credential` instructions.
pub const FLAG_ZK_CREDENTIALS: u64 = 1 << 10;


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

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
    pub bump: u8,
}

impl StablecoinConfig {
    pub const SEED: &'static [u8] = b"stablecoin-config";

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

use anchor_lang::prelude::*;

#[event]
pub struct TokenInitialized {
    pub mint: Pubkey,
    pub authority: Pubkey,
    pub preset: u8,
    pub max_supply: u64,
}

#[event]
pub struct TokensMinted {
    pub mint: Pubkey,
    pub minter: Pubkey,
    pub recipient: Pubkey,
    pub amount: u64,
    pub total_minted: u64,
}

#[event]
pub struct TokensBurned {
    pub mint: Pubkey,
    pub minter: Pubkey,
    pub amount: u64,
    pub total_burned: u64,
}

#[event]
pub struct AccountFrozen {
    pub mint: Pubkey,
    pub account: Pubkey,
}

#[event]
pub struct AccountThawed {
    pub mint: Pubkey,
    pub account: Pubkey,
}

#[event]
pub struct MintPausedEvent {
    pub mint: Pubkey,
    pub paused: bool,
}

#[event]
pub struct CollateralDeposited {
    pub mint: Pubkey,
    pub depositor: Pubkey,
    pub amount: u64,
    pub total_collateral: u64,
}

#[event]
pub struct CollateralRedeemed {
    pub mint: Pubkey,
    pub redeemer: Pubkey,
    pub amount: u64,
    pub total_collateral: u64,
}

#[event]
pub struct AuthorityProposed {
    pub mint: Pubkey,
    pub proposed: Pubkey,
    pub is_compliance: bool,
}

#[event]
pub struct AuthorityAccepted {
    pub mint: Pubkey,
    pub new_authority: Pubkey,
    pub is_compliance: bool,
}

/// SSS-093: Emitted on every PSM redeem (deposit_collateral→mint is fee-free).
#[event]
pub struct PsmSwapEvent {
    pub mint: Pubkey,
    pub redeemer: Pubkey,
    /// SSS tokens burned by the redeemer.
    pub sss_burned: u64,
    /// Collateral tokens released to the redeemer (sss_burned - fee_collected).
    pub collateral_out: u64,
    /// Collateral retained in vault as fee.
    pub fee_collected: u64,
    /// Fee rate at time of swap in basis points.
    pub fee_bps: u16,
}

/// SSS-093: Emitted when the PSM redemption fee is updated.
#[event]
pub struct PsmFeeUpdated {
    pub mint: Pubkey,
    pub old_fee_bps: u16,
    pub new_fee_bps: u16,
    pub authority: Pubkey,
}

/// SSS-093: Emitted when a minter's per-epoch velocity limit is updated.
#[event]
pub struct MintVelocityUpdated {
    pub mint: Pubkey,
    pub minter: Pubkey,
    pub max_mint_per_epoch: u64,
    pub authority: Pubkey,
}

// ─── SSS-110: CDP on-chain events ────────────────────────────────────────────

/// Emitted when collateral is deposited into a CDP vault.
#[event]
pub struct CdpCollateralDeposited {
    pub sss_mint: Pubkey,
    pub user: Pubkey,
    pub collateral_mint: Pubkey,
    pub amount: u64,
    pub vault_total: u64,
}

/// Emitted when SSS tokens are borrowed against collateral.
#[event]
pub struct CdpBorrowed {
    pub sss_mint: Pubkey,
    pub user: Pubkey,
    pub collateral_mint: Pubkey,
    pub amount_borrowed: u64,
    pub total_debt: u64,
}

/// Emitted when SSS tokens are repaid and collateral is released.
#[event]
pub struct CdpRepaid {
    pub sss_mint: Pubkey,
    pub user: Pubkey,
    pub collateral_mint: Pubkey,
    pub amount_repaid: u64,
    pub collateral_released: u64,
    pub remaining_debt: u64,
}

/// Emitted when a CDP position is liquidated (SSS-110 circuit breaker compatible).
#[event]
pub struct CdpLiquidated {
    pub sss_mint: Pubkey,
    pub owner: Pubkey,
    pub liquidator: Pubkey,
    pub collateral_mint: Pubkey,
    pub debt_burned: u64,
    pub collateral_seized: u64,
    /// Collateral ratio at time of liquidation (in basis points).
    pub ratio_bps: u64,
}

/// SSS-100: Emitted on every CDP liquidation (full and partial) with multi-collateral details.
#[event]
pub struct CollateralLiquidated {
    /// The SSS stablecoin mint.
    pub mint: Pubkey,
    /// The specific collateral mint seized.
    pub collateral_mint: Pubkey,
    /// The CDP owner whose position was (partially) liquidated.
    pub cdp_owner: Pubkey,
    /// The liquidator who initiated the liquidation.
    pub liquidator: Pubkey,
    /// Amount of SSS debt burned.
    pub debt_burned: u64,
    /// Amount of collateral transferred to the liquidator.
    pub collateral_seized: u64,
    /// Collateral ratio before liquidation (basis points).
    pub ratio_before_bps: u64,
    /// Whether this was a partial liquidation (true) or full (false).
    pub partial: bool,
    /// Liquidation bonus applied in basis points (from CollateralConfig or global default).
    pub bonus_bps: u16,
}

// ─── SSS-109: Probabilistic Balance Standard events ───────────────────────────

/// Emitted when a new probabilistic commitment is created (funds locked in escrow).
#[event]
pub struct ProbabilisticCommitmentCreated {
    /// StablecoinConfig PDA this commitment belongs to.
    pub config: Pubkey,
    /// Unique commitment id (caller-provided, scoped to config).
    pub commitment_id: u64,
    /// Account that locked the funds.
    pub issuer: Pubkey,
    /// Account authorised to claim on proof.
    pub claimant: Pubkey,
    /// SSS stablecoin mint.
    pub stable_mint: Pubkey,
    /// Total tokens committed.
    pub committed_amount: u64,
    /// Condition hash the proof must match.
    pub condition_hash: [u8; 32],
    /// Slot after which issuer may claim a refund.
    pub expiry_slot: u64,
}

/// Emitted on every resolution (full or partial) of a probabilistic commitment.
#[event]
pub struct ProbabilisticCommitmentResolved {
    /// StablecoinConfig PDA.
    pub config: Pubkey,
    /// Commitment id being resolved.
    pub commitment_id: u64,
    /// Claimant who received the tokens.
    pub claimant: Pubkey,
    /// Amount released to claimant in this resolution.
    pub amount_released: u64,
    /// True if this was a partial resolution (remainder returned to issuer).
    pub partial: bool,
}


// ─── SSS-110: Agent Payment Channel events ────────────────────────────────────

/// Emitted when a new agent payment channel is opened.
#[event]
pub struct ChannelOpened {
    pub channel_id: u64,
    pub initiator: Pubkey,
    pub counterparty: Pubkey,
    pub stable_mint: Pubkey,
    pub initiator_deposit: u64,
    pub dispute_policy: u8,
    pub timeout_slots: u64,
}

/// Emitted when a work proof is submitted to a channel.
#[event]
pub struct WorkProofSubmitted {
    pub channel_id: u64,
    pub initiator: Pubkey,
    pub task_hash: [u8; 32],
    pub output_hash: [u8; 32],
    pub proof_type: u8,
}

/// Emitted when a channel is mutually settled.
#[event]
pub struct ChannelSettled {
    pub channel_id: u64,
    pub initiator: Pubkey,
    pub counterparty: Pubkey,
    pub amount_to_counterparty: u64,
    pub amount_to_initiator: u64,
}

/// Emitted when a channel is placed in dispute.
#[event]
pub struct ChannelDisputed {
    pub channel_id: u64,
    pub initiator: Pubkey,
    pub counterparty: Pubkey,
    pub evidence_hash: [u8; 32],
}

/// Emitted when a channel is force-closed by the initiator after timeout.
#[event]
pub struct ChannelForceClosed {
    pub channel_id: u64,
    pub initiator: Pubkey,
    pub amount_returned: u64,
}

// ─── SSS-120: Authority Rotation events ──────────────────────────────────────

/// Emitted when an authority rotation is proposed.
#[event]
pub struct AuthorityRotationProposed {
    pub mint: Pubkey,
    pub current_authority: Pubkey,
    pub new_authority: Pubkey,
    pub backup_authority: Pubkey,
    pub proposed_slot: u64,
    pub timelock_slots: u64,
}

/// Emitted when the new_authority accepts the rotation after the timelock.
#[event]
pub struct AuthorityRotationCompleted {
    pub mint: Pubkey,
    pub prev_authority: Pubkey,
    pub new_authority: Pubkey,
}

/// Emitted when the backup_authority claims authority via emergency recovery.
#[event]
pub struct AuthorityRotationEmergencyRecovered {
    pub mint: Pubkey,
    pub prev_authority: Pubkey,
    pub backup_authority: Pubkey,
}

/// Emitted when the current authority cancels an in-flight rotation proposal.
#[event]
pub struct AuthorityRotationCancelled {
    pub mint: Pubkey,
    pub authority: Pubkey,
    pub cancelled_new_authority: Pubkey,
}

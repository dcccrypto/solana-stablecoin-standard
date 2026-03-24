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

// ─── SSS-123: Proof of Reserves events ───────────────────────────────────────

/// Emitted every time a reserve attestation is submitted or refreshed.
#[event]
pub struct ReserveAttestationSubmitted {
    /// The SSS stablecoin mint.
    pub mint: Pubkey,
    /// The attestor that submitted the attestation (authority, Pyth, or custodian).
    pub attestor: Pubkey,
    /// Claimed on-chain reserve amount (in collateral token native units).
    pub reserve_amount: u64,
    /// 32-byte hash of the off-chain audit evidence or Pyth price feed id.
    pub attestation_hash: [u8; 32],
    /// Solana slot at submission.
    pub slot: u64,
    /// Previous reserve amount (for change tracking).
    pub prev_reserve_amount: u64,
}

/// Emitted by `verify_reserve_ratio` with the current computed ratio.
#[event]
pub struct ReserveRatioEvent {
    /// The SSS stablecoin mint.
    pub mint: Pubkey,
    /// Reserve amount used in computation.
    pub reserve_amount: u64,
    /// Net circulating supply at time of computation.
    pub net_supply: u64,
    /// Computed ratio: reserve_amount * 10_000 / net_supply (bps).
    pub ratio_bps: u64,
    /// Slot of the last submitted attestation.
    pub last_attestation_slot: u64,
    /// Attestor who last submitted the attestation.
    pub attestor: Pubkey,
}

/// Emitted when the reserve ratio drops below `config.min_reserve_ratio_bps`.
#[event]
pub struct ReserveBreach {
    /// The SSS stablecoin mint.
    pub mint: Pubkey,
    /// Current reserve amount.
    pub reserve_amount: u64,
    /// Current net circulating supply.
    pub net_supply: u64,
    /// Current ratio in basis points.
    pub ratio_bps: u64,
    /// Minimum ratio that triggered the breach check.
    pub min_ratio_bps: u16,
    /// Slot of the last attestation.
    pub slot: u64,
}

// ---------------------------------------------------------------------------
// SSS-124: Reserve Composition events
// ---------------------------------------------------------------------------

/// Emitted when the reserve composition breakdown is created or updated.
#[event]
pub struct ReserveCompositionUpdated {
    /// The SSS stablecoin mint.
    pub mint: Pubkey,
    /// Authority who submitted the update.
    pub updated_by: Pubkey,
    /// Cash and cash equivalents (basis points).
    pub cash_bps: u16,
    /// US Treasury Bills (basis points).
    pub t_bills_bps: u16,
    /// Crypto assets (basis points).
    pub crypto_bps: u16,
    /// Other assets (basis points).
    pub other_bps: u16,
    /// Slot at which the composition was updated.
    pub slot: u64,
}

// ---------------------------------------------------------------------------
// SSS-125: Redemption Guarantee events
// ---------------------------------------------------------------------------

/// Emitted when a redemption request is fulfilled at par within SLA.
#[event]
pub struct RedemptionFulfilled {
    /// The SSS stablecoin mint.
    pub mint: Pubkey,
    /// User whose redemption was fulfilled.
    pub user: Pubkey,
    /// Amount of stable tokens redeemed.
    pub amount: u64,
    /// Slot at which the request was submitted.
    pub requested_slot: u64,
    /// Slot at which fulfillment occurred.
    pub fulfilled_slot: u64,
    /// Slots elapsed from request to fulfillment.
    pub sla_slots_used: u64,
}

/// Emitted when a redemption request expires unserviced (SLA breach).
/// User receives their stable tokens back plus a penalty from the insurance fund.
#[event]
pub struct RedemptionSLABreached {
    /// The SSS stablecoin mint.
    pub mint: Pubkey,
    /// User whose redemption SLA was breached.
    pub user: Pubkey,
    /// Amount of stable tokens that were not redeemed in time.
    pub amount: u64,
    /// Slot at which the redemption request was made.
    pub requested_slot: u64,
    /// Slot at which the SLA expired.
    pub expiry_slot: u64,
    /// Slot at which the claim was executed.
    pub claim_slot: u64,
    /// Penalty paid out from the insurance fund (collateral token units).
    pub penalty_paid: u64,
}

// ---------------------------------------------------------------------------
// SSS-127: Travel Rule events
// ---------------------------------------------------------------------------

/// Emitted when a TravelRuleRecord is submitted for a qualifying transfer.
#[event]
pub struct TravelRuleRecordSubmitted {
    /// The SSS stablecoin mint.
    pub mint: Pubkey,
    /// Monotonic nonce used to derive the TravelRuleRecord PDA.
    pub nonce: u64,
    /// Originating VASP pubkey.
    pub originator_vasp: Pubkey,
    /// Beneficiary VASP pubkey.
    pub beneficiary_vasp: Pubkey,
    /// Transfer amount this record covers (in token native units).
    pub transfer_amount: u64,
    /// Solana slot at which the record was submitted.
    pub slot: u64,
}

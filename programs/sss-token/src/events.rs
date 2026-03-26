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

// SSS-121: Guardian Multisig Emergency Pause

/// Emitted when a guardian opens a new pause proposal.
#[event]
pub struct GuardianPauseProposed {
    pub mint: Pubkey,
    pub proposer: Pubkey,
    pub proposal_id: u64,
    pub reason: [u8; 32],
}

/// Emitted when a guardian votes on an open pause proposal.
#[event]
pub struct GuardianPauseVoted {
    pub mint: Pubkey,
    pub guardian: Pubkey,
    pub proposal_id: u64,
    pub votes_so_far: u8,
    pub threshold: u8,
}

/// Emitted when a guardian-imposed pause is lifted.
#[event]
pub struct GuardianPauseLifted {
    pub mint: Pubkey,
    pub lifted_by: Pubkey,
    pub by_quorum: bool,
}

// BUG-018: Guardian pause override timelock
/// Emitted when authority lifts a guardian pause after the timelock has expired.
#[event]
pub struct GuardianPauseAuthorityOverride {
    pub mint: Pubkey,
    pub authority: Pubkey,
    /// Unix timestamp when override occurred.
    pub timestamp: i64,
}

// ---------------------------------------------------------------------------
// SSS-BUG-008: Proof of Reserves breach event
// ---------------------------------------------------------------------------

/// Emitted when minting is halted because the reserve ratio breaches the minimum.
#[event]
pub struct MintHaltedByPoRBreach {
    pub mint: Pubkey,
    pub current_ratio_bps: u64,
    pub min_ratio_bps: u64,
    pub last_attestation_slot: u64,
    pub attempted_amount: u64,
}

// ---------------------------------------------------------------------------
// SSS-130: PID fee events
// ---------------------------------------------------------------------------

#[event]
pub struct PidConfigInitialised {
    pub mint: Pubkey,
    pub kp: i64,
    pub ki: i64,
    pub kd: i64,
    pub target_price: u64,
    pub min_fee_bps: u16,
    pub max_fee_bps: u16,
}

#[event]
pub struct PidFeeUpdated {
    pub mint: Pubkey,
    pub old_fee_bps: u16,
    pub new_fee_bps: u16,
    pub current_price: u64,
    pub target_price: u64,
    pub error: i64,
    pub integral: i64,
    pub derivative: i64,
    pub delta_bps: i64,
}

// ---------------------------------------------------------------------------
// SSS-129: ZK Credential events
// ---------------------------------------------------------------------------

#[event]
pub struct CredentialRegistryInitialised {
    pub mint: Pubkey,
    pub issuer: Pubkey,
    pub merkle_root: [u8; 32],
    pub credential_ttl_slots: u64,
}

#[event]
pub struct CredentialRegistryRootRotated {
    pub mint: Pubkey,
    pub new_merkle_root: [u8; 32],
    pub slot: u64,
}

#[event]
pub struct CredentialIssued {
    pub mint: Pubkey,
    pub holder: Pubkey,
    pub issued_slot: u64,
    pub expires_slot: u64,
}

#[event]
pub struct CredentialRevoked {
    pub mint: Pubkey,
    pub holder: Pubkey,
    pub slot: u64,
}

// ---------------------------------------------------------------------------
// SSS-131: Liquidation bonus events
// ---------------------------------------------------------------------------

#[event]
pub struct LiquidationBonusConfigInitialised {
    pub mint: Pubkey,
    pub tier1_threshold_bps: u16,
    pub tier1_bonus_bps: u16,
    pub tier2_threshold_bps: u16,
    pub tier2_bonus_bps: u16,
    pub tier3_threshold_bps: u16,
    pub tier3_bonus_bps: u16,
    pub max_bonus_bps: u16,
}

#[event]
pub struct LiquidationBonusConfigUpdated {
    pub mint: Pubkey,
    pub old_tier1_threshold_bps: u16,
    pub old_tier1_bonus_bps: u16,
    pub new_tier1_threshold_bps: u16,
    pub new_tier1_bonus_bps: u16,
    pub old_tier2_threshold_bps: u16,
    pub old_tier2_bonus_bps: u16,
    pub new_tier2_threshold_bps: u16,
    pub new_tier2_bonus_bps: u16,
    pub old_tier3_threshold_bps: u16,
    pub old_tier3_bonus_bps: u16,
    pub new_tier3_threshold_bps: u16,
    pub new_tier3_bonus_bps: u16,
}

// ---------------------------------------------------------------------------
// SSS-132: PSM curve events
// ---------------------------------------------------------------------------

#[event]
pub struct PsmCurveConfigInitialised {
    pub mint: Pubkey,
    pub base_fee_bps: u16,
    pub curve_k: u64,
    pub max_fee_bps: u16,
    pub authority: Pubkey,
}

#[event]
pub struct PsmCurveConfigUpdated {
    pub mint: Pubkey,
    pub old_base_fee_bps: u16,
    pub new_base_fee_bps: u16,
    pub old_curve_k: u64,
    pub new_curve_k: u64,
    pub old_max_fee_bps: u16,
    pub new_max_fee_bps: u16,
    pub authority: Pubkey,
}

#[event]
pub struct PsmDynamicSwapEvent {
    pub mint: Pubkey,
    pub redeemer: Pubkey,
    pub sss_burned: u64,
    pub collateral_out: u64,
    pub fee_collected: u64,
    pub fee_bps: u16,
    pub vault_amount_before: u64,
    pub total_reserves: u64,
}

#[event]
pub struct PsmQuoteEvent {
    pub mint: Pubkey,
    pub amount_in: u64,
    pub expected_out: u64,
    pub expected_fee: u64,
    pub fee_bps: u16,
    pub vault_amount: u64,
}

// ---------------------------------------------------------------------------
// SSS-133: Wallet rate limit events
// ---------------------------------------------------------------------------

#[event]
pub struct WalletRateLimitSet {
    pub mint: Pubkey,
    pub wallet: Pubkey,
    pub max_transfer_per_window: u64,
    pub window_slots: u64,
    pub authority: Pubkey,
}

#[event]
pub struct WalletRateLimitRemoved {
    pub mint: Pubkey,
    pub wallet: Pubkey,
    pub authority: Pubkey,
}

// ---------------------------------------------------------------------------
// SSS-134: Squads authority events
// ---------------------------------------------------------------------------

#[event]
pub struct SquadsAuthorityInitialized {
    pub mint: Pubkey,
    pub multisig_pda: Pubkey,
    pub threshold: u8,
    pub member_count: u8,
    pub old_authority: Pubkey,
}

#[event]
pub struct SquadsAuthorityVerified {
    pub mint: Pubkey,
    pub multisig_pda: Pubkey,
    pub verified: bool,
}

// ---------------------------------------------------------------------------
// SSS-153: Multi-oracle consensus events
// ---------------------------------------------------------------------------

#[event]
pub struct OracleConsensusUpdated {
    pub mint: Pubkey,
    pub consensus_price: u64,
    pub source_count: u8,
    pub used_twap: bool,
    pub slot: u64,
}

#[event]
pub struct OracleOutlierRejected {
    pub mint: Pubkey,
    pub source_index: u8,
    pub feed: Pubkey,
    pub price: u64,
    pub median: u64,
    pub deviation_bps: u64,
    pub slot: u64,
}

#[event]
pub struct OracleStalenessDetected {
    pub mint: Pubkey,
    pub source_index: u8,
    pub feed: Pubkey,
    pub last_slot: u64,
    pub current_slot: u64,
}

// ---------------------------------------------------------------------------
// SSS-127: Travel Rule event
// ---------------------------------------------------------------------------

#[event]
pub struct TravelRuleRecordSubmitted {
    pub mint: Pubkey,
    pub nonce: u64,
    pub originator_vasp: Pubkey,
    pub beneficiary_vasp: Pubkey,
    pub transfer_amount: u64,
    pub slot: u64,
}

// ---------------------------------------------------------------------------
// SSS-128: Sanctions oracle events
// ---------------------------------------------------------------------------

#[event]
pub struct SanctionsOracleSet {
    pub mint: Pubkey,
    pub oracle: Pubkey,
    pub max_staleness_slots: u64,
}

#[event]
pub struct SanctionsOracleCleared {
    pub mint: Pubkey,
}

#[event]
pub struct SanctionsRecordUpdated {
    pub mint: Pubkey,
    pub wallet: Pubkey,
    pub is_sanctioned: bool,
    pub slot: u64,
}

// ---------------------------------------------------------------------------
// SSS-125: Redemption guarantee events
// ---------------------------------------------------------------------------

#[event]
pub struct RedemptionFulfilled {
    pub mint: Pubkey,
    pub user: Pubkey,
    pub amount: u64,
    pub requested_slot: u64,
    pub fulfilled_slot: u64,
    pub sla_slots_used: u64,
}

#[event]
pub struct RedemptionSLABreached {
    pub mint: Pubkey,
    pub user: Pubkey,
    pub amount: u64,
    pub requested_slot: u64,
    pub expiry_slot: u64,
    pub claim_slot: u64,
    pub penalty_paid: u64,
}

// ---------------------------------------------------------------------------
// SSS-137: Redemption pool events
// ---------------------------------------------------------------------------

#[event]
pub struct RedemptionPoolSeeded {
    pub sss_mint: Pubkey,
    pub amount: u64,
    pub new_liquidity: u64,
}

#[event]
pub struct InstantRedemption {
    pub sss_mint: Pubkey,
    pub user: Pubkey,
    pub burned: u64,
    pub received: u64,
    pub fee: u64,
    pub remaining_liquidity: u64,
}

#[event]
pub struct RedemptionPoolReplenished {
    pub sss_mint: Pubkey,
    pub replenisher: Pubkey,
    pub amount: u64,
    pub new_liquidity: u64,
}

#[event]
pub struct RedemptionPoolDrained {
    pub sss_mint: Pubkey,
    pub amount: u64,
}

// ---------------------------------------------------------------------------
// SSS-125: ReserveComposition event
// ---------------------------------------------------------------------------

#[event]
pub struct ReserveCompositionUpdated {
    pub mint: Pubkey,
    pub updated_by: Pubkey,
    pub cash_bps: u16,
    pub t_bills_bps: u16,
    pub crypto_bps: u16,
    pub other_bps: u16,
    pub slot: u64,
}

// ---------------------------------------------------------------------------
// SSS-Bridge: Bridge events
// ---------------------------------------------------------------------------

#[event]
pub struct BridgeConfigInitialized {
    pub sss_mint: Pubkey,
    pub bridge_type: u8,
    pub bridge_program: Pubkey,
    pub max_bridge_amount_per_tx: u64,
    pub bridge_fee_bps: u16,
}

#[event]
pub struct BridgeOut {
    pub sss_mint: Pubkey,
    pub sender: Pubkey,
    pub amount: u64,
    pub fee_amount: u64,
    pub target_chain: u16,
    pub recipient_address: [u8; 32],
    pub bridge_type: u8,
}

#[event]
pub struct BridgeIn {
    pub sss_mint: Pubkey,
    pub recipient: Pubkey,
    pub amount: u64,
    pub source_chain: u16,
    pub bridge_type: u8,
}

// ---------------------------------------------------------------------------
// SSS-152: Circuit breaker keeper events
// ---------------------------------------------------------------------------

#[event]
pub struct KeeperConfigInitialised {
    pub mint: Pubkey,
    pub deviation_threshold_bps: u16,
    pub keeper_reward_lamports: u64,
    pub min_cooldown_slots: u64,
    pub sustained_recovery_slots: u64,
}

#[event]
pub struct CircuitBreakerTriggered {
    pub mint: Pubkey,
    pub keeper: Pubkey,
    pub oracle_price: i64,
    pub target_price: u64,
    pub deviation_bps: u64,
    pub slot: u64,
}

#[event]
pub struct CircuitBreakerAutoUnpaused {
    pub mint: Pubkey,
    pub caller: Pubkey,
    pub oracle_price: i64,
    pub target_price: u64,
    pub deviation_bps: u64,
    pub recovery_slots: u64,
    pub slot: u64,
}

#[event]
pub struct KeeperRewarded {
    pub mint: Pubkey,
    pub keeper: Pubkey,
    pub reward_lamports: u64,
    pub slot: u64,
}

// ---------------------------------------------------------------------------
// SSS-154: Redemption queue events
// ---------------------------------------------------------------------------

#[event]
pub struct RedemptionQueued {
    pub sss_mint: Pubkey,
    pub owner: Pubkey,
    pub queue_index: u64,
    pub amount: u64,
    pub enqueue_slot: u64,
    pub slot_hash_seed: [u8; 8],
    pub earliest_process_slot: u64,
}

#[event]
pub struct RedemptionFulfilledQueued {
    pub sss_mint: Pubkey,
    pub owner: Pubkey,
    pub queue_index: u64,
    pub amount: u64,
    pub enqueue_slot: u64,
    pub fulfilled_slot: u64,
    pub keeper: Pubkey,
    pub keeper_reward_lamports: u64,
}

#[event]
pub struct RedemptionCancelled {
    pub sss_mint: Pubkey,
    pub owner: Pubkey,
    pub queue_index: u64,
    pub amount: u64,
    pub cancel_slot: u64,
}

// ---------------------------------------------------------------------------
// SSS-151: Insurance vault events (defined in instructions/insurance_vault.rs)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// SSS-138: Market maker events
// ---------------------------------------------------------------------------

#[event]
pub struct MarketMakerConfigInitialized {
    pub mint: Pubkey,
    pub mm_mint_limit_per_slot: u64,
    pub mm_burn_limit_per_slot: u64,
    pub spread_bps: u16,
    pub authority: Pubkey,
}

#[event]
pub struct MarketMakerRegistered {
    pub mint: Pubkey,
    pub market_maker: Pubkey,
    pub authority: Pubkey,
}

#[event]
pub struct MmMint {
    pub mint: Pubkey,
    pub market_maker: Pubkey,
    pub amount: u64,
    pub slot: u64,
}

#[event]
pub struct MmBurn {
    pub mint: Pubkey,
    pub market_maker: Pubkey,
    pub amount: u64,
    pub slot: u64,
}

#[event]
pub struct MmCapacity {
    pub mint: Pubkey,
    pub mint_remaining: u64,
    pub burn_remaining: u64,
    pub slot: u64,
}

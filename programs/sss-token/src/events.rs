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

// ---------------------------------------------------------------------------
// SSS-135: Cross-chain bridge events
// ---------------------------------------------------------------------------

/// Emitted when tokens are bridged out of Solana.
#[event]
pub struct BridgeOut {
    /// The SSS stablecoin mint.
    pub sss_mint: Pubkey,
    /// The sender who initiated the bridge-out.
    pub sender: Pubkey,
    /// Net tokens burned (after fee deduction).
    pub amount: u64,
    /// Fee burned (in native token units, 0 if bridge_fee_bps == 0).
    pub fee_amount: u64,
    /// Target chain ID (Wormhole chain ID or LayerZero chain ID).
    pub target_chain: u16,
    /// Recipient address on the target chain (32-byte universal address).
    pub recipient_address: [u8; 32],
    /// Bridge type: 1 = Wormhole, 2 = LayerZero.
    pub bridge_type: u8,
}

/// Emitted when tokens are bridged into Solana.
#[event]
pub struct BridgeIn {
    /// The SSS stablecoin mint.
    pub sss_mint: Pubkey,
    /// The recipient who received the minted tokens.
    pub recipient: Pubkey,
    /// Tokens minted.
    pub amount: u64,
    /// Source chain ID.
    pub source_chain: u16,
    /// Bridge type: 1 = Wormhole, 2 = LayerZero.
    pub bridge_type: u8,
}

/// Emitted when bridge config is initialized.
#[event]
pub struct BridgeConfigInitialized {
    /// The SSS stablecoin mint.
    pub sss_mint: Pubkey,
    /// Bridge type.
    pub bridge_type: u8,
    /// Bridge program address.
    pub bridge_program: Pubkey,
    /// Max bridge amount per tx (0 = unlimited).
    pub max_bridge_amount_per_tx: u64,
    /// Fee in basis points.
    pub bridge_fee_bps: u16,
}

// ---------------------------------------------------------------------------
// SSS-138: Market maker hook events
// ---------------------------------------------------------------------------

/// Emitted on a successful `mm_mint`.
#[event]
pub struct MmMint {
    pub mint: Pubkey,
    pub market_maker: Pubkey,
    pub amount: u64,
    pub slot: u64,
}

/// Emitted on a successful `mm_burn`.
#[event]
pub struct MmBurn {
    pub mint: Pubkey,
    pub market_maker: Pubkey,
    pub amount: u64,
    pub slot: u64,
}

/// Emitted by `get_mm_capacity` — reports remaining per-slot limits.
#[event]
pub struct MmCapacity {
    pub mint: Pubkey,
    pub mint_remaining: u64,
    pub burn_remaining: u64,
    pub slot: u64,
}

/// Emitted when MarketMakerConfig is initialised.
#[event]
pub struct MarketMakerConfigInitialized {
    pub mint: Pubkey,
    pub mm_mint_limit_per_slot: u64,
    pub mm_burn_limit_per_slot: u64,
    pub spread_bps: u16,
    pub authority: Pubkey,
}

/// Emitted when a market maker is registered or removed.
#[event]
pub struct MarketMakerRegistered {
    pub mint: Pubkey,
    pub market_maker: Pubkey,
    pub authority: Pubkey,
}

// ── SSS-134: Squads Authority Events ──────────────────────────────────────
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

// ── SSS-121: Guardian Pause Events ────────────────────────────────────────
#[event]
pub struct GuardianPauseProposed {
    pub mint: Pubkey,
    pub proposer: Pubkey,
    pub proposal_id: u64,
    pub reason: [u8; 32],
}

#[event]
pub struct GuardianPauseVoted {
    pub mint: Pubkey,
    pub guardian: Pubkey,
    pub proposal_id: u64,
    pub votes_so_far: u8,
    pub threshold: u8,
}

#[event]
pub struct GuardianPauseLifted {
    pub mint: Pubkey,
    pub lifted_by: Pubkey,
    pub by_quorum: bool,
}

// ── SSS-120: Authority Rotation Events ────────────────────────────────────
#[event]
pub struct AuthorityRotationProposed {
    pub mint: Pubkey,
    pub current_authority: Pubkey,
    pub new_authority: Pubkey,
    pub backup_authority: Pubkey,
    pub proposed_slot: u64,
    pub timelock_slots: u64,
}

#[event]
pub struct AuthorityRotationCompleted {
    pub mint: Pubkey,
    pub prev_authority: Pubkey,
    pub new_authority: Pubkey,
}

#[event]
pub struct AuthorityRotationEmergencyRecovered {
    pub mint: Pubkey,
    pub prev_authority: Pubkey,
    pub backup_authority: Pubkey,
}

#[event]
pub struct AuthorityRotationCancelled {
    pub mint: Pubkey,
    pub authority: Pubkey,
    pub cancelled_new_authority: Pubkey,
}

// ── APC: Agent Payment Channel Events ─────────────────────────────────────
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

#[event]
pub struct WorkProofSubmitted {
    pub channel_id: u64,
    pub initiator: Pubkey,
    pub task_hash: [u8; 32],
    pub output_hash: [u8; 32],
    pub proof_type: u8,
}

#[event]
pub struct ChannelSettled {
    pub channel_id: u64,
    pub initiator: Pubkey,
    pub counterparty: Pubkey,
    pub amount_to_counterparty: u64,
    pub amount_to_initiator: u64,
}

#[event]
pub struct ChannelDisputed {
    pub channel_id: u64,
    pub initiator: Pubkey,
    pub counterparty: Pubkey,
    pub evidence_hash: [u8; 32],
}

#[event]
pub struct ChannelForceClosed {
    pub channel_id: u64,
    pub initiator: Pubkey,
    pub amount_returned: u64,
}

// ── SSS-123: Proof of Reserves Events ─────────────────────────────────────
#[event]
pub struct ReserveAttestationSubmitted {
    pub mint: Pubkey,
    pub attestor: Pubkey,
    pub reserve_amount: u64,
    pub attestation_hash: [u8; 32],
    pub slot: u64,
    pub prev_reserve_amount: u64,
}

#[event]
pub struct ReserveRatioEvent {
    pub mint: Pubkey,
    pub reserve_amount: u64,
    pub net_supply: u64,
    pub ratio_bps: u64,
    pub last_attestation_slot: u64,
    pub attestor: Pubkey,
}

#[event]
pub struct ReserveBreach {
    pub mint: Pubkey,
    pub reserve_amount: u64,
    pub net_supply: u64,
    pub ratio_bps: u64,
    pub min_ratio_bps: u16,
    pub slot: u64,
}

// ── SSS-131: Liquidation Bonus Events ─────────────────────────────────────
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

// ── SSS-130: PID Fee Events ────────────────────────────────────────────────
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

// ── SSS-132: PSM Curve Events ──────────────────────────────────────────────
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

// ── SSS-133: Wallet Rate Limit Events ─────────────────────────────────────
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

// ── SSS-127: Travel Rule Events ────────────────────────────────────────────
#[event]
pub struct TravelRuleRecordSubmitted {
    pub mint: Pubkey,
    pub nonce: u64,
    pub originator_vasp: Pubkey,
    pub beneficiary_vasp: Pubkey,
    pub transfer_amount: u64,
    pub slot: u64,
}

// ── SSS-128: Sanctions Oracle Events ──────────────────────────────────────
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

// ── SSS-137: Redemption Pool Events ───────────────────────────────────────
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

// ── SSS-137: Redemption Guarantee Events ──────────────────────────────────
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

// ── SSS-124: Reserve Composition Events ───────────────────────────────────
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

// ── SSS-145: Mint Halted Events ────────────────────────────────────────────
#[event]
pub struct MintHaltedByPoRBreach {
    pub mint: Pubkey,
    pub current_ratio_bps: u64,
    pub min_ratio_bps: u64,
    pub last_attestation_slot: u64,
    pub attempted_amount: u64,
}

// ── SSS-129: ZK Credential Events ─────────────────────────────────────────
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

// ── PBS: Probabilistic Money Market Events ─────────────────────────────────
#[event]
pub struct ProbabilisticCommitmentCreated {
    pub config: Pubkey,
    pub commitment_id: u64,
    pub issuer: Pubkey,
    pub claimant: Pubkey,
    pub stable_mint: Pubkey,
    pub committed_amount: u64,
    pub condition_hash: [u8; 32],
    pub expiry_slot: u64,
}

#[event]
pub struct ProbabilisticCommitmentResolved {
    pub config: Pubkey,
    pub commitment_id: u64,
    pub claimant: Pubkey,
    pub amount_released: u64,
    pub partial: bool,
}

// ── SSS-153: Multi-Oracle Consensus Events ──────────────────────────────────

/// Emitted when update_oracle_consensus successfully computes (or falls back to TWAP for) a price.
#[event]
pub struct OracleConsensusUpdated {
    pub mint: Pubkey,
    /// Consensus price (raw, same scale as the oracle adapters).
    pub consensus_price: u64,
    /// Number of sources that passed both staleness and outlier checks.
    pub source_count: u8,
    /// True when fewer than min_oracles sources qualified and TWAP fallback was used.
    pub used_twap: bool,
    pub slot: u64,
}

/// Emitted when a source's last price age exceeds max_age_slots.
#[event]
pub struct OracleStalenessDetected {
    pub mint: Pubkey,
    pub source_index: u8,
    pub feed: Pubkey,
    pub last_slot: u64,
    pub current_slot: u64,
}

/// Emitted when a source's price deviates beyond outlier_threshold_bps from the median.
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

// ---------------------------------------------------------------------------
// SSS-154: Redemption Queue events
// ---------------------------------------------------------------------------

/// Emitted when a user enqueues a redemption.
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

/// Emitted when a keeper processes (fulfils) a queued redemption.
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

/// Emitted when a user cancels a queued redemption.
#[event]
pub struct RedemptionCancelled {
    pub sss_mint: Pubkey,
    pub owner: Pubkey,
    pub queue_index: u64,
    pub amount: u64,
    pub cancel_slot: u64,
}

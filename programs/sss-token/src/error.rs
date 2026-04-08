use anchor_lang::prelude::*;

#[error_code]
pub enum SssError {
    #[msg("Unauthorized: caller is not the authority")]
    Unauthorized,
    #[msg("Unauthorized: caller is not the compliance authority")]
    UnauthorizedCompliance,
    #[msg("Unauthorized: caller is not a registered minter")]
    NotAMinter,
    #[msg("Mint is paused")]
    MintPaused,
    #[msg("Minter cap exceeded")]
    MinterCapExceeded,
    #[msg("SSS-2 feature not available on SSS-1 preset")]
    WrongPreset,
    #[msg("Transfer hook program required for SSS-2")]
    MissingTransferHook,
    #[msg("Invalid preset: must be 1 (SSS-1), 2 (SSS-2), or 3 (SSS-3)")]
    InvalidPreset,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Insufficient collateral in reserve vault to mint")]
    InsufficientReserves,
    #[msg("Invalid collateral mint for this stablecoin")]
    InvalidCollateralMint,
    #[msg("Invalid reserve vault account")]
    InvalidVault,
    #[msg("Max supply would be exceeded")]
    MaxSupplyExceeded,
    #[msg("No pending authority transfer to accept")]
    NoPendingAuthority,
    #[msg("No pending compliance authority transfer to accept")]
    NoPendingComplianceAuthority,
    #[msg("Reserve vault is required for SSS-3")]
    ReserveVaultRequired,
    // CDP errors
    #[msg("Collateral ratio too low — minimum 150% required")]
    CollateralRatioTooLow,
    #[msg("CDP is healthy — cannot be liquidated (ratio >= 120%)")]
    CdpNotLiquidatable,
    #[msg("Insufficient debt to repay requested amount")]
    InsufficientDebt,
    #[msg("Insufficient collateral deposited in vault")]
    InsufficientCollateral,
    #[msg("Invalid Pyth price feed account")]
    InvalidPriceFeed,
    #[msg("Pyth price is stale or unavailable")]
    StalePriceFeed,
    #[msg("Price is zero or negative — cannot compute ratio")]
    InvalidPrice,
    #[msg("Collateral mint does not match the position's locked collateral (SSS-054: single-collateral per position)")]
    WrongCollateralMint,
    // CPI Composability (Direction 3)
    #[msg("InterfaceVersion PDA not initialized — call init_interface_version first")]
    InterfaceNotInitialized,
    #[msg("InterfaceVersion mismatch — caller pinned to an incompatible version")]
    InterfaceVersionMismatch,
    #[msg("This SSS interface has been deprecated — use the updated program")]
    InterfaceDeprecated,
    // Feature Flags (SSS-058)
    #[msg("Circuit breaker is active: mint/burn are halted")]
    CircuitBreakerActive,
    #[msg("Spend policy: transfer amount exceeds max_transfer_amount")]
    SpendLimitExceeded,
    #[msg("Spend policy: max_transfer_amount must be > 0 before enabling FLAG_SPEND_POLICY")]
    SpendPolicyNotConfigured,
    // DAO Committee Governance (SSS-067)
    #[msg("DAO committee is active: this admin op requires a passed proposal")]
    DaoCommitteeRequired,
    #[msg("Caller is not a registered committee member")]
    NotACommitteeMember,
    #[msg("Committee member has already voted on this proposal")]
    AlreadyVoted,
    #[msg("Proposal has already been executed")]
    ProposalAlreadyExecuted,
    #[msg("Proposal has been cancelled")]
    ProposalCancelled,
    #[msg("DAO proposal required — FLAG_DAO_COMMITTEE is active; provide an executed DrawInsurance proposal")]
    DaoProposalRequired,
    #[msg("DAO proposal config mismatch — proposal does not belong to this stablecoin config")]
    DaoProposalConfigMismatch,
    #[msg("DAO proposal wrong action — expected DrawInsurance")]
    DaoProposalWrongAction,
    #[msg("DAO proposal not yet executed — quorum must be reached and execute_action called first")]
    DaoProposalNotExecuted,
    #[msg("DAO proposal approved amount is less than requested draw amount")]
    DaoProposalInsufficientAmount,
    #[msg("Quorum not reached: not enough YES votes")]
    QuorumNotReached,
    #[msg("Quorum must be at least 1 and at most members.len()")]
    InvalidQuorum,
    #[msg("Committee member list is full (max 10)")]
    CommitteeFull,
    #[msg("Member not found in committee")]
    MemberNotFound,
    #[msg("Proposal action does not match the guarded instruction")]
    ProposalActionMismatch,
    // Yield-Bearing Collateral (SSS-070)
    #[msg("FLAG_YIELD_COLLATERAL is not enabled for this stablecoin")]
    YieldCollateralNotEnabled,
    #[msg("Collateral mint is not on the yield-bearing whitelist")]
    CollateralMintNotWhitelisted,
    #[msg("Yield collateral whitelist is full (max 8 mints)")]
    WhitelistFull,
    #[msg("Collateral mint is already on the whitelist")]
    MintAlreadyWhitelisted,
    // ZK Compliance (SSS-075)
    #[msg("FLAG_ZK_COMPLIANCE is not enabled for this stablecoin")]
    ZkComplianceNotEnabled,
    #[msg("ZK verification record has expired — submit a fresh proof")]
    VerificationExpired,
    #[msg("ZK verification record has not expired yet — cannot close")]
    VerificationRecordNotExpired,
    #[msg("ZK verification record is missing for this user")]
    VerificationRecordMissing,
    #[msg("ZK proof submission requires a verifier co-signature (verifier_pubkey is set)")]
    ZkVerifierRequired,
    #[msg("ZK proof verifier account does not match the configured verifier_pubkey")]
    ZkVerifierMismatch,
    // SSS-085: Security fixes
    #[msg("Price feed account does not match the registered expected_pyth_feed for this config")]
    UnexpectedPriceFeed,
    #[msg("Pyth price confidence interval is too wide — price uncertainty exceeds max_oracle_conf_bps")]
    OracleConfidenceTooWide,
    #[msg("Admin timelock: operation not yet mature — wait until the required slot")]
    TimelockNotMature,
    #[msg("No pending timelocked operation to execute")]
    NoTimelockPending,
    // BUG-010: Timelock enforcement errors
    #[msg("Direct admin call blocked — timelock is active; use propose_timelocked_op + execute_timelocked_op")]
    TimelockRequired,
    #[msg("Invalid timelock op kind — unrecognised ADMIN_OP_* constant")]
    InvalidTimelockOpKind,
    #[msg("Invalid timelock delay — minimum 216_000 slots (1 epoch) required")]
    InvalidTimelockDelay,
    #[msg("Invalid stability fee — max 10_000 bps (100% p.a.)")]
    InvalidStabilityFee,
    #[msg("Invalid backstop params — max_backstop_bps must be ≤ 10_000")]
    InvalidBackstopParams,
    #[msg("Invalid min reserve ratio — max 20_000 bps (200%)")]
    InvalidReserveRatio,
    #[msg("Duplicate pubkey in DAO committee member list")]
    DuplicateMember,
    #[msg("Liquidation slippage: collateral received is below caller-specified minimum")]
    SlippageExceeded,
    // SSS-091: DefaultAccountState=Frozen
    #[msg("Token program must be Token-2022 (spl-token-2022 program)")]
    InvalidTokenProgram,
    // SSS-092: Stability fee
    #[msg("Stability fee bps exceeds maximum allowed (2000 = 20% p.a.)")]
    StabilityFeeTooHigh,
    // SSS-093: PSM fee + velocity
    #[msg("Minter epoch velocity limit exceeded — too much minted in this epoch")]
    MintVelocityExceeded,
    #[msg("PSM redemption fee too high — max 1000 bps (10%)")]
    InvalidPsmFee,
    // SSS-097: Bad Debt Backstop
    #[msg("Bad debt backstop is not configured — set insurance_fund_pubkey first")]
    BackstopNotConfigured,
    #[msg("No bad debt detected — collateral covers outstanding debt")]
    NoBadDebt,
    #[msg("Insurance fund balance is zero — cannot backstop")]
    InsuranceFundEmpty,
    #[msg("max_backstop_bps exceeds maximum allowed (10000 = 100%)")]
    InvalidBackstopBps,
    #[msg("Caller is not the liquidation handler — only cdp_liquidate may trigger backstop")]
    UnauthorizedBackstopCaller,
    // SSS-098: CollateralConfig PDA
    #[msg("Collateral mint is not whitelisted in CollateralConfig")]
    CollateralNotWhitelisted,
    #[msg("CollateralConfig deposit cap exceeded")]
    DepositCapExceeded,
    #[msg("liquidation_threshold_bps must be > max_ltv_bps")]
    InvalidCollateralThreshold,
    #[msg("liquidation_bonus_bps cannot exceed 5000 (50%)")]
    InvalidLiquidationBonus,
    // SSS-106: Confidential Transfers
    #[msg("Confidential transfer not enabled for this mint")]
    ConfidentialTransferNotEnabled,
    #[msg("Auditor ElGamal pubkey required for confidential transfers")]
    MissingAuditorKey,
    #[msg("Invalid amount")]
    InvalidAmount,
    #[msg("Insufficient repayment amount for partial liquidation")]
    PartialLiquidationInsufficientRepay,
    // SSS-109: Probabilistic Balance Standard
    #[msg("Feature flag not enabled on this config")]
    FeatureNotEnabled,
    #[msg("Proof hash does not match the committed condition hash")]
    ProofHashMismatch,
    #[msg("Vault is already in a terminal state (Resolved or Expired)")]
    VaultAlreadyTerminal,
    #[msg("Vault has not yet expired (current slot < expiry_slot)")]
    VaultNotExpired,
    #[msg("Expiry slot must be in the future")]
    InvalidExpirySlot,
    // SSS-110: Agent Payment Channel
    #[msg("Channel is already closed (settled or force-closed)")]
    ChannelAlreadyClosed,
    #[msg("Settle amount exceeds channel deposit")]
    InvalidSettleAmount,
    #[msg("A settlement has already been proposed for this channel")]
    SettlementAlreadyProposed,
    #[msg("Counter-sign amount does not match proposed settlement amount")]
    SettlementNotMatching,
    #[msg("Channel timeout has not elapsed yet")]
    ChannelNotExpired,
    // SSS-113: Security audit fixes
    #[msg("Authority transfer must use the admin timelock path when a timelock delay is configured")]
    UseTimelockForAuthorityTransfer,
    #[msg("Caller is not authorized to trigger the backstop (authority only)")]
    UnauthorizedBackstopTrigger,
    // SSS-119: Oracle abstraction layer
    #[msg("Oracle adapter not configured — Switchboard V2 crate not yet integrated")]
    OracleNotConfigured,
    #[msg("oracle_type must be 0 (Pyth), 1 (Switchboard), or 2 (Custom)")]
    InvalidOracleType,
    // SSS-120: Authority rotation
    #[msg("Rotation new_authority must differ from current authority")]
    RotationNewAuthorityIsCurrent,
    #[msg("Rotation backup_authority must differ from current authority")]
    RotationBackupIsCurrent,
    #[msg("Rotation backup_authority must differ from new_authority")]
    RotationBackupEqualsNew,
    #[msg("Rotation pubkeys must be non-zero")]
    RotationZeroPubkey,
    #[msg("Emergency recovery window has not elapsed (7 days required)")]
    EmergencyRecoveryNotReady,
    // Insurance fund
    #[msg("Insurance fund not configured — set insurance_fund_pubkey first")]
    InsuranceFundNotConfigured,
    // BUG-022: Blacklist freeze-on-blacklist
    #[msg("Invalid mint account — does not match config.mint")]
    InvalidMint,
    #[msg("Invalid blacklist state PDA — expected [b\"blacklist-state\", mint] on transfer-hook program")]
    InvalidBlacklistState,
    #[msg("Invalid transfer hook program — expected registered transfer_hook_program")]
    InvalidTransferHookProgram,
    // SSS-147: Trustless hardening
    #[msg("FLAG_DAO_COMMITTEE cannot be cleared via timelock — requires an explicit DAO governance vote")]
    DaoFlagProtected,
    #[msg("Caller is not the authority nor a registered committee member — cannot propose")]
    NotAuthorizedToPropose,
    // SSS-127: Travel Rule
    #[msg("Compliance authority changes require a timelocked operation")]
    ComplianceAuthorityRequiresTimelock,
    #[msg("Travel Rule record is invalid or does not match the transfer")]
    TravelRuleRecordInvalid,
    #[msg("Travel Rule threshold not set — call set_travel_rule_threshold first")]
    TravelRuleThresholdNotSet,
    #[msg("Travel Rule threshold requires a travel rule record for this amount")]
    TravelRuleRequired,
    // SSS-128: Sanctions
    #[msg("Sanctioned address — transfer blocked by sanctions oracle")]
    SanctionedAddress,
    #[msg("Sanctions record is stale — oracle has not attested recently")]
    SanctionsRecordStale,
    #[msg("Sanctions record account is required when FLAG_SANCTIONS_ORACLE is set")]
    SanctionsRecordMissing,
    // SSS-137: Redemption pool
    #[msg("Redemption pool is empty — no liquidity available")]
    RedemptionPoolEmpty,
    #[msg("Redemption pool is full — liquidity exceeds max_pool_size")]
    RedemptionPoolFull,
    #[msg("Redemption pool mint mismatch — pool does not match the stablecoin mint")]
    RedemptionPoolMintMismatch,
    #[msg("Redemption pool vault mismatch — vault does not match the pool's vault_token_account")]
    RedemptionPoolVaultMismatch,
    #[msg("Redemption already fulfilled — cannot fulfill twice")]
    RedemptionAlreadyFulfilled,
    #[msg("Redemption not expired — SLA window has not elapsed")]
    RedemptionNotExpired,
    #[msg("Redemption daily limit exceeded — try again in the next window")]
    RedemptionDailyLimitExceeded,
    #[msg("Redemption fee too high — max 500 bps (5%)")]
    RedemptionFeeTooHigh,
    #[msg("SLA has been breached — use claim_expired_redemption instead")]
    RedemptionSLABreached,
    // Bridge errors
    #[msg("Bridge is not enabled — FLAG_BRIDGE_ENABLED is not set")]
    BridgeNotEnabled,
    #[msg("Bridge config mint mismatch")]
    BridgeConfigMintMismatch,
    #[msg("Bridge type invalid — must be 0 (Wormhole) or 1 (LayerZero)")]
    InvalidBridgeType,
    #[msg("Bridge fee too high — max 1000 bps (10%)")]
    BridgeFeeTooHigh,
    #[msg("Bridge amount exceeds the per-tx limit")]
    BridgeAmountExceedsLimit,
    #[msg("Bridge proof is empty")]
    BridgeProofEmpty,
    #[msg("Bridge recipient mismatch")]
    BridgeRecipientMismatch,
    #[msg("Bridge relayer is not authorized")]
    BridgeRelayerUnauthorized,
    // Token account errors
    #[msg("Token account owner mismatch")]
    TokenAccountOwnerMismatch,
    #[msg("Token account mint mismatch")]
    TokenAccountMintMismatch,
    // Fee vault errors
    #[msg("Fee vault does not match the configured fee vault")]
    FeeVaultMismatch,
    // Reserve composition
    #[msg("Invalid composition — bps components must sum to 10_000")]
    InvalidCompositionBps,
    // SSS-138: Market maker hooks
    #[msg("Market maker hooks disabled — FLAG_MARKET_MAKER_HOOKS not set")]
    MarketMakerHooksDisabled,
    #[msg("Market maker hooks not enabled")]
    MarketMakerHooksNotEnabled,
    #[msg("Caller is not a whitelisted market maker")]
    NotWhitelistedMarketMaker,
    #[msg("Market maker list is full (max 8)")]
    MarketMakerListFull,
    #[msg("Market maker is already registered")]
    MarketMakerAlreadyRegistered,
    #[msg("MM mint limit exceeded for this slot")]
    MmMintLimitExceeded,
    #[msg("MM burn limit exceeded for this slot")]
    MmBurnLimitExceeded,
    #[msg("Oracle price is outside spread threshold — mm_mint/mm_burn not permitted")]
    OraclePriceOutsideSpread,
    // SSS-152: Keeper / Circuit breaker
    #[msg("Keeper config mint mismatch")]
    KeeperConfigMintMismatch,
    #[msg("Circuit breaker is not armed — deviation is within threshold")]
    CircuitBreakerNotArmed,
    #[msg("Peg is still deviating — cannot auto-unpause yet")]
    PegStillDeviating,
    #[msg("Peg is within threshold — no action needed")]
    PegWithinThreshold,
    #[msg("Keeper cooldown is active — wait before triggering again")]
    KeeperCooldownActive,
    #[msg("Recovery window not met — peg must stay stable for sustained_recovery_slots")]
    KeeperRecoveryWindowNotMet,
    #[msg("Invalid keeper deviation threshold")]
    InvalidKeeperDeviation,
    #[msg("Invalid keeper cooldown — must be >= 10 slots")]
    InvalidKeeperCooldown,
    #[msg("Invalid keeper reward — exceeds MAX_KEEPER_REWARD_LAMPORTS (0.1 SOL)")]
    InvalidKeeperReward,
    #[msg("Invalid keeper recovery — sustained_recovery_slots must be > 0")]
    InvalidKeeperRecovery,
    #[msg("Mint is not paused")]
    NotPaused,
    // SSS-154: Redemption queue
    #[msg("Redemption queue not initialized — call init_redemption_queue first")]
    RedemptionQueueNotInitialized,
    #[msg("Redemption queue is full")]
    RedemptionQueueFull,
    #[msg("Redemption already processed")]
    RedemptionAlreadyProcessed,
    #[msg("Redemption not ready — min_delay_slots not elapsed")]
    RedemptionNotReady,
    #[msg("Caller is not the owner of this redemption entry")]
    RedemptionNotOwner,
    #[msg("Redemption slot cap exceeded — too many redeemed this slot")]
    RedemptionSlotCapExceeded,
    #[msg("Redemption queue out of order — must process queue_head first (FIFO enforced)")]
    RedemptionQueueOutOfOrder,
    // SSS-150: Upgrade authority guard
    #[msg("Upgrade authority guard is not set")]
    UpgradeAuthorityGuardNotSet,
    #[msg("Upgrade authority guard is already set (irreversible)")]
    UpgradeAuthorityGuardAlreadySet,
    #[msg("Upgrade authority guard key is invalid (zero or mismatches squads_multisig)")]
    UpgradeAuthorityGuardInvalidKey,
    #[msg("Upgrade authority mismatch — actual BPF upgrade authority differs from guard")]
    UpgradeAuthorityMismatch,
    // SSS-121: Guardian errors
    #[msg("Guardian list is empty — add at least one guardian before setting threshold")]
    GuardianListEmpty,
    #[msg("Guardian list is full (max 7)")]
    GuardianListFull,
    #[msg("Invalid guardian threshold — must be >= 1 and <= guardians.len()")]
    InvalidGuardianThreshold,
    #[msg("Duplicate guardian pubkey in list")]
    DuplicateGuardian,
    #[msg("Caller is not a registered guardian")]
    NotAGuardian,
    #[msg("Guardian-initiated pause timelock is still active")]
    GuardianPauseTimelockActive,
    // Config version
    #[msg("Config version is too old — upgrade the config before calling this instruction")]
    ConfigVersionTooOld,
    // SSS-153: Multi-oracle consensus errors
    #[msg("OracleConsensus PDA not found — call init_oracle_consensus first")]
    OracleConsensusNotFound,
    // SSS-BUG-008: Proof-of-Reserves errors
    #[msg("Proof-of-Reserves has not been attested yet")]
    PoRNotAttested,
    #[msg("Proof-of-Reserves breach: reserve ratio below minimum — minting halted")]
    PoRBreachHaltsMinting,
    // SSS-147: Supply cap
    #[msg("Supply cap is required for SSS-3 preset — set max_supply > 0")]
    SupplyCapRequired,
    // SSS-147B: max_supply enforcement for SSS-3
    #[msg("SSS-3 preset requires max_supply > 0")]
    RequiresMaxSupplyForSSS3,
    // SSS-147A: squads multisig enforcement for SSS-3
    #[msg("SSS-3 preset requires a valid squads_multisig pubkey — cannot be None or default")]
    RequiresSquadsForSSS3,
    #[msg("Max supply is immutable after initialization")]
    MaxSupplyImmutable,
    // SSS-129: ZK credential
    #[msg("CredentialRegistry not found — call init_credential_registry first")]
    CredentialRegistryNotFound,
    // SSS-153: Oracle errors
    #[msg("Insufficient valid oracle sources for consensus")]
    InsufficientOracles,
    // SSS-156: Legal entity registry errors
    #[msg("Invalid legal entity attestor — attestor pubkey does not match registry")]
    InvalidLegalEntityAttestor,
    #[msg("Invalid legal entity hash — hash must be 32 non-zero bytes")]
    InvalidLegalEntityHash,
    #[msg("Invalid jurisdiction — must be a 2-character ISO 3166-1 alpha-2 code")]
    InvalidLegalEntityJurisdiction,
    // SSS-131: Liquidation bonus errors
    #[msg("Invalid liquidation tier config — thresholds must be ordered and bonuses within bounds")]
    InvalidLiquidationTierConfig,
    // SSS-153: Oracle consensus config errors
    #[msg("Invalid oracle consensus config — check num_sources and max_age_slots")]
    InvalidOracleConsensusConfig,
    #[msg("Invalid oracle source index — index out of range")]
    InvalidOracleSourceIndex,
    // SSS-130: PID fee errors
    #[msg("Invalid PID fee range — min_fee_bps must be <= max_fee_bps")]
    InvalidPidFeeRange,
    // SSS-132: PSM curve errors
    #[msg("Invalid PSM curve base fee — must be <= max_fee_bps")]
    InvalidPsmCurveBaseFee,
    #[msg("Invalid PSM curve max fee — exceeds maximum allowed (1000 bps)")]
    InvalidPsmCurveMaxFee,
    // SSS-133: Wallet rate limit errors
    #[msg("Invalid rate limit amount — must be > 0")]
    InvalidRateLimitAmount,
    #[msg("Invalid rate limit window — window_slots must be > 0")]
    InvalidRateLimitWindow,
    // SSS-129: ZK proof errors
    #[msg("Invalid ZK proof — proof verification failed")]
    InvalidZkProof,
    // SSS-156: Legal entity attestation errors
    #[msg("Legal entity has already been attested — cannot attest twice")]
    LegalEntityAlreadyAttested,
    #[msg("Legal entity record has expired")]
    LegalEntityExpired,
    // SSS-153: Multi-oracle not enabled
    #[msg("Multi-oracle consensus not enabled — FLAG_MULTI_ORACLE_CONSENSUS is not set")]
    MultiOracleNotEnabled,
    #[msg("No oracle sources configured for consensus")]
    OracleNoSourcesConfigured,
    #[msg("Oracle remaining accounts count does not match num_sources")]
    OracleRemainingAccountsMismatch,
    // SSS-130: PID config not found
    #[msg("PID config not found — call init_pid_config first")]
    PidConfigNotFound,
    // SSS-132: PSM curve config not found
    #[msg("PSM curve config not found — call init_psm_curve_config first")]
    PsmCurveConfigNotFound,
    #[msg("PSM dynamic fees not enabled — FLAG_PSM_DYNAMIC_FEES is not set")]
    PsmDynamicFeesNotEnabled,
    #[msg("PSM dynamic swap output is zero after fee deduction")]
    PsmSwapOutputZero,
    // SSS-134: Squads authority errors
    #[msg("Squads authority already set — FLAG_SQUADS_AUTHORITY is irreversible")]
    SquadsAuthorityAlreadySet,
    #[msg("Squads authority not set — FLAG_SQUADS_AUTHORITY is not enabled")]
    SquadsAuthorityNotSet,
    #[msg("Duplicate member in Squads member list")]
    SquadsDuplicateMember,
    #[msg("Squads member list is empty — provide at least one member")]
    SquadsMembersEmpty,
    #[msg("Squads member list is too large — max 10 members")]
    SquadsMembersTooMany,
    #[msg("Squads multisig PDA is invalid — does not match expected derivation")]
    SquadsMultisigPdaInvalid,
    #[msg("Squads signer does not match the configured multisig_pda")]
    SquadsSignerMismatch,
    #[msg("Squads threshold exceeds member count")]
    SquadsThresholdExceedsMembers,
    #[msg("Squads threshold must be >= 1")]
    SquadsThresholdZero,
    // SSS-133: Wallet rate limit errors
    #[msg("Wallet rate limit exceeded — transfer would exceed window allowance")]
    WalletRateLimitExceeded,
    #[msg("Wallet rate limits not enabled — FLAG_WALLET_RATE_LIMITS is not set")]
    WalletRateLimitsNotEnabled,
    #[msg("DAO proposal amount exhausted — cumulative draws have consumed the full approved amount")]
    DaoProposalExhausted,
    #[msg("Invalid feature flags — prohibited flags set at initialization")]
    InvalidFeatureFlags,
    #[msg("This instruction has been disabled")]
    InstructionDisabled,
    #[msg("No collateral mint configured — collateral_mint is Pubkey::default")]
    NoCollateralConfigured,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("PID controller updates must be at least 10 slots apart")]
    PidUpdateTooFrequent,
    #[msg("Invalid collateral config — max_ltv_bps and liquidation_threshold_bps must be <= 10_000")]
    InvalidCollateralConfig,
    #[msg("Interface version downgrade not allowed — new version must be >= current version")]
    InvalidInterfaceVersion,
}

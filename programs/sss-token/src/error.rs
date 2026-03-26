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
    // SSS-100: Multi-collateral / partial liquidation
    #[msg("partial_repay_amount would not restore CDP to healthy ratio — increase repay amount")]
    PartialLiquidationInsufficientRepay,
    #[msg("invalid amount: partial_repay_amount exceeds total debt")]
    InvalidAmount,
    // SSS-106: Confidential Transfers
    #[msg("Confidential transfer not enabled for this mint")]
    ConfidentialTransferNotEnabled,
    #[msg("Auditor ElGamal pubkey required for confidential transfers")]
    MissingAuditorKey,
    #[msg("Auditor ElGamal pubkey must be non-zero (all-zero key is invalid)")]
    InvalidElGamalKey,
    #[msg("ct_config account must be omitted when FLAG_CONFIDENTIAL_TRANSFERS is not set")]
    UnexpectedCtConfig,
    // SSS-135: Cross-chain bridge
    #[msg("Bridge not enabled — set FLAG_BRIDGE_ENABLED via set_feature_flag")]
    BridgeNotEnabled,
    #[msg("Bridge fee bps exceeds maximum allowed (1000 = 10%)")]
    BridgeFeeTooHigh,
    #[msg("Invalid bridge type — must be 1 (Wormhole) or 2 (LayerZero)")]
    InvalidBridgeType,
    #[msg("Bridge amount exceeds max_bridge_amount_per_tx limit")]
    BridgeAmountExceedsLimit,
    #[msg("Bridge config mint does not match the provided mint account")]
    BridgeConfigMintMismatch,
    #[msg("Token account owner does not match expected signer")]
    TokenAccountOwnerMismatch,
    #[msg("Token account mint does not match the stablecoin mint")]
    TokenAccountMintMismatch,
    #[msg("Bridge recipient does not match recipient_token_account owner")]
    BridgeRecipientMismatch,
    #[msg("Bridge proof bytes are empty")]
    BridgeProofEmpty,
    #[msg("Bridge proof verification failed")]
    BridgeProofInvalid,
    // SSS-138: Market maker errors
    #[msg("Market maker hooks not enabled — set FLAG_MARKET_MAKER_HOOKS first")]
    MarketMakerHooksNotEnabled,
    #[msg("Caller is not a whitelisted market maker")]
    NotWhitelistedMarketMaker,
    #[msg("Market maker whitelist is full (max 10)")]
    MarketMakerListFull,
    #[msg("Market maker mint limit exceeded for this slot")]
    MmMintLimitExceeded,
    #[msg("Market maker burn limit exceeded for this slot")]
    MmBurnLimitExceeded,
    #[msg("Oracle price is outside the market maker spread tolerance")]
    OraclePriceOutsideSpread,
    #[msg("Market maker already registered")]
    MarketMakerAlreadyRegistered,
    // Travel Rule (SSS-127)
    #[msg("Travel Rule: missing TravelRuleRecord PDA for this transfer")]
    TravelRuleRequired,
    #[msg("Travel Rule: record amount does not match transfer amount")]
    TravelRuleRecordInvalid,
    #[msg("Travel Rule: threshold not configured — call set_travel_rule_threshold first")]
    TravelRuleThresholdNotSet,
    // Sanctions Oracle (SSS-128)
    #[msg("Sanctions oracle: SanctionsRecord PDA is required when FLAG_SANCTIONS_ORACLE is set")]
    SanctionsRecordMissing,
    #[msg("Sanctions oracle: wallet is sanctioned — transfer blocked")]
    SanctionedAddress,
    #[msg("Sanctions oracle: SanctionsRecord is stale — update before transfer")]
    SanctionsRecordStale,
    // Guardian Pause (SSS-121)
    #[msg("Guardian: caller is not a registered guardian")]
    NotAGuardian,
    #[msg("Guardian: caller is already in the guardian list")]
    DuplicateGuardian,
    #[msg("Guardian: guardian list is full (max 7)")]
    GuardianListFull,
    #[msg("Guardian: guardian list is empty")]
    GuardianListEmpty,
    #[msg("Guardian: threshold must be >= 1 and <= guardian count")]
    InvalidGuardianThreshold,
    // Squads Authority (SSS-134)
    #[msg("Squads: FLAG_SQUADS_AUTHORITY already set — irreversible")]
    SquadsAuthorityAlreadySet,
    #[msg("Squads: FLAG_SQUADS_AUTHORITY not set")]
    SquadsAuthorityNotSet,
    #[msg("Squads: signer does not match registered multisig PDA")]
    SquadsSignerMismatch,
    #[msg("Squads: threshold must be >= 1")]
    SquadsThresholdZero,
    #[msg("Squads: threshold cannot exceed member count")]
    SquadsThresholdExceedsMembers,
    #[msg("Squads: member list is empty")]
    SquadsMembersEmpty,
    #[msg("Squads: too many members (max 20)")]
    SquadsMembersTooMany,
    #[msg("Squads: duplicate member pubkey in list")]
    SquadsDuplicateMember,
    #[msg("Squads: provided multisig PDA does not match registered address")]
    SquadsMultisigPdaInvalid,
    // Proof of Reserves (SSS-123)
    #[msg("PoR: FLAG_POR_HALT_ON_BREACH is set but ProofOfReserves PDA not provided")]
    PoRNotAttested,
    #[msg("PoR: reserve ratio is below minimum — minting halted")]
    PoRBreachHaltsMinting,
    #[msg("PoR: reserve attestor whitelist is full")]
    ReserveAttestorWhitelistFull,
    // PID Fee (SSS-130)
    #[msg("PID fee: PidConfig PDA not found — call init_pid_config first")]
    PidConfigNotFound,
    #[msg("PID fee: fee parameters out of valid range")]
    InvalidPidFeeRange,
    // PSM Dynamic Fees (SSS-132)
    #[msg("PSM: dynamic fees not enabled — set FLAG_PSM_DYNAMIC_FEES first")]
    PsmDynamicFeesNotEnabled,
    #[msg("PSM: PsmCurveConfig PDA not found")]
    PsmCurveConfigNotFound,
    #[msg("PSM: base_fee_bps must be > 0")]
    InvalidPsmCurveBaseFee,
    #[msg("PSM: max_fee_bps must be >= base_fee_bps")]
    InvalidPsmCurveMaxFee,
    #[msg("PSM: swap output amount is zero")]
    PsmSwapOutputZero,
    // Wallet Rate Limits (SSS-133)
    #[msg("Wallet rate limits not enabled — set FLAG_WALLET_RATE_LIMITS first")]
    WalletRateLimitsNotEnabled,
    #[msg("Wallet rate limit: max_transfer_per_window must be > 0")]
    InvalidRateLimitAmount,
    #[msg("Wallet rate limit: window_slots must be > 0")]
    InvalidRateLimitWindow,
    // Redemption Pool (SSS-137)
    #[msg("Redemption pool: pool is empty")]
    RedemptionPoolEmpty,
    #[msg("Redemption pool: pool is full")]
    RedemptionPoolFull,
    #[msg("Redemption pool: mint mismatch")]
    RedemptionPoolMintMismatch,
    #[msg("Redemption pool: vault mismatch")]
    RedemptionPoolVaultMismatch,
    #[msg("Redemption pool: fee too high (max 1000 bps)")]
    RedemptionFeeTooHigh,
    #[msg("Redemption pool: daily limit exceeded")]
    RedemptionDailyLimitExceeded,
    #[msg("Redemption pool: SLA breach — redemption not fulfilled in time")]
    RedemptionSLABreached,
    #[msg("Redemption pool: request already fulfilled")]
    RedemptionAlreadyFulfilled,
    #[msg("Redemption pool: SLA period not yet expired")]
    RedemptionNotExpired,
    // Reserve Composition (SSS-124)
    #[msg("Reserve composition: bps values must sum to <= 10000")]
    InvalidCompositionBps,
    // Authority Rotation (SSS-122)
    #[msg("Authority rotation: new authority is same as current")]
    RotationNewAuthorityIsCurrent,
    #[msg("Authority rotation: backup authority is same as current")]
    RotationBackupIsCurrent,
    #[msg("Authority rotation: backup equals new authority")]
    RotationBackupEqualsNew,
    #[msg("Authority rotation: zero pubkey not allowed")]
    RotationZeroPubkey,
    #[msg("Use the admin timelock flow for authority transfer")]
    UseTimelockForAuthorityTransfer,
    // ZK Credentials (SSS-129)
    #[msg("ZK credential registry not found — call init_zk_credentials first")]
    CredentialRegistryNotFound,
    #[msg("ZK proof is invalid or malformed")]
    InvalidZkProof,
    #[msg("ZK proof hash does not match stored commitment")]
    ProofHashMismatch,
    // Agent/Channel (future)
    #[msg("Channel already closed")]
    ChannelAlreadyClosed,
    #[msg("Channel has not yet expired")]
    ChannelNotExpired,
    #[msg("Feature not enabled — check required feature flag")]
    FeatureNotEnabled,
    // Config version
    #[msg("Config version is too old — upgrade the program")]
    ConfigVersionTooOld,
    // Supply Cap (SSS-145)
    #[msg("Supply cap and minter cap cannot both be zero when supply cap feature is enabled")]
    SupplyCapAndMinterCapBothZero,
    // Vault lifecycle
    #[msg("Vault is already in terminal state")]
    VaultAlreadyTerminal,
    #[msg("Vault has not yet expired")]
    VaultNotExpired,
    // Settlement
    #[msg("Settlement amount does not match expected")]
    SettlementNotMatching,
    #[msg("Invalid settle amount")]
    InvalidSettleAmount,
    // Liquidation tiers (SSS-131)
    #[msg("Invalid liquidation tier configuration")]
    InvalidLiquidationTierConfig,
    // Oracle
    #[msg("Invalid oracle type — must be 0 (Pyth), 1 (Switchboard), or 2 (Custom)")]
    InvalidOracleType,
    // Expiry
    #[msg("Invalid expiry slot")]
    InvalidExpirySlot,
    // Emergency recovery
    #[msg("Emergency recovery conditions not yet met")]
    EmergencyRecoveryNotReady,
    // Insurance fund
    #[msg("Insurance fund not configured — set insurance_fund_pubkey first")]
    InsuranceFundNotConfigured,
    // Oracle
    #[msg("Oracle not configured — set oracle_type and oracle_feed first")]
    OracleNotConfigured,
    // BUG-019: Appended last to avoid shifting downstream discriminants
    #[msg("Compliance authority transfer always requires propose_timelocked_op (op_kind=10) with minimum 432_000 slot delay")]
    ComplianceAuthorityRequiresTimelock,
}

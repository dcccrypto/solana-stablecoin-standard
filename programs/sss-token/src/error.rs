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
    // SSS-123: Proof of Reserves
    #[msg("Reserve attestation not yet initialized — submit_reserve_attestation first")]
    ReserveNotInitialized,
    #[msg("Reserve attestor whitelist is full (max 4 entries)")]
    ReserveAttestorWhitelistFull,
    // SSS-124: Reserve Composition
    #[msg("Reserve composition basis points must sum to exactly 10000 (100%)")]
    InvalidCompositionBps,
    // SSS-125: Redemption Guarantee
    #[msg("Redemption amount would exceed the daily redemption limit")]
    RedemptionDailyLimitExceeded,
    #[msg("Redemption request has already been fulfilled")]
    RedemptionAlreadyFulfilled,
    #[msg("Redemption SLA was breached — use claim_expired_redemption")]
    RedemptionSLABreached,
    #[msg("Redemption request has not yet expired; SLA is still active")]
    RedemptionNotExpired,
    #[msg("Insurance fund is not configured on this stablecoin")]
    InsuranceFundNotConfigured,
    // SSS-127: Travel Rule
    #[msg("Travel Rule record required: transfer amount meets threshold but no TravelRuleRecord found")]
    TravelRuleRequired,
    #[msg("Travel Rule record is invalid: transfer_amount or beneficiary_vasp does not match")]
    TravelRuleRecordInvalid,
    #[msg("Travel Rule threshold must be greater than zero when FLAG_TRAVEL_RULE is set")]
    TravelRuleThresholdNotSet,
    // SSS-128: Sanctions oracle
    #[msg("Transfer rejected: sender is on the sanctions list")]
    SanctionedAddress,
    #[msg("Sanctions record is stale — oracle has not updated within sanctions_max_staleness_slots")]
    SanctionsRecordStale,
    #[msg("Sanctions oracle is not configured on this stablecoin (sanctions_oracle is default)")]
    SanctionsOracleNotConfigured,
    // SSS-130: PID fee control
    #[msg("PID config not found or FLAG_PID_FEE_CONTROL is not set on this mint")]
    PidConfigNotFound,
    #[msg("PID fee range invalid: min_fee_bps must be <= max_fee_bps")]
    InvalidPidFeeRange,
    // SSS-129: ZK credentials
    #[msg("Transfer rejected: sender does not hold a valid ZK credential")]
    CredentialRequired,
    #[msg("ZK credential has expired; submit a fresh verify_zk_credential to renew")]
    CredentialExpired,
    #[msg("ZK credential has been revoked by the issuer")]
    CredentialRevoked,
    #[msg("Invalid Groth16 proof: proof does not verify against the registry Merkle root")]
    InvalidZkProof,
    #[msg("Credential registry is not initialised for this mint (FLAG_ZK_CREDENTIALS not set)")]
    CredentialRegistryNotFound,
    // SSS-120: Authority rotation errors
    #[msg("Proposed new authority is the same as the current authority")]
    RotationNewAuthorityIsCurrent,
    #[msg("Backup authority is the same as the current authority")]
    RotationBackupIsCurrent,
    #[msg("Backup authority must be different from the new authority")]
    RotationBackupEqualsNew,
    #[msg("New or backup authority pubkey cannot be the default (zero) pubkey")]
    RotationZeroPubkey,
    #[msg("Emergency recovery window (7 days) has not elapsed since proposal")]
    EmergencyRecoveryNotReady,
    // SSS-121: Guardian config errors
    #[msg("Guardian list is empty — at least one guardian is required")]
    GuardianListEmpty,
    #[msg("Guardian list is full — maximum 7 guardians allowed")]
    GuardianListFull,
    #[msg("Invalid guardian threshold — must be >= 1 and <= guardian count")]
    InvalidGuardianThreshold,
    #[msg("Duplicate guardian pubkey in guardian list")]
    DuplicateGuardian,
    #[msg("Caller is not a registered guardian for this stablecoin")]
    NotAGuardian,
    // SSS-119 / SSS-122: Config versioning
    #[msg("Config version is too old — run upgrade_config before calling this instruction")]
    ConfigVersionTooOld,
    // SSS-119: Oracle errors
    #[msg("Oracle feed is not configured on this stablecoin — call set_oracle_config first")]
    OracleNotConfigured,
    #[msg("Invalid oracle type — must be 0 (Pyth), 1 (Switchboard), or 2 (Custom)")]
    InvalidOracleType,
    // SSS-131: Graduated liquidation bonus errors
    #[msg("Invalid liquidation tier config — check threshold ordering and bonus bounds")]
    InvalidLiquidationTierConfig,
    // SSS-132: PSM dynamic AMM-style slippage curves
    #[msg("PSM dynamic fees not enabled — FLAG_PSM_DYNAMIC_FEES is not set")]
    PsmDynamicFeesNotEnabled,
    #[msg("PsmCurveConfig: base_fee_bps must be <= max_fee_bps")]
    InvalidPsmCurveBaseFee,
    #[msg("PsmCurveConfig: max_fee_bps exceeds ceiling of 2000 bps (20%)")]
    InvalidPsmCurveMaxFee,
    #[msg("PsmCurveConfig not found — init_psm_curve_config first")]
    PsmCurveConfigNotFound,
    #[msg("Swap output would be zero — amount too small for current fee")]
    PsmSwapOutputZero,
    // SSS-133: Per-wallet rate limiting
    #[msg("FLAG_WALLET_RATE_LIMITS is not enabled for this stablecoin")]
    WalletRateLimitsNotEnabled,
    #[msg("WalletRateLimit: max_transfer_per_window must be > 0")]
    InvalidRateLimitAmount,
    #[msg("WalletRateLimit: window_slots must be > 0")]
    InvalidRateLimitWindow,
    #[msg("WalletRateLimit: transfer exceeds per-wallet window allowance")]
    WalletRateLimitExceeded,
    // SSS-134: Squads Protocol V4 multisig authority
    #[msg("Squads multisig authority is not configured for this stablecoin")]
    SquadsAuthorityNotSet,
    #[msg("Squads multisig authority is already configured — cannot reinitialize")]
    SquadsAuthorityAlreadySet,
    #[msg("Squads multisig PDA is the zero pubkey — must be a valid Squads PDA")]
    SquadsMultisigPdaInvalid,
    #[msg("Squads signer does not match the registered multisig PDA")]
    SquadsSignerMismatch,
    #[msg("Squads threshold must be >= 1")]
    SquadsThresholdZero,
    #[msg("Squads threshold exceeds the number of provided members")]
    SquadsThresholdExceedsMembers,
    #[msg("Squads member list must not be empty")]
    SquadsMembersEmpty,
    #[msg("Squads member list exceeds maximum of 10 members")]
    SquadsMembersTooMany,
    #[msg("Duplicate pubkey in Squads member list")]
    SquadsDuplicateMember,
    // SSS-145: Supply cap enforcement + PoR mint halt
    #[msg("Supply cap and minter cap are both zero — at least one must be set to prevent uncapped minting")]
    SupplyCapAndMinterCapBothZero,
    #[msg("FLAG_POR_HALT_ON_BREACH is set but no PoR attestation has been submitted yet")]
    PoRNotAttested,
    #[msg("Minting halted: PoR attestation shows reserve breach (ratio below min_reserve_ratio_bps)")]
    PoRBreachHaltsMinting,
}

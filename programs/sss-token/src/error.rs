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
    // Oracle
    #[msg("Oracle not configured — set oracle_type and oracle_feed first")]
    OracleNotConfigured,
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
    #[msg("SSS-3 requires supply_cap > 0 to prevent uncapped minting (supply_cap_locked)")]
    SupplyCapRequired,
}

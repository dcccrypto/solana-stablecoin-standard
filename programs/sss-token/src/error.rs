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
    // SSS-106: Confidential Transfers
    #[msg("Confidential transfer not enabled for this mint")]
    ConfidentialTransferNotEnabled,
    #[msg("Auditor ElGamal pubkey required for confidential transfers")]
    MissingAuditorKey,
}

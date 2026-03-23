use anchor_lang::prelude::*;

#[error_code]
pub enum SssError {
    #[msg("Operation is paused")]
    Paused = 6000,
    #[msg("Unauthorized: missing required role")]
    Unauthorized = 6001,
    #[msg("Invalid role identifier")]
    InvalidRole = 6002,
    #[msg("Minter quota exceeded")]
    QuotaExceeded = 6003,
    #[msg("Supply cap would be exceeded")]
    SupplyCapExceeded = 6004,
    #[msg("Math overflow")]
    MathOverflow = 6005,
    #[msg("No pending authority nomination")]
    NoPendingAuthority = 6006,
    #[msg("Pending authority mismatch")]
    PendingAuthorityMismatch = 6007,
    #[msg("Already paused")]
    AlreadyPaused = 6008,
    #[msg("Not paused")]
    NotPaused = 6009,
    #[msg("Token account is not frozen")]
    AccountNotFrozen = 6010,
    #[msg("Token account is frozen")]
    AccountFrozen = 6011,
    #[msg("Minter is not active")]
    MinterNotActive = 6012,
    #[msg("Invalid preset value")]
    InvalidPreset = 6013,
    #[msg("Recipient is blacklisted")]
    RecipientBlacklisted = 6014,
    #[msg("Invalid metadata field")]
    InvalidMetadataField = 6015,
    #[msg("Compliance not enabled")]
    ComplianceNotEnabled = 6016,
    #[msg("Amount must be greater than zero")]
    ZeroAmount = 6017,
    #[msg("Transfer hook program not set")]
    HookProgramNotSet = 6018,
    #[msg("SSS-2 requires DefaultAccountState::Frozen on the mint")]
    DefaultAccountStateNotFrozen = 6019,
    #[msg("Invalid blacklist entry: account owner does not match the transfer hook program")]
    InvalidBlacklistEntry = 6020,
}

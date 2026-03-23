use anchor_lang::prelude::*;

#[error_code]
pub enum BlacklistError {
    #[msg("Unauthorized — caller is not the admin")]
    Unauthorized = 6000,
    #[msg("Sender wallet is blacklisted")]
    SenderBlacklisted = 6001,
    #[msg("Recipient wallet is blacklisted")]
    RecipientBlacklisted = 6002,
    #[msg("Mint mismatch")]
    MintMismatch = 6003,
    #[msg("Invalid token account data")]
    InvalidTokenAccount = 6004,
    #[msg("Invalid blacklist account")]
    InvalidBlacklistAccount = 6005,
    #[msg("Invalid extra account meta list")]
    InvalidExtraAccountMetaList = 6006,
    #[msg("Transfer hook invoked outside of a token transfer")]
    NotTransferring = 6007,
    #[msg("No pending admin nomination to accept")]
    NoPendingAdmin = 6008,
    #[msg("Cannot close a blacklist entry that is still blocked")]
    CannotCloseBlockedEntry = 6009,
    #[msg("Transfers are paused")]
    TransfersPaused = 6010,
    #[msg("Transfers are already paused")]
    AlreadyPaused = 6011,
    #[msg("Transfers are not paused")]
    NotPaused = 6012,
    #[msg("Wallet is not blocked — evidence updates require a blocked entry")]
    WalletNotBlocked = 6013,
}

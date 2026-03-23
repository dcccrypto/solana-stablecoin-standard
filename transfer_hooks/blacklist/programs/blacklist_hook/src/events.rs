use anchor_lang::prelude::*;

#[event]
pub struct ConfigInitialized {
    pub config: Pubkey,
    pub admin: Pubkey,
    pub mint: Pubkey,
}

#[event]
pub struct WalletBlacklisted {
    pub mint: Pubkey,
    pub wallet: Pubkey,
    pub authority: Pubkey,
    pub reason: String,
    pub evidence_hash: [u8; 32],
    pub evidence_uri: String,
    pub timestamp: i64,
}

#[event]
pub struct WalletUnblacklisted {
    pub mint: Pubkey,
    pub wallet: Pubkey,
    pub authority: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct BlacklistEntryClosed {
    pub mint: Pubkey,
    pub wallet: Pubkey,
    pub authority: Pubkey,
}

#[event]
pub struct AdminTransferNominated {
    pub config: Pubkey,
    pub current_admin: Pubkey,
    pub pending_admin: Pubkey,
}

#[event]
pub struct AdminTransferred {
    pub config: Pubkey,
    pub previous_admin: Pubkey,
    pub new_admin: Pubkey,
}

#[event]
pub struct TransfersPaused {
    pub config: Pubkey,
    pub admin: Pubkey,
}

#[event]
pub struct TransfersUnpaused {
    pub config: Pubkey,
    pub admin: Pubkey,
}

#[event]
pub struct EvidenceUpdated {
    pub mint: Pubkey,
    pub wallet: Pubkey,
    pub authority: Pubkey,
    pub previous_hash: [u8; 32],
    pub new_hash: [u8; 32],
    pub evidence_uri: String,
    pub timestamp: i64,
}

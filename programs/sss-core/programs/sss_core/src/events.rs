use anchor_lang::prelude::*;

#[event]
pub struct ConfigInitialized {
    pub config: Pubkey,
    pub mint: Pubkey,
    pub authority: Pubkey,
    pub preset: u8,
    pub supply_cap: Option<u64>,
}

#[event]
pub struct TokensMinted {
    pub config: Pubkey,
    pub mint: Pubkey,
    pub minter: Pubkey,
    pub recipient: Pubkey,
    pub amount: u64,
    pub total_minted: u64,
}

#[event]
pub struct TokensBurned {
    pub config: Pubkey,
    pub mint: Pubkey,
    pub burner: Pubkey,
    pub amount: u64,
    pub total_burned: u64,
}

#[event]
pub struct StablecoinPaused {
    pub config: Pubkey,
    pub authority: Pubkey,
}

#[event]
pub struct StablecoinUnpaused {
    pub config: Pubkey,
    pub authority: Pubkey,
}

#[event]
pub struct RoleGranted {
    pub config: Pubkey,
    pub authority: Pubkey,
    pub grantee: Pubkey,
    pub role: u8,
}

#[event]
pub struct RoleRevoked {
    pub config: Pubkey,
    pub authority: Pubkey,
    pub grantee: Pubkey,
    pub role: u8,
}

#[event]
pub struct MinterQuotaSet {
    pub config: Pubkey,
    pub minter: Pubkey,
    pub quota: u64,
}

#[event]
pub struct AuthorityNominated {
    pub config: Pubkey,
    pub current_authority: Pubkey,
    pub pending_authority: Pubkey,
}

#[event]
pub struct AuthorityTransferred {
    pub config: Pubkey,
    pub old_authority: Pubkey,
    pub new_authority: Pubkey,
}

#[event]
pub struct TokensSeized {
    pub config: Pubkey,
    pub mint: Pubkey,
    pub seizer: Pubkey,
    pub from: Pubkey,
    pub treasury: Pubkey,
    pub amount: u64,
    pub total_seized: u64,
}

#[event]
pub struct TokenAccountFrozen {
    pub config: Pubkey,
    pub mint: Pubkey,
    pub freezer: Pubkey,
    pub target: Pubkey,
}

#[event]
pub struct TokenAccountThawed {
    pub config: Pubkey,
    pub mint: Pubkey,
    pub freezer: Pubkey,
    pub target: Pubkey,
}

#[event]
pub struct ReserveAttested {
    pub config: Pubkey,
    pub attestor: Pubkey,
    pub reserve_amount: u64,
    pub source: String,
    pub uri: String,
    pub timestamp: i64,
}

#[event]
pub struct MetadataUpdated {
    pub config: Pubkey,
    pub mint: Pubkey,
    pub authority: Pubkey,
    pub field: String,
    pub value: String,
}

#[event]
pub struct ComplianceToggled {
    pub config: Pubkey,
    pub authority: Pubkey,
    pub enabled: bool,
}

#[event]
pub struct TokensBurnedFrom {
    pub config: Pubkey,
    pub mint: Pubkey,
    pub burner: Pubkey,
    pub target: Pubkey,
    pub amount: u64,
    pub total_burned: u64,
}

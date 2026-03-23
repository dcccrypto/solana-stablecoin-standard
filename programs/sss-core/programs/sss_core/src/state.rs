use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct StablecoinConfig {
    pub authority: Pubkey,
    pub pending_authority: Option<Pubkey>,
    pub mint: Pubkey,
    pub transfer_hook_program: Option<Pubkey>,
    pub preset: u8,
    pub paused: bool,
    pub compliance_enabled: bool,
    pub total_minted: u64,
    pub total_burned: u64,
    pub total_seized: u64,
    pub supply_cap: Option<u64>,
    pub bump: u8,
    pub _reserved: [u8; 22],
}

#[account]
#[derive(InitSpace)]
pub struct RoleEntry {
    pub config: Pubkey,
    pub authority: Pubkey,
    pub role: u8,
    pub granted_at: i64,
    pub granted_by: Pubkey,
    pub bump: u8,
    pub _reserved: [u8; 32],
}

#[account]
#[derive(InitSpace)]
pub struct MinterInfo {
    pub config: Pubkey,
    pub minter: Pubkey,
    pub quota: u64,
    pub total_minted: u64,
    pub is_active: bool,
    pub bump: u8,
    pub _reserved: [u8; 32],
}

#[account]
#[derive(InitSpace)]
pub struct ReserveAttestation {
    pub config: Pubkey,
    pub attestor: Pubkey,
    pub reserve_amount: u64,
    #[max_len(128)]
    pub source: String,
    #[max_len(256)]
    pub uri: String,
    pub timestamp: i64,
    pub bump: u8,
    pub _reserved: [u8; 32],
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct InitializeParams {
    pub preset: u8,
    pub supply_cap: Option<u64>,
    pub compliance_enabled: bool,
    pub transfer_hook_program: Option<Pubkey>,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct UpdateMetadataParams {
    pub field: String,
    pub value: String,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct AttestReserveParams {
    pub reserve_amount: u64,
    pub source: String,
    pub uri: String,
}

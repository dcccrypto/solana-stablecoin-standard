use anchor_lang::prelude::*;

pub use sss_common::BlacklistEntry;

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    pub pending_admin: Option<Pubkey>,
    pub mint: Pubkey,
    pub paused: bool,
    pub bump: u8,
    pub _reserved: [u8; 63],
}

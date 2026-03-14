use anchor_lang::prelude::*;

#[event]
pub struct TokenInitialized {
    pub mint: Pubkey,
    pub authority: Pubkey,
    pub preset: u8,
    pub max_supply: u64,
}

#[event]
pub struct TokensMinted {
    pub mint: Pubkey,
    pub minter: Pubkey,
    pub recipient: Pubkey,
    pub amount: u64,
    pub total_minted: u64,
}

#[event]
pub struct TokensBurned {
    pub mint: Pubkey,
    pub minter: Pubkey,
    pub amount: u64,
    pub total_burned: u64,
}

#[event]
pub struct AccountFrozen {
    pub mint: Pubkey,
    pub account: Pubkey,
}

#[event]
pub struct AccountThawed {
    pub mint: Pubkey,
    pub account: Pubkey,
}

#[event]
pub struct MintPausedEvent {
    pub mint: Pubkey,
    pub paused: bool,
}

#[event]
pub struct CollateralDeposited {
    pub mint: Pubkey,
    pub depositor: Pubkey,
    pub amount: u64,
    pub total_collateral: u64,
}

#[event]
pub struct CollateralRedeemed {
    pub mint: Pubkey,
    pub redeemer: Pubkey,
    pub amount: u64,
    pub total_collateral: u64,
}

#[event]
pub struct AuthorityProposed {
    pub mint: Pubkey,
    pub proposed: Pubkey,
    pub is_compliance: bool,
}

#[event]
pub struct AuthorityAccepted {
    pub mint: Pubkey,
    pub new_authority: Pubkey,
    pub is_compliance: bool,
}

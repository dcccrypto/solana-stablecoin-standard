use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::SssError;
use crate::events::MinterQuotaSet;
use crate::state::{MinterInfo, StablecoinConfig};

pub fn set_minter_quota(ctx: Context<SetMinterQuota>, quota: u64) -> Result<()> {
    let info = &mut ctx.accounts.minter_info;

    if info.config == Pubkey::default() {
        info.config = ctx.accounts.config.key();
        info.minter = ctx.accounts.minter.key();
        info.total_minted = 0;
        info.is_active = true;
        info._reserved = [0u8; 32];
    }

    info.quota = quota;
    info.is_active = true;
    info.bump = ctx.bumps.minter_info;

    emit_cpi!(MinterQuotaSet {
        config: ctx.accounts.config.key(),
        minter: ctx.accounts.minter.key(),
        quota,
    });

    Ok(())
}

#[derive(Accounts)]
#[event_cpi]
pub struct SetMinterQuota<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        has_one = authority @ SssError::Unauthorized,
        seeds = [CONFIG_SEED, config.mint.as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, StablecoinConfig>,

    /// CHECK: the minter wallet
    pub minter: UncheckedAccount<'info>,

    // SAFETY: init_if_needed is safe here because:
    // 1. Only the config admin can call this (has_one = authority above)
    // 2. The PDA is seeded with [config, minter], so it's unique per minter
    // 3. The handler checks if config == default to distinguish first-init vs update
    // 4. Reinitialization attack is mitigated: Anchor prevents re-init of an existing
    //    account with a different discriminator, and the PDA seed uniqueness prevents
    //    a malicious actor from creating a colliding account.
    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + MinterInfo::INIT_SPACE,
        seeds = [MINTER_INFO_SEED, config.key().as_ref(), minter.key().as_ref()],
        bump,
    )]
    pub minter_info: Account<'info, MinterInfo>,

    pub system_program: Program<'info, System>,
}

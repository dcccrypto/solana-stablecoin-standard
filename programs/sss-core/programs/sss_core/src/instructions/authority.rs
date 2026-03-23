use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::SssError;
use crate::events::{AuthorityNominated, AuthorityTransferred};
use crate::state::StablecoinConfig;

pub fn transfer_authority(ctx: Context<TransferAuthorityCtx>, new_authority: Pubkey) -> Result<()> {
    ctx.accounts.config.pending_authority = Some(new_authority);

    emit_cpi!(AuthorityNominated {
        config: ctx.accounts.config.key(),
        current_authority: ctx.accounts.authority.key(),
        pending_authority: new_authority,
    });
    Ok(())
}

pub fn accept_authority(ctx: Context<AcceptAuthorityCtx>) -> Result<()> {
    let config = &mut ctx.accounts.config;
    let pending = config.pending_authority
        .ok_or(error!(SssError::NoPendingAuthority))?;
    require!(
        pending == ctx.accounts.new_authority.key(),
        SssError::PendingAuthorityMismatch
    );

    let old = config.authority;
    config.authority = pending;
    config.pending_authority = None;

    emit_cpi!(AuthorityTransferred {
        config: config.key(),
        old_authority: old,
        new_authority: config.authority,
    });
    Ok(())
}

#[derive(Accounts)]
#[event_cpi]
pub struct TransferAuthorityCtx<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        has_one = authority @ SssError::Unauthorized,
        seeds = [CONFIG_SEED, config.mint.as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, StablecoinConfig>,
}

#[derive(Accounts)]
#[event_cpi]
pub struct AcceptAuthorityCtx<'info> {
    pub new_authority: Signer<'info>,

    #[account(
        mut,
        seeds = [CONFIG_SEED, config.mint.as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, StablecoinConfig>,
}

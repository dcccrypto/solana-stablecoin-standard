use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;

use crate::constants::*;
use crate::error::BlacklistError;
use crate::events::{AdminTransferNominated, AdminTransferred};
use crate::state::Config;

#[derive(Accounts)]
#[event_cpi]
pub struct TransferAdmin<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [CONFIG_SEED, mint.key().as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, Config>,
}

pub fn transfer_admin(ctx: Context<TransferAdmin>, new_admin: Pubkey) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.admin.key(),
        ctx.accounts.config.admin,
        BlacklistError::Unauthorized
    );

    let config = &mut ctx.accounts.config;
    config.pending_admin = Some(new_admin);

    emit_cpi!(AdminTransferNominated {
        config: ctx.accounts.config.key(),
        current_admin: ctx.accounts.admin.key(),
        pending_admin: new_admin,
    });

    Ok(())
}

#[derive(Accounts)]
#[event_cpi]
pub struct AcceptAdmin<'info> {
    pub new_admin: Signer<'info>,

    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [CONFIG_SEED, mint.key().as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, Config>,
}

pub fn accept_admin(ctx: Context<AcceptAdmin>) -> Result<()> {
    let config = &mut ctx.accounts.config;
    let pending = config
        .pending_admin
        .ok_or(error!(BlacklistError::NoPendingAdmin))?;

    require_keys_eq!(
        ctx.accounts.new_admin.key(),
        pending,
        BlacklistError::Unauthorized
    );

    let previous = config.admin;
    config.admin = ctx.accounts.new_admin.key();
    config.pending_admin = None;

    emit_cpi!(AdminTransferred {
        config: ctx.accounts.config.key(),
        previous_admin: previous,
        new_admin: ctx.accounts.new_admin.key(),
    });

    Ok(())
}

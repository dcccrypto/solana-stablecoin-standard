use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::SssError;
use crate::events::{RoleGranted, RoleRevoked};
use crate::state::{RoleEntry, StablecoinConfig};

pub fn grant_role(ctx: Context<GrantRole>, role: u8) -> Result<()> {
    require!(role <= ROLE_MAX, SssError::InvalidRole);

    let entry = &mut ctx.accounts.role_entry;
    entry.config = ctx.accounts.config.key();
    entry.authority = ctx.accounts.grantee.key();
    entry.role = role;
    entry.granted_at = Clock::get()?.unix_timestamp;
    entry.granted_by = ctx.accounts.authority.key();
    entry.bump = ctx.bumps.role_entry;
    entry._reserved = [0u8; 32];

    emit_cpi!(RoleGranted {
        config: ctx.accounts.config.key(),
        authority: ctx.accounts.authority.key(),
        grantee: ctx.accounts.grantee.key(),
        role,
    });

    Ok(())
}

pub fn revoke_role(ctx: Context<RevokeRole>, role: u8) -> Result<()> {
    require!(role <= ROLE_MAX, SssError::InvalidRole);

    emit_cpi!(RoleRevoked {
        config: ctx.accounts.config.key(),
        authority: ctx.accounts.authority.key(),
        grantee: ctx.accounts.grantee.key(),
        role,
    });

    Ok(())
}

#[derive(Accounts)]
#[event_cpi]
#[instruction(role: u8)]
pub struct GrantRole<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        has_one = authority @ SssError::Unauthorized,
        seeds = [CONFIG_SEED, config.mint.as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, StablecoinConfig>,

    /// CHECK: wallet receiving the role
    pub grantee: UncheckedAccount<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + RoleEntry::INIT_SPACE,
        seeds = [ROLE_SEED, config.key().as_ref(), grantee.key().as_ref(), &[role]],
        bump,
    )]
    pub role_entry: Account<'info, RoleEntry>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[event_cpi]
#[instruction(role: u8)]
pub struct RevokeRole<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        has_one = authority @ SssError::Unauthorized,
        seeds = [CONFIG_SEED, config.mint.as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, StablecoinConfig>,

    /// CHECK: wallet losing the role
    pub grantee: UncheckedAccount<'info>,

    #[account(
        mut,
        close = authority,
        seeds = [ROLE_SEED, config.key().as_ref(), grantee.key().as_ref(), &[role]],
        bump = role_entry.bump,
        has_one = config,
    )]
    pub role_entry: Account<'info, RoleEntry>,
}

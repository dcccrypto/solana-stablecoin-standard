use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenInterface};

use crate::error::SssError;
use crate::events::AuthorityProposed;
use crate::state::{StablecoinConfig, UpdateRolesParams};

#[derive(Accounts)]
pub struct UpdateRoles<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [StablecoinConfig::SEED, mint.key().as_ref()],
        bump = config.bump,
        constraint = config.authority == authority.key() @ SssError::Unauthorized,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(constraint = mint.key() == config.mint)]
    pub mint: InterfaceAccount<'info, Mint>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handler(ctx: Context<UpdateRoles>, params: UpdateRolesParams) -> Result<()> {
    let config = &mut ctx.accounts.config;
    if let Some(proposed) = params.new_authority {
        config.pending_authority = proposed;
        emit!(AuthorityProposed {
            mint: config.mint,
            proposed,
            is_compliance: false,
        });
        msg!("Authority transfer proposed to {}", proposed);
    }
    if let Some(proposed) = params.new_compliance_authority {
        config.pending_compliance_authority = proposed;
        emit!(AuthorityProposed {
            mint: config.mint,
            proposed,
            is_compliance: true,
        });
        msg!("Compliance authority transfer proposed to {}", proposed);
    }
    Ok(())
}

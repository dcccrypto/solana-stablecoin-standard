use anchor_lang::prelude::*;
use anchor_spl::token_interface::{thaw_account, ThawAccount as ThawAccountCpi, Mint, TokenAccount, TokenInterface};

use crate::error::SssError;
use crate::state::StablecoinConfig;

#[derive(Accounts)]
pub struct ThawAccount<'info> {
    pub compliance_authority: Signer<'info>,

    #[account(
        seeds = [StablecoinConfig::SEED, mint.key().as_ref()],
        bump = config.bump,
        constraint = config.compliance_authority == compliance_authority.key() @ SssError::UnauthorizedCompliance,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(
        mut,
        constraint = mint.key() == config.mint,
    )]
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(mut)]
    pub target_token_account: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handler(ctx: Context<ThawAccount>) -> Result<()> {
    thaw_account(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            ThawAccountCpi {
                account: ctx.accounts.target_token_account.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                authority: ctx.accounts.compliance_authority.to_account_info(),
            },
        ),
    )?;
    msg!("Thawed account {}", ctx.accounts.target_token_account.key());
    Ok(())
}

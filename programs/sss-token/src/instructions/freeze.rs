use anchor_lang::prelude::*;
use anchor_spl::token_interface::{freeze_account, FreezeAccount as FreezeAccountCpi, Mint, TokenAccount, TokenInterface};

use crate::error::SssError;
use crate::events::AccountFrozen;
use crate::state::StablecoinConfig;

#[derive(Accounts)]
pub struct FreezeAccount<'info> {
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

    #[account(mut, constraint = target_token_account.mint == mint.key() @ SssError::InvalidMint)]
    pub target_token_account: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handler(ctx: Context<FreezeAccount>) -> Result<()> {
    let mint_key = ctx.accounts.mint.key();
    let seeds = &[StablecoinConfig::SEED, mint_key.as_ref(), &[ctx.accounts.config.bump]];
    let signer_seeds = &[&seeds[..]];
    freeze_account(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            FreezeAccountCpi {
                account: ctx.accounts.target_token_account.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                authority: ctx.accounts.config.to_account_info(),
            },
            signer_seeds,
        ),
    )?;
    emit!(AccountFrozen {
        mint: ctx.accounts.mint.key(),
        account: ctx.accounts.target_token_account.key(),
    });
    msg!("Froze account {}", ctx.accounts.target_token_account.key());
    Ok(())
}

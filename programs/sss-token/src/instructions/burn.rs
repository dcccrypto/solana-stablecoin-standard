use anchor_lang::prelude::*;
use anchor_spl::token_interface::{burn, Burn, Mint, TokenAccount, TokenInterface};

use crate::error::SssError;
use crate::events::TokensBurned;
use crate::state::{MinterInfo, StablecoinConfig, FLAG_CIRCUIT_BREAKER};

#[derive(Accounts)]
pub struct BurnTokens<'info> {
    pub minter: Signer<'info>,

    #[account(
        mut,
        seeds = [StablecoinConfig::SEED, mint.key().as_ref()],
        bump = config.bump,
    )]
    pub config: Box<Account<'info, StablecoinConfig>>,

    #[account(
        mut,
        constraint = mint.key() == config.mint,
    )]
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [MinterInfo::SEED, config.key().as_ref(), minter.key().as_ref()],
        bump = minter_info.bump,
        constraint = minter_info.config == config.key() @ SssError::NotAMinter,
        constraint = minter_info.minter == minter.key() @ SssError::NotAMinter,
    )]
    pub minter_info: Account<'info, MinterInfo>,

    #[account(
        mut,
        constraint = source_token_account.mint == mint.key() @ SssError::InvalidMint,
        constraint = source_token_account.owner == minter.key(),
    )]
    pub source_token_account: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handler(ctx: Context<BurnTokens>, amount: u64) -> Result<()> {
    // SSS-122: version guard
    require!(
        ctx.accounts.config.version >= crate::instructions::upgrade::MIN_SUPPORTED_VERSION,
        SssError::ConfigVersionTooOld
    );
    require!(amount > 0, SssError::ZeroAmount);
    require!(!ctx.accounts.config.paused, SssError::MintPaused);
    // SSS-113 HIGH-01: Circuit breaker — halt all burns when FLAG_CIRCUIT_BREAKER is set.
    // Consistent with mint and cdp_borrow_stable which already check this flag.
    require!(
        ctx.accounts.config.feature_flags & FLAG_CIRCUIT_BREAKER == 0,
        SssError::CircuitBreakerActive
    );

    burn(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Burn {
                mint: ctx.accounts.mint.to_account_info(),
                from: ctx.accounts.source_token_account.to_account_info(),
                authority: ctx.accounts.minter.to_account_info(),
            },
        ),
        amount,
    )?;

    let config = &mut ctx.accounts.config;
    config.total_burned = config.total_burned.checked_add(amount)
        .ok_or(error!(SssError::Overflow))?;

    emit!(TokensBurned {
        mint: config.mint,
        minter: ctx.accounts.minter.key(),
        amount,
        total_burned: config.total_burned,
    });

    msg!("Burned {} tokens from {}", amount, ctx.accounts.source_token_account.key());
    Ok(())
}

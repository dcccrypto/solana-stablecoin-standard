use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::*;
use crate::error::SssError;
use crate::events::{TokensBurned, TokensBurnedFrom};
use crate::state::{RoleEntry, StablecoinConfig};

pub fn burn_tokens(ctx: Context<BurnTokens>, amount: u64) -> Result<()> {
    require!(amount > 0, SssError::ZeroAmount);
    require!(!ctx.accounts.config.paused, SssError::Paused);

    let ix = spl_token_2022::instruction::burn(
        ctx.accounts.token_program.key,
        &ctx.accounts.burner_ata.key(),
        &ctx.accounts.mint.key(),
        &ctx.accounts.burner.key(),
        &[],
        amount,
    )?;
    anchor_lang::solana_program::program::invoke(
        &ix,
        &[
            ctx.accounts.burner_ata.to_account_info(),
            ctx.accounts.mint.to_account_info(),
            ctx.accounts.burner.to_account_info(),
        ],
    )?;

    let config = &mut ctx.accounts.config;
    config.total_burned = config.total_burned
        .checked_add(amount)
        .ok_or(error!(SssError::MathOverflow))?;

    emit_cpi!(TokensBurned {
        config: config.key(),
        mint: ctx.accounts.mint.key(),
        burner: ctx.accounts.burner.key(),
        amount,
        total_burned: config.total_burned,
    });

    Ok(())
}

pub fn burn_from(ctx: Context<BurnFromCtx>, amount: u64) -> Result<()> {
    require!(amount > 0, SssError::ZeroAmount);
    require!(!ctx.accounts.config.paused, SssError::Paused);

    let mint_key = ctx.accounts.mint.key();
    let bump = ctx.accounts.config.bump;
    let seeds: &[&[u8]] = &[CONFIG_SEED, mint_key.as_ref(), &[bump]];
    let signer_seeds = &[seeds];

    let ix = spl_token_2022::instruction::burn(
        ctx.accounts.token_program.key,
        &ctx.accounts.target_ata.key(),
        &ctx.accounts.mint.key(),
        &ctx.accounts.config.key(),
        &[],
        amount,
    )?;
    anchor_lang::solana_program::program::invoke_signed(
        &ix,
        &[
            ctx.accounts.target_ata.to_account_info(),
            ctx.accounts.mint.to_account_info(),
            ctx.accounts.config.to_account_info(),
        ],
        signer_seeds,
    )?;

    let config = &mut ctx.accounts.config;
    config.total_burned = config.total_burned
        .checked_add(amount)
        .ok_or(error!(SssError::MathOverflow))?;

    emit_cpi!(TokensBurnedFrom {
        config: config.key(),
        mint: ctx.accounts.mint.key(),
        burner: ctx.accounts.burner.key(),
        target: ctx.accounts.target_ata.key(),
        amount,
        total_burned: config.total_burned,
    });

    Ok(())
}

#[derive(Accounts)]
#[event_cpi]
pub struct BurnTokens<'info> {
    pub burner: Signer<'info>,

    #[account(
        mut,
        seeds = [CONFIG_SEED, mint.key().as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(
        seeds = [ROLE_SEED, config.key().as_ref(), burner.key().as_ref(), &[ROLE_BURNER]],
        bump = role_entry.bump,
        has_one = config,
    )]
    pub role_entry: Account<'info, RoleEntry>,

    #[account(mut, mint::token_program = token_program)]
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        token::mint = mint,
        token::authority = burner,
        token::token_program = token_program,
    )]
    pub burner_ata: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
#[event_cpi]
pub struct BurnFromCtx<'info> {
    pub burner: Signer<'info>,

    #[account(
        mut,
        seeds = [CONFIG_SEED, mint.key().as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(
        seeds = [ROLE_SEED, config.key().as_ref(), burner.key().as_ref(), &[ROLE_BURNER]],
        bump = role_entry.bump,
        has_one = config,
    )]
    pub role_entry: Account<'info, RoleEntry>,

    #[account(mut, mint::token_program = token_program)]
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(mut, token::mint = mint, token::token_program = token_program)]
    pub target_ata: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}

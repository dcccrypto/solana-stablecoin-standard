use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::*;
use crate::error::SssError;
use crate::events::TokensSeized;
use crate::state::{RoleEntry, StablecoinConfig};

pub fn seize(ctx: Context<SeizeCtx>, amount: u64) -> Result<()> {
    require!(amount > 0, SssError::ZeroAmount);
    require!(!ctx.accounts.config.paused, SssError::Paused);
    require!(ctx.accounts.target_ata.is_frozen(), SssError::AccountNotFrozen);

    let mint_key = ctx.accounts.mint.key();
    let bump = ctx.accounts.config.bump;
    let seeds: &[&[u8]] = &[CONFIG_SEED, mint_key.as_ref(), &[bump]];
    let signer_seeds = &[seeds];

    // 1. Thaw
    let thaw_ix = spl_token_2022::instruction::thaw_account(
        ctx.accounts.token_program.key,
        &ctx.accounts.target_ata.key(),
        &ctx.accounts.mint.key(),
        &ctx.accounts.config.key(),
        &[],
    )?;
    anchor_lang::solana_program::program::invoke_signed(
        &thaw_ix,
        &[
            ctx.accounts.target_ata.to_account_info(),
            ctx.accounts.mint.to_account_info(),
            ctx.accounts.config.to_account_info(),
        ],
        signer_seeds,
    )?;

    // 2. Burn from target (config PDA is permanent delegate)
    let burn_ix = spl_token_2022::instruction::burn(
        ctx.accounts.token_program.key,
        &ctx.accounts.target_ata.key(),
        &ctx.accounts.mint.key(),
        &ctx.accounts.config.key(),
        &[],
        amount,
    )?;
    anchor_lang::solana_program::program::invoke_signed(
        &burn_ix,
        &[
            ctx.accounts.target_ata.to_account_info(),
            ctx.accounts.mint.to_account_info(),
            ctx.accounts.config.to_account_info(),
        ],
        signer_seeds,
    )?;

    // 3. Mint to treasury
    let mint_ix = spl_token_2022::instruction::mint_to(
        ctx.accounts.token_program.key,
        &ctx.accounts.mint.key(),
        &ctx.accounts.treasury_ata.key(),
        &ctx.accounts.config.key(),
        &[],
        amount,
    )?;
    anchor_lang::solana_program::program::invoke_signed(
        &mint_ix,
        &[
            ctx.accounts.mint.to_account_info(),
            ctx.accounts.treasury_ata.to_account_info(),
            ctx.accounts.config.to_account_info(),
        ],
        signer_seeds,
    )?;

    // 4. Re-freeze
    let freeze_ix = spl_token_2022::instruction::freeze_account(
        ctx.accounts.token_program.key,
        &ctx.accounts.target_ata.key(),
        &ctx.accounts.mint.key(),
        &ctx.accounts.config.key(),
        &[],
    )?;
    anchor_lang::solana_program::program::invoke_signed(
        &freeze_ix,
        &[
            ctx.accounts.target_ata.to_account_info(),
            ctx.accounts.mint.to_account_info(),
            ctx.accounts.config.to_account_info(),
        ],
        signer_seeds,
    )?;

    // 5. Update accounting
    let config = &mut ctx.accounts.config;
    config.total_burned = config.total_burned
        .checked_add(amount)
        .ok_or(error!(SssError::MathOverflow))?;
    config.total_minted = config.total_minted
        .checked_add(amount)
        .ok_or(error!(SssError::MathOverflow))?;
    config.total_seized = config.total_seized
        .checked_add(amount)
        .ok_or(error!(SssError::MathOverflow))?;

    emit_cpi!(TokensSeized {
        config: config.key(),
        mint: ctx.accounts.mint.key(),
        seizer: ctx.accounts.seizer.key(),
        from: ctx.accounts.target_ata.key(),
        treasury: ctx.accounts.treasury_ata.key(),
        amount,
        total_seized: config.total_seized,
    });

    Ok(())
}

#[derive(Accounts)]
#[event_cpi]
pub struct SeizeCtx<'info> {
    pub seizer: Signer<'info>,

    #[account(
        mut,
        seeds = [CONFIG_SEED, mint.key().as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(
        seeds = [ROLE_SEED, config.key().as_ref(), seizer.key().as_ref(), &[ROLE_SEIZER]],
        bump = role_entry.bump,
        has_one = config,
    )]
    pub role_entry: Account<'info, RoleEntry>,

    #[account(mut, mint::token_program = token_program)]
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(mut, token::mint = mint, token::token_program = token_program)]
    pub target_ata: InterfaceAccount<'info, TokenAccount>,

    #[account(mut, token::mint = mint, token::token_program = token_program)]
    pub treasury_ata: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::*;
use crate::error::SssError;
use crate::events::{TokenAccountFrozen, TokenAccountThawed};
use crate::state::{RoleEntry, StablecoinConfig};

pub fn freeze_token_account(ctx: Context<FreezeCtx>) -> Result<()> {
    require!(!ctx.accounts.target_ata.is_frozen(), SssError::AccountFrozen);

    let mint_key = ctx.accounts.mint.key();
    let seeds: &[&[u8]] = &[CONFIG_SEED, mint_key.as_ref(), &[ctx.accounts.config.bump]];
    let signer_seeds = &[seeds];

    let ix = spl_token_2022::instruction::freeze_account(
        ctx.accounts.token_program.key,
        &ctx.accounts.target_ata.key(),
        &ctx.accounts.mint.key(),
        &ctx.accounts.config.key(),
        &[],
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

    emit_cpi!(TokenAccountFrozen {
        config: ctx.accounts.config.key(),
        mint: ctx.accounts.mint.key(),
        freezer: ctx.accounts.freezer.key(),
        target: ctx.accounts.target_ata.key(),
    });
    Ok(())
}

pub fn thaw_token_account(ctx: Context<ThawCtx>) -> Result<()> {
    require!(ctx.accounts.target_ata.is_frozen(), SssError::AccountNotFrozen);

    let mint_key = ctx.accounts.mint.key();
    let seeds: &[&[u8]] = &[CONFIG_SEED, mint_key.as_ref(), &[ctx.accounts.config.bump]];
    let signer_seeds = &[seeds];

    let ix = spl_token_2022::instruction::thaw_account(
        ctx.accounts.token_program.key,
        &ctx.accounts.target_ata.key(),
        &ctx.accounts.mint.key(),
        &ctx.accounts.config.key(),
        &[],
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

    emit_cpi!(TokenAccountThawed {
        config: ctx.accounts.config.key(),
        mint: ctx.accounts.mint.key(),
        freezer: ctx.accounts.freezer.key(),
        target: ctx.accounts.target_ata.key(),
    });
    Ok(())
}

#[derive(Accounts)]
#[event_cpi]
pub struct FreezeCtx<'info> {
    pub freezer: Signer<'info>,

    #[account(
        seeds = [CONFIG_SEED, mint.key().as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(
        seeds = [ROLE_SEED, config.key().as_ref(), freezer.key().as_ref(), &[ROLE_FREEZER]],
        bump = role_entry.bump,
        has_one = config,
    )]
    pub role_entry: Account<'info, RoleEntry>,

    #[account(mint::token_program = token_program)]
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(mut, token::mint = mint, token::token_program = token_program)]
    pub target_ata: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
#[event_cpi]
pub struct ThawCtx<'info> {
    pub freezer: Signer<'info>,

    #[account(
        seeds = [CONFIG_SEED, mint.key().as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(
        seeds = [ROLE_SEED, config.key().as_ref(), freezer.key().as_ref(), &[ROLE_FREEZER]],
        bump = role_entry.bump,
        has_one = config,
    )]
    pub role_entry: Account<'info, RoleEntry>,

    #[account(mint::token_program = token_program)]
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(mut, token::mint = mint, token::token_program = token_program)]
    pub target_ata: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}

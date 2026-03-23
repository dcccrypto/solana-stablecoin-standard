use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use sss_common::BlacklistEntry;

use crate::constants::*;
use crate::error::SssError;
use crate::events::TokensMinted;
use crate::state::{MinterInfo, RoleEntry, StablecoinConfig};

pub fn mint_tokens(ctx: Context<MintTokens>, amount: u64) -> Result<()> {
    require!(amount > 0, SssError::ZeroAmount);
    let config = &ctx.accounts.config;
    require!(!config.paused, SssError::Paused);
    require!(ctx.accounts.minter_info.is_active, SssError::MinterNotActive);

    #[cfg(feature = "compliance")]
    if config.compliance_enabled {
        let hook_program = config.transfer_hook_program
            .ok_or(error!(SssError::HookProgramNotSet))?;

        let bl_account = &ctx.accounts.recipient_blacklist_entry;
        if !bl_account.data_is_empty() {
            require!(
                bl_account.owner == &hook_program,
                SssError::InvalidBlacklistEntry
            );

            let data = bl_account.try_borrow_data()?;
            let mut data_slice: &[u8] = &data;
            let entry = BlacklistEntry::try_deserialize(&mut data_slice)
                .map_err(|_| error!(SssError::InvalidBlacklistEntry))?;

            require!(
                entry.wallet == ctx.accounts.recipient_ata.owner,
                SssError::InvalidBlacklistEntry
            );
            require!(
                entry.mint == ctx.accounts.mint.key(),
                SssError::InvalidBlacklistEntry
            );

            require!(!entry.blocked, SssError::RecipientBlacklisted);
        }
    }

    #[cfg(feature = "quotas")]
    {
        let remaining_quota = ctx.accounts.minter_info.quota
            .checked_sub(ctx.accounts.minter_info.total_minted)
            .ok_or(error!(SssError::MathOverflow))?;
        require!(amount <= remaining_quota, SssError::QuotaExceeded);
    }

    #[cfg(feature = "supply-cap")]
    if let Some(cap) = config.supply_cap {
        let net_supply = config.total_minted
            .checked_sub(config.total_burned)
            .ok_or(error!(SssError::MathOverflow))?;
        let new_net = net_supply
            .checked_add(amount)
            .ok_or(error!(SssError::MathOverflow))?;
        require!(new_net <= cap, SssError::SupplyCapExceeded);
    }

    let mint_key = ctx.accounts.mint.key();
    let seeds: &[&[u8]] = &[CONFIG_SEED, mint_key.as_ref(), &[config.bump]];
    let signer_seeds = &[seeds];

    let ix = spl_token_2022::instruction::mint_to(
        ctx.accounts.token_program.key,
        &ctx.accounts.mint.key(),
        &ctx.accounts.recipient_ata.key(),
        &config.key(),
        &[],
        amount,
    )?;
    anchor_lang::solana_program::program::invoke_signed(
        &ix,
        &[
            ctx.accounts.mint.to_account_info(),
            ctx.accounts.recipient_ata.to_account_info(),
            ctx.accounts.config.to_account_info(),
        ],
        signer_seeds,
    )?;

    let config = &mut ctx.accounts.config;
    config.total_minted = config.total_minted
        .checked_add(amount)
        .ok_or(error!(SssError::MathOverflow))?;

    let minter_info = &mut ctx.accounts.minter_info;
    minter_info.total_minted = minter_info.total_minted
        .checked_add(amount)
        .ok_or(error!(SssError::MathOverflow))?;

    emit_cpi!(TokensMinted {
        config: config.key(),
        mint: ctx.accounts.mint.key(),
        minter: ctx.accounts.minter.key(),
        recipient: ctx.accounts.recipient_ata.key(),
        amount,
        total_minted: config.total_minted,
    });

    Ok(())
}

#[derive(Accounts)]
#[event_cpi]
pub struct MintTokens<'info> {
    pub minter: Signer<'info>,

    #[account(
        mut,
        seeds = [CONFIG_SEED, mint.key().as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(
        seeds = [ROLE_SEED, config.key().as_ref(), minter.key().as_ref(), &[ROLE_MINTER]],
        bump = role_entry.bump,
        has_one = config,
    )]
    pub role_entry: Account<'info, RoleEntry>,

    #[account(
        mut,
        seeds = [MINTER_INFO_SEED, config.key().as_ref(), minter.key().as_ref()],
        bump = minter_info.bump,
        has_one = config,
    )]
    pub minter_info: Account<'info, MinterInfo>,

    #[account(mut, mint::token_program = token_program)]
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(mut, token::mint = mint, token::token_program = token_program)]
    pub recipient_ata: InterfaceAccount<'info, TokenAccount>,

    /// Recipient's blacklist entry PDA from the transfer hook program.
    /// Required when compliance_enabled is true. Pass the derived PDA —
    /// if the account does not exist on-chain (never blacklisted), pass it
    /// anyway and the check will pass (empty account = not blacklisted).
    /// CHECK: Validated manually by reading raw data; empty/missing = not blocked.
    pub recipient_blacklist_entry: UncheckedAccount<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}

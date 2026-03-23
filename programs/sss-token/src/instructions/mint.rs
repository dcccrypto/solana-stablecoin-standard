use anchor_lang::prelude::*;
use anchor_spl::token_2022::Token2022;
use anchor_spl::token_interface::{mint_to, Mint, MintTo, TokenAccount, TokenInterface};

use crate::error::SssError;
use crate::state::{MinterInfo, StablecoinConfig, FLAG_CIRCUIT_BREAKER};

// Solana clock is available via Clock::get() in Anchor instructions.

#[derive(Accounts)]
pub struct MintTokens<'info> {
    pub minter: Signer<'info>,

    #[account(
        mut,
        seeds = [StablecoinConfig::SEED, mint.key().as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, StablecoinConfig>,

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

    #[account(mut)]
    pub recipient_token_account: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handler(ctx: Context<MintTokens>, amount: u64) -> Result<()> {
    // SSS-122: version guard — reject pre-migration configs
    require!(
        ctx.accounts.config.version >= crate::instructions::upgrade::MIN_SUPPORTED_VERSION,
        SssError::ConfigVersionTooOld
    );
    require!(amount > 0, SssError::ZeroAmount);
    require!(!ctx.accounts.config.paused, SssError::MintPaused);
    // SSS-110: Circuit breaker — halt all minting when FLAG_CIRCUIT_BREAKER is set.
    require!(
        ctx.accounts.config.feature_flags & FLAG_CIRCUIT_BREAKER == 0,
        SssError::CircuitBreakerActive
    );

    // SSS-093: Per-minter epoch velocity limit check.
    {
        let clock = Clock::get()?;
        let current_epoch = clock.epoch;
        let minter_info = &mut ctx.accounts.minter_info;

        // Reset epoch counter if epoch has advanced since last reset.
        // last_epoch_reset == 0 means never minted; initialize it now.
        if minter_info.last_epoch_reset == 0 || current_epoch != minter_info.last_epoch_reset {
            minter_info.minted_this_epoch = 0;
            minter_info.last_epoch_reset = current_epoch;
        }

        if minter_info.max_mint_per_epoch > 0 {
            require!(
                minter_info.minted_this_epoch.checked_add(amount).unwrap()
                    <= minter_info.max_mint_per_epoch,
                SssError::MintVelocityExceeded
            );
        }
    }

    let minter_info = &mut ctx.accounts.minter_info;
    if minter_info.cap > 0 {
        require!(
            minter_info.minted.checked_add(amount).unwrap() <= minter_info.cap,
            SssError::MinterCapExceeded
        );
    }

    // Check max supply constraint (0 = unlimited)
    let config = &ctx.accounts.config;
    if config.max_supply > 0 {
        require!(
            config.net_supply().checked_add(amount).unwrap() <= config.max_supply,
            SssError::MaxSupplyExceeded
        );
    }

    // Mint via Token-2022 — authority is the config PDA, sign with seeds
    let mint_key = ctx.accounts.mint.key();
    let seeds = &[
        StablecoinConfig::SEED,
        mint_key.as_ref(),
        &[ctx.accounts.config.bump],
    ];
    let signer_seeds = &[&seeds[..]];
    mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            MintTo {
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.recipient_token_account.to_account_info(),
                authority: ctx.accounts.config.to_account_info(),
            },
            signer_seeds,
        ),
        amount,
    )?;

    let config = &mut ctx.accounts.config;
    config.total_minted = config.total_minted.checked_add(amount).unwrap();
    minter_info.minted = minter_info.minted.checked_add(amount).unwrap();
    // SSS-093: Track epoch velocity regardless of whether limit is set
    // (enables auditing even when max_mint_per_epoch == 0).
    minter_info.minted_this_epoch = minter_info.minted_this_epoch.checked_add(amount).unwrap();

    msg!("Minted {} tokens to {}", amount, ctx.accounts.recipient_token_account.key());
    Ok(())
}

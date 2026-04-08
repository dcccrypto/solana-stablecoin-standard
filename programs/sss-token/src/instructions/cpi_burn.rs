/// SSS-055 — Direction 3: CPI Composability Standard — `cpi_burn` interface stub
///
/// Standardized CPI entrypoint for external programs to burn SSS tokens.
/// Semantically identical to `burn`, but validates InterfaceVersion PDA.
///
/// External programs construct this call as:
///   discriminator = sha256("global:cpi_burn")[..8]
///   accounts: [config, minter_info, mint, source_token_account, minter (signer),
///              interface_version, token_program]
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{burn, Burn, Mint, TokenAccount, TokenInterface};

use crate::error::SssError;
use crate::events::TokensBurned;
use crate::state::{InterfaceVersion, MinterInfo, StablecoinConfig, FLAG_CIRCUIT_BREAKER};

#[derive(Accounts)]
pub struct CpiBurn<'info> {
    pub minter: Signer<'info>,

    #[account(
        mut,
        seeds = [StablecoinConfig::SEED, mint.key().as_ref()],
        bump = config.bump,
    )]
    pub config: Box<Account<'info, StablecoinConfig>>,

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
        constraint = mint.key() == config.mint,
    )]
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        constraint = source_token_account.mint == mint.key() @ SssError::InvalidMint,
        constraint = source_token_account.owner == minter.key(),
    )]
    pub source_token_account: InterfaceAccount<'info, TokenAccount>,

    /// InterfaceVersion PDA — validated before execution.
    #[account(
        seeds = [InterfaceVersion::SEED, mint.key().as_ref()],
        bump = interface_version.bump,
    )]
    pub interface_version: Account<'info, InterfaceVersion>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn cpi_burn_handler(ctx: Context<CpiBurn>, amount: u64, required_version: u8) -> Result<()> {
    // ── Interface version gate ────────────────────────────────────────────────
    let iv = &ctx.accounts.interface_version;
    require!(iv.active, SssError::InterfaceDeprecated);
    require!(
        iv.version == required_version,
        SssError::InterfaceVersionMismatch
    );

    // ── Version guard (mirrors burn::handler) ────────────────────────────────
    require!(
        ctx.accounts.config.version >= crate::instructions::upgrade::MIN_SUPPORTED_VERSION,
        SssError::ConfigVersionTooOld
    );

    // ── Standard burn logic ───────────────────────────────────────────────────
    require!(amount > 0, SssError::ZeroAmount);
    require!(!ctx.accounts.config.paused, SssError::MintPaused);
    // SSS-113 HIGH-02: Circuit breaker — halt all burns when FLAG_CIRCUIT_BREAKER is set.
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

    msg!(
        "cpi_burn: {} tokens from {} (interface v{})",
        amount,
        ctx.accounts.source_token_account.key(),
        required_version,
    );
    Ok(())
}

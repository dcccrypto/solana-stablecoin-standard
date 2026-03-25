//! SSS-151: First-loss insurance vault — protocol-level reserve for liquidation cascades.
//!
//! Distinct from the bad-debt backstop (`insurance_fund_pubkey`): this vault is seeded
//! upfront by the issuer and absorbs liquidation cascades before they reach bad-debt territory.
//!
//! Instructions:
//! - `init_insurance_vault`  — authority-only, creates InsuranceVault PDA + sets FLAG_INSURANCE_VAULT_REQUIRED
//! - `seed_insurance_vault`  — anyone deposits; issuer must hit min_seed_bps before minting unlocks
//! - `draw_insurance`        — governance-controlled draw (authority + optional DAO quorum)
//! - `replenish_insurance_vault` — permissionless community replenishment

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
};

use crate::error::SssError;
use crate::state::{InsuranceVault, StablecoinConfig, FLAG_INSURANCE_VAULT_REQUIRED};

// ─── Events ──────────────────────────────────────────────────────────────────

/// Emitted when the insurance vault is seeded.
#[event]
pub struct InsuranceVaultSeeded {
    pub sss_mint: Pubkey,
    pub amount: u64,
    pub current_balance: u64,
    pub adequately_seeded: bool,
}

/// Emitted when the insurance vault is drawn to cover protocol losses.
#[event]
pub struct InsuranceDrawn {
    pub sss_mint: Pubkey,
    pub amount: u64,
    pub reason_hash: [u8; 32],
    pub remaining_balance: u64,
    pub total_drawn: u64,
}

/// Emitted when the insurance vault is replenished.
#[event]
pub struct InsuranceVaultReplenished {
    pub sss_mint: Pubkey,
    pub amount: u64,
    pub contributor: Pubkey,
    pub new_balance: u64,
}

// ─── init_insurance_vault ────────────────────────────────────────────────────

/// Authority-only: initialise the InsuranceVault PDA and enable
/// FLAG_INSURANCE_VAULT_REQUIRED on the config.
///
/// `min_seed_bps`           — minimum % of net_supply the issuer must deposit
///                           (0 = no minimum; minting is immediately unblocked)
/// `max_draw_per_event_bps` — per-event draw cap in bps of net_supply (0 = no cap)
#[derive(Accounts)]
pub struct InitInsuranceVault<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [StablecoinConfig::SEED, sss_mint.key().as_ref()],
        bump = config.bump,
        constraint = config.authority == authority.key() @ SssError::Unauthorized,
        constraint = config.preset == 3 @ SssError::InvalidPreset,
    )]
    pub config: Account<'info, StablecoinConfig>,

    pub sss_mint: InterfaceAccount<'info, Mint>,

    /// Collateral token account that will hold insurance reserves.
    /// Must use the collateral mint matching this config.
    #[account(
        constraint = vault_token_account.mint == config.collateral_mint @ SssError::InvalidCollateralMint,
    )]
    pub vault_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        init,
        payer = authority,
        space = 8 + InsuranceVault::INIT_SPACE,
        seeds = [InsuranceVault::SEED, sss_mint.key().as_ref()],
        bump,
    )]
    pub insurance_vault: Account<'info, InsuranceVault>,

    pub system_program: Program<'info, System>,
}

pub fn init_insurance_vault_handler(
    ctx: Context<InitInsuranceVault>,
    min_seed_bps: u16,
    max_draw_per_event_bps: u16,
) -> Result<()> {
    require!(min_seed_bps <= 10_000, SssError::InvalidBackstopBps);

    let vault = &mut ctx.accounts.insurance_vault;
    vault.sss_mint = ctx.accounts.sss_mint.key();
    vault.vault_token_account = ctx.accounts.vault_token_account.key();
    vault.min_seed_bps = min_seed_bps;
    vault.current_balance = 0;
    vault.total_drawn = 0;
    vault.max_draw_per_event_bps = max_draw_per_event_bps;
    // If min_seed_bps == 0 the vault is seeded-enough immediately.
    vault.adequately_seeded = min_seed_bps == 0;
    vault.bump = ctx.bumps.insurance_vault;

    // Enable FLAG_INSURANCE_VAULT_REQUIRED on config.
    let config = &mut ctx.accounts.config;
    config.feature_flags |= FLAG_INSURANCE_VAULT_REQUIRED;

    msg!(
        "InsuranceVault initialised: min_seed_bps={}, max_draw_per_event_bps={}",
        min_seed_bps,
        max_draw_per_event_bps,
    );
    Ok(())
}

// ─── seed_insurance_vault ────────────────────────────────────────────────────

/// Deposit collateral into the insurance vault.  Anyone may call.  The vault's
/// `adequately_seeded` flag is updated after each deposit.
///
/// When FLAG_INSURANCE_VAULT_REQUIRED is set, the `mint` instruction blocks
/// until `adequately_seeded == true`.
#[derive(Accounts)]
pub struct SeedInsuranceVault<'info> {
    #[account(mut)]
    pub depositor: Signer<'info>,

    #[account(
        seeds = [StablecoinConfig::SEED, sss_mint.key().as_ref()],
        bump = config.bump,
        constraint = config.feature_flags & FLAG_INSURANCE_VAULT_REQUIRED != 0 @ SssError::FeatureNotEnabled,
    )]
    pub config: Account<'info, StablecoinConfig>,

    pub sss_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [InsuranceVault::SEED, sss_mint.key().as_ref()],
        bump = insurance_vault.bump,
    )]
    pub insurance_vault: Account<'info, InsuranceVault>,

    /// Depositor's collateral token account (source).
    #[account(
        mut,
        constraint = depositor_token_account.mint == config.collateral_mint @ SssError::InvalidCollateralMint,
        constraint = depositor_token_account.owner == depositor.key() @ SssError::TokenAccountOwnerMismatch,
    )]
    pub depositor_token_account: InterfaceAccount<'info, TokenAccount>,

    /// The vault token account (destination).
    #[account(
        mut,
        constraint = vault_token_account.key() == insurance_vault.vault_token_account @ SssError::InvalidVault,
    )]
    pub vault_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        constraint = collateral_mint.key() == config.collateral_mint @ SssError::InvalidCollateralMint,
    )]
    pub collateral_mint: InterfaceAccount<'info, Mint>,

    pub collateral_token_program: Interface<'info, TokenInterface>,
}

pub fn seed_insurance_vault_handler(
    ctx: Context<SeedInsuranceVault>,
    amount: u64,
) -> Result<()> {
    require!(amount > 0, SssError::ZeroAmount);

    transfer_checked(
        CpiContext::new(
            ctx.accounts.collateral_token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.depositor_token_account.to_account_info(),
                mint: ctx.accounts.collateral_mint.to_account_info(),
                to: ctx.accounts.vault_token_account.to_account_info(),
                authority: ctx.accounts.depositor.to_account_info(),
            },
        ),
        amount,
        ctx.accounts.collateral_mint.decimals,
    )?;

    let vault = &mut ctx.accounts.insurance_vault;
    vault.current_balance = vault
        .current_balance
        .checked_add(amount)
        .ok_or(error!(SssError::InvalidPrice))?;

    // Recompute adequately_seeded.
    let net_supply = ctx.accounts.config.net_supply();
    let required = vault.required_seed_amount(net_supply);
    vault.adequately_seeded = vault.current_balance >= required;

    emit!(InsuranceVaultSeeded {
        sss_mint: ctx.accounts.sss_mint.key(),
        amount,
        current_balance: vault.current_balance,
        adequately_seeded: vault.adequately_seeded,
    });

    msg!(
        "InsuranceVault seeded: amount={}, balance={}, required={}, seeded={}",
        amount,
        vault.current_balance,
        required,
        vault.adequately_seeded,
    );
    Ok(())
}

// ─── draw_insurance ──────────────────────────────────────────────────────────

/// Governance-controlled draw to cover protocol losses.
///
/// Access: authority-only.  When FLAG_DAO_COMMITTEE is set, callers must first
/// execute a DAO proposal with action matching `draw_insurance`; this instruction
/// trusts the DAO executor has already validated quorum.
///
/// `reason_hash` — 32-byte hash linking to the on/off-chain governance decision.
#[derive(Accounts)]
pub struct DrawInsurance<'info> {
    pub authority: Signer<'info>,

    #[account(
        seeds = [StablecoinConfig::SEED, sss_mint.key().as_ref()],
        bump = config.bump,
        constraint = config.authority == authority.key() @ SssError::Unauthorized,
        constraint = config.feature_flags & FLAG_INSURANCE_VAULT_REQUIRED != 0 @ SssError::FeatureNotEnabled,
    )]
    pub config: Account<'info, StablecoinConfig>,

    pub sss_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [InsuranceVault::SEED, sss_mint.key().as_ref()],
        bump = insurance_vault.bump,
        constraint = insurance_vault.current_balance > 0 @ SssError::InsuranceFundEmpty,
    )]
    pub insurance_vault: Account<'info, InsuranceVault>,

    /// Vault token account (source).
    #[account(
        mut,
        constraint = vault_token_account.key() == insurance_vault.vault_token_account @ SssError::InvalidVault,
    )]
    pub vault_token_account: InterfaceAccount<'info, TokenAccount>,

    /// Destination token account (reserve vault or recovery account).
    #[account(
        mut,
        constraint = destination_token_account.mint == config.collateral_mint @ SssError::InvalidCollateralMint,
    )]
    pub destination_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(constraint = collateral_mint.key() == config.collateral_mint @ SssError::InvalidCollateralMint)]
    pub collateral_mint: InterfaceAccount<'info, Mint>,

    /// Vault PDA — signs the transfer out of vault_token_account.
    /// CHECK: seeds + bump verified via constraint.
    #[account(
        seeds = [InsuranceVault::SEED, sss_mint.key().as_ref()],
        bump = insurance_vault.bump,
    )]
    pub vault_authority: AccountInfo<'info>,

    pub collateral_token_program: Interface<'info, TokenInterface>,
}

pub fn draw_insurance_handler(
    ctx: Context<DrawInsurance>,
    amount: u64,
    reason_hash: [u8; 32],
) -> Result<()> {
    require!(amount > 0, SssError::ZeroAmount);

    let config = &ctx.accounts.config;
    let vault = &ctx.accounts.insurance_vault;

    if config.feature_flags & crate::state::FLAG_DAO_COMMITTEE != 0 {
        // DAO active: trust that execute_action (DAO executor) already validated quorum
        // before CPIing into draw_insurance.  Authority here is the DAO executor.
        msg!("DAO committee active: draw authorised via governance proposal");
    }

    let net_supply = config.net_supply();
    let max_draw = if vault.max_draw_per_event_bps == 0 {
        vault.current_balance
    } else {
        let cap = ((net_supply as u128)
            .saturating_mul(vault.max_draw_per_event_bps as u128)
            / 10_000u128) as u64;
        cap.min(vault.current_balance)
    };
    require!(amount <= max_draw, SssError::InvalidAmount);

    // Transfer via vault PDA signer.
    let sss_mint_key = ctx.accounts.sss_mint.key();
    let vault_seeds: &[&[u8]] = &[
        InsuranceVault::SEED,
        sss_mint_key.as_ref(),
        &[ctx.accounts.insurance_vault.bump],
    ];
    transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.collateral_token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.vault_token_account.to_account_info(),
                mint: ctx.accounts.collateral_mint.to_account_info(),
                to: ctx.accounts.destination_token_account.to_account_info(),
                authority: ctx.accounts.vault_authority.to_account_info(),
            },
            &[vault_seeds],
        ),
        amount,
        ctx.accounts.collateral_mint.decimals,
    )?;

    let vault_mut = &mut ctx.accounts.insurance_vault;
    vault_mut.current_balance = vault_mut
        .current_balance
        .checked_sub(amount)
        .ok_or(error!(SssError::InsufficientCollateral))?;
    vault_mut.total_drawn = vault_mut
        .total_drawn
        .checked_add(amount)
        .ok_or(error!(SssError::InvalidPrice))?;

    // Recompute seeded status.
    let required = vault_mut.required_seed_amount(net_supply);
    vault_mut.adequately_seeded = vault_mut.current_balance >= required;

    emit!(InsuranceDrawn {
        sss_mint: ctx.accounts.sss_mint.key(),
        amount,
        reason_hash,
        remaining_balance: vault_mut.current_balance,
        total_drawn: vault_mut.total_drawn,
    });

    msg!(
        "Insurance drawn: amount={}, remaining={}, total_drawn={}",
        amount,
        vault_mut.current_balance,
        vault_mut.total_drawn,
    );
    Ok(())
}

// ─── replenish_insurance_vault ───────────────────────────────────────────────

/// Permissionless: anyone may replenish the vault after a draw event.
/// Emits `InsuranceVaultReplenished`.
#[derive(Accounts)]
pub struct ReplenishInsuranceVault<'info> {
    #[account(mut)]
    pub contributor: Signer<'info>,

    #[account(
        seeds = [StablecoinConfig::SEED, sss_mint.key().as_ref()],
        bump = config.bump,
        constraint = config.feature_flags & FLAG_INSURANCE_VAULT_REQUIRED != 0 @ SssError::FeatureNotEnabled,
    )]
    pub config: Account<'info, StablecoinConfig>,

    pub sss_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [InsuranceVault::SEED, sss_mint.key().as_ref()],
        bump = insurance_vault.bump,
    )]
    pub insurance_vault: Account<'info, InsuranceVault>,

    #[account(
        mut,
        constraint = contributor_token_account.mint == config.collateral_mint @ SssError::InvalidCollateralMint,
        constraint = contributor_token_account.owner == contributor.key() @ SssError::TokenAccountOwnerMismatch,
    )]
    pub contributor_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        constraint = vault_token_account.key() == insurance_vault.vault_token_account @ SssError::InvalidVault,
    )]
    pub vault_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(constraint = collateral_mint.key() == config.collateral_mint @ SssError::InvalidCollateralMint)]
    pub collateral_mint: InterfaceAccount<'info, Mint>,

    pub collateral_token_program: Interface<'info, TokenInterface>,
}

pub fn replenish_insurance_vault_handler(
    ctx: Context<ReplenishInsuranceVault>,
    amount: u64,
) -> Result<()> {
    require!(amount > 0, SssError::ZeroAmount);

    transfer_checked(
        CpiContext::new(
            ctx.accounts.collateral_token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.contributor_token_account.to_account_info(),
                mint: ctx.accounts.collateral_mint.to_account_info(),
                to: ctx.accounts.vault_token_account.to_account_info(),
                authority: ctx.accounts.contributor.to_account_info(),
            },
        ),
        amount,
        ctx.accounts.collateral_mint.decimals,
    )?;

    let vault = &mut ctx.accounts.insurance_vault;
    vault.current_balance = vault
        .current_balance
        .checked_add(amount)
        .ok_or(error!(SssError::InvalidPrice))?;

    let net_supply = ctx.accounts.config.net_supply();
    let required = vault.required_seed_amount(net_supply);
    vault.adequately_seeded = vault.current_balance >= required;

    emit!(InsuranceVaultReplenished {
        sss_mint: ctx.accounts.sss_mint.key(),
        amount,
        contributor: ctx.accounts.contributor.key(),
        new_balance: vault.current_balance,
    });

    msg!(
        "InsuranceVault replenished: amount={}, new_balance={}, seeded={}",
        amount,
        vault.current_balance,
        vault.adequately_seeded,
    );
    Ok(())
}

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    burn, transfer_checked, Burn, Mint, TokenAccount, TokenInterface, TransferChecked,
};

use crate::error::SssError;
use crate::events::{
    InstantRedemption, RedemptionPoolDrained, RedemptionPoolReplenished, RedemptionPoolSeeded,
};
use crate::state::{RedemptionPool, StablecoinConfig, FLAG_SQUADS_AUTHORITY};

// ---------------------------------------------------------------------------
// SSS-137: On-chain redemption pools — always-available par redemption
//
// Instructions:
//  1. seed_redemption_pool(amount, max_pool_size, fee_bps) — authority only
//  2. instant_redemption(amount) — any user, draws from pool (1:1 par, minus fee)
//  3. replenish_redemption_pool(amount) — permissionless top-up
//  4. drain_redemption_pool — authority only
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 1. seed_redemption_pool
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct SeedRedemptionPool<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        seeds = [StablecoinConfig::SEED, config.mint.as_ref()],
        bump = config.bump,
        constraint = config.authority == authority.key() @ SssError::Unauthorized,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + RedemptionPool::INIT_SPACE,
        seeds = [RedemptionPool::SEED, config.mint.as_ref()],
        bump,
    )]
    pub redemption_pool: Account<'info, RedemptionPool>,

    /// Reserve vault token account holding pool assets (collateral, not SSS).
    #[account(
        mut,
        constraint = reserve_vault.mint == config.collateral_mint @ SssError::RedemptionPoolMintMismatch,
    )]
    pub reserve_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Authority's source token account for the initial deposit (collateral).
    #[account(
        mut,
        constraint = reserve_source.owner == authority.key() @ SssError::TokenAccountOwnerMismatch,
        constraint = reserve_source.mint == config.collateral_mint @ SssError::RedemptionPoolMintMismatch,
    )]
    pub reserve_source: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mint::token_program = token_program,
        constraint = sss_mint.key() == config.mint @ SssError::RedemptionPoolMintMismatch,
    )]
    pub sss_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        constraint = collateral_mint.key() == config.collateral_mint @ SssError::InvalidMint,
    )]
    pub collateral_mint: InterfaceAccount<'info, Mint>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn seed_redemption_pool_handler(
    ctx: Context<SeedRedemptionPool>,
    amount: u64,
    max_pool_size: u64,
    instant_redemption_fee_bps: u16,
) -> Result<()> {
    // Squads authority enforcement
    if ctx.accounts.config.feature_flags & FLAG_SQUADS_AUTHORITY != 0 {
        crate::instructions::squads_authority::verify_squads_signer(
            &ctx.accounts.config,
            &ctx.accounts.authority.key(),
        )?;
    }

    require!(
        ctx.accounts.config.collateral_mint != Pubkey::default(),
        SssError::NoCollateralConfigured
    );
    require!(amount > 0, SssError::InvalidAmount);
    require!(
        instant_redemption_fee_bps <= RedemptionPool::MAX_FEE_BPS,
        SssError::RedemptionFeeTooHigh
    );

    let pool = &mut ctx.accounts.redemption_pool;

    // Initialize on first seed
    if pool.bump == 0 {
        pool.bump = ctx.bumps.redemption_pool;
        pool.sss_mint = ctx.accounts.config.mint;
        pool.reserve_vault = ctx.accounts.reserve_vault.key();
    }

    // Vault must match stored config after first seed
    require!(
        pool.reserve_vault == ctx.accounts.reserve_vault.key(),
        SssError::RedemptionPoolVaultMismatch
    );

    // Check pool capacity
    if max_pool_size > 0 {
        let new_liquidity = pool.current_liquidity.saturating_add(amount);
        require!(new_liquidity <= max_pool_size, SssError::RedemptionPoolFull);
    }

    // Update state
    pool.max_pool_size = max_pool_size;
    pool.instant_redemption_fee_bps = instant_redemption_fee_bps;
    pool.current_liquidity = pool.current_liquidity.saturating_add(amount);
    pool.total_seeded = pool.total_seeded.saturating_add(amount);

    // Transfer reserve assets (collateral) from authority → vault
    transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.reserve_source.to_account_info(),
                mint: ctx.accounts.collateral_mint.to_account_info(),
                to: ctx.accounts.reserve_vault.to_account_info(),
                authority: ctx.accounts.authority.to_account_info(),
            },
        ),
        amount,
        ctx.accounts.collateral_mint.decimals,
    )?;

    emit!(RedemptionPoolSeeded {
        sss_mint: pool.sss_mint,
        amount,
        new_liquidity: pool.current_liquidity,
    });

    Ok(())
}

// ---------------------------------------------------------------------------
// 2. instant_redemption
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct InstantRedemptionCtx<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        seeds = [StablecoinConfig::SEED, config.mint.as_ref()],
        bump = config.bump,
        constraint = !config.paused @ SssError::MintPaused,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(
        mut,
        seeds = [RedemptionPool::SEED, config.mint.as_ref()],
        bump = redemption_pool.bump,
        constraint = redemption_pool.sss_mint == config.mint @ SssError::RedemptionPoolMintMismatch,
    )]
    pub redemption_pool: Account<'info, RedemptionPool>,

    /// User's SSS token account (burned on redemption).
    #[account(
        mut,
        constraint = user_token_account.owner == user.key() @ SssError::TokenAccountOwnerMismatch,
        constraint = user_token_account.mint == config.mint @ SssError::RedemptionPoolMintMismatch,
    )]
    pub user_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Reserve vault — must match pool config.
    #[account(
        mut,
        constraint = reserve_vault.key() == redemption_pool.reserve_vault @ SssError::RedemptionPoolVaultMismatch,
    )]
    pub reserve_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// User's destination token account for reserve assets (collateral).
    #[account(
        mut,
        constraint = user_reserve_account.owner == user.key() @ SssError::TokenAccountOwnerMismatch,
        constraint = user_reserve_account.mint == config.collateral_mint @ SssError::RedemptionPoolMintMismatch,
    )]
    pub user_reserve_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Vault authority PDA for signing CPI transfers from reserve_vault.
    /// Seeds: [b"vault-authority", sss_mint]
    /// CHECK: PDA signer — validated by seeds.
    #[account(
        seeds = [b"vault-authority", config.mint.as_ref()],
        bump,
    )]
    pub vault_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        mint::token_program = token_program,
        constraint = sss_mint.key() == config.mint @ SssError::RedemptionPoolMintMismatch,
    )]
    pub sss_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        constraint = collateral_mint.key() == config.collateral_mint @ SssError::InvalidMint,
    )]
    pub collateral_mint: InterfaceAccount<'info, Mint>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn instant_redemption_handler(
    ctx: Context<InstantRedemptionCtx>,
    amount: u64,
) -> Result<()> {
    require!(
        ctx.accounts.config.collateral_mint != Pubkey::default(),
        SssError::NoCollateralConfigured
    );
    require!(amount > 0, SssError::InvalidAmount);

    let pool = &mut ctx.accounts.redemption_pool;

    require!(
        pool.current_liquidity >= amount,
        SssError::RedemptionPoolEmpty
    );

    // Compute fee (rounds down, protecting pool)
    let fee = (amount as u128)
        .saturating_mul(pool.instant_redemption_fee_bps as u128)
        / 10_000;
    let fee = fee as u64;

    let payout = amount.saturating_sub(fee);
    require!(payout > 0, SssError::InvalidAmount);

    // Deduct from pool
    pool.current_liquidity = pool.current_liquidity.saturating_sub(amount);
    pool.total_redeemed = pool.total_redeemed.saturating_add(amount);

    // Update utilization_bps lazily
    let total_in = pool.total_seeded.saturating_add(pool.total_replenished);
    if total_in > 0 {
        pool.utilization_bps = ((pool.total_redeemed as u128)
            .saturating_mul(10_000)
            / total_in as u128)
            .min(10_000) as u16;
    }

    // Burn SSS tokens from user (1:1 par)
    burn(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Burn {
                mint: ctx.accounts.sss_mint.to_account_info(),
                from: ctx.accounts.user_token_account.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
        amount,
    )?;

    // Transfer reserve assets from vault → user (payout after fee)
    let sss_mint_key = ctx.accounts.config.mint;
    let vault_auth_bump = ctx.bumps.vault_authority;
    let seeds: &[&[u8]] = &[b"vault-authority", sss_mint_key.as_ref(), &[vault_auth_bump]];
    let signer_seeds = &[seeds];

    transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.reserve_vault.to_account_info(),
                mint: ctx.accounts.collateral_mint.to_account_info(),
                to: ctx.accounts.user_reserve_account.to_account_info(),
                authority: ctx.accounts.vault_authority.to_account_info(),
            },
            signer_seeds,
        ),
        payout,
        ctx.accounts.collateral_mint.decimals,
    )?;

    emit!(InstantRedemption {
        sss_mint: sss_mint_key,
        user: ctx.accounts.user.key(),
        burned: amount,
        received: payout,
        fee,
        remaining_liquidity: pool.current_liquidity,
    });

    Ok(())
}

// ---------------------------------------------------------------------------
// 3. replenish_redemption_pool — permissionless
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct ReplenishRedemptionPool<'info> {
    #[account(mut)]
    pub replenisher: Signer<'info>,

    #[account(
        seeds = [StablecoinConfig::SEED, config.mint.as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(
        mut,
        seeds = [RedemptionPool::SEED, config.mint.as_ref()],
        bump = redemption_pool.bump,
        constraint = redemption_pool.sss_mint == config.mint @ SssError::RedemptionPoolMintMismatch,
    )]
    pub redemption_pool: Account<'info, RedemptionPool>,

    #[account(
        mut,
        constraint = reserve_vault.key() == redemption_pool.reserve_vault @ SssError::RedemptionPoolVaultMismatch,
    )]
    pub reserve_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mut,
        constraint = replenisher_source.owner == replenisher.key() @ SssError::TokenAccountOwnerMismatch,
        constraint = replenisher_source.mint == config.collateral_mint @ SssError::RedemptionPoolMintMismatch,
    )]
    pub replenisher_source: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        mint::token_program = token_program,
        constraint = sss_mint.key() == config.mint @ SssError::RedemptionPoolMintMismatch,
    )]
    pub sss_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        constraint = collateral_mint.key() == config.collateral_mint @ SssError::InvalidMint,
    )]
    pub collateral_mint: InterfaceAccount<'info, Mint>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn replenish_redemption_pool_handler(
    ctx: Context<ReplenishRedemptionPool>,
    amount: u64,
) -> Result<()> {
    require!(
        ctx.accounts.config.collateral_mint != Pubkey::default(),
        SssError::NoCollateralConfigured
    );
    require!(amount > 0, SssError::InvalidAmount);

    let pool = &mut ctx.accounts.redemption_pool;

    // Check capacity
    if pool.max_pool_size > 0 {
        let new_liquidity = pool.current_liquidity.saturating_add(amount);
        require!(new_liquidity <= pool.max_pool_size, SssError::RedemptionPoolFull);
    }

    pool.current_liquidity = pool.current_liquidity.saturating_add(amount);
    pool.total_replenished = pool.total_replenished.saturating_add(amount);

    transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.replenisher_source.to_account_info(),
                mint: ctx.accounts.collateral_mint.to_account_info(),
                to: ctx.accounts.reserve_vault.to_account_info(),
                authority: ctx.accounts.replenisher.to_account_info(),
            },
        ),
        amount,
        ctx.accounts.collateral_mint.decimals,
    )?;

    emit!(RedemptionPoolReplenished {
        sss_mint: pool.sss_mint,
        replenisher: ctx.accounts.replenisher.key(),
        amount,
        new_liquidity: pool.current_liquidity,
    });

    Ok(())
}

// ---------------------------------------------------------------------------
// 4. drain_redemption_pool — authority only
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct DrainRedemptionPool<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        seeds = [StablecoinConfig::SEED, config.mint.as_ref()],
        bump = config.bump,
        constraint = config.authority == authority.key() @ SssError::Unauthorized,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(
        mut,
        seeds = [RedemptionPool::SEED, config.mint.as_ref()],
        bump = redemption_pool.bump,
        constraint = redemption_pool.sss_mint == config.mint @ SssError::RedemptionPoolMintMismatch,
    )]
    pub redemption_pool: Account<'info, RedemptionPool>,

    #[account(
        mut,
        constraint = reserve_vault.key() == redemption_pool.reserve_vault @ SssError::RedemptionPoolVaultMismatch,
    )]
    pub reserve_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Destination for drained assets (authority's collateral token account).
    #[account(
        mut,
        constraint = drain_destination.owner == authority.key() @ SssError::TokenAccountOwnerMismatch,
        constraint = drain_destination.mint == config.collateral_mint @ SssError::RedemptionPoolMintMismatch,
    )]
    pub drain_destination: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: PDA signer — validated by seeds.
    #[account(
        seeds = [b"vault-authority", config.mint.as_ref()],
        bump,
    )]
    pub vault_authority: UncheckedAccount<'info>,

    #[account(
        mint::token_program = token_program,
        constraint = sss_mint.key() == config.mint @ SssError::RedemptionPoolMintMismatch,
    )]
    pub sss_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        constraint = collateral_mint.key() == config.collateral_mint @ SssError::InvalidMint,
    )]
    pub collateral_mint: InterfaceAccount<'info, Mint>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn drain_redemption_pool_handler(ctx: Context<DrainRedemptionPool>) -> Result<()> {
    require!(
        ctx.accounts.config.collateral_mint != Pubkey::default(),
        SssError::NoCollateralConfigured
    );
    // Squads authority enforcement
    if ctx.accounts.config.feature_flags & FLAG_SQUADS_AUTHORITY != 0 {
        crate::instructions::squads_authority::verify_squads_signer(
            &ctx.accounts.config,
            &ctx.accounts.authority.key(),
        )?;
    }

    let pool = &mut ctx.accounts.redemption_pool;
    let drain_amount = pool.current_liquidity;
    require!(drain_amount > 0, SssError::InvalidAmount);

    pool.current_liquidity = 0;

    let sss_mint_key = ctx.accounts.config.mint;
    let vault_auth_bump = ctx.bumps.vault_authority;
    let seeds: &[&[u8]] = &[b"vault-authority", sss_mint_key.as_ref(), &[vault_auth_bump]];
    let signer_seeds = &[seeds];

    transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.reserve_vault.to_account_info(),
                mint: ctx.accounts.collateral_mint.to_account_info(),
                to: ctx.accounts.drain_destination.to_account_info(),
                authority: ctx.accounts.vault_authority.to_account_info(),
            },
            signer_seeds,
        ),
        drain_amount,
        ctx.accounts.collateral_mint.decimals,
    )?;

    emit!(RedemptionPoolDrained {
        sss_mint: sss_mint_key,
        amount: drain_amount,
    });

    Ok(())
}

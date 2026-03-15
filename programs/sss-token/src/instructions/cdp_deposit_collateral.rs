use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
};

use crate::error::SssError;
use crate::state::{CollateralVault, StablecoinConfig, YieldCollateralConfig, FLAG_YIELD_COLLATERAL};

/// Deposit SPL tokens as collateral into a per-user CDP vault.
///
/// When FLAG_YIELD_COLLATERAL is enabled on the config, only mints listed in
/// the `YieldCollateralConfig` whitelist may be deposited.  Pass the real
/// `yield_collateral_config` PDA in that case.  When the flag is off, pass the
/// program_id as a None placeholder (standard Anchor 0.32 optional-account pattern).
///
/// Works with any SPL token type; each (user, collateral_mint) gets its own vault PDA.
#[derive(Accounts)]
pub struct CdpDepositCollateral<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    /// The SSS stablecoin config (must be SSS-3 with reserve vault set)
    #[account(
        seeds = [StablecoinConfig::SEED, sss_mint.key().as_ref()],
        bump = config.bump,
        constraint = config.preset == 3 @ SssError::InvalidPreset,
    )]
    pub config: Box<Account<'info, StablecoinConfig>>,

    /// The SSS stablecoin mint — identifies the config
    pub sss_mint: InterfaceAccount<'info, Mint>,

    /// The collateral SPL token mint being deposited
    pub collateral_mint: InterfaceAccount<'info, Mint>,

    /// Per-user collateral vault PDA — tracks how much of this collateral type the user has
    #[account(
        init_if_needed,
        payer = user,
        space = 8 + CollateralVault::INIT_SPACE,
        seeds = [
            CollateralVault::SEED,
            sss_mint.key().as_ref(),
            user.key().as_ref(),
            collateral_mint.key().as_ref(),
        ],
        bump,
    )]
    pub collateral_vault: Box<Account<'info, CollateralVault>>,

    /// The token account that holds collateral on behalf of collateral_vault PDA.
    /// Created externally; must be owned by collateral_vault PDA.
    #[account(
        mut,
        constraint = vault_token_account.mint == collateral_mint.key(),
        constraint = vault_token_account.owner == collateral_vault.key(),
    )]
    pub vault_token_account: InterfaceAccount<'info, TokenAccount>,

    /// User's source token account for the collateral
    #[account(
        mut,
        constraint = user_collateral_account.mint == collateral_mint.key(),
        constraint = user_collateral_account.owner == user.key(),
    )]
    pub user_collateral_account: InterfaceAccount<'info, TokenAccount>,

    /// Optional: yield-collateral config PDA (heap-allocated to avoid stack overflow).
    /// Must be the real YieldCollateralConfig PDA when FLAG_YIELD_COLLATERAL is active.
    /// Pass the program_id as a None placeholder when the flag is not set.
    /// Seeds: [b"yield-collateral", sss_mint]
    pub yield_collateral_config: Option<Box<Account<'info, YieldCollateralConfig>>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn cdp_deposit_collateral_handler(
    ctx: Context<CdpDepositCollateral>,
    amount: u64,
) -> Result<()> {
    require!(amount > 0, SssError::ZeroAmount);

    // ── FLAG_YIELD_COLLATERAL guard ───────────────────────────────────────────
    // When the flag is set, the deposited collateral_mint must appear in the
    // YieldCollateralConfig whitelist.  1 CU when the flag is off.
    if ctx.accounts.config.feature_flags & FLAG_YIELD_COLLATERAL != 0 {
        let yc_config = ctx
            .accounts
            .yield_collateral_config
            .as_ref()
            .ok_or(SssError::YieldCollateralNotEnabled)?;

        require!(
            yc_config
                .whitelisted_mints
                .contains(&ctx.accounts.collateral_mint.key()),
            SssError::CollateralMintNotWhitelisted
        );
    }
    // ─────────────────────────────────────────────────────────────────────────

    // Initialise vault metadata on first deposit
    let vault = &mut ctx.accounts.collateral_vault;
    if vault.owner == Pubkey::default() {
        vault.owner = ctx.accounts.user.key();
        vault.collateral_mint = ctx.accounts.collateral_mint.key();
        vault.vault_token_account = ctx.accounts.vault_token_account.key();
        vault.bump = ctx.bumps.collateral_vault;
    }

    // Transfer collateral from user → vault token account
    transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.user_collateral_account.to_account_info(),
                mint: ctx.accounts.collateral_mint.to_account_info(),
                to: ctx.accounts.vault_token_account.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
        amount,
        ctx.accounts.collateral_mint.decimals,
    )?;

    vault.deposited_amount = vault.deposited_amount.checked_add(amount).unwrap();

    msg!(
        "CDP: deposited {} of collateral {}. Vault total: {}",
        amount,
        ctx.accounts.collateral_mint.key(),
        vault.deposited_amount,
    );
    Ok(())
}

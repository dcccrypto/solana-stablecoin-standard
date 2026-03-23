use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenInterface};
use spl_token_2022::{
    extension::{BaseStateWithExtensions, StateWithExtensions, default_account_state::DefaultAccountState},
    instruction::AuthorityType,
    state::Mint as MintState,
};

use crate::constants::*;
use crate::error::SssError;
use crate::events::ConfigInitialized;
use crate::state::{InitializeParams, StablecoinConfig};

pub fn initialize(ctx: Context<Initialize>, params: InitializeParams) -> Result<()> {
    require!(
        params.preset == PRESET_SSS1 || params.preset == PRESET_SSS2,
        SssError::InvalidPreset
    );

    // SSS-2: verify the mint has DefaultAccountState::Frozen for KYC-gated onboarding
    if params.preset == PRESET_SSS2 {
        let mint_info = ctx.accounts.mint.to_account_info();
        let mint_data = mint_info.try_borrow_data()?;
        if let Ok(mint_state) = StateWithExtensions::<MintState>::unpack(&mint_data) {
            if let Ok(das) = mint_state.get_extension::<DefaultAccountState>() {
                let state_val: u8 = das.state.into();
                // AccountState::Frozen == 2
                require!(state_val == 2, SssError::DefaultAccountStateNotFrozen);
            } else {
                return err!(SssError::DefaultAccountStateNotFrozen);
            }
        }
        drop(mint_data);
    }

    let config = &mut ctx.accounts.config;
    config.authority = ctx.accounts.authority.key();
    config.pending_authority = None;
    config.mint = ctx.accounts.mint.key();
    config.transfer_hook_program = params.transfer_hook_program;
    config.preset = params.preset;
    config.paused = false;
    config.compliance_enabled = params.compliance_enabled;
    config.total_minted = 0;
    config.total_burned = 0;
    config.total_seized = 0;
    config.supply_cap = params.supply_cap;
    config.bump = ctx.bumps.config;
    config._reserved = [0u8; 22];

    let cpi_program = ctx.accounts.token_program.to_account_info();

    let ix = spl_token_2022::instruction::set_authority(
        cpi_program.key,
        &ctx.accounts.mint.key(),
        Some(&config.key()),
        AuthorityType::MintTokens,
        &ctx.accounts.authority.key(),
        &[],
    )?;
    anchor_lang::solana_program::program::invoke(
        &ix,
        &[
            ctx.accounts.mint.to_account_info(),
            ctx.accounts.authority.to_account_info(),
        ],
    )?;

    if ctx.accounts.mint.freeze_authority.is_some() {
        let freeze_ix = spl_token_2022::instruction::set_authority(
            cpi_program.key,
            &ctx.accounts.mint.key(),
            Some(&config.key()),
            AuthorityType::FreezeAccount,
            &ctx.accounts.authority.key(),
            &[],
        )?;
        anchor_lang::solana_program::program::invoke(
            &freeze_ix,
            &[
                ctx.accounts.mint.to_account_info(),
                ctx.accounts.authority.to_account_info(),
            ],
        )?;
    }

    emit_cpi!(ConfigInitialized {
        config: config.key(),
        mint: config.mint,
        authority: config.authority,
        preset: config.preset,
        supply_cap: config.supply_cap,
    });

    Ok(())
}

#[derive(Accounts)]
#[event_cpi]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(mut, mint::token_program = token_program)]
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        init,
        payer = authority,
        space = 8 + StablecoinConfig::INIT_SPACE,
        seeds = [CONFIG_SEED, mint.key().as_ref()],
        bump,
    )]
    pub config: Account<'info, StablecoinConfig>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

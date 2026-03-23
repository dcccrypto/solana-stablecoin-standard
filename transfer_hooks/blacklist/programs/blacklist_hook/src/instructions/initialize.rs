use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;
use spl_tlv_account_resolution::{account::ExtraAccountMeta, state::ExtraAccountMetaList};
use spl_transfer_hook_interface::instruction::ExecuteInstruction;

use crate::constants::*;
use crate::error::BlacklistError;
use crate::events::ConfigInitialized;
use crate::state::Config;

#[derive(Accounts)]
#[event_cpi]
pub struct InitializeConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        init,
        payer = admin,
        space = 8 + Config::INIT_SPACE,
        seeds = [CONFIG_SEED, mint.key().as_ref()],
        bump
    )]
    pub config: Account<'info, Config>,

    pub system_program: Program<'info, System>,
}

pub fn initialize_config(ctx: Context<InitializeConfig>) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.admin = ctx.accounts.admin.key();
    config.pending_admin = None;
    config.mint = ctx.accounts.mint.key();
    config.paused = false;
    config.bump = ctx.bumps.config;

    emit_cpi!(ConfigInitialized {
        config: ctx.accounts.config.key(),
        admin: ctx.accounts.admin.key(),
        mint: ctx.accounts.mint.key(),
    });

    Ok(())
}

#[derive(Accounts)]
pub struct InitializeExtraAccountMetaList<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        seeds = [CONFIG_SEED, mint.key().as_ref()],
        bump = config.bump,
        constraint = config.mint == mint.key() @ BlacklistError::MintMismatch,
    )]
    pub config: Account<'info, Config>,

    #[account(
        init,
        payer = payer,
        seeds = [EXTRA_ACCOUNT_METAS_SEED, mint.key().as_ref()],
        bump,
        space = 8 + 256
    )]
    /// CHECK: raw TLV account
    pub extra_account_meta_list: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn initialize_extra_account_meta_list(
    ctx: Context<InitializeExtraAccountMetaList>,
) -> Result<()> {
    let metas = vec![
        ExtraAccountMeta::new_with_seeds(
            &[
                spl_tlv_account_resolution::seeds::Seed::Literal {
                    bytes: CONFIG_SEED.to_vec(),
                },
                spl_tlv_account_resolution::seeds::Seed::AccountKey { index: 1 },
            ],
            false,
            false,
        )?,
        ExtraAccountMeta::new_with_seeds(
            &[
                spl_tlv_account_resolution::seeds::Seed::Literal {
                    bytes: BLACKLIST_SEED.to_vec(),
                },
                spl_tlv_account_resolution::seeds::Seed::AccountKey { index: 1 },
                spl_tlv_account_resolution::seeds::Seed::AccountData {
                    account_index: 0,
                    data_index: 32,
                    length: 32,
                },
            ],
            false,
            false,
        )?,
        ExtraAccountMeta::new_with_seeds(
            &[
                spl_tlv_account_resolution::seeds::Seed::Literal {
                    bytes: BLACKLIST_SEED.to_vec(),
                },
                spl_tlv_account_resolution::seeds::Seed::AccountKey { index: 1 },
                spl_tlv_account_resolution::seeds::Seed::AccountData {
                    account_index: 2,
                    data_index: 32,
                    length: 32,
                },
            ],
            false,
            false,
        )?,
    ];

    let mut data = ctx
        .accounts
        .extra_account_meta_list
        .try_borrow_mut_data()?;

    ExtraAccountMetaList::init::<ExecuteInstruction>(&mut data, &metas)?;
    Ok(())
}

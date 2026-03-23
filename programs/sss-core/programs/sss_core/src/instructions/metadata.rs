use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenInterface};
use spl_token_metadata_interface::instruction::update_field;

use crate::constants::*;
use crate::error::SssError;
use crate::events::MetadataUpdated;
use crate::state::{StablecoinConfig, UpdateMetadataParams};

pub fn update_metadata(ctx: Context<UpdateMetadataCtx>, params: UpdateMetadataParams) -> Result<()> {
    let field = match params.field.as_str() {
        "name" => spl_token_metadata_interface::state::Field::Name,
        "symbol" => spl_token_metadata_interface::state::Field::Symbol,
        "uri" => spl_token_metadata_interface::state::Field::Uri,
        _ => return err!(SssError::InvalidMetadataField),
    };

    let mint_key = ctx.accounts.mint.key();
    let bump = ctx.accounts.config.bump;
    let seeds: &[&[u8]] = &[CONFIG_SEED, mint_key.as_ref(), &[bump]];
    let signer_seeds = &[seeds];

    let ix = update_field(
        ctx.accounts.token_program.key,
        &ctx.accounts.mint.key(),
        &ctx.accounts.config.key(),
        field,
        params.value.clone(),
    );
    anchor_lang::solana_program::program::invoke_signed(
        &ix,
        &[
            ctx.accounts.mint.to_account_info(),
            ctx.accounts.config.to_account_info(),
        ],
        signer_seeds,
    )?;

    emit_cpi!(MetadataUpdated {
        config: ctx.accounts.config.key(),
        mint: ctx.accounts.mint.key(),
        authority: ctx.accounts.authority.key(),
        field: params.field,
        value: params.value,
    });

    Ok(())
}

#[derive(Accounts)]
#[event_cpi]
pub struct UpdateMetadataCtx<'info> {
    pub authority: Signer<'info>,

    #[account(
        has_one = authority @ SssError::Unauthorized,
        seeds = [CONFIG_SEED, config.mint.as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(mut, mint::token_program = token_program)]
    pub mint: InterfaceAccount<'info, Mint>,

    pub token_program: Interface<'info, TokenInterface>,
}

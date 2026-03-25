use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;

use crate::error::SssError;
use crate::events::{MintVelocityUpdated, PsmFeeUpdated};
use crate::state::{MinterInfo, StablecoinConfig};

/// Maximum PSM redemption fee: 10% (1000 bps).
pub const MAX_PSM_FEE_BPS: u16 = 1_000;

// ---------------------------------------------------------------------------
// set_psm_fee
// ---------------------------------------------------------------------------

/// Accounts for `set_psm_fee` — authority-only.
#[derive(Accounts)]
pub struct SetPsmFee<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [StablecoinConfig::SEED, mint.key().as_ref()],
        bump = config.bump,
        constraint = config.authority == authority.key() @ SssError::Unauthorized,
        constraint = config.preset == 3 @ SssError::InvalidPreset,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(constraint = mint.key() == config.mint)]
    pub mint: InterfaceAccount<'info, Mint>,
}

/// Set the PSM redemption fee (basis points).  Authority-only.
/// `fee_bps` = 0 disables the fee.  Max = 1000 bps (10%).
///
/// BUG-010: When `admin_timelock_delay > 0` this direct call is blocked.
/// Use `propose_timelocked_op` (op_kind=7, param=fee_bps) + `execute_timelocked_op`.
pub fn set_psm_fee_handler(ctx: Context<SetPsmFee>, fee_bps: u16) -> Result<()> {
    // BUG-010: block direct call when timelock is active.
    crate::instructions::admin_timelock::require_timelock_executed(
        &ctx.accounts.config,
        crate::state::ADMIN_OP_SET_PSM_FEE,
    )?;

    // SSS-135: enforce Squads multisig when FLAG_SQUADS_AUTHORITY is active
    if ctx.accounts.config.feature_flags & crate::state::FLAG_SQUADS_AUTHORITY != 0 {
        crate::instructions::squads_authority::verify_squads_signer(
            &ctx.accounts.config,
            &ctx.accounts.authority.key(),
        )?;
    }

    require!(fee_bps <= MAX_PSM_FEE_BPS, SssError::InvalidPsmFee);

    let config = &mut ctx.accounts.config;
    let old_fee_bps = config.redemption_fee_bps;
    config.redemption_fee_bps = fee_bps;

    emit!(PsmFeeUpdated {
        mint: config.mint,
        old_fee_bps,
        new_fee_bps: fee_bps,
        authority: ctx.accounts.authority.key(),
    });

    msg!("PSM fee updated: {} → {} bps", old_fee_bps, fee_bps);
    Ok(())
}

// ---------------------------------------------------------------------------
// set_mint_velocity_limit
// ---------------------------------------------------------------------------

/// Accounts for `set_mint_velocity_limit` — authority-only.
#[derive(Accounts)]
pub struct SetMintVelocityLimit<'info> {
    pub authority: Signer<'info>,

    #[account(
        seeds = [StablecoinConfig::SEED, mint.key().as_ref()],
        bump = config.bump,
        constraint = config.authority == authority.key() @ SssError::Unauthorized,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(constraint = mint.key() == config.mint)]
    pub mint: InterfaceAccount<'info, Mint>,

    /// CHECK: Validated as the minter pubkey for the minter_info PDA.
    pub minter: AccountInfo<'info>,

    #[account(
        mut,
        seeds = [MinterInfo::SEED, config.key().as_ref(), minter.key().as_ref()],
        bump = minter_info.bump,
        constraint = minter_info.config == config.key() @ SssError::NotAMinter,
        constraint = minter_info.minter == minter.key() @ SssError::NotAMinter,
    )]
    pub minter_info: Account<'info, MinterInfo>,
}

/// Set `max_mint_per_epoch` for a registered minter.  0 = unlimited (disable limit).
pub fn set_mint_velocity_limit_handler(
    ctx: Context<SetMintVelocityLimit>,
    max_mint_per_epoch: u64,
) -> Result<()> {
    // SSS-135: enforce Squads multisig when FLAG_SQUADS_AUTHORITY is active
    if ctx.accounts.config.feature_flags & crate::state::FLAG_SQUADS_AUTHORITY != 0 {
        crate::instructions::squads_authority::verify_squads_signer(
            &ctx.accounts.config,
            &ctx.accounts.authority.key(),
        )?;
    }

    ctx.accounts.minter_info.max_mint_per_epoch = max_mint_per_epoch;

    emit!(MintVelocityUpdated {
        mint: ctx.accounts.config.mint,
        minter: ctx.accounts.minter.key(),
        max_mint_per_epoch,
        authority: ctx.accounts.authority.key(),
    });

    msg!(
        "Minter {} velocity limit set to {} per epoch",
        ctx.accounts.minter.key(),
        max_mint_per_epoch
    );
    Ok(())
}

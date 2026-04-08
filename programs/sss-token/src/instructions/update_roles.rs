use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenInterface};

use crate::error::SssError;
use crate::events::AuthorityProposed;
use crate::state::{StablecoinConfig, UpdateRolesParams, FLAG_SQUADS_AUTHORITY};

#[derive(Accounts)]
pub struct UpdateRoles<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [StablecoinConfig::SEED, mint.key().as_ref()],
        bump = config.bump,
        constraint = config.authority == authority.key() @ SssError::Unauthorized,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(constraint = mint.key() == config.mint)]
    pub mint: InterfaceAccount<'info, Mint>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handler(ctx: Context<UpdateRoles>, params: UpdateRolesParams) -> Result<()> {
    let config = &mut ctx.accounts.config;
    // AUDIT NOTE: Squads enforcement — defense-in-depth verify_squads_signer check.
    // The has_one = authority constraint already guarantees config.authority == authority.key(),
    // and after init_squads_authority config.authority IS the Squads multisig PDA, so the
    // constraint provides equivalent security. This explicit check adds belt-and-suspenders.
    if config.feature_flags & FLAG_SQUADS_AUTHORITY != 0 {
        crate::instructions::squads_authority::verify_squads_signer(
            config,
            &ctx.accounts.authority.key(),
        )?;
    }
    // BUG-019: Compliance authority transfer ALWAYS requires the admin timelock
    // (minimum 432_000 slots), regardless of admin_timelock_delay setting.
    // This check is placed FIRST to ensure a combined call (new_authority +
    // new_compliance_authority) never partially succeeds before hitting this guard.
    // Direct update_roles call is permanently blocked for compliance authority.
    // Use propose_timelocked_op (op_kind=10) + execute_timelocked_op instead.
    if params.new_compliance_authority.is_some() {
        return err!(SssError::ComplianceAuthorityRequiresTimelock);
    }
    if let Some(proposed) = params.new_authority {
        // SSS-113 CRIT-01: When an admin timelock delay is configured (> 0), authority
        // transfers MUST go through propose_timelocked_op / execute_timelocked_op to
        // prevent a compromised key from instantly hijacking the protocol.
        require!(
            config.admin_timelock_delay == 0,
            SssError::UseTimelockForAuthorityTransfer
        );
        config.pending_authority = proposed;
        emit!(AuthorityProposed {
            mint: config.mint,
            proposed,
            is_compliance: false,
        });
        msg!("Authority transfer proposed to {}", proposed);
    }
    Ok(())
}

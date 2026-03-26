use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenInterface};

use crate::error::SssError;
use crate::events::AuthorityProposed;
use crate::state::{StablecoinConfig, UpdateRolesParams};

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
    if let Some(proposed) = params.new_authority {
        // SSS-113 CRIT-01: When an admin timelock delay is configured (> 0), authority
        // transfers MUST go through propose_timelocked_op / execute_timelocked_op to
        // prevent a compromised key from instantly hijacking the protocol.
        // Compliance authority transfers are exempt (no timelock variant exists for that role).
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
    if let Some(_proposed) = params.new_compliance_authority {
        // BUG-019: Compliance authority transfer ALWAYS requires the admin timelock
        // (minimum 432_000 slots), regardless of admin_timelock_delay setting.
        // Direct update_roles call is permanently blocked for compliance authority.
        // Use propose_timelocked_op (op_kind=10) + execute_timelocked_op instead.
        return err!(SssError::ComplianceAuthorityRequiresTimelock);
    }
    Ok(())
}

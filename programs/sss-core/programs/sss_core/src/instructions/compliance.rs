use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::SssError;
use crate::events::ComplianceToggled;
use crate::state::StablecoinConfig;

pub fn set_compliance(ctx: Context<SetComplianceCtx>, enabled: bool) -> Result<()> {
    ctx.accounts.config.compliance_enabled = enabled;

    emit_cpi!(ComplianceToggled {
        config: ctx.accounts.config.key(),
        authority: ctx.accounts.authority.key(),
        enabled,
    });

    Ok(())
}

#[derive(Accounts)]
#[event_cpi]
pub struct SetComplianceCtx<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        has_one = authority @ SssError::Unauthorized,
        seeds = [CONFIG_SEED, config.mint.as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, StablecoinConfig>,
}

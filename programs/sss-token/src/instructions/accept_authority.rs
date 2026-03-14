use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenInterface};

use crate::error::SssError;
use crate::events::AuthorityAccepted;
use crate::state::StablecoinConfig;

// ── Accept authority ──────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct AcceptAuthority<'info> {
    /// Must be the pending_authority
    pub pending: Signer<'info>,

    #[account(
        mut,
        seeds = [StablecoinConfig::SEED, mint.key().as_ref()],
        bump = config.bump,
        constraint = config.pending_authority != Pubkey::default() @ SssError::NoPendingAuthority,
        constraint = config.pending_authority == pending.key() @ SssError::Unauthorized,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(constraint = mint.key() == config.mint)]
    pub mint: InterfaceAccount<'info, Mint>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn accept_authority_handler(ctx: Context<AcceptAuthority>) -> Result<()> {
    let config = &mut ctx.accounts.config;
    let new_authority = config.pending_authority;
    config.authority = new_authority;
    config.pending_authority = Pubkey::default();
    emit!(AuthorityAccepted {
        mint: config.mint,
        new_authority,
        is_compliance: false,
    });
    msg!("Authority accepted by {}", new_authority);
    Ok(())
}

// ── Accept compliance authority ───────────────────────────────────────────────

#[derive(Accounts)]
pub struct AcceptComplianceAuthority<'info> {
    /// Must be the pending_compliance_authority
    pub pending: Signer<'info>,

    #[account(
        mut,
        seeds = [StablecoinConfig::SEED, mint.key().as_ref()],
        bump = config.bump,
        constraint = config.pending_compliance_authority != Pubkey::default() @ SssError::NoPendingComplianceAuthority,
        constraint = config.pending_compliance_authority == pending.key() @ SssError::Unauthorized,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(constraint = mint.key() == config.mint)]
    pub mint: InterfaceAccount<'info, Mint>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn accept_compliance_authority_handler(
    ctx: Context<AcceptComplianceAuthority>,
) -> Result<()> {
    let config = &mut ctx.accounts.config;
    let new_authority = config.pending_compliance_authority;
    config.compliance_authority = new_authority;
    config.pending_compliance_authority = Pubkey::default();
    emit!(AuthorityAccepted {
        mint: config.mint,
        new_authority,
        is_compliance: true,
    });
    msg!("Compliance authority accepted by {}", new_authority);
    Ok(())
}

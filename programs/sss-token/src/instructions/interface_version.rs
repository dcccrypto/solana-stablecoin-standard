/// SSS-055 — Direction 3: CPI Composability Standard
///
/// `init_interface_version`: One-time init of the InterfaceVersion PDA for a mint.
/// `update_interface_version`: Bump version or set active=false (authority only).
///
/// External programs that CPI into SSS should:
///   1. Derive the InterfaceVersion PDA: ["interface-version", sss_mint]
///   2. Read `version` and `active` — reject if version mismatch or !active
///   3. Construct the mint/burn instruction using the standard discriminators
///   4. Call via `invoke` or `invoke_signed` with the published account list
use anchor_lang::prelude::*;

use crate::error::SssError;
use crate::state::{InterfaceVersion, StablecoinConfig};

// ─── Init ─────────────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct InitInterfaceVersion<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        seeds = [StablecoinConfig::SEED, mint.key().as_ref()],
        bump = config.bump,
        constraint = config.authority == authority.key() @ SssError::Unauthorized,
    )]
    pub config: Account<'info, StablecoinConfig>,

    /// CHECK: just used as seed reference; validated via config.mint in constraint
    #[account(address = config.mint)]
    pub mint: UncheckedAccount<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + InterfaceVersion::INIT_SPACE,
        seeds = [InterfaceVersion::SEED, mint.key().as_ref()],
        bump,
    )]
    pub interface_version: Account<'info, InterfaceVersion>,

    pub system_program: Program<'info, System>,
}

pub fn init_interface_version_handler(ctx: Context<InitInterfaceVersion>) -> Result<()> {
    let iv = &mut ctx.accounts.interface_version;
    iv.mint = ctx.accounts.mint.key();
    iv.version = InterfaceVersion::CURRENT_VERSION;
    iv.active = true;
    iv.bump = ctx.bumps.interface_version;

    // Store namespace bytes (zero-padded to 32 bytes) for caller reference.
    // Discriminators are sha256("global:<instruction_name>")[..8] per Anchor convention.
    let ns_bytes = InterfaceVersion::NAMESPACE.as_bytes();
    let copy_len = ns_bytes.len().min(32);
    iv.namespace[..copy_len].copy_from_slice(&ns_bytes[..copy_len]);

    msg!(
        "InterfaceVersion initialized: mint={}, version={}, namespace_len={}",
        iv.mint,
        iv.version,
        iv.namespace.len(),
    );
    Ok(())
}

// ─── Update ───────────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct UpdateInterfaceVersion<'info> {
    pub authority: Signer<'info>,

    #[account(
        seeds = [StablecoinConfig::SEED, interface_version.mint.as_ref()],
        bump = config.bump,
        constraint = config.authority == authority.key() @ SssError::Unauthorized,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(
        mut,
        seeds = [InterfaceVersion::SEED, interface_version.mint.as_ref()],
        bump = interface_version.bump,
    )]
    pub interface_version: Account<'info, InterfaceVersion>,
}

pub fn update_interface_version_handler(
    ctx: Context<UpdateInterfaceVersion>,
    new_version: Option<u8>,
    active: Option<bool>,
) -> Result<()> {
    let iv = &mut ctx.accounts.interface_version;
    if let Some(v) = new_version {
        iv.version = v;
    }
    if let Some(a) = active {
        iv.active = a;
    }
    msg!(
        "InterfaceVersion updated: version={}, active={}",
        iv.version,
        iv.active
    );
    Ok(())
}

use anchor_lang::prelude::*;

use crate::constants::*;
use crate::state::{MinterInfo, ReserveAttestation, StablecoinConfig};

pub fn view_config(ctx: Context<ViewConfigCtx>) -> Result<()> {
    let c = &ctx.accounts.config;
    msg!("authority={}", c.authority);
    msg!("mint={}", c.mint);
    msg!("preset={}", c.preset);
    msg!("paused={}", c.paused);
    msg!("compliance_enabled={}", c.compliance_enabled);
    msg!("total_minted={}", c.total_minted);
    msg!("total_burned={}", c.total_burned);
    msg!("total_seized={}", c.total_seized);
    msg!("supply_cap={:?}", c.supply_cap);
    Ok(())
}

pub fn view_minter(ctx: Context<ViewMinterCtx>) -> Result<()> {
    let m = &ctx.accounts.minter_info;
    msg!("minter={}", m.minter);
    msg!("quota={}", m.quota);
    msg!("total_minted={}", m.total_minted);
    msg!("is_active={}", m.is_active);
    Ok(())
}

pub fn view_reserve(ctx: Context<ViewReserveCtx>) -> Result<()> {
    let a = &ctx.accounts.attestation;
    msg!("attestor={}", a.attestor);
    msg!("reserve_amount={}", a.reserve_amount);
    msg!("source={}", a.source);
    msg!("uri={}", a.uri);
    msg!("timestamp={}", a.timestamp);
    Ok(())
}

#[derive(Accounts)]
pub struct ViewConfigCtx<'info> {
    #[account(
        seeds = [CONFIG_SEED, config.mint.as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, StablecoinConfig>,
}

#[derive(Accounts)]
pub struct ViewMinterCtx<'info> {
    pub minter_info: Account<'info, MinterInfo>,
}

#[derive(Accounts)]
pub struct ViewReserveCtx<'info> {
    pub attestation: Account<'info, ReserveAttestation>,
}

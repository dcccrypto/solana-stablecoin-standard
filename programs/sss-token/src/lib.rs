use anchor_lang::prelude::*;

pub mod error;
pub mod events;
pub mod instructions;
pub mod proofs;
pub mod state;

use instructions::*;

declare_id!("AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat");

/// Solana Stablecoin Standard — SSS-1 (Minimal) + SSS-2 (Compliant) + SSS-3 (Reserve-Backed)
///
/// SSS-1: Token-2022 mint with freeze authority + metadata
/// SSS-2: SSS-1 + permanent delegate + transfer hook + blacklist enforcement
/// SSS-3: SSS-1 + collateral reserve vault (deposit/redeem against on-chain reserves)
#[program]
pub mod sss_token {
    use super::*;

    /// Initialize a new stablecoin.
    /// preset = 1 => SSS-1 (minimal)
    /// preset = 2 => SSS-2 (compliant, requires transfer_hook_program)
    pub fn initialize(ctx: Context<Initialize>, params: InitializeParams) -> Result<()> {
        instructions::initialize::handler(ctx, params)
    }

    /// Mint tokens to a recipient. Caller must be a registered minter.
    pub fn mint(ctx: Context<MintTokens>, amount: u64) -> Result<()> {
        instructions::mint::handler(ctx, amount)
    }

    /// Burn tokens from source. Caller must be a registered minter.
    pub fn burn(ctx: Context<BurnTokens>, amount: u64) -> Result<()> {
        instructions::burn::handler(ctx, amount)
    }

    /// Freeze an account (compliance action). Caller must be compliance authority.
    pub fn freeze_account(ctx: Context<FreezeAccount>) -> Result<()> {
        instructions::freeze::handler(ctx)
    }

    /// Thaw a frozen account. Caller must be compliance authority.
    pub fn thaw_account(ctx: Context<ThawAccount>) -> Result<()> {
        instructions::thaw::handler(ctx)
    }

    /// Pause the entire mint (SSS-2). No minting/burning while paused.
    pub fn pause(ctx: Context<Pause>) -> Result<()> {
        instructions::pause::handler(ctx, true)
    }

    /// Unpause the mint.
    pub fn unpause(ctx: Context<Pause>) -> Result<()> {
        instructions::pause::handler(ctx, false)
    }

    /// Register or update a minter with a cap. Authority only.
    pub fn update_minter(ctx: Context<UpdateMinter>, cap: u64) -> Result<()> {
        instructions::update_minter::handler(ctx, cap)
    }

    /// Revoke a minter. Authority only.
    pub fn revoke_minter(ctx: Context<RevokeMinter>) -> Result<()> {
        instructions::revoke_minter::handler(ctx)
    }

    /// Transfer admin/compliance authorities.
    pub fn update_roles(ctx: Context<UpdateRoles>, params: UpdateRolesParams) -> Result<()> {
        instructions::update_roles::handler(ctx, params)
    }

    /// Deposit collateral into the reserve vault (SSS-3 only).
    pub fn deposit_collateral(ctx: Context<DepositCollateralCtx>, amount: u64) -> Result<()> {
        instructions::deposit_collateral::deposit_collateral_handler(ctx, amount)
    }

    /// Redeem SSS tokens by burning them and releasing collateral (SSS-3 only).
    pub fn redeem(ctx: Context<RedeemCtx>, amount: u64) -> Result<()> {
        instructions::redeem::redeem_handler(ctx, amount)
    }

    /// Accept a pending authority transfer (two-step). Caller must be pending_authority.
    pub fn accept_authority(ctx: Context<AcceptAuthority>) -> Result<()> {
        instructions::accept_authority::accept_authority_handler(ctx)
    }

    /// Accept a pending compliance authority transfer. Caller must be pending_compliance_authority.
    pub fn accept_compliance_authority(ctx: Context<AcceptComplianceAuthority>) -> Result<()> {
        instructions::accept_authority::accept_compliance_authority_handler(ctx)
    }
}

#![deny(clippy::all)]

use anchor_lang::prelude::*;

pub mod constants;
pub mod error;
pub mod events;
pub mod instructions;
pub mod state;

use instructions::*;

declare_id!("4ZFzYcNVDSew79hSAVRdtDuMqe9g4vYh7CFvitPSy5DD");

#[cfg(not(feature = "no-entrypoint"))]
solana_security_txt::security_txt! {
    name: "SSS-Core",
    project_url: "https://github.com/luiz-lvj/solana-stablecoin-standard",
    contacts: "email:security@sss.dev",
    policy: "https://github.com/luiz-lvj/solana-stablecoin-standard/blob/main/SECURITY.md",
    preferred_languages: "en",
    source_code: "https://github.com/luiz-lvj/solana-stablecoin-standard/tree/main/programs/sss-core"
}

#[program]
pub mod sss_core {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, params: state::InitializeParams) -> Result<()> {
        instructions::initialize::initialize(ctx, params)
    }

    pub fn grant_role(ctx: Context<GrantRole>, role: u8) -> Result<()> {
        instructions::roles::grant_role(ctx, role)
    }

    pub fn revoke_role(ctx: Context<RevokeRole>, role: u8) -> Result<()> {
        instructions::roles::revoke_role(ctx, role)
    }

    pub fn set_minter_quota(ctx: Context<SetMinterQuota>, quota: u64) -> Result<()> {
        instructions::quota::set_minter_quota(ctx, quota)
    }

    pub fn mint_tokens(ctx: Context<MintTokens>, amount: u64) -> Result<()> {
        instructions::mint::mint_tokens(ctx, amount)
    }

    pub fn burn_tokens(ctx: Context<BurnTokens>, amount: u64) -> Result<()> {
        instructions::burn::burn_tokens(ctx, amount)
    }

    pub fn burn_from(ctx: Context<BurnFromCtx>, amount: u64) -> Result<()> {
        instructions::burn::burn_from(ctx, amount)
    }

    pub fn pause(ctx: Context<PauseCtx>) -> Result<()> {
        instructions::pause::pause(ctx)
    }

    pub fn unpause(ctx: Context<UnpauseCtx>) -> Result<()> {
        instructions::pause::unpause(ctx)
    }

    pub fn freeze_token_account(ctx: Context<FreezeCtx>) -> Result<()> {
        instructions::freeze::freeze_token_account(ctx)
    }

    pub fn thaw_token_account(ctx: Context<ThawCtx>) -> Result<()> {
        instructions::freeze::thaw_token_account(ctx)
    }

    pub fn transfer_authority(ctx: Context<TransferAuthorityCtx>, new_authority: Pubkey) -> Result<()> {
        instructions::authority::transfer_authority(ctx, new_authority)
    }

    pub fn accept_authority(ctx: Context<AcceptAuthorityCtx>) -> Result<()> {
        instructions::authority::accept_authority(ctx)
    }

    pub fn seize(ctx: Context<SeizeCtx>, amount: u64) -> Result<()> {
        instructions::seize::seize(ctx, amount)
    }

    pub fn update_metadata(ctx: Context<UpdateMetadataCtx>, params: state::UpdateMetadataParams) -> Result<()> {
        instructions::metadata::update_metadata(ctx, params)
    }

    pub fn set_compliance(ctx: Context<SetComplianceCtx>, enabled: bool) -> Result<()> {
        instructions::compliance::set_compliance(ctx, enabled)
    }

    pub fn attest_reserve(ctx: Context<AttestReserveCtx>, params: state::AttestReserveParams) -> Result<()> {
        instructions::attest::attest_reserve(ctx, params)
    }

    pub fn view_config(ctx: Context<ViewConfigCtx>) -> Result<()> {
        instructions::view::view_config(ctx)
    }

    pub fn view_minter(ctx: Context<ViewMinterCtx>) -> Result<()> {
        instructions::view::view_minter(ctx)
    }

    pub fn view_reserve(ctx: Context<ViewReserveCtx>) -> Result<()> {
        instructions::view::view_reserve(ctx)
    }
}

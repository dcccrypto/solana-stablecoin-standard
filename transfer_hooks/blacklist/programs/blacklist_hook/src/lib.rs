#![deny(clippy::all)]

use anchor_lang::prelude::*;
use spl_transfer_hook_interface::instruction::TransferHookInstruction;

pub mod constants;
pub mod error;
pub mod events;
pub mod instructions;
pub mod state;

use instructions::*;

declare_id!("84rPjkmmoP3oYZVxjtL2rdcT6hC5Rts6N5XzJTFcJEk6");

#[cfg(not(feature = "no-entrypoint"))]
solana_security_txt::security_txt! {
    name: "SSS Blacklist Transfer Hook",
    project_url: "https://github.com/luiz-lvj/solana-stablecoin-standard",
    contacts: "email:security@sss.dev",
    policy: "https://github.com/luiz-lvj/solana-stablecoin-standard/blob/main/SECURITY.md",
    preferred_languages: "en",
    source_code: "https://github.com/luiz-lvj/solana-stablecoin-standard/tree/main/transfer_hooks/blacklist"
}

#[program]
pub mod blacklist_hook {
    use super::*;

    pub fn initialize_config(ctx: Context<InitializeConfig>) -> Result<()> {
        instructions::initialize::initialize_config(ctx)
    }

    pub fn initialize_extra_account_meta_list(
        ctx: Context<InitializeExtraAccountMetaList>,
    ) -> Result<()> {
        instructions::initialize::initialize_extra_account_meta_list(ctx)
    }

    pub fn add_to_blacklist(
        ctx: Context<SetBlacklist>,
        wallet: Pubkey,
        reason: String,
        evidence_hash: [u8; 32],
        evidence_uri: String,
    ) -> Result<()> {
        instructions::blacklist::add_to_blacklist(ctx, wallet, reason, evidence_hash, evidence_uri)
    }

    pub fn update_blacklist_evidence(
        ctx: Context<UpdateEvidence>,
        wallet: Pubkey,
        new_evidence_hash: [u8; 32],
        new_evidence_uri: String,
    ) -> Result<()> {
        instructions::blacklist::update_blacklist_evidence(ctx, wallet, new_evidence_hash, new_evidence_uri)
    }

    pub fn remove_from_blacklist(ctx: Context<SetBlacklist>, wallet: Pubkey) -> Result<()> {
        instructions::blacklist::remove_from_blacklist(ctx, wallet)
    }

    pub fn close_blacklist_entry(
        ctx: Context<CloseBlacklistEntry>,
        wallet: Pubkey,
    ) -> Result<()> {
        instructions::blacklist::close_blacklist_entry(ctx, wallet)
    }

    pub fn transfer_admin(ctx: Context<TransferAdmin>, new_admin: Pubkey) -> Result<()> {
        instructions::admin::transfer_admin(ctx, new_admin)
    }

    pub fn accept_admin(ctx: Context<AcceptAdmin>) -> Result<()> {
        instructions::admin::accept_admin(ctx)
    }

    pub fn pause_hook(ctx: Context<PauseHook>) -> Result<()> {
        instructions::pause::pause_hook(ctx)
    }

    pub fn unpause_hook(ctx: Context<PauseHook>) -> Result<()> {
        instructions::pause::unpause_hook(ctx)
    }

    pub fn transfer_hook(ctx: Context<TransferHook>, amount: u64) -> Result<()> {
        instructions::transfer_hook::transfer_hook(ctx, amount)
    }

    pub fn fallback<'info>(
        program_id: &Pubkey,
        accounts: &'info [AccountInfo<'info>],
        data: &[u8],
    ) -> Result<()> {
        let instruction = TransferHookInstruction::unpack(data)
            .map_err(|_| ProgramError::InvalidInstructionData)?;

        match instruction {
            TransferHookInstruction::Execute { amount } => {
                let amount_bytes = amount.to_le_bytes();
                __private::__global::transfer_hook(program_id, accounts, &amount_bytes)
            }
            _ => Err(ProgramError::InvalidInstructionData.into()),
        }
    }
}

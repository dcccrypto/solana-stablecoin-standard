/// BUG-022: Blacklist escapable — tokens movable to clean wallet pre-blacklist.
///
/// Fix: `blacklist_add_and_freeze` atomically:
///   1. Adds the wallet to the transfer-hook's BlacklistState (via CPI).
///   2. Freezes the wallet's token account using the config PDA as freeze authority.
///
/// Because both operations are in the same transaction, there is no window in which
/// the wallet can move tokens out before the blacklist+freeze takes effect.
///
/// Use `blacklist_add` (transfer-hook program directly) for pre-emptive blacklisting
/// of wallets that don't yet hold a token account. Only the sss-token program can
/// freeze (config PDA is freeze authority), so that path does not freeze.
use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke,
};
use anchor_spl::token_interface::{
    freeze_account, FreezeAccount as FreezeAccountCpi, Mint, TokenAccount, TokenInterface,
};

use crate::error::SssError;
use crate::state::StablecoinConfig;

/// Anchor discriminator for `blacklist_add` instruction on the transfer-hook program.
/// sha256("global:blacklist_add")[0..8]
const BLACKLIST_ADD_DISCRIMINATOR: [u8; 8] = [
    0xfe, 0xb8, 0x83, 0xc8, 0x91, 0x32, 0x2b, 0xf4,
];

#[derive(Accounts)]
pub struct BlacklistAddAndFreeze<'info> {
    /// Compliance authority — must match config.compliance_authority.
    pub compliance_authority: Signer<'info>,

    /// StablecoinConfig PDA — freeze authority and compliance authority validator.
    /// The config PDA is the freeze authority on the Token-2022 mint.
    #[account(
        seeds = [StablecoinConfig::SEED, mint.key().as_ref()],
        bump = config.bump,
        constraint = config.compliance_authority == compliance_authority.key() @ SssError::UnauthorizedCompliance,
    )]
    pub config: Account<'info, StablecoinConfig>,

    /// The Token-2022 mint — freeze authority is config PDA.
    #[account(
        mut,
        constraint = mint.key() == config.mint @ SssError::InvalidMint,
    )]
    pub mint: InterfaceAccount<'info, Mint>,

    /// Token account owned by the wallet being blacklisted.
    /// This account is frozen atomically with the blacklist write.
    #[account(
        mut,
        constraint = target_token_account.mint == mint.key() @ SssError::InvalidMint,
    )]
    pub target_token_account: InterfaceAccount<'info, TokenAccount>,

    /// BlacklistState PDA on the transfer-hook program.
    /// Seeds: [b"blacklist-state", mint] — owned by the transfer-hook program.
    /// We pass this as mutable so the CPI to transfer-hook can write the new entry.
    /// CHECK: Address verified in handler against config.transfer_hook_program + known seeds.
    #[account(mut)]
    pub blacklist_state: UncheckedAccount<'info>,

    /// The transfer-hook program — invoked via CPI to add to blacklist.
    /// CHECK: Address validated against config.transfer_hook_program in handler.
    pub transfer_hook_program: UncheckedAccount<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn handler(ctx: Context<BlacklistAddAndFreeze>) -> Result<()> {
    let hook_pid = ctx.accounts.config.transfer_hook_program;

    // ── Validate transfer_hook_program and blacklist_state ────────────────────
    require_keys_eq!(
        ctx.accounts.transfer_hook_program.key(),
        hook_pid,
        SssError::InvalidTransferHookProgram
    );

    let (expected_blacklist_state, _) = Pubkey::find_program_address(
        &[b"blacklist-state", ctx.accounts.mint.key().as_ref()],
        &hook_pid,
    );
    require_keys_eq!(
        ctx.accounts.blacklist_state.key(),
        expected_blacklist_state,
        SssError::InvalidBlacklistState
    );

    // ── Step 1: Add wallet to blacklist via CPI to transfer-hook ──────────────
    // Call `blacklist_add(address)` on the transfer-hook program.
    // The blacklist_state.authority == compliance_authority (set at transfer-hook init).
    let wallet_address = ctx.accounts.target_token_account.owner;

    // Encode instruction: discriminator (8B) + Pubkey (32B)
    let mut ix_data = BLACKLIST_ADD_DISCRIMINATOR.to_vec();
    ix_data.extend_from_slice(wallet_address.as_ref());

    let blacklist_add_ix = Instruction {
        program_id: hook_pid,
        accounts: vec![
            AccountMeta::new_readonly(ctx.accounts.compliance_authority.key(), true),
            AccountMeta::new_readonly(ctx.accounts.mint.key(), false),
            AccountMeta::new(ctx.accounts.blacklist_state.key(), false),
        ],
        data: ix_data,
    };

    // compliance_authority is a real signer in this transaction — no PDA needed.
    invoke(
        &blacklist_add_ix,
        &[
            ctx.accounts.compliance_authority.to_account_info(),
            ctx.accounts.mint.to_account_info(),
            ctx.accounts.blacklist_state.to_account_info(),
        ],
    )?;

    // ── Step 2: Freeze token account via config PDA as freeze authority ───────
    let mint_key = ctx.accounts.mint.key();
    let config_seeds: &[&[u8]] = &[
        StablecoinConfig::SEED,
        mint_key.as_ref(),
        &[ctx.accounts.config.bump],
    ];
    let signer_seeds = &[config_seeds];

    freeze_account(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            FreezeAccountCpi {
                account: ctx.accounts.target_token_account.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                authority: ctx.accounts.config.to_account_info(),
            },
            signer_seeds,
        ),
    )?;

    msg!(
        "BUG-022: blacklisted and froze token account {} (owner: {})",
        ctx.accounts.target_token_account.key(),
        wallet_address,
    );
    Ok(())
}

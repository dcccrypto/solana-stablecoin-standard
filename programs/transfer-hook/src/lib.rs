use anchor_lang::prelude::*;
use anchor_lang::system_program;
use spl_tlv_account_resolution::{account::ExtraAccountMeta, seeds::Seed, state::ExtraAccountMetaList};
use spl_transfer_hook_interface::instruction::ExecuteInstruction;

declare_id!("phAtzRyRUJGpMC3ftAtWzoaX7UkghRe9x5KTig8jPQp");

/// SSS-2 Transfer Hook — enforces blacklist on every token transfer.
///
/// This program is invoked by Token-2022 on every transfer for mints
/// that have registered this as their transfer hook.
///
/// Token-2022 Transfer Hook Interface:
/// - `initialize_extra_account_meta_list` sets up the canonical PDA at
///   seeds [b"extra-account-metas", mint] telling Token-2022 which extra
///   accounts to resolve and pass when invoking the hook.
/// - `transfer_hook` (with `#[interface]` attribute) is the execute entry
///   point. Token-2022 dispatches here using the SPL discriminator.
#[program]
pub mod sss_transfer_hook {
    use super::*;

    /// Called by Token-2022 on every transfer.
    ///
    /// CRITICAL: The `#[interface(spl_transfer_hook_interface::execute)]`
    /// attribute makes Anchor emit the correct SPL discriminator so Token-2022
    /// can find and invoke this instruction.
    ///
    /// Accounts (in Token-2022's required order):
    ///   0. source_token_account
    ///   1. mint
    ///   2. destination_token_account
    ///   3. owner (source owner/delegate)
    ///   4. extra_account_meta_list (validation account)
    ///   5+ extra accounts listed in extra_account_meta_list (blacklist_state)
    #[interface(spl_transfer_hook_interface::execute)]
    pub fn transfer_hook(ctx: Context<TransferHook>, _amount: u64) -> Result<()> {
        let blacklist = &ctx.accounts.blacklist_state;

        // Check sender — read owner from Token-2022 token account layout (owner at offset 32..64)
        let src_data = ctx.accounts.source_token_account.try_borrow_data()?;
        let src_owner =
            Pubkey::try_from(&src_data[32..64]).map_err(|_| error!(HookError::SenderBlacklisted))?;
        require!(
            !blacklist.is_blacklisted(&src_owner),
            HookError::SenderBlacklisted
        );

        // Check receiver
        let dst_data = ctx.accounts.destination_token_account.try_borrow_data()?;
        let dst_owner =
            Pubkey::try_from(&dst_data[32..64]).map_err(|_| error!(HookError::ReceiverBlacklisted))?;
        require!(
            !blacklist.is_blacklisted(&dst_owner),
            HookError::ReceiverBlacklisted
        );

        Ok(())
    }

    /// Initialize the ExtraAccountMetaList and the blacklist state.
    ///
    /// Must be called once after mint creation (SSS-2 preset) before any
    /// transfers can occur.
    ///
    /// This creates the canonical `extra_account_meta_list` PDA at seeds
    /// [b"extra-account-metas", mint] that Token-2022 looks up on every
    /// transfer to know which additional accounts to resolve and forward.
    ///
    /// We encode `blacklist_state` (seeds [b"blacklist-state", mint]) as the
    /// one extra account, using PDA seed derivation so Token-2022 can compute
    /// its address at transfer time without it being a fixed account.
    pub fn initialize_extra_account_meta_list(
        ctx: Context<InitializeExtraAccountMetaList>,
    ) -> Result<()> {
        // Build the extra account list:
        // We need blacklist_state PDA, seeds = [b"blacklist-state", mint (index 1)]
        // In the Execute instruction accounts:
        //   index 0 = source_token_account
        //   index 1 = mint
        //   index 2 = destination_token_account
        //   index 3 = owner
        //   index 4 = extra_account_meta_list (validation account itself)
        //   index 5+ = our extra accounts (blacklist_state)
        let account_metas = vec![ExtraAccountMeta::new_with_seeds(
            &[
                Seed::Literal {
                    bytes: b"blacklist-state".to_vec(),
                },
                Seed::AccountKey { index: 1 }, // mint is at index 1
            ],
            false, // is_signer
            false, // is_writable
        )?];

        // Calculate space required for the ExtraAccountMetaList TLV data
        let account_size = ExtraAccountMetaList::size_of(account_metas.len())? as u64;

        // Fund the extra_account_meta_list PDA
        let rent = Rent::get()?;
        let lamports = rent.minimum_balance(account_size as usize);

        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.authority.to_account_info(),
                    to: ctx.accounts.extra_account_meta_list.to_account_info(),
                },
            ),
            lamports,
        )?;

        // Allocate space
        {
            let extra_meta_info = ctx.accounts.extra_account_meta_list.to_account_info();
            extra_meta_info.realloc(account_size as usize, false)
                .map_err(|_| error!(HookError::SenderBlacklisted))?;
        }

        // Write the ExtraAccountMetaList data
        {
            let mut data = ctx
                .accounts
                .extra_account_meta_list
                .try_borrow_mut_data()?;
            ExtraAccountMetaList::init::<ExecuteInstruction>(&mut data, &account_metas)?;
        }

        // Initialize the blacklist state PDA
        let bl = &mut ctx.accounts.blacklist_state;
        bl.mint = ctx.accounts.mint.key();
        bl.authority = ctx.accounts.authority.key();
        bl.blacklisted = Vec::new();
        bl.bump = ctx.bumps.blacklist_state;

        msg!(
            "TransferHook initialized: mint={} extra_account_meta_list={}",
            ctx.accounts.mint.key(),
            ctx.accounts.extra_account_meta_list.key()
        );

        Ok(())
    }

    /// Add an address to the blacklist.
    pub fn blacklist_add(ctx: Context<ManageBlacklist>, address: Pubkey) -> Result<()> {
        let bl = &mut ctx.accounts.blacklist_state;
        if !bl.blacklisted.contains(&address) {
            bl.blacklisted.push(address);
        }
        msg!("Blacklisted {}", address);
        Ok(())
    }

    /// Remove an address from the blacklist.
    pub fn blacklist_remove(ctx: Context<ManageBlacklist>, address: Pubkey) -> Result<()> {
        let bl = &mut ctx.accounts.blacklist_state;
        bl.blacklisted.retain(|a| *a != address);
        msg!("Removed {} from blacklist", address);
        Ok(())
    }
}

#[error_code]
pub enum HookError {
    #[msg("Sender is blacklisted")]
    SenderBlacklisted,
    #[msg("Receiver is blacklisted")]
    ReceiverBlacklisted,
    #[msg("Unauthorized")]
    Unauthorized,
}

/// Blacklist state PDA for a given mint.
#[account]
pub struct BlacklistState {
    pub mint: Pubkey,
    pub authority: Pubkey,
    pub blacklisted: Vec<Pubkey>,
    pub bump: u8,
}

impl BlacklistState {
    pub const SEED: &'static [u8] = b"blacklist-state";

    pub fn is_blacklisted(&self, address: &Pubkey) -> bool {
        self.blacklisted.contains(address)
    }

    /// Space: discriminator(8) + mint(32) + authority(32) + vec_len(4) + 100*32 + u8(1)
    pub const INIT_SPACE: usize = 8 + 32 + 32 + 4 + (100 * 32) + 1;
}

/// Accounts for the transfer hook execute instruction.
///
/// MUST match Token-2022's expected layout for the Execute instruction:
///   0. source_token_account
///   1. mint
///   2. destination_token_account
///   3. owner (source owner/delegate)
///   4. extra_account_meta_list (validation account, passed by Token-2022)
///   5+ extra accounts listed in extra_account_meta_list (blacklist_state)
///
/// All of 0-4 are passed and validated by Token-2022 itself; we use
/// UncheckedAccount + CHECK comments as required by Anchor's safety linter.
#[derive(Accounts)]
pub struct TransferHook<'info> {
    /// CHECK: Source token account — Token-2022 validates this before calling hook
    pub source_token_account: UncheckedAccount<'info>,

    /// CHECK: Token-2022 mint — Token-2022 validates this before calling hook
    pub mint: UncheckedAccount<'info>,

    /// CHECK: Destination token account — Token-2022 validates this before calling hook
    pub destination_token_account: UncheckedAccount<'info>,

    /// CHECK: Owner/delegate of source account — Token-2022 validates this before calling hook
    pub owner: UncheckedAccount<'info>,

    /// CHECK: ExtraAccountMetaList PDA — contains the list of extra accounts for this hook
    #[account(
        seeds = [b"extra-account-metas", mint.key().as_ref()],
        bump,
    )]
    pub extra_account_meta_list: UncheckedAccount<'info>,

    /// Blacklist state — resolved by Token-2022 from extra_account_meta_list using PDA seeds
    #[account(
        seeds = [BlacklistState::SEED, mint.key().as_ref()],
        bump = blacklist_state.bump,
    )]
    pub blacklist_state: Account<'info, BlacklistState>,
}

/// Accounts for initializing the ExtraAccountMetaList and blacklist state.
#[derive(Accounts)]
pub struct InitializeExtraAccountMetaList<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    /// CHECK: The Token-2022 mint (already created by sss-token program)
    pub mint: UncheckedAccount<'info>,

    /// CHECK: The canonical extra-account-metas PDA that Token-2022 looks up on every transfer.
    /// We write ExtraAccountMetaList TLV data into it; no Anchor type validation needed.
    /// Seeds: [b"extra-account-metas", mint]
    #[account(
        mut,
        seeds = [b"extra-account-metas", mint.key().as_ref()],
        bump,
    )]
    pub extra_account_meta_list: UncheckedAccount<'info>,

    /// Blacklist state PDA — initialized here alongside the meta list.
    #[account(
        init,
        payer = authority,
        space = BlacklistState::INIT_SPACE,
        seeds = [BlacklistState::SEED, mint.key().as_ref()],
        bump,
    )]
    pub blacklist_state: Account<'info, BlacklistState>,

    pub system_program: Program<'info, System>,
}

/// Accounts for managing the blacklist.
#[derive(Accounts)]
pub struct ManageBlacklist<'info> {
    pub authority: Signer<'info>,

    /// CHECK: The Token-2022 mint
    pub mint: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [BlacklistState::SEED, mint.key().as_ref()],
        bump = blacklist_state.bump,
        constraint = blacklist_state.authority == authority.key() @ HookError::Unauthorized,
    )]
    pub blacklist_state: Account<'info, BlacklistState>,
}

use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;
use spl_token_2022::{
    extension::{
        transfer_hook::TransferHookAccount, BaseStateWithExtensions, StateWithExtensions,
    },
    state::Account as TokenAccountState,
};

use crate::constants::*;
use crate::error::BlacklistError;
use crate::state::{BlacklistEntry, Config};

#[derive(Accounts)]
pub struct TransferHook<'info> {
    /// CHECK: validated by parsing token state
    pub source_token: UncheckedAccount<'info>,

    pub mint: InterfaceAccount<'info, Mint>,

    /// CHECK: validated by parsing token state
    pub destination_token: UncheckedAccount<'info>,

    /// CHECK: source authority / delegate from token-2022
    pub authority: UncheckedAccount<'info>,

    /// CHECK: validation / extra-account-metas PDA
    #[account(
        seeds = [EXTRA_ACCOUNT_METAS_SEED, mint.key().as_ref()],
        bump
    )]
    pub extra_account_meta_list: UncheckedAccount<'info>,

    #[account(
        seeds = [CONFIG_SEED, mint.key().as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, Config>,

    /// CHECK: validated manually; missing account = not blacklisted
    pub source_blacklist: UncheckedAccount<'info>,

    /// CHECK: validated manually; missing account = not blacklisted
    pub destination_blacklist: UncheckedAccount<'info>,
}

pub fn transfer_hook(ctx: Context<TransferHook>, _amount: u64) -> Result<()> {
    let (expected_extra_account_meta_list, _) = Pubkey::find_program_address(
        &[EXTRA_ACCOUNT_METAS_SEED, ctx.accounts.mint.key().as_ref()],
        ctx.program_id,
    );

    require_keys_eq!(
        expected_extra_account_meta_list,
        ctx.accounts.extra_account_meta_list.key(),
        BlacklistError::InvalidExtraAccountMetaList
    );

    require_keys_eq!(
        ctx.accounts.config.mint,
        ctx.accounts.mint.key(),
        BlacklistError::MintMismatch
    );

    require!(!ctx.accounts.config.paused, BlacklistError::TransfersPaused);

    let source_data = ctx.accounts.source_token.try_borrow_data()?;
    let destination_data = ctx.accounts.destination_token.try_borrow_data()?;

    let source_state = StateWithExtensions::<TokenAccountState>::unpack(&source_data)
        .map_err(|_| error!(BlacklistError::InvalidTokenAccount))?;
    let destination_state = StateWithExtensions::<TokenAccountState>::unpack(&destination_data)
        .map_err(|_| error!(BlacklistError::InvalidTokenAccount))?;

    if let Ok(hook_ext) = source_state.get_extension::<TransferHookAccount>() {
        if !bool::from(hook_ext.transferring) {
            return err!(BlacklistError::NotTransferring);
        }
    } else {
        return err!(BlacklistError::NotTransferring);
    }

    require_keys_eq!(
        source_state.base.mint,
        ctx.accounts.mint.key(),
        BlacklistError::MintMismatch
    );
    require_keys_eq!(
        destination_state.base.mint,
        ctx.accounts.mint.key(),
        BlacklistError::MintMismatch
    );

    let source_owner = source_state.base.owner;
    let destination_owner = destination_state.base.owner;

    let (expected_source_blacklist, _) = Pubkey::find_program_address(
        &[
            BLACKLIST_SEED,
            ctx.accounts.mint.key().as_ref(),
            source_owner.as_ref(),
        ],
        ctx.program_id,
    );
    let (expected_destination_blacklist, _) = Pubkey::find_program_address(
        &[
            BLACKLIST_SEED,
            ctx.accounts.mint.key().as_ref(),
            destination_owner.as_ref(),
        ],
        ctx.program_id,
    );

    require_keys_eq!(
        expected_source_blacklist,
        ctx.accounts.source_blacklist.key(),
        BlacklistError::InvalidBlacklistAccount
    );
    require_keys_eq!(
        expected_destination_blacklist,
        ctx.accounts.destination_blacklist.key(),
        BlacklistError::InvalidBlacklistAccount
    );

    if is_blacklisted(&ctx.accounts.source_blacklist)? {
        return err!(BlacklistError::SenderBlacklisted);
    }

    if is_blacklisted(&ctx.accounts.destination_blacklist)? {
        return err!(BlacklistError::RecipientBlacklisted);
    }

    Ok(())
}

/// Missing or empty accounts are treated as "not blacklisted", so wallets that
/// were never added to (or removed+closed from) the blacklist can still transfer.
pub fn is_blacklisted(account_info: &AccountInfo) -> Result<bool> {
    if account_info.data_is_empty() || account_info.owner != &crate::ID {
        return Ok(false);
    }
    let mut data: &[u8] = &account_info.try_borrow_data()?;
    match BlacklistEntry::try_deserialize(&mut data) {
        Ok(entry) => Ok(entry.blocked),
        Err(_) => Ok(false),
    }
}

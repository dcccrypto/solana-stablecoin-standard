use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;
use spl_tlv_account_resolution::{account::ExtraAccountMeta, state::ExtraAccountMetaList};
use spl_transfer_hook_interface::instruction::{ExecuteInstruction, TransferHookInstruction};
use spl_token_2022::{
    extension::{
        transfer_hook::TransferHookAccount, BaseStateWithExtensions, StateWithExtensions,
    },
    state::Account as TokenAccountState,
};

declare_id!("84rPjkmmoP3oYZVxjtL2rdcT6hC5Rts6N5XzJTFcJEk6");

const CONFIG_SEED: &[u8] = b"config";
const BLACKLIST_SEED: &[u8] = b"blacklist";
const EXTRA_ACCOUNT_METAS_SEED: &[u8] = b"extra-account-metas";

#[program]
pub mod blacklist_hook {
    use super::*;

    pub fn initialize_config(ctx: Context<InitializeConfig>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.admin = ctx.accounts.admin.key();
        config.pending_admin = None;
        config.mint = ctx.accounts.mint.key();
        config.bump = ctx.bumps.config;

        emit!(ConfigInitialized {
            config: ctx.accounts.config.key(),
            admin: ctx.accounts.admin.key(),
            mint: ctx.accounts.mint.key(),
        });

        Ok(())
    }

    pub fn initialize_extra_account_meta_list(
        ctx: Context<InitializeExtraAccountMetaList>,
    ) -> Result<()> {
        let metas = vec![
            // config PDA = ["config", mint]
            ExtraAccountMeta::new_with_seeds(
                &[
                    spl_tlv_account_resolution::seeds::Seed::Literal {
                        bytes: CONFIG_SEED.to_vec(),
                    },
                    spl_tlv_account_resolution::seeds::Seed::AccountKey { index: 1 },
                ],
                false,
                false,
            )?,
            // source blacklist = ["blacklist", mint, source_token.owner]
            ExtraAccountMeta::new_with_seeds(
                &[
                    spl_tlv_account_resolution::seeds::Seed::Literal {
                        bytes: BLACKLIST_SEED.to_vec(),
                    },
                    spl_tlv_account_resolution::seeds::Seed::AccountKey { index: 1 },
                    spl_tlv_account_resolution::seeds::Seed::AccountData {
                        account_index: 0,
                        data_index: 32,
                        length: 32,
                    },
                ],
                false,
                false,
            )?,
            // destination blacklist = ["blacklist", mint, destination_token.owner]
            ExtraAccountMeta::new_with_seeds(
                &[
                    spl_tlv_account_resolution::seeds::Seed::Literal {
                        bytes: BLACKLIST_SEED.to_vec(),
                    },
                    spl_tlv_account_resolution::seeds::Seed::AccountKey { index: 1 },
                    spl_tlv_account_resolution::seeds::Seed::AccountData {
                        account_index: 2,
                        data_index: 32,
                        length: 32,
                    },
                ],
                false,
                false,
            )?,
        ];

        let mut data = ctx
            .accounts
            .extra_account_meta_list
            .try_borrow_mut_data()?;

        ExtraAccountMetaList::init::<ExecuteInstruction>(&mut data, &metas)?;
        Ok(())
    }

    pub fn add_to_blacklist(ctx: Context<SetBlacklist>, wallet: Pubkey, reason: String) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.admin.key(),
            ctx.accounts.config.admin,
            BlacklistError::Unauthorized
        );
        require_keys_eq!(
            ctx.accounts.config.mint,
            ctx.accounts.mint.key(),
            BlacklistError::MintMismatch
        );

        let entry = &mut ctx.accounts.blacklist_entry;
        entry.wallet = wallet;
        entry.mint = ctx.accounts.mint.key();
        entry.blocked = true;
        entry.reason = reason.clone();
        entry.bump = ctx.bumps.blacklist_entry;

        emit!(WalletBlacklisted {
            mint: ctx.accounts.mint.key(),
            wallet,
            authority: ctx.accounts.admin.key(),
            reason,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    pub fn remove_from_blacklist(ctx: Context<SetBlacklist>, wallet: Pubkey) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.admin.key(),
            ctx.accounts.config.admin,
            BlacklistError::Unauthorized
        );
        require_keys_eq!(
            ctx.accounts.config.mint,
            ctx.accounts.mint.key(),
            BlacklistError::MintMismatch
        );

        let entry = &mut ctx.accounts.blacklist_entry;
        entry.wallet = wallet;
        entry.mint = ctx.accounts.mint.key();
        entry.blocked = false;
        entry.bump = ctx.bumps.blacklist_entry;

        emit!(WalletUnblacklisted {
            mint: ctx.accounts.mint.key(),
            wallet,
            authority: ctx.accounts.admin.key(),
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    pub fn close_blacklist_entry(
        ctx: Context<CloseBlacklistEntry>,
        _wallet: Pubkey,
    ) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.admin.key(),
            ctx.accounts.config.admin,
            BlacklistError::Unauthorized
        );
        require!(
            !ctx.accounts.blacklist_entry.blocked,
            BlacklistError::CannotCloseBlockedEntry
        );

        emit!(BlacklistEntryClosed {
            mint: ctx.accounts.mint.key(),
            wallet: ctx.accounts.blacklist_entry.wallet,
            authority: ctx.accounts.admin.key(),
        });

        Ok(())
    }

    pub fn transfer_admin(ctx: Context<TransferAdmin>, new_admin: Pubkey) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.admin.key(),
            ctx.accounts.config.admin,
            BlacklistError::Unauthorized
        );

        let config = &mut ctx.accounts.config;
        config.pending_admin = Some(new_admin);

        emit!(AdminTransferNominated {
            config: ctx.accounts.config.key(),
            current_admin: ctx.accounts.admin.key(),
            pending_admin: new_admin,
        });

        Ok(())
    }

    pub fn accept_admin(ctx: Context<AcceptAdmin>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        let pending = config
            .pending_admin
            .ok_or(error!(BlacklistError::NoPendingAdmin))?;

        require_keys_eq!(
            ctx.accounts.new_admin.key(),
            pending,
            BlacklistError::Unauthorized
        );

        let previous = config.admin;
        config.admin = ctx.accounts.new_admin.key();
        config.pending_admin = None;

        emit!(AdminTransferred {
            config: ctx.accounts.config.key(),
            previous_admin: previous,
            new_admin: ctx.accounts.new_admin.key(),
        });

        Ok(())
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

        let source_data = ctx.accounts.source_token.try_borrow_data()?;
        let destination_data = ctx.accounts.destination_token.try_borrow_data()?;

        let source_state = StateWithExtensions::<TokenAccountState>::unpack(&source_data)
            .map_err(|_| error!(BlacklistError::InvalidTokenAccount))?;
        let destination_state = StateWithExtensions::<TokenAccountState>::unpack(&destination_data)
            .map_err(|_| error!(BlacklistError::InvalidTokenAccount))?;

        // Prevent direct invocation: verify token account is mid-transfer
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

        // Verify PDA derivation (per-mint scoping)
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

/// Missing or empty accounts are treated as "not blacklisted", so wallets that
/// were never added to (or removed+closed from) the blacklist can still transfer.
fn is_blacklisted(account_info: &AccountInfo) -> Result<bool> {
    if account_info.data_is_empty() || account_info.owner != &crate::ID {
        return Ok(false);
    }
    let mut data: &[u8] = &account_info.try_borrow_data()?;
    match BlacklistEntry::try_deserialize(&mut data) {
        Ok(entry) => Ok(entry.blocked),
        Err(_) => Ok(false),
    }
}

// ─── Account contexts ────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        init,
        payer = admin,
        space = 8 + Config::INIT_SPACE,
        seeds = [CONFIG_SEED, mint.key().as_ref()],
        bump
    )]
    pub config: Account<'info, Config>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitializeExtraAccountMetaList<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        seeds = [CONFIG_SEED, mint.key().as_ref()],
        bump = config.bump,
        constraint = config.mint == mint.key() @ BlacklistError::MintMismatch,
    )]
    pub config: Account<'info, Config>,

    #[account(
        init,
        payer = payer,
        seeds = [EXTRA_ACCOUNT_METAS_SEED, mint.key().as_ref()],
        bump,
        space = 8 + 256
    )]
    /// CHECK: raw TLV account
    pub extra_account_meta_list: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(wallet: Pubkey)]
pub struct SetBlacklist<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        seeds = [CONFIG_SEED, mint.key().as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, Config>,

    #[account(
        init_if_needed,
        payer = admin,
        space = 8 + BlacklistEntry::INIT_SPACE,
        seeds = [BLACKLIST_SEED, mint.key().as_ref(), wallet.as_ref()],
        bump
    )]
    pub blacklist_entry: Account<'info, BlacklistEntry>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(wallet: Pubkey)]
pub struct CloseBlacklistEntry<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        seeds = [CONFIG_SEED, mint.key().as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, Config>,

    #[account(
        mut,
        close = admin,
        seeds = [BLACKLIST_SEED, mint.key().as_ref(), wallet.as_ref()],
        bump = blacklist_entry.bump,
    )]
    pub blacklist_entry: Account<'info, BlacklistEntry>,
}

#[derive(Accounts)]
pub struct TransferAdmin<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [CONFIG_SEED, mint.key().as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, Config>,
}

#[derive(Accounts)]
pub struct AcceptAdmin<'info> {
    pub new_admin: Signer<'info>,

    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [CONFIG_SEED, mint.key().as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, Config>,
}

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

// ─── Account state ───────────────────────────────────────────────────────────

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    pub pending_admin: Option<Pubkey>,
    pub mint: Pubkey,
    pub bump: u8,
    pub _reserved: [u8; 64],
}

#[account]
#[derive(InitSpace)]
pub struct BlacklistEntry {
    pub wallet: Pubkey,
    pub mint: Pubkey,
    pub blocked: bool,
    #[max_len(128)]
    pub reason: String,
    pub bump: u8,
    pub _reserved: [u8; 32],
}

// ─── Events ──────────────────────────────────────────────────────────────────

#[event]
pub struct ConfigInitialized {
    pub config: Pubkey,
    pub admin: Pubkey,
    pub mint: Pubkey,
}

#[event]
pub struct WalletBlacklisted {
    pub mint: Pubkey,
    pub wallet: Pubkey,
    pub authority: Pubkey,
    pub reason: String,
    pub timestamp: i64,
}

#[event]
pub struct WalletUnblacklisted {
    pub mint: Pubkey,
    pub wallet: Pubkey,
    pub authority: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct BlacklistEntryClosed {
    pub mint: Pubkey,
    pub wallet: Pubkey,
    pub authority: Pubkey,
}

#[event]
pub struct AdminTransferNominated {
    pub config: Pubkey,
    pub current_admin: Pubkey,
    pub pending_admin: Pubkey,
}

#[event]
pub struct AdminTransferred {
    pub config: Pubkey,
    pub previous_admin: Pubkey,
    pub new_admin: Pubkey,
}

// ─── Error codes (6000+, aligned with vault standard) ────────────────────────

#[error_code]
pub enum BlacklistError {
    #[msg("Unauthorized — caller is not the admin")]
    Unauthorized = 6000,
    #[msg("Sender wallet is blacklisted")]
    SenderBlacklisted = 6001,
    #[msg("Recipient wallet is blacklisted")]
    RecipientBlacklisted = 6002,
    #[msg("Mint mismatch")]
    MintMismatch = 6003,
    #[msg("Invalid token account data")]
    InvalidTokenAccount = 6004,
    #[msg("Invalid blacklist account")]
    InvalidBlacklistAccount = 6005,
    #[msg("Invalid extra account meta list")]
    InvalidExtraAccountMetaList = 6006,
    #[msg("Transfer hook invoked outside of a token transfer")]
    NotTransferring = 6007,
    #[msg("No pending admin nomination to accept")]
    NoPendingAdmin = 6008,
    #[msg("Cannot close a blacklist entry that is still blocked")]
    CannotCloseBlockedEntry = 6009,
}

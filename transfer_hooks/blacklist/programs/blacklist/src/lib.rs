use anchor_lang::prelude::*;
use spl_token::state::Account as SplTokenAccount;

declare_id!("6HNhRDkViEECPf9sE6bePXePaJQjVN8PJG2v2zbetosY");

/// This program maintains a simple, authority-controlled blacklist,
/// where each blacklisted entry is keyed by the blacklisted account.
/// A later transfer-hook program will consult these entries to block
/// transfers involving blacklisted accounts.
#[program]
pub mod blacklist {
    use super::*;

    /// Initializes the blacklist configuration and sets the authority
    /// that can add / remove accounts from the blacklist.
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.authority = ctx.accounts.authority.key();
        Ok(())
    }

    /// Add an account to the blacklist. Only the configured authority
    /// may call this instruction.
    pub fn blacklist_account(ctx: Context<BlacklistAccount>) -> Result<()> {
        let config = &ctx.accounts.config;
        require_keys_eq!(
            config.authority,
            ctx.accounts.authority.key(),
            BlacklistError::Unauthorized
        );

        let entry = &mut ctx.accounts.entry;
        entry.account = ctx.accounts.account_to_blacklist.key();
        Ok(())
    }

    /// Remove an account from the blacklist. Only the configured authority
    /// may call this instruction.
    pub fn unblacklist_account(ctx: Context<UnblacklistAccount>) -> Result<()> {
        let config = &ctx.accounts.config;
        require_keys_eq!(
            config.authority,
            ctx.accounts.authority.key(),
            BlacklistError::Unauthorized
        );

        // The `entry` account is closed automatically by Anchor via
        // the `close = authority` constraint on the context.
        Ok(())
    }

    /// Hook-style execute entrypoint used by a transfer hook to check
    /// if either the source or destination owner is blacklisted.
    pub fn execute(ctx: Context<Execute>) -> Result<()> {
        let source_data = ctx.accounts.source.try_borrow_data()?;
        let dest_data = ctx.accounts.destination.try_borrow_data()?;

        let source_token = SplTokenAccount::unpack_from_slice(&source_data)
            .map_err(|_| error!(BlacklistError::Unauthorized))?;
        let dest_token = SplTokenAccount::unpack_from_slice(&dest_data)
            .map_err(|_| error!(BlacklistError::Unauthorized))?;

        let owners = [source_token.owner, dest_token.owner];
        for owner in owners {
            let (pda, _) =
                Pubkey::find_program_address(&[b"blacklist", owner.as_ref()], &crate::ID);
            if ctx
                .remaining_accounts
                .iter()
                .any(|ai| *ai.key == pda && !ai.data_is_empty())
            {
                return err!(BlacklistError::Blacklisted);
            }
        }
        Ok(())
    }
}

/// Global configuration: stores the authority allowed to manage the blacklist.
#[account]
pub struct Config {
    pub authority: Pubkey,
}

/// Blacklist entry: one per blacklisted account.
#[account]
pub struct BlacklistEntry {
    pub account: Pubkey,
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    /// The authority that will be allowed to manage the blacklist.
    #[account(mut)]
    pub authority: Signer<'info>,

    /// PDA that stores the global config for this program.
    #[account(
        init,
        payer = authority,
        space = 8 + 32,
        seeds = [b"config"],
        bump,
    )]
    pub config: Account<'info, Config>,

    pub system_program: Program<'info, System>,
}

/// Context for adding an account to the blacklist.
#[derive(Accounts)]
pub struct BlacklistAccount<'info> {
    /// Global config, used to check the authority.
    #[account(
        seeds = [b"config"],
        bump,
    )]
    pub config: Account<'info, Config>,

    /// Authority that is allowed to modify the blacklist.
    #[account(mut)]
    pub authority: Signer<'info>,

    /// The account to blacklist.
    /// CHECK: we only use the pubkey.
    pub account_to_blacklist: UncheckedAccount<'info>,

    /// PDA that stores the blacklist entry for `account_to_blacklist`.
    #[account(
        init,
        payer = authority,
        space = 8 + 32,
        seeds = [b"blacklist", account_to_blacklist.key().as_ref()],
        bump,
    )]
    pub entry: Account<'info, BlacklistEntry>,

    pub system_program: Program<'info, System>,
}

/// Context for removing an account from the blacklist.
#[derive(Accounts)]
pub struct UnblacklistAccount<'info> {
    /// Global config, used to check the authority.
    #[account(
        seeds = [b"config"],
        bump,
    )]
    pub config: Account<'info, Config>,

    /// Authority that is allowed to modify the blacklist.
    #[account(mut)]
    pub authority: Signer<'info>,

    /// The account to unblacklist.
    /// CHECK: we only use the pubkey.
    pub account_to_blacklist: UncheckedAccount<'info>,

    /// PDA that stores the blacklist entry for `account_to_blacklist`.
    #[account(
        mut,
        close = authority,
        seeds = [b"blacklist", account_to_blacklist.key().as_ref()],
        bump,
    )]
    pub entry: Account<'info, BlacklistEntry>,

    pub system_program: Program<'info, System>,
}

#[error_code]
pub enum BlacklistError {
    #[msg("Caller is not authorized to modify the blacklist")]
    Unauthorized,

    #[msg("Transfer involves a blacklisted account")]
    Blacklisted,
}

/// Hook-style execute entrypoint.
/// In a real Token-2022 TransferHook setup, the token program would pass
/// the source and destination token accounts and any extra PDAs required
/// by the hook (such as blacklist entries) as remaining accounts.
#[derive(Accounts)]
pub struct Execute<'info> {
    /// Source token account of the transfer.
    /// CHECK: validated as token accounts in the handler.
    pub source: UncheckedAccount<'info>,
    /// Destination token account of the transfer.
    /// CHECK: validated as token accounts in the handler.
    pub destination: UncheckedAccount<'info>,
}

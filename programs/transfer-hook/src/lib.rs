use anchor_lang::prelude::*;

declare_id!("phAtzRyRUJGpMC3ftAtWzoaX7UkghRe9x5KTig8jPQp");

/// SSS-2 Transfer Hook — enforces blacklist on every token transfer.
///
/// This program is invoked by Token-2022 on every transfer for mints
/// that have registered this as their transfer hook.
#[program]
pub mod sss_transfer_hook {
    use super::*;

    /// Called by Token-2022 on every transfer.
    /// Checks that neither sender nor receiver is on the blacklist.
    pub fn transfer_hook(ctx: Context<TransferHook>, amount: u64) -> Result<()> {
        let blacklist = &ctx.accounts.blacklist_state;
        // Check sender
        // Parse owner from source token account data (Token-2022 layout: owner is at offset 32)
        let src_data = ctx.accounts.source_token_account.try_borrow_data()?;
        let src_owner = Pubkey::try_from(&src_data[32..64]).map_err(|_| error!(HookError::SenderBlacklisted))?;
        require!(
            !blacklist.is_blacklisted(&src_owner),
            HookError::SenderBlacklisted
        );
        // Check receiver
        let dst_data = ctx.accounts.destination_token_account.try_borrow_data()?;
        let dst_owner = Pubkey::try_from(&dst_data[32..64]).map_err(|_| error!(HookError::ReceiverBlacklisted))?;
        require!(
            !blacklist.is_blacklisted(&dst_owner),
            HookError::ReceiverBlacklisted
        );
        msg!("Transfer hook: {} tokens OK", amount);
        Ok(())
    }

    /// Initialize blacklist state PDA for a given mint.
    pub fn initialize_extra_account_meta_list(
        ctx: Context<InitializeExtraAccountMetaList>,
    ) -> Result<()> {
        ctx.accounts.blacklist_state.mint = ctx.accounts.mint.key();
        ctx.accounts.blacklist_state.authority = ctx.accounts.authority.key();
        ctx.accounts.blacklist_state.blacklisted = Vec::new();
        ctx.accounts.blacklist_state.bump = ctx.bumps.blacklist_state;
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

// Simplified token account stub for hook context (Token-2022 passes these)
#[derive(Accounts)]
pub struct TransferHook<'info> {
    /// CHECK: Source token account (Token-2022 validates)
    pub source_token_account: AccountInfo<'info>,
    /// CHECK: Mint (Token-2022 validates)
    pub mint: AccountInfo<'info>,
    /// CHECK: Destination token account (Token-2022 validates)
    pub destination_token_account: AccountInfo<'info>,
    /// CHECK: Owner of source (Token-2022 validates)
    pub owner: AccountInfo<'info>,

    #[account(
        seeds = [BlacklistState::SEED, mint.key().as_ref()],
        bump = blacklist_state.bump,
    )]
    pub blacklist_state: Account<'info, BlacklistState>,
}

#[derive(Accounts)]
pub struct InitializeExtraAccountMetaList<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    /// CHECK: The Token-2022 mint
    pub mint: AccountInfo<'info>,

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

#[derive(Accounts)]
pub struct ManageBlacklist<'info> {
    pub authority: Signer<'info>,

    /// CHECK: The Token-2022 mint
    pub mint: AccountInfo<'info>,

    #[account(
        mut,
        seeds = [BlacklistState::SEED, mint.key().as_ref()],
        bump = blacklist_state.bump,
        constraint = blacklist_state.authority == authority.key() @ HookError::Unauthorized,
    )]
    pub blacklist_state: Account<'info, BlacklistState>,
}

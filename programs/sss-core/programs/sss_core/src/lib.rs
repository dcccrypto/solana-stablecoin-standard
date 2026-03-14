use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};
use spl_token_2022::instruction::AuthorityType;
use spl_token_metadata_interface::instruction::update_field;

declare_id!("4ZFzYcNVDSew79hSAVRdtDuMqe9g4vYh7CFvitPSy5DD");

// ── Seeds & Constants ────────────────────────────────────────────────

pub const CONFIG_SEED: &[u8] = b"sss-config";
pub const ROLE_SEED: &[u8] = b"role";
pub const MINTER_INFO_SEED: &[u8] = b"minter";

pub const ROLE_MINTER: u8 = 0;
pub const ROLE_BURNER: u8 = 1;
pub const ROLE_FREEZER: u8 = 2;
pub const ROLE_PAUSER: u8 = 3;
pub const ROLE_BLACKLISTER: u8 = 4;
pub const ROLE_SEIZER: u8 = 5;
pub const ROLE_ATTESTOR: u8 = 6;
pub const ROLE_MAX: u8 = 6;

pub const RESERVE_SEED: &[u8] = b"reserve";

pub const PRESET_SSS1: u8 = 1;
pub const PRESET_SSS2: u8 = 2;

// ── Errors ───────────────────────────────────────────────────────────

#[error_code]
pub enum SssError {
    #[msg("Operation is paused")]
    Paused = 6000,
    #[msg("Unauthorized: missing required role")]
    Unauthorized = 6001,
    #[msg("Invalid role identifier")]
    InvalidRole = 6002,
    #[msg("Minter quota exceeded")]
    QuotaExceeded = 6003,
    #[msg("Supply cap would be exceeded")]
    SupplyCapExceeded = 6004,
    #[msg("Math overflow")]
    MathOverflow = 6005,
    #[msg("No pending authority nomination")]
    NoPendingAuthority = 6006,
    #[msg("Pending authority mismatch")]
    PendingAuthorityMismatch = 6007,
    #[msg("Already paused")]
    AlreadyPaused = 6008,
    #[msg("Not paused")]
    NotPaused = 6009,
    #[msg("Token account is not frozen")]
    AccountNotFrozen = 6010,
    #[msg("Token account is frozen")]
    AccountFrozen = 6011,
    #[msg("Minter is not active")]
    MinterNotActive = 6012,
    #[msg("Invalid preset value")]
    InvalidPreset = 6013,
    #[msg("Recipient is blacklisted")]
    RecipientBlacklisted = 6014,
    #[msg("Invalid metadata field")]
    InvalidMetadataField = 6015,
    #[msg("Compliance not enabled")]
    ComplianceNotEnabled = 6016,
    #[msg("Amount must be greater than zero")]
    ZeroAmount = 6017,
    #[msg("Transfer hook program not set")]
    HookProgramNotSet = 6018,
}

// ── Events ───────────────────────────────────────────────────────────

#[event]
pub struct ConfigInitialized {
    pub config: Pubkey,
    pub mint: Pubkey,
    pub authority: Pubkey,
    pub preset: u8,
    pub supply_cap: Option<u64>,
}

#[event]
pub struct TokensMinted {
    pub config: Pubkey,
    pub mint: Pubkey,
    pub minter: Pubkey,
    pub recipient: Pubkey,
    pub amount: u64,
    pub total_minted: u64,
}

#[event]
pub struct TokensBurned {
    pub config: Pubkey,
    pub mint: Pubkey,
    pub burner: Pubkey,
    pub amount: u64,
    pub total_burned: u64,
}

#[event]
pub struct StablecoinPaused {
    pub config: Pubkey,
    pub authority: Pubkey,
}

#[event]
pub struct StablecoinUnpaused {
    pub config: Pubkey,
    pub authority: Pubkey,
}

#[event]
pub struct RoleGranted {
    pub config: Pubkey,
    pub authority: Pubkey,
    pub grantee: Pubkey,
    pub role: u8,
}

#[event]
pub struct RoleRevoked {
    pub config: Pubkey,
    pub authority: Pubkey,
    pub grantee: Pubkey,
    pub role: u8,
}

#[event]
pub struct MinterQuotaSet {
    pub config: Pubkey,
    pub minter: Pubkey,
    pub quota: u64,
}

#[event]
pub struct AuthorityNominated {
    pub config: Pubkey,
    pub current_authority: Pubkey,
    pub pending_authority: Pubkey,
}

#[event]
pub struct AuthorityTransferred {
    pub config: Pubkey,
    pub old_authority: Pubkey,
    pub new_authority: Pubkey,
}

#[event]
pub struct TokensSeized {
    pub config: Pubkey,
    pub mint: Pubkey,
    pub seizer: Pubkey,
    pub from: Pubkey,
    pub treasury: Pubkey,
    pub amount: u64,
    pub total_seized: u64,
}

#[event]
pub struct TokenAccountFrozen {
    pub config: Pubkey,
    pub mint: Pubkey,
    pub freezer: Pubkey,
    pub target: Pubkey,
}

#[event]
pub struct TokenAccountThawed {
    pub config: Pubkey,
    pub mint: Pubkey,
    pub freezer: Pubkey,
    pub target: Pubkey,
}

#[event]
pub struct ReserveAttested {
    pub config: Pubkey,
    pub attestor: Pubkey,
    pub reserve_amount: u64,
    pub source: String,
    pub uri: String,
    pub timestamp: i64,
}

#[event]
pub struct MetadataUpdated {
    pub config: Pubkey,
    pub mint: Pubkey,
    pub authority: Pubkey,
    pub field: String,
    pub value: String,
}

#[event]
pub struct ComplianceToggled {
    pub config: Pubkey,
    pub authority: Pubkey,
    pub enabled: bool,
}

#[event]
pub struct TokensBurnedFrom {
    pub config: Pubkey,
    pub mint: Pubkey,
    pub burner: Pubkey,
    pub target: Pubkey,
    pub amount: u64,
    pub total_burned: u64,
}

// ── State ────────────────────────────────────────────────────────────

#[account]
#[derive(InitSpace)]
pub struct StablecoinConfig {
    pub authority: Pubkey,
    pub pending_authority: Option<Pubkey>,
    pub mint: Pubkey,
    pub transfer_hook_program: Option<Pubkey>,
    pub preset: u8,
    pub paused: bool,
    pub compliance_enabled: bool,
    pub total_minted: u64,
    pub total_burned: u64,
    pub total_seized: u64,
    pub supply_cap: Option<u64>,
    pub bump: u8,
    pub _reserved: [u8; 22],
}

#[account]
#[derive(InitSpace)]
pub struct RoleEntry {
    pub config: Pubkey,
    pub authority: Pubkey,
    pub role: u8,
    pub granted_at: i64,
    pub granted_by: Pubkey,
    pub bump: u8,
    pub _reserved: [u8; 32],
}

#[account]
#[derive(InitSpace)]
pub struct MinterInfo {
    pub config: Pubkey,
    pub minter: Pubkey,
    pub quota: u64,
    pub total_minted: u64,
    pub is_active: bool,
    pub bump: u8,
    pub _reserved: [u8; 32],
}

#[account]
#[derive(InitSpace)]
pub struct ReserveAttestation {
    pub config: Pubkey,
    pub attestor: Pubkey,
    pub reserve_amount: u64,
    #[max_len(128)]
    pub source: String,
    #[max_len(256)]
    pub uri: String,
    pub timestamp: i64,
    pub bump: u8,
    pub _reserved: [u8; 32],
}

// ── Instruction params ───────────────────────────────────────────────

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct InitializeParams {
    pub preset: u8,
    pub supply_cap: Option<u64>,
    pub compliance_enabled: bool,
    pub transfer_hook_program: Option<Pubkey>,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct UpdateMetadataParams {
    pub field: String,
    pub value: String,
}

#[derive(AnchorSerialize, AnchorDeserialize)]
pub struct AttestReserveParams {
    pub reserve_amount: u64,
    pub source: String,
    pub uri: String,
}

// ── Program ──────────────────────────────────────────────────────────

#[program]
pub mod sss_core {
    use super::*;

    /// Create config PDA and transfer mint + freeze authority to it.
    pub fn initialize(ctx: Context<Initialize>, params: InitializeParams) -> Result<()> {
        require!(
            params.preset == PRESET_SSS1 || params.preset == PRESET_SSS2,
            SssError::InvalidPreset
        );

        let config = &mut ctx.accounts.config;
        config.authority = ctx.accounts.authority.key();
        config.pending_authority = None;
        config.mint = ctx.accounts.mint.key();
        config.transfer_hook_program = params.transfer_hook_program;
        config.preset = params.preset;
        config.paused = false;
        config.compliance_enabled = params.compliance_enabled;
        config.total_minted = 0;
        config.total_burned = 0;
        config.total_seized = 0;
        config.supply_cap = params.supply_cap;
        config.bump = ctx.bumps.config;
        config._reserved = [0u8; 22];

        let cpi_program = ctx.accounts.token_program.to_account_info();

        // Transfer mint authority → config PDA
        let ix = spl_token_2022::instruction::set_authority(
            cpi_program.key,
            &ctx.accounts.mint.key(),
            Some(&config.key()),
            AuthorityType::MintTokens,
            &ctx.accounts.authority.key(),
            &[],
        )?;
        anchor_lang::solana_program::program::invoke(
            &ix,
            &[
                ctx.accounts.mint.to_account_info(),
                ctx.accounts.authority.to_account_info(),
            ],
        )?;

        // Transfer freeze authority → config PDA (if present)
        if ctx.accounts.mint.freeze_authority.is_some() {
            let freeze_ix = spl_token_2022::instruction::set_authority(
                cpi_program.key,
                &ctx.accounts.mint.key(),
                Some(&config.key()),
                AuthorityType::FreezeAccount,
                &ctx.accounts.authority.key(),
                &[],
            )?;
            anchor_lang::solana_program::program::invoke(
                &freeze_ix,
                &[
                    ctx.accounts.mint.to_account_info(),
                    ctx.accounts.authority.to_account_info(),
                ],
            )?;
        }

        emit!(ConfigInitialized {
            config: config.key(),
            mint: config.mint,
            authority: config.authority,
            preset: config.preset,
            supply_cap: config.supply_cap,
        });

        Ok(())
    }

    /// Admin grants a role to a wallet. Creates a PDA per (config, wallet, role).
    pub fn grant_role(ctx: Context<GrantRole>, role: u8) -> Result<()> {
        require!(role <= ROLE_MAX, SssError::InvalidRole);

        let entry = &mut ctx.accounts.role_entry;
        entry.config = ctx.accounts.config.key();
        entry.authority = ctx.accounts.grantee.key();
        entry.role = role;
        entry.granted_at = Clock::get()?.unix_timestamp;
        entry.granted_by = ctx.accounts.authority.key();
        entry.bump = ctx.bumps.role_entry;
        entry._reserved = [0u8; 32];

        emit!(RoleGranted {
            config: ctx.accounts.config.key(),
            authority: ctx.accounts.authority.key(),
            grantee: ctx.accounts.grantee.key(),
            role,
        });

        Ok(())
    }

    /// Admin revokes a role (closes the PDA, reclaims rent).
    pub fn revoke_role(ctx: Context<RevokeRole>, role: u8) -> Result<()> {
        require!(role <= ROLE_MAX, SssError::InvalidRole);

        emit!(RoleRevoked {
            config: ctx.accounts.config.key(),
            authority: ctx.accounts.authority.key(),
            grantee: ctx.accounts.grantee.key(),
            role,
        });

        Ok(())
    }

    /// Admin sets (or creates) a minter quota.
    pub fn set_minter_quota(ctx: Context<SetMinterQuota>, quota: u64) -> Result<()> {
        let info = &mut ctx.accounts.minter_info;

        if info.config == Pubkey::default() {
            info.config = ctx.accounts.config.key();
            info.minter = ctx.accounts.minter.key();
            info.total_minted = 0;
            info.is_active = true;
            info._reserved = [0u8; 32];
        }

        info.quota = quota;
        info.is_active = true;
        info.bump = ctx.bumps.minter_info;

        emit!(MinterQuotaSet {
            config: ctx.accounts.config.key(),
            minter: ctx.accounts.minter.key(),
            quota,
        });

        Ok(())
    }

    /// Mint tokens. Requires ROLE_MINTER + an active minter-info with quota.
    /// For SSS-2 (preset=2), pass the recipient's blacklist entry PDA as the
    /// first remaining account. If the entry exists and is blocked, mint is rejected.
    pub fn mint_tokens(ctx: Context<MintTokens>, amount: u64) -> Result<()> {
        require!(amount > 0, SssError::ZeroAmount);
        let config = &ctx.accounts.config;
        require!(!config.paused, SssError::Paused);
        require!(ctx.accounts.minter_info.is_active, SssError::MinterNotActive);

        #[cfg(feature = "compliance")]
        if config.compliance_enabled {
            let bl_account = &ctx.accounts.recipient_blacklist_entry;
            if !bl_account.data_is_empty() && bl_account.data_len() >= 8 + 32 + 32 + 1 {
                let data = bl_account.try_borrow_data()?;
                let blocked = data[8 + 32 + 32] != 0;
                require!(!blocked, SssError::RecipientBlacklisted);
            }
        }

        #[cfg(feature = "quotas")]
        {
            let remaining_quota = ctx.accounts.minter_info.quota
                .checked_sub(ctx.accounts.minter_info.total_minted)
                .ok_or(error!(SssError::MathOverflow))?;
            require!(amount <= remaining_quota, SssError::QuotaExceeded);
        }

        #[cfg(feature = "supply-cap")]
        if let Some(cap) = config.supply_cap {
            let net_supply = config.total_minted
                .checked_sub(config.total_burned)
                .ok_or(error!(SssError::MathOverflow))?;
            let new_net = net_supply
                .checked_add(amount)
                .ok_or(error!(SssError::MathOverflow))?;
            require!(new_net <= cap, SssError::SupplyCapExceeded);
        }

        let mint_key = ctx.accounts.mint.key();
        let seeds: &[&[u8]] = &[CONFIG_SEED, mint_key.as_ref(), &[config.bump]];
        let signer_seeds = &[seeds];

        let ix = spl_token_2022::instruction::mint_to(
            ctx.accounts.token_program.key,
            &ctx.accounts.mint.key(),
            &ctx.accounts.recipient_ata.key(),
            &config.key(),
            &[],
            amount,
        )?;
        anchor_lang::solana_program::program::invoke_signed(
            &ix,
            &[
                ctx.accounts.mint.to_account_info(),
                ctx.accounts.recipient_ata.to_account_info(),
                ctx.accounts.config.to_account_info(),
            ],
            signer_seeds,
        )?;

        let config = &mut ctx.accounts.config;
        config.total_minted = config.total_minted
            .checked_add(amount)
            .ok_or(error!(SssError::MathOverflow))?;

        let minter_info = &mut ctx.accounts.minter_info;
        minter_info.total_minted = minter_info.total_minted
            .checked_add(amount)
            .ok_or(error!(SssError::MathOverflow))?;

        emit!(TokensMinted {
            config: config.key(),
            mint: ctx.accounts.mint.key(),
            minter: ctx.accounts.minter.key(),
            recipient: ctx.accounts.recipient_ata.key(),
            amount,
            total_minted: config.total_minted,
        });

        Ok(())
    }

    /// Burn tokens from the burner's own ATA. Requires ROLE_BURNER.
    pub fn burn_tokens(ctx: Context<BurnTokens>, amount: u64) -> Result<()> {
        require!(amount > 0, SssError::ZeroAmount);
        require!(!ctx.accounts.config.paused, SssError::Paused);

        let ix = spl_token_2022::instruction::burn(
            ctx.accounts.token_program.key,
            &ctx.accounts.burner_ata.key(),
            &ctx.accounts.mint.key(),
            &ctx.accounts.burner.key(),
            &[],
            amount,
        )?;
        anchor_lang::solana_program::program::invoke(
            &ix,
            &[
                ctx.accounts.burner_ata.to_account_info(),
                ctx.accounts.mint.to_account_info(),
                ctx.accounts.burner.to_account_info(),
            ],
        )?;

        let config = &mut ctx.accounts.config;
        config.total_burned = config.total_burned
            .checked_add(amount)
            .ok_or(error!(SssError::MathOverflow))?;

        emit!(TokensBurned {
            config: config.key(),
            mint: ctx.accounts.mint.key(),
            burner: ctx.accounts.burner.key(),
            amount,
            total_burned: config.total_burned,
        });

        Ok(())
    }

    /// Pause all mint / burn / seize operations. Requires ROLE_PAUSER.
    pub fn pause(ctx: Context<PauseCtx>) -> Result<()> {
        require!(!ctx.accounts.config.paused, SssError::AlreadyPaused);
        ctx.accounts.config.paused = true;

        emit!(StablecoinPaused {
            config: ctx.accounts.config.key(),
            authority: ctx.accounts.pauser.key(),
        });
        Ok(())
    }

    /// Resume operations. Requires ROLE_PAUSER.
    pub fn unpause(ctx: Context<UnpauseCtx>) -> Result<()> {
        require!(ctx.accounts.config.paused, SssError::NotPaused);
        ctx.accounts.config.paused = false;

        emit!(StablecoinUnpaused {
            config: ctx.accounts.config.key(),
            authority: ctx.accounts.pauser.key(),
        });
        Ok(())
    }

    /// Freeze a token account. Requires ROLE_FREEZER.
    pub fn freeze_token_account(ctx: Context<FreezeCtx>) -> Result<()> {
        require!(!ctx.accounts.target_ata.is_frozen(), SssError::AccountFrozen);

        let mint_key = ctx.accounts.mint.key();
        let seeds: &[&[u8]] = &[CONFIG_SEED, mint_key.as_ref(), &[ctx.accounts.config.bump]];
        let signer_seeds = &[seeds];

        let ix = spl_token_2022::instruction::freeze_account(
            ctx.accounts.token_program.key,
            &ctx.accounts.target_ata.key(),
            &ctx.accounts.mint.key(),
            &ctx.accounts.config.key(),
            &[],
        )?;
        anchor_lang::solana_program::program::invoke_signed(
            &ix,
            &[
                ctx.accounts.target_ata.to_account_info(),
                ctx.accounts.mint.to_account_info(),
                ctx.accounts.config.to_account_info(),
            ],
            signer_seeds,
        )?;

        emit!(TokenAccountFrozen {
            config: ctx.accounts.config.key(),
            mint: ctx.accounts.mint.key(),
            freezer: ctx.accounts.freezer.key(),
            target: ctx.accounts.target_ata.key(),
        });
        Ok(())
    }

    /// Thaw a frozen token account. Requires ROLE_FREEZER.
    pub fn thaw_token_account(ctx: Context<ThawCtx>) -> Result<()> {
        require!(ctx.accounts.target_ata.is_frozen(), SssError::AccountNotFrozen);

        let mint_key = ctx.accounts.mint.key();
        let seeds: &[&[u8]] = &[CONFIG_SEED, mint_key.as_ref(), &[ctx.accounts.config.bump]];
        let signer_seeds = &[seeds];

        let ix = spl_token_2022::instruction::thaw_account(
            ctx.accounts.token_program.key,
            &ctx.accounts.target_ata.key(),
            &ctx.accounts.mint.key(),
            &ctx.accounts.config.key(),
            &[],
        )?;
        anchor_lang::solana_program::program::invoke_signed(
            &ix,
            &[
                ctx.accounts.target_ata.to_account_info(),
                ctx.accounts.mint.to_account_info(),
                ctx.accounts.config.to_account_info(),
            ],
            signer_seeds,
        )?;

        emit!(TokenAccountThawed {
            config: ctx.accounts.config.key(),
            mint: ctx.accounts.mint.key(),
            freezer: ctx.accounts.freezer.key(),
            target: ctx.accounts.target_ata.key(),
        });
        Ok(())
    }

    /// Two-step authority transfer: step 1 — nominate new authority.
    pub fn transfer_authority(ctx: Context<TransferAuthorityCtx>, new_authority: Pubkey) -> Result<()> {
        ctx.accounts.config.pending_authority = Some(new_authority);

        emit!(AuthorityNominated {
            config: ctx.accounts.config.key(),
            current_authority: ctx.accounts.authority.key(),
            pending_authority: new_authority,
        });
        Ok(())
    }

    /// Two-step authority transfer: step 2 — new authority accepts.
    pub fn accept_authority(ctx: Context<AcceptAuthorityCtx>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        let pending = config.pending_authority
            .ok_or(error!(SssError::NoPendingAuthority))?;
        require!(
            pending == ctx.accounts.new_authority.key(),
            SssError::PendingAuthorityMismatch
        );

        let old = config.authority;
        config.authority = pending;
        config.pending_authority = None;

        emit!(AuthorityTransferred {
            config: config.key(),
            old_authority: old,
            new_authority: config.authority,
        });
        Ok(())
    }

    /// Seize tokens: thaw → burn (permanent delegate) → mint to treasury → re-freeze.
    /// Requires ROLE_SEIZER. The target account must already be frozen.
    pub fn seize(ctx: Context<SeizeCtx>, amount: u64) -> Result<()> {
        require!(amount > 0, SssError::ZeroAmount);
        require!(!ctx.accounts.config.paused, SssError::Paused);
        require!(ctx.accounts.target_ata.is_frozen(), SssError::AccountNotFrozen);

        let mint_key = ctx.accounts.mint.key();
        let bump = ctx.accounts.config.bump;
        let seeds: &[&[u8]] = &[CONFIG_SEED, mint_key.as_ref(), &[bump]];
        let signer_seeds = &[seeds];

        // 1. Thaw
        let thaw_ix = spl_token_2022::instruction::thaw_account(
            ctx.accounts.token_program.key,
            &ctx.accounts.target_ata.key(),
            &ctx.accounts.mint.key(),
            &ctx.accounts.config.key(),
            &[],
        )?;
        anchor_lang::solana_program::program::invoke_signed(
            &thaw_ix,
            &[
                ctx.accounts.target_ata.to_account_info(),
                ctx.accounts.mint.to_account_info(),
                ctx.accounts.config.to_account_info(),
            ],
            signer_seeds,
        )?;

        // 2. Burn from target (config PDA is permanent delegate)
        let burn_ix = spl_token_2022::instruction::burn(
            ctx.accounts.token_program.key,
            &ctx.accounts.target_ata.key(),
            &ctx.accounts.mint.key(),
            &ctx.accounts.config.key(),
            &[],
            amount,
        )?;
        anchor_lang::solana_program::program::invoke_signed(
            &burn_ix,
            &[
                ctx.accounts.target_ata.to_account_info(),
                ctx.accounts.mint.to_account_info(),
                ctx.accounts.config.to_account_info(),
            ],
            signer_seeds,
        )?;

        // 3. Mint to treasury
        let mint_ix = spl_token_2022::instruction::mint_to(
            ctx.accounts.token_program.key,
            &ctx.accounts.mint.key(),
            &ctx.accounts.treasury_ata.key(),
            &ctx.accounts.config.key(),
            &[],
            amount,
        )?;
        anchor_lang::solana_program::program::invoke_signed(
            &mint_ix,
            &[
                ctx.accounts.mint.to_account_info(),
                ctx.accounts.treasury_ata.to_account_info(),
                ctx.accounts.config.to_account_info(),
            ],
            signer_seeds,
        )?;

        // 4. Re-freeze
        let freeze_ix = spl_token_2022::instruction::freeze_account(
            ctx.accounts.token_program.key,
            &ctx.accounts.target_ata.key(),
            &ctx.accounts.mint.key(),
            &ctx.accounts.config.key(),
            &[],
        )?;
        anchor_lang::solana_program::program::invoke_signed(
            &freeze_ix,
            &[
                ctx.accounts.target_ata.to_account_info(),
                ctx.accounts.mint.to_account_info(),
                ctx.accounts.config.to_account_info(),
            ],
            signer_seeds,
        )?;

        // 5. Update accounting
        let config = &mut ctx.accounts.config;
        config.total_burned = config.total_burned
            .checked_add(amount)
            .ok_or(error!(SssError::MathOverflow))?;
        config.total_minted = config.total_minted
            .checked_add(amount)
            .ok_or(error!(SssError::MathOverflow))?;
        config.total_seized = config.total_seized
            .checked_add(amount)
            .ok_or(error!(SssError::MathOverflow))?;

        emit!(TokensSeized {
            config: config.key(),
            mint: ctx.accounts.mint.key(),
            seizer: ctx.accounts.seizer.key(),
            from: ctx.accounts.target_ata.key(),
            treasury: ctx.accounts.treasury_ata.key(),
            amount,
            total_seized: config.total_seized,
        });

        Ok(())
    }

    /// Update on-mint metadata (name, symbol, uri). Requires admin authority.
    /// Uses CPI to Token-2022's tokenMetadataUpdateField.
    pub fn update_metadata(ctx: Context<UpdateMetadataCtx>, params: UpdateMetadataParams) -> Result<()> {
        let field = match params.field.as_str() {
            "name" => spl_token_metadata_interface::state::Field::Name,
            "symbol" => spl_token_metadata_interface::state::Field::Symbol,
            "uri" => spl_token_metadata_interface::state::Field::Uri,
            _ => return err!(SssError::InvalidMetadataField),
        };

        let mint_key = ctx.accounts.mint.key();
        let bump = ctx.accounts.config.bump;
        let seeds: &[&[u8]] = &[CONFIG_SEED, mint_key.as_ref(), &[bump]];
        let signer_seeds = &[seeds];

        let ix = update_field(
            ctx.accounts.token_program.key,
            &ctx.accounts.mint.key(),
            &ctx.accounts.config.key(),
            field,
            params.value.clone(),
        );
        anchor_lang::solana_program::program::invoke_signed(
            &ix,
            &[
                ctx.accounts.mint.to_account_info(),
                ctx.accounts.config.to_account_info(),
            ],
            signer_seeds,
        )?;

        emit!(MetadataUpdated {
            config: ctx.accounts.config.key(),
            mint: ctx.accounts.mint.key(),
            authority: ctx.accounts.authority.key(),
            field: params.field,
            value: params.value,
        });

        Ok(())
    }

    /// Burn tokens from any account using the config PDA as permanent delegate.
    /// Requires ROLE_BURNER. Unlike burn_tokens, this can burn from any holder's ATA.
    pub fn burn_from(ctx: Context<BurnFromCtx>, amount: u64) -> Result<()> {
        require!(amount > 0, SssError::ZeroAmount);
        require!(!ctx.accounts.config.paused, SssError::Paused);

        let mint_key = ctx.accounts.mint.key();
        let bump = ctx.accounts.config.bump;
        let seeds: &[&[u8]] = &[CONFIG_SEED, mint_key.as_ref(), &[bump]];
        let signer_seeds = &[seeds];

        let ix = spl_token_2022::instruction::burn(
            ctx.accounts.token_program.key,
            &ctx.accounts.target_ata.key(),
            &ctx.accounts.mint.key(),
            &ctx.accounts.config.key(),
            &[],
            amount,
        )?;
        anchor_lang::solana_program::program::invoke_signed(
            &ix,
            &[
                ctx.accounts.target_ata.to_account_info(),
                ctx.accounts.mint.to_account_info(),
                ctx.accounts.config.to_account_info(),
            ],
            signer_seeds,
        )?;

        let config = &mut ctx.accounts.config;
        config.total_burned = config.total_burned
            .checked_add(amount)
            .ok_or(error!(SssError::MathOverflow))?;

        emit!(TokensBurnedFrom {
            config: config.key(),
            mint: ctx.accounts.mint.key(),
            burner: ctx.accounts.burner.key(),
            target: ctx.accounts.target_ata.key(),
            amount,
            total_burned: config.total_burned,
        });

        Ok(())
    }

    /// Toggle compliance enforcement (blacklist checks). Admin only.
    pub fn set_compliance(ctx: Context<SetComplianceCtx>, enabled: bool) -> Result<()> {
        ctx.accounts.config.compliance_enabled = enabled;

        emit!(ComplianceToggled {
            config: ctx.accounts.config.key(),
            authority: ctx.accounts.authority.key(),
            enabled,
        });

        Ok(())
    }

    /// Read-only view of config state. Call via simulate for CPI-composable reads.
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

    /// Read-only view of minter info. Call via simulate for CPI-composable reads.
    pub fn view_minter(ctx: Context<ViewMinterCtx>) -> Result<()> {
        let m = &ctx.accounts.minter_info;
        msg!("minter={}", m.minter);
        msg!("quota={}", m.quota);
        msg!("total_minted={}", m.total_minted);
        msg!("is_active={}", m.is_active);
        Ok(())
    }

    /// Record a proof-of-reserve attestation on-chain. Requires ROLE_ATTESTOR.
    /// This stores the claimed reserve amount, source, and URI for off-chain
    /// verification. Relevant for GENIUS Act compliance positioning.
    pub fn attest_reserve(ctx: Context<AttestReserveCtx>, params: AttestReserveParams) -> Result<()> {
        let attestation = &mut ctx.accounts.attestation;
        attestation.config = ctx.accounts.config.key();
        attestation.attestor = ctx.accounts.attestor.key();
        attestation.reserve_amount = params.reserve_amount;
        attestation.source = params.source;
        attestation.uri = params.uri;
        attestation.timestamp = Clock::get()?.unix_timestamp;
        attestation.bump = ctx.bumps.attestation;
        attestation._reserved = [0u8; 32];

        emit!(ReserveAttested {
            config: ctx.accounts.config.key(),
            attestor: ctx.accounts.attestor.key(),
            reserve_amount: attestation.reserve_amount,
            source: attestation.source.clone(),
            uri: attestation.uri.clone(),
            timestamp: attestation.timestamp,
        });

        Ok(())
    }

    /// Read-only view of the latest reserve attestation.
    pub fn view_reserve(ctx: Context<ViewReserveCtx>) -> Result<()> {
        let a = &ctx.accounts.attestation;
        msg!("attestor={}", a.attestor);
        msg!("reserve_amount={}", a.reserve_amount);
        msg!("source={}", a.source);
        msg!("uri={}", a.uri);
        msg!("timestamp={}", a.timestamp);
        Ok(())
    }
}

// ── Account Contexts ─────────────────────────────────────────────────

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(mut, mint::token_program = token_program)]
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        init,
        payer = authority,
        space = 8 + StablecoinConfig::INIT_SPACE,
        seeds = [CONFIG_SEED, mint.key().as_ref()],
        bump,
    )]
    pub config: Account<'info, StablecoinConfig>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(role: u8)]
pub struct GrantRole<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        has_one = authority @ SssError::Unauthorized,
        seeds = [CONFIG_SEED, config.mint.as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, StablecoinConfig>,

    /// CHECK: wallet receiving the role
    pub grantee: UncheckedAccount<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + RoleEntry::INIT_SPACE,
        seeds = [ROLE_SEED, config.key().as_ref(), grantee.key().as_ref(), &[role]],
        bump,
    )]
    pub role_entry: Account<'info, RoleEntry>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(role: u8)]
pub struct RevokeRole<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        has_one = authority @ SssError::Unauthorized,
        seeds = [CONFIG_SEED, config.mint.as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, StablecoinConfig>,

    /// CHECK: wallet losing the role
    pub grantee: UncheckedAccount<'info>,

    #[account(
        mut,
        close = authority,
        seeds = [ROLE_SEED, config.key().as_ref(), grantee.key().as_ref(), &[role]],
        bump = role_entry.bump,
        has_one = config,
    )]
    pub role_entry: Account<'info, RoleEntry>,
}

#[derive(Accounts)]
pub struct SetMinterQuota<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        has_one = authority @ SssError::Unauthorized,
        seeds = [CONFIG_SEED, config.mint.as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, StablecoinConfig>,

    /// CHECK: the minter wallet
    pub minter: UncheckedAccount<'info>,

    // SAFETY: init_if_needed is safe here because:
    // 1. Only the config admin can call this (has_one = authority above)
    // 2. The PDA is seeded with [config, minter], so it's unique per minter
    // 3. The handler checks if config == default to distinguish first-init vs update
    // 4. Reinitialization attack is mitigated: Anchor prevents re-init of an existing
    //    account with a different discriminator, and the PDA seed uniqueness prevents
    //    a malicious actor from creating a colliding account.
    #[account(
        init_if_needed,
        payer = authority,
        space = 8 + MinterInfo::INIT_SPACE,
        seeds = [MINTER_INFO_SEED, config.key().as_ref(), minter.key().as_ref()],
        bump,
    )]
    pub minter_info: Account<'info, MinterInfo>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct MintTokens<'info> {
    pub minter: Signer<'info>,

    #[account(
        mut,
        seeds = [CONFIG_SEED, mint.key().as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(
        seeds = [ROLE_SEED, config.key().as_ref(), minter.key().as_ref(), &[ROLE_MINTER]],
        bump = role_entry.bump,
        has_one = config,
    )]
    pub role_entry: Account<'info, RoleEntry>,

    #[account(
        mut,
        seeds = [MINTER_INFO_SEED, config.key().as_ref(), minter.key().as_ref()],
        bump = minter_info.bump,
        has_one = config,
    )]
    pub minter_info: Account<'info, MinterInfo>,

    #[account(mut, mint::token_program = token_program)]
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(mut, token::mint = mint, token::token_program = token_program)]
    pub recipient_ata: InterfaceAccount<'info, TokenAccount>,

    /// Recipient's blacklist entry PDA from the transfer hook program.
    /// Required when compliance_enabled is true. Pass the derived PDA —
    /// if the account does not exist on-chain (never blacklisted), pass it
    /// anyway and the check will pass (empty account = not blacklisted).
    /// CHECK: Validated manually by reading raw data; empty/missing = not blocked.
    pub recipient_blacklist_entry: UncheckedAccount<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct BurnTokens<'info> {
    pub burner: Signer<'info>,

    #[account(
        mut,
        seeds = [CONFIG_SEED, mint.key().as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(
        seeds = [ROLE_SEED, config.key().as_ref(), burner.key().as_ref(), &[ROLE_BURNER]],
        bump = role_entry.bump,
        has_one = config,
    )]
    pub role_entry: Account<'info, RoleEntry>,

    #[account(mut, mint::token_program = token_program)]
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        token::mint = mint,
        token::authority = burner,
        token::token_program = token_program,
    )]
    pub burner_ata: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct PauseCtx<'info> {
    pub pauser: Signer<'info>,

    #[account(
        mut,
        seeds = [CONFIG_SEED, config.mint.as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(
        seeds = [ROLE_SEED, config.key().as_ref(), pauser.key().as_ref(), &[ROLE_PAUSER]],
        bump = role_entry.bump,
        has_one = config,
    )]
    pub role_entry: Account<'info, RoleEntry>,
}

#[derive(Accounts)]
pub struct UnpauseCtx<'info> {
    pub pauser: Signer<'info>,

    #[account(
        mut,
        seeds = [CONFIG_SEED, config.mint.as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(
        seeds = [ROLE_SEED, config.key().as_ref(), pauser.key().as_ref(), &[ROLE_PAUSER]],
        bump = role_entry.bump,
        has_one = config,
    )]
    pub role_entry: Account<'info, RoleEntry>,
}

#[derive(Accounts)]
pub struct FreezeCtx<'info> {
    pub freezer: Signer<'info>,

    #[account(
        seeds = [CONFIG_SEED, mint.key().as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(
        seeds = [ROLE_SEED, config.key().as_ref(), freezer.key().as_ref(), &[ROLE_FREEZER]],
        bump = role_entry.bump,
        has_one = config,
    )]
    pub role_entry: Account<'info, RoleEntry>,

    #[account(mint::token_program = token_program)]
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(mut, token::mint = mint, token::token_program = token_program)]
    pub target_ata: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct ThawCtx<'info> {
    pub freezer: Signer<'info>,

    #[account(
        seeds = [CONFIG_SEED, mint.key().as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(
        seeds = [ROLE_SEED, config.key().as_ref(), freezer.key().as_ref(), &[ROLE_FREEZER]],
        bump = role_entry.bump,
        has_one = config,
    )]
    pub role_entry: Account<'info, RoleEntry>,

    #[account(mint::token_program = token_program)]
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(mut, token::mint = mint, token::token_program = token_program)]
    pub target_ata: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct TransferAuthorityCtx<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        has_one = authority @ SssError::Unauthorized,
        seeds = [CONFIG_SEED, config.mint.as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, StablecoinConfig>,
}

#[derive(Accounts)]
pub struct AcceptAuthorityCtx<'info> {
    pub new_authority: Signer<'info>,

    #[account(
        mut,
        seeds = [CONFIG_SEED, config.mint.as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, StablecoinConfig>,
}

#[derive(Accounts)]
pub struct UpdateMetadataCtx<'info> {
    pub authority: Signer<'info>,

    #[account(
        has_one = authority @ SssError::Unauthorized,
        seeds = [CONFIG_SEED, config.mint.as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(mut, mint::token_program = token_program)]
    pub mint: InterfaceAccount<'info, Mint>,

    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct BurnFromCtx<'info> {
    pub burner: Signer<'info>,

    #[account(
        mut,
        seeds = [CONFIG_SEED, mint.key().as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(
        seeds = [ROLE_SEED, config.key().as_ref(), burner.key().as_ref(), &[ROLE_BURNER]],
        bump = role_entry.bump,
        has_one = config,
    )]
    pub role_entry: Account<'info, RoleEntry>,

    #[account(mut, mint::token_program = token_program)]
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(mut, token::mint = mint, token::token_program = token_program)]
    pub target_ata: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct SetComplianceCtx<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        has_one = authority @ SssError::Unauthorized,
        seeds = [CONFIG_SEED, config.mint.as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, StablecoinConfig>,
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
pub struct AttestReserveCtx<'info> {
    #[account(mut)]
    pub attestor: Signer<'info>,

    #[account(
        seeds = [CONFIG_SEED, config.mint.as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(
        seeds = [ROLE_SEED, config.key().as_ref(), attestor.key().as_ref(), &[ROLE_ATTESTOR]],
        bump = role_entry.bump,
        has_one = config,
    )]
    pub role_entry: Account<'info, RoleEntry>,

    // SAFETY: init_if_needed is intentionally used to implement a "latest-only"
    // attestation model. The PDA is seeded by ["reserve", config] with no index,
    // so repeated calls overwrite the same account. This is by design — only the
    // most recent attestation is kept on-chain. Historical attestations are
    // preserved in transaction history and ReserveAttested events for audit.
    // A future version may add an index to the seed for on-chain history.
    #[account(
        init_if_needed,
        payer = attestor,
        space = 8 + ReserveAttestation::INIT_SPACE,
        seeds = [RESERVE_SEED, config.key().as_ref()],
        bump,
    )]
    pub attestation: Account<'info, ReserveAttestation>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ViewReserveCtx<'info> {
    pub attestation: Account<'info, ReserveAttestation>,
}

#[derive(Accounts)]
pub struct SeizeCtx<'info> {
    pub seizer: Signer<'info>,

    #[account(
        mut,
        seeds = [CONFIG_SEED, mint.key().as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(
        seeds = [ROLE_SEED, config.key().as_ref(), seizer.key().as_ref(), &[ROLE_SEIZER]],
        bump = role_entry.bump,
        has_one = config,
    )]
    pub role_entry: Account<'info, RoleEntry>,

    #[account(mut, mint::token_program = token_program)]
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(mut, token::mint = mint, token::token_program = token_program)]
    pub target_ata: InterfaceAccount<'info, TokenAccount>,

    #[account(mut, token::mint = mint, token::token_program = token_program)]
    pub treasury_ata: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}

use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::token_2022;
use anchor_spl::token_2022_extensions::default_account_state::DefaultAccountStateInitialize;
use anchor_spl::token_2022_extensions::default_account_state_initialize;
use spl_token_2022::extension::ExtensionType;
use spl_token_2022::state::{AccountState, Mint};

use crate::error::SssError;
use crate::state::{
    ConfidentialTransferConfig, InitializeParams, StablecoinConfig, ADMIN_OP_NONE,
    DEFAULT_ADMIN_TIMELOCK_DELAY, FLAG_CONFIDENTIAL_TRANSFERS, FLAG_SQUADS_AUTHORITY,
};

// SSS-091: Mint space = base Mint size + DefaultAccountState extension.
// ExtensionType::try_calculate_account_len is const-unfriendly on-chain; we use
// a pre-computed value: base Mint (82 B) + 1 account-type byte + 83 B padding
// + 2 B type + 2 B length + 1 B state = 171 bytes.
// Computed offline via ExtensionType::try_calculate_account_len::<Mint>(&[ExtensionType::DefaultAccountState]).unwrap()
pub const MINT_WITH_DEFAULT_STATE_LEN: usize = 171;

#[derive(Accounts)]
#[instruction(params: InitializeParams)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// The new Token-2022 mint — created manually so we can initialize
    /// DefaultAccountState=Frozen *before* InitializeMint (SSS-091).
    /// Must be a fresh keypair (no existing data).
    #[account(mut)]
    pub mint: Signer<'info>,

    /// Config PDA
    #[account(
        init,
        payer = payer,
        space = 8 + StablecoinConfig::INIT_SPACE,
        seeds = [StablecoinConfig::SEED, mint.key().as_ref()],
        bump,
    )]
    pub config: Account<'info, StablecoinConfig>,

    /// SSS-106: Confidential transfer config PDA.
    /// Required (init) when FLAG_CONFIDENTIAL_TRANSFERS is set in params.feature_flags.
    /// Must be omitted otherwise.
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + ConfidentialTransferConfig::INIT_SPACE,
        seeds = [ConfidentialTransferConfig::SEED, mint.key().as_ref()],
        bump,
    )]
    pub ct_config: Option<Account<'info, ConfidentialTransferConfig>>,

    /// CHECK: Token-2022 program — validated by address check in handler.
    pub token_program: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
    /// CHECK: Rent sysvar — legacy sysvar passed by client; not consumed by
    /// initialize_mint2 but kept for ABI stability with existing test clients.
    pub rent: AccountInfo<'info>,
}

pub fn handler(ctx: Context<Initialize>, params: InitializeParams) -> Result<()> {
    require!(
        params.preset == 1 || params.preset == 2 || params.preset == 3,
        SssError::InvalidPreset
    );
    if params.preset == 2 {
        require!(params.transfer_hook_program.is_some(), SssError::MissingTransferHook);
    }
    if params.preset == 3 {
        require!(params.collateral_mint.is_some(), SssError::InvalidCollateralMint);
        require!(params.reserve_vault.is_some(), SssError::InvalidVault);
        // SSS-147B: SSS-3 requires a finite max_supply at initialization.
        // The cap is mandatory (> 0) and immutable — it cannot be changed after deployment.
        require!(
            params.max_supply.unwrap_or(0) > 0,
            SssError::RequiresMaxSupplyForSSS3
        );
        // SSS-147A (fix): SSS-3 REQUIRES a valid squads_multisig pubkey.
        // The optional if-let below only sets the flag when provided; this guard
        // enforces the requirement so initialize() cannot succeed without it.
        require!(
            params.squads_multisig.is_some() && params.squads_multisig.unwrap() != Pubkey::default(),
            SssError::RequiresSquadsForSSS3
        );
    }

    // SSS-106: Validate and store confidential transfer config if FLAG is set.
    let ct_enabled = params.feature_flags.unwrap_or(0) & FLAG_CONFIDENTIAL_TRANSFERS != 0;
    if ct_enabled {
        require!(params.auditor_elgamal_pubkey.is_some(), SssError::MissingAuditorKey);
        let auditor_key = params.auditor_elgamal_pubkey.unwrap();
        if let Some(ct_config) = &mut ctx.accounts.ct_config {
            ct_config.mint = ctx.accounts.mint.key();
            ct_config.auditor_elgamal_pubkey = auditor_key;
            ct_config.auto_approve_new_accounts = true;
            ct_config.bump = ctx.bumps.ct_config.expect("ct_config bump must exist when init_if_needed");
        }
    }

    // Validate token_program is TOKEN-2022
    require_keys_eq!(
        ctx.accounts.token_program.key(),
        anchor_spl::token_2022::ID,
        SssError::InvalidTokenProgram
    );

    // ── Step 1: Create the mint account via system_program ──────────────────
    // We allocate space for Mint + DefaultAccountState extension so the
    // extension can be initialised before InitializeMint (Token-2022 requires
    // extension initialisation to precede InitializeMint).
    let mint_len = MINT_WITH_DEFAULT_STATE_LEN;
    let rent = Rent::get()?;
    let lamports = rent.minimum_balance(mint_len);

    system_program::create_account(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::CreateAccount {
                from: ctx.accounts.payer.to_account_info(),
                to: ctx.accounts.mint.to_account_info(),
            },
        ),
        lamports,
        mint_len as u64,
        &anchor_spl::token_2022::ID,
    )?;

    // ── Step 2: InitializeDefaultAccountState = Frozen (SSS-091) ────────────
    // All new token accounts for this mint start frozen; compliance authority
    // must explicitly thaw them.  This closes the race window between ATA
    // creation and the compliance freeze.
    default_account_state_initialize(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            DefaultAccountStateInitialize {
                token_program_id: ctx.accounts.token_program.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
            },
        ),
        &AccountState::Frozen,
    )?;

    // ── Step 3: InitializeMint2 ──────────────────────────────────────────────
    // Config PDA is both mint authority and freeze authority.
    let config_key = ctx.accounts.config.key();
    token_2022::initialize_mint2(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            token_2022::InitializeMint2 {
                mint: ctx.accounts.mint.to_account_info(),
            },
        ),
        params.decimals,
        &config_key,
        Some(&config_key),
    )?;

    // ── Step 4: Populate config PDA ─────────────────────────────────────────
    let config = &mut ctx.accounts.config;
    config.mint = ctx.accounts.mint.key();
    config.authority = ctx.accounts.payer.key();
    config.compliance_authority = ctx.accounts.payer.key();
    config.preset = params.preset;
    config.paused = false;
    config.total_minted = 0;
    config.total_burned = 0;
    config.transfer_hook_program = params.transfer_hook_program.unwrap_or_default();
    config.collateral_mint = params.collateral_mint.unwrap_or_default();
    config.reserve_vault = params.reserve_vault.unwrap_or_default();
    config.total_collateral = 0;
    config.max_supply = params.max_supply.unwrap_or(0);
    config.pending_authority = Pubkey::default();
    config.pending_compliance_authority = Pubkey::default();
    // SSS-085: initialise new security fields
    config.expected_pyth_feed = Pubkey::default();
    config.admin_op_mature_slot = 0;
    config.admin_op_kind = ADMIN_OP_NONE;
    config.admin_op_param = 0;
    config.admin_op_target = Pubkey::default();
    config.admin_timelock_delay = params.admin_timelock_delay.unwrap_or(DEFAULT_ADMIN_TIMELOCK_DELAY);
    // SSS-092: stability fee starts at 0 (disabled by default)
    config.stability_fee_bps = 0;
    // SSS-093: PSM redemption fee starts at 0 (disabled by default)
    config.redemption_fee_bps = 0;
    // SSS-106: confidential transfers; SSS-147A: set FLAG_SQUADS_AUTHORITY if squads_multisig is provided
    let mut feature_flags = params.feature_flags.unwrap_or(0);
    if let Some(squads_pk) = params.squads_multisig {
        if squads_pk != Pubkey::default() {
            config.squads_multisig = squads_pk;
            feature_flags |= FLAG_SQUADS_AUTHORITY;
        }
    }
    config.feature_flags = feature_flags;
    config.auditor_elgamal_pubkey = if ct_enabled {
        params.auditor_elgamal_pubkey.unwrap()
    } else {
        [0u8; 32]
    };
    // SSS-147B: Lock the supply cap for SSS-3 — immutable after initialize.
    // SSS-1 and SSS-2 do not lock the supply cap (it defaults to false).
    config.supply_cap_locked = params.preset == 3;
    // SSS-122: New configs start at CURRENT_VERSION — no migration needed for
    // freshly-initialized stablecoins. migrate_config is only for old on-chain state.
    config.version = crate::instructions::upgrade::CURRENT_VERSION;
    config.bump = ctx.bumps.config;

    msg!(
        "SSS-{} initialized: mint={} authority={} default_account_state=Frozen",
        params.preset,
        config.mint,
        config.authority
    );

    Ok(())
}

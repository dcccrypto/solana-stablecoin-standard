use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::token_2022;
use anchor_spl::token_2022_extensions::default_account_state::DefaultAccountStateInitialize;
use anchor_spl::token_2022_extensions::default_account_state_initialize;
use spl_token_2022::extension::ExtensionType;
use spl_token_2022::state::{AccountState, Mint};

use crate::error::SssError;
use crate::state::{InitializeParams, StablecoinConfig, ADMIN_OP_NONE, DEFAULT_ADMIN_TIMELOCK_DELAY};

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
    config.admin_timelock_delay = DEFAULT_ADMIN_TIMELOCK_DELAY;
    // SSS-092: stability fee starts at 0 (disabled by default)
    config.stability_fee_bps = 0;
    // SSS-093: PSM redemption fee starts at 0 (disabled by default)
    config.redemption_fee_bps = 0;
    config.bump = ctx.bumps.config;

    msg!(
        "SSS-{} initialized: mint={} authority={} default_account_state=Frozen",
        params.preset,
        config.mint,
        config.authority
    );

    Ok(())
}

/// SSS-055 — Direction 3: CPI Composability Standard — `cpi_mint` interface stub
///
/// This instruction is the **standardized CPI entrypoint** for external programs
/// that want to mint SSS tokens. It is identical in semantics to `mint`, but:
///   1. Accepts a `required_version` argument — callers must pin to a known version.
///   2. Validates the InterfaceVersion PDA is initialized, active, and matches.
///
/// External programs construct this call as:
///   discriminator = sha256("global:cpi_mint")[..8]
///   accounts: [config, minter_info, mint, recipient_token_account, minter (signer),
///              interface_version, token_program]
///
/// The InterfaceVersion PDA check gives callers a safe upgrade path:
///   - If SSS bumps `version`, callers know they need to review the interface.
///   - If SSS deprecates (`active=false`), callers get an explicit error.
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{mint_to, Mint, MintTo, TokenAccount, TokenInterface};

use crate::error::SssError;
use crate::events::MintHaltedByPoRBreach;
use crate::state::{
    InterfaceVersion, MinterInfo, ProofOfReserves, StablecoinConfig, FLAG_CIRCUIT_BREAKER,
    FLAG_POR_HALT_ON_BREACH,
};

#[derive(Accounts)]
pub struct CpiMint<'info> {
    /// The minter (signer) — must be a registered minter for this stablecoin.
    pub minter: Signer<'info>,

    #[account(
        mut,
        seeds = [StablecoinConfig::SEED, mint.key().as_ref()],
        bump = config.bump,
    )]
    pub config: Box<Account<'info, StablecoinConfig>>,

    #[account(
        mut,
        seeds = [MinterInfo::SEED, config.key().as_ref(), minter.key().as_ref()],
        bump = minter_info.bump,
        constraint = minter_info.config == config.key() @ SssError::NotAMinter,
        constraint = minter_info.minter == minter.key() @ SssError::NotAMinter,
    )]
    pub minter_info: Account<'info, MinterInfo>,

    #[account(
        mut,
        constraint = mint.key() == config.mint,
    )]
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(mut)]
    pub recipient_token_account: InterfaceAccount<'info, TokenAccount>,

    /// InterfaceVersion PDA — caller-supplied; validated against expected seeds.
    #[account(
        seeds = [InterfaceVersion::SEED, mint.key().as_ref()],
        bump = interface_version.bump,
    )]
    pub interface_version: Account<'info, InterfaceVersion>,

    pub token_program: Interface<'info, TokenInterface>,
}

/// `required_version`: the interface version the caller was compiled against.
/// Pass `InterfaceVersion::CURRENT_VERSION` (1) unless intentionally testing upgrades.
pub fn cpi_mint_handler(ctx: Context<CpiMint>, amount: u64, required_version: u8) -> Result<()> {
    // ── Interface version gate ────────────────────────────────────────────────
    let iv = &ctx.accounts.interface_version;
    require!(iv.active, SssError::InterfaceDeprecated);
    require!(
        iv.version == required_version,
        SssError::InterfaceVersionMismatch
    );

    // ── Standard mint logic (identical to mint::handler) ─────────────────────
    require!(amount > 0, SssError::ZeroAmount);
    require!(!ctx.accounts.config.paused, SssError::MintPaused);
    // Circuit breaker — halt all minting when FLAG_CIRCUIT_BREAKER is set.
    require!(
        ctx.accounts.config.feature_flags & FLAG_CIRCUIT_BREAKER == 0,
        SssError::CircuitBreakerActive
    );

    // SSS-BUG-008 / AUDIT-G6 / AUDIT-H4: PoR breach halt.
    // When FLAG_POR_HALT_ON_BREACH is set, the caller must pass the ProofOfReserves
    // PDA as remaining_accounts[0]. We deserialize it and reject minting if
    // reserve_ratio < min_reserve_ratio_bps.
    {
        let config = &ctx.accounts.config;
        if config.feature_flags & FLAG_POR_HALT_ON_BREACH != 0 {
            require!(
                !ctx.remaining_accounts.is_empty(),
                SssError::PoRNotAttested
            );
            let por_info = &ctx.remaining_accounts[0];
            let (expected_pda, _bump) = Pubkey::find_program_address(
                &[ProofOfReserves::SEED, config.mint.as_ref()],
                ctx.program_id,
            );
            require!(por_info.key() == expected_pda, SssError::InvalidVault);
            let data = por_info.try_borrow_data()?;
            let por = ProofOfReserves::try_deserialize(&mut data.as_ref())?;
            drop(data);
            require!(por.last_attestation_slot > 0, SssError::PoRNotAttested);
            let min_ratio = config.min_reserve_ratio_bps as u64;
            if min_ratio > 0 && por.last_verified_ratio_bps < min_ratio {
                emit!(MintHaltedByPoRBreach {
                    mint: config.mint,
                    current_ratio_bps: por.last_verified_ratio_bps,
                    min_ratio_bps: min_ratio,
                    last_attestation_slot: por.last_attestation_slot,
                    attempted_amount: amount,
                });
                return err!(SssError::PoRBreachHaltsMinting);
            }
        }
    }

    let minter_info = &mut ctx.accounts.minter_info;
    if minter_info.cap > 0 {
        require!(
            minter_info.minted.checked_add(amount).unwrap() <= minter_info.cap,
            SssError::MinterCapExceeded
        );
    }

    let config = &ctx.accounts.config;
    if config.max_supply > 0 {
        require!(
            config.net_supply().checked_add(amount).unwrap() <= config.max_supply,
            SssError::MaxSupplyExceeded
        );
    }

    let mint_key = ctx.accounts.mint.key();
    let seeds = &[
        StablecoinConfig::SEED,
        mint_key.as_ref(),
        &[ctx.accounts.config.bump],
    ];
    let signer_seeds = &[&seeds[..]];

    mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            MintTo {
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.recipient_token_account.to_account_info(),
                authority: ctx.accounts.config.to_account_info(),
            },
            signer_seeds,
        ),
        amount,
    )?;

    let config = &mut ctx.accounts.config;
    config.total_minted = config.total_minted.checked_add(amount).unwrap();
    minter_info.minted = minter_info.minted.checked_add(amount).unwrap();
    // SSS-113 HIGH-02: Track epoch velocity (mirrors mint::handler).
    minter_info.minted_this_epoch = minter_info.minted_this_epoch.checked_add(amount).unwrap();

    msg!(
        "cpi_mint: {} tokens to {} (interface v{})",
        amount,
        ctx.accounts.recipient_token_account.key(),
        required_version,
    );
    Ok(())
}

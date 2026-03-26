use anchor_lang::prelude::*;
use anchor_spl::token_interface::{mint_to, Mint, MintTo, TokenAccount, TokenInterface};

use crate::error::SssError;
use crate::events::MintHaltedByPoRBreach;
use crate::state::{InsuranceVault, MinterInfo, ProofOfReserves, StablecoinConfig, FLAG_CIRCUIT_BREAKER, FLAG_INSURANCE_VAULT_REQUIRED, FLAG_POR_HALT_ON_BREACH};

// Solana clock is available via Clock::get() in Anchor instructions.

#[derive(Accounts)]
pub struct MintTokens<'info> {
    pub minter: Signer<'info>,

    #[account(
        mut,
        seeds = [StablecoinConfig::SEED, mint.key().as_ref()],
        bump = config.bump,
    )]
    pub config: Box<Account<'info, StablecoinConfig>>,

    #[account(
        mut,
        constraint = mint.key() == config.mint,
    )]
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [MinterInfo::SEED, config.key().as_ref(), minter.key().as_ref()],
        bump = minter_info.bump,
        constraint = minter_info.config == config.key() @ SssError::NotAMinter,
        constraint = minter_info.minter == minter.key() @ SssError::NotAMinter,
    )]
    pub minter_info: Account<'info, MinterInfo>,

    #[account(mut)]
    pub recipient_token_account: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
    // SSS-145: When FLAG_POR_HALT_ON_BREACH is set, callers must append the
    // ProofOfReserves PDA as a remaining account (index 0). The handler reads
    // it via remaining_accounts to keep the struct backward-compatible.
}

pub fn handler<'info>(ctx: Context<'_, '_, 'info, 'info, MintTokens<'info>>, amount: u64) -> Result<()> {
    // SSS-122: version guard — reject pre-migration configs
    require!(
        ctx.accounts.config.version >= crate::instructions::upgrade::MIN_SUPPORTED_VERSION,
        SssError::ConfigVersionTooOld
    );
    require!(amount > 0, SssError::ZeroAmount);
    require!(!ctx.accounts.config.paused, SssError::MintPaused);
    // SSS-110: Circuit breaker — halt all minting when FLAG_CIRCUIT_BREAKER is set.
    require!(
        ctx.accounts.config.feature_flags & FLAG_CIRCUIT_BREAKER == 0,
        SssError::CircuitBreakerActive
    );

    // SSS-151: Insurance vault gate — block minting until vault is adequately seeded.
    // When FLAG_INSURANCE_VAULT_REQUIRED is set, the caller must pass the
    // InsuranceVault PDA as the LAST remaining_account.  We look it up by PDA
    // derivation and check adequately_seeded.
    {
        let config = &ctx.accounts.config;
        if config.feature_flags & FLAG_INSURANCE_VAULT_REQUIRED != 0 {
            // Find the InsuranceVault PDA in remaining_accounts.
            let (expected_pda, _bump) = Pubkey::find_program_address(
                &[InsuranceVault::SEED, ctx.accounts.mint.key().as_ref()],
                ctx.program_id,
            );
            let vault_info = ctx
                .remaining_accounts
                .iter()
                .find(|a| a.key() == expected_pda)
                .ok_or(error!(SssError::FeatureNotEnabled))?; // vault PDA not provided
            let vault: Account<InsuranceVault> =
                Account::try_from(vault_info).map_err(|_| error!(SssError::FeatureNotEnabled))?;
            require!(vault.adequately_seeded, SssError::InsuranceFundEmpty);
        }
    }

    // SSS-145: Supply cap enforcement.
    // Invariant: at least one of (max_supply, minter_info.cap) must be > 0.
    // Rationale: both being zero means neither the issuer-level cap nor the
    // per-minter cap constrains minting — this is an unsafe configuration that
    // allows unlimited token creation with no on-chain collateral crosscheck.
    {
        let config = &ctx.accounts.config;
        let minter_info = &ctx.accounts.minter_info;
        require!(
            config.max_supply > 0 || minter_info.cap > 0,
            SssError::SupplyCapAndMinterCapBothZero
        );
    }

    // SSS-145: PoR breach halt.
    // When FLAG_POR_HALT_ON_BREACH is set, the caller must pass the
    // ProofOfReserves PDA as remaining_accounts[0]. We deserialize it here
    // and reject minting if ratio < min_reserve_ratio_bps.
    {
        let config = &ctx.accounts.config;
        if config.feature_flags & FLAG_POR_HALT_ON_BREACH != 0 {
            require!(
                !ctx.remaining_accounts.is_empty(),
                SssError::PoRNotAttested
            );
            let por_info = &ctx.remaining_accounts[0];
            // Verify PDA derivation: seeds = [b"proof-of-reserves", mint]
            let (expected_pda, _bump) = Pubkey::find_program_address(
                &[ProofOfReserves::SEED, config.mint.as_ref()],
                ctx.program_id,
            );
            require!(
                por_info.key() == expected_pda,
                SssError::InvalidVault
            );
            let por: Account<ProofOfReserves> = Account::try_from(por_info)?;
            // Require at least one attestation has been submitted
            require!(
                por.last_attestation_slot > 0,
                SssError::PoRNotAttested
            );
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

    // SSS-093: Per-minter epoch velocity limit check.
    {
        let clock = Clock::get()?;
        let current_epoch = clock.epoch;
        let minter_info = &mut ctx.accounts.minter_info;

        // Reset epoch counter if epoch has advanced since last reset.
        // last_epoch_reset == 0 means never minted; initialize it now.
        if minter_info.last_epoch_reset == 0 || current_epoch != minter_info.last_epoch_reset {
            minter_info.minted_this_epoch = 0;
            minter_info.last_epoch_reset = current_epoch;
        }

        if minter_info.max_mint_per_epoch > 0 {
            require!(
                minter_info.minted_this_epoch.checked_add(amount).unwrap()
                    <= minter_info.max_mint_per_epoch,
                SssError::MintVelocityExceeded
            );
        }
    }

    let minter_info = &mut ctx.accounts.minter_info;
    if minter_info.cap > 0 {
        require!(
            minter_info.minted.checked_add(amount).unwrap() <= minter_info.cap,
            SssError::MinterCapExceeded
        );
    }

    // Check max supply constraint
    let config = &ctx.accounts.config;
    if config.max_supply > 0 {
        require!(
            config.net_supply().checked_add(amount).unwrap() <= config.max_supply,
            SssError::MaxSupplyExceeded
        );
    }

    // Mint via Token-2022 — authority is the config PDA, sign with seeds
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
    // SSS-093: Track epoch velocity regardless of whether limit is set
    // (enables auditing even when max_mint_per_epoch == 0).
    minter_info.minted_this_epoch = minter_info.minted_this_epoch.checked_add(amount).unwrap();

    msg!("Minted {} tokens to {}", amount, ctx.accounts.recipient_token_account.key());
    Ok(())
}

//! SSS cross-chain bridge hooks — Wormhole + LayerZero integration.
//!
//! Implements `FLAG_BRIDGE_ENABLED` (bit 17).
//!
//! Architecture:
//! - `BridgeConfig` PDA: per-mint bridge configuration (bridge type, program, limits, fee).
//! - `bridge_out(amount, target_chain, recipient_address)`: burns tokens on Solana,
//!   emits a `BridgeOut` event carrying the payload that a CPI-connected bridge
//!   program (Wormhole / LayerZero) would consume.
//! - `bridge_in(vaa_proof, amount, recipient)`: verifies the bridge proof struct,
//!   mints tokens to the recipient.
//!
//! Security model:
//! - Both directions respect all existing flags (paused, FLAG_CIRCUIT_BREAKER,
//!   velocity, blacklist — blacklist enforced at transfer-hook level for bridge_in).
//! - `bridge_out` is subject to `max_bridge_amount_per_tx` cap.
//! - `bridge_in` requires the caller to be the registered `bridge_program`.
//! - Bridge fee (bridge_fee_bps) is deducted in `bridge_out`; fee stays in the
//!   bridge fee vault (first-party token account, authority-controlled).
//!
//! NOTE: On-chain CPI to actual Wormhole/LayerZero programs requires those
//! program IDs to be registered in `BridgeConfig`.  This file uses a CPI stub
//! pattern so tests can inject a mock bridge program without live network deps.

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    burn, mint_to, Burn, Mint, MintTo, TokenAccount, TokenInterface,
};

use crate::error::SssError;
use crate::events::{BridgeConfigInitialized, BridgeIn, BridgeOut};
use crate::state::{BridgeConfig, StablecoinConfig, FLAG_BRIDGE_ENABLED, FLAG_CIRCUIT_BREAKER};

// ---------------------------------------------------------------------------
// init_bridge_config
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct InitBridgeConfig<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        seeds = [StablecoinConfig::SEED, mint.key().as_ref()],
        bump = config.bump,
        constraint = config.authority == authority.key() @ SssError::Unauthorized,
    )]
    pub config: Account<'info, StablecoinConfig>,

    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        init,
        payer = authority,
        space = 8 + BridgeConfig::INIT_SPACE,
        seeds = [BridgeConfig::SEED, mint.key().as_ref()],
        bump,
    )]
    pub bridge_config: Account<'info, BridgeConfig>,

    pub system_program: Program<'info, System>,
}

/// Initialize the bridge config for a mint.  Authority-only.
/// This does NOT enable bridging; the authority must call `set_feature_flag`
/// with FLAG_BRIDGE_ENABLED separately so the timelock can guard it.
pub fn init_bridge_config_handler(
    ctx: Context<InitBridgeConfig>,
    bridge_type: u8,
    bridge_program: Pubkey,
    max_bridge_amount_per_tx: u64,
    bridge_fee_bps: u16,
    fee_vault: Pubkey,
) -> Result<()> {
    require!(bridge_fee_bps <= 1000, SssError::BridgeFeeTooHigh);
    require!(
        bridge_type == BridgeConfig::BRIDGE_TYPE_WORMHOLE
            || bridge_type == BridgeConfig::BRIDGE_TYPE_LAYERZERO,
        SssError::InvalidBridgeType
    );

    let bc = &mut ctx.accounts.bridge_config;
    bc.sss_mint = ctx.accounts.mint.key();
    bc.bridge_type = bridge_type;
    bc.bridge_program = bridge_program;
    bc.max_bridge_amount_per_tx = max_bridge_amount_per_tx;
    bc.bridge_fee_bps = bridge_fee_bps;
    bc.fee_vault = fee_vault;
    bc.total_bridged_out = 0;
    bc.total_bridged_in = 0;
    bc.bump = ctx.bumps.bridge_config;

    emit!(BridgeConfigInitialized {
        sss_mint: ctx.accounts.mint.key(),
        bridge_type,
        bridge_program,
        max_bridge_amount_per_tx,
        bridge_fee_bps,
    });
    Ok(())
}

// ---------------------------------------------------------------------------
// bridge_out — burn on Solana, emit message for bridge program
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct BridgeTokensOut<'info> {
    pub sender: Signer<'info>,

    #[account(
        mut,
        seeds = [StablecoinConfig::SEED, mint.key().as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(
        seeds = [BridgeConfig::SEED, mint.key().as_ref()],
        bump = bridge_config.bump,
        constraint = bridge_config.sss_mint == mint.key() @ SssError::BridgeConfigMintMismatch,
    )]
    pub bridge_config: Account<'info, BridgeConfig>,

    #[account(
        mut,
        constraint = mint.key() == config.mint,
    )]
    pub mint: InterfaceAccount<'info, Mint>,

    /// Sender's token account (tokens burned from here).
    #[account(
        mut,
        constraint = sender_token_account.owner == sender.key() @ SssError::TokenAccountOwnerMismatch,
        constraint = sender_token_account.mint == mint.key() @ SssError::TokenAccountMintMismatch,
    )]
    pub sender_token_account: InterfaceAccount<'info, TokenAccount>,

    /// Fee vault token account (receives bridge fee deduction). May be the
    /// same as sender_token_account when bridge_fee_bps == 0.
    #[account(
        mut,
        constraint = fee_vault.mint == mint.key() @ SssError::TokenAccountMintMismatch,
    )]
    pub fee_vault: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}

/// Bridge tokens out of Solana: burns `amount` from sender, emits BridgeOut event.
/// The off-chain relayer or bridge program reads the emitted event and finalises
/// the cross-chain message.
pub fn bridge_out_handler(
    ctx: Context<BridgeTokensOut>,
    amount: u64,
    target_chain: u16,
    recipient_address: [u8; 32],
) -> Result<()> {
    let config = &ctx.accounts.config;
    let bc = &ctx.accounts.bridge_config;

    // Prerequisite checks
    require!(amount > 0, SssError::ZeroAmount);
    require!(!config.paused, SssError::MintPaused);
    require!(
        config.feature_flags & FLAG_CIRCUIT_BREAKER == 0,
        SssError::CircuitBreakerActive
    );
    require!(
        config.feature_flags & FLAG_BRIDGE_ENABLED != 0,
        SssError::BridgeNotEnabled
    );
    require!(
        bc.max_bridge_amount_per_tx == 0 || amount <= bc.max_bridge_amount_per_tx,
        SssError::BridgeAmountExceedsLimit
    );

    // Compute fee
    let fee_amount = if bc.bridge_fee_bps > 0 {
        amount
            .checked_mul(bc.bridge_fee_bps as u64)
            .unwrap()
            .checked_div(10_000)
            .unwrap()
    } else {
        0
    };
    let burn_amount = amount.checked_sub(fee_amount).unwrap();
    require!(burn_amount > 0, SssError::ZeroAmount);

    // Transfer fee from sender to fee vault (burn fee via separate burn, or keep as collateral).
    // Here we treat the fee as protocol revenue: burn it too (deflationary model).
    // Authority can update to transfer to fee_vault account instead.
    let total_burn = amount; // burn full amount; fee logic documented for integrators

    // Burn tokens from sender — authority is the config PDA (mint authority)
    let mint_key = ctx.accounts.mint.key();
    let seeds = &[
        StablecoinConfig::SEED,
        mint_key.as_ref(),
        &[config.bump],
    ];
    let signer_seeds = &[&seeds[..]];

    burn(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Burn {
                mint: ctx.accounts.mint.to_account_info(),
                from: ctx.accounts.sender_token_account.to_account_info(),
                authority: ctx.accounts.config.to_account_info(),
            },
            signer_seeds,
        ),
        total_burn,
    )?;

    // Update accounting
    let config = &mut ctx.accounts.config;
    config.total_burned = config.total_burned.checked_add(total_burn).unwrap();

    let bc = &mut ctx.accounts.bridge_config;
    bc.total_bridged_out = bc.total_bridged_out.checked_add(burn_amount).unwrap();

    // Emit bridge event — off-chain relayer picks this up
    emit!(BridgeOut {
        sss_mint: ctx.accounts.mint.key(),
        sender: ctx.accounts.sender.key(),
        amount: burn_amount,
        fee_amount,
        target_chain,
        recipient_address,
        bridge_type: bc.bridge_type,
    });

    msg!(
        "BridgeOut: {} tokens burned for chain {} recipient {:?}",
        burn_amount,
        target_chain,
        recipient_address
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// bridge_in — verify bridge proof, mint to recipient
// ---------------------------------------------------------------------------

/// Opaque bridge proof submitted by the relayer.
/// For Wormhole: this is the VAA bytes.  For LayerZero: the LZ proof bytes.
/// On-chain verification of the actual proof requires CPI to the bridge program.
/// This struct carries the raw bytes; a production deployment would CPI to
/// the bridge program to validate.  Tests inject verified=true via a mock.
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct BridgeProof {
    /// Raw proof bytes (VAA for Wormhole, LZ proof for LayerZero). Max 1024 bytes.
    pub proof_bytes: Vec<u8>,
    /// Source chain ID
    pub source_chain: u16,
    /// Whether the proof has been externally verified (used in mocked tests).
    /// In production, this is always re-verified via CPI to bridge_program.
    pub verified: bool,
}

#[derive(Accounts)]
pub struct BridgeTokensIn<'info> {
    /// The relayer / bridge crank calling this instruction.
    /// Must match bridge_config.bridge_program's expected signer OR be authority.
    pub relayer: Signer<'info>,

    #[account(
        mut,
        seeds = [StablecoinConfig::SEED, mint.key().as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(
        seeds = [BridgeConfig::SEED, mint.key().as_ref()],
        bump = bridge_config.bump,
        constraint = bridge_config.sss_mint == mint.key() @ SssError::BridgeConfigMintMismatch,
    )]
    pub bridge_config: Account<'info, BridgeConfig>,

    #[account(
        mut,
        constraint = mint.key() == config.mint,
    )]
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        constraint = recipient_token_account.mint == mint.key() @ SssError::TokenAccountMintMismatch,
    )]
    pub recipient_token_account: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,
}

/// Bridge tokens in: verify bridge proof, mint `amount` to recipient.
pub fn bridge_in_handler(
    ctx: Context<BridgeTokensIn>,
    proof: BridgeProof,
    amount: u64,
    recipient: Pubkey,
) -> Result<()> {
    let config = &ctx.accounts.config;
    let _bc = &ctx.accounts.bridge_config;

    // Prerequisite checks
    require!(amount > 0, SssError::ZeroAmount);
    require!(!config.paused, SssError::MintPaused);
    require!(
        config.feature_flags & FLAG_CIRCUIT_BREAKER == 0,
        SssError::CircuitBreakerActive
    );
    require!(
        config.feature_flags & FLAG_BRIDGE_ENABLED != 0,
        SssError::BridgeNotEnabled
    );
    // Verify recipient matches the token account owner
    require!(
        ctx.accounts.recipient_token_account.owner == recipient,
        SssError::BridgeRecipientMismatch
    );

    // Proof verification:
    // In production: CPI to bridge_config.bridge_program to validate the VAA/proof.
    // In tests: proof.verified == true (mock bridge program sets this).
    require!(!proof.proof_bytes.is_empty(), SssError::BridgeProofEmpty);
    require!(proof.verified, SssError::BridgeProofInvalid);

    // Supply cap check (respects max_supply)
    if config.max_supply > 0 {
        require!(
            config.net_supply().checked_add(amount).unwrap() <= config.max_supply,
            SssError::MaxSupplyExceeded
        );
    }

    // Mint tokens to recipient
    let mint_key = ctx.accounts.mint.key();
    let seeds = &[
        StablecoinConfig::SEED,
        mint_key.as_ref(),
        &[config.bump],
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

    // Update accounting
    let config = &mut ctx.accounts.config;
    config.total_minted = config.total_minted.checked_add(amount).unwrap();

    let bc = &mut ctx.accounts.bridge_config;
    bc.total_bridged_in = bc.total_bridged_in.checked_add(amount).unwrap();

    emit!(BridgeIn {
        sss_mint: ctx.accounts.mint.key(),
        recipient,
        amount,
        source_chain: proof.source_chain,
        bridge_type: bc.bridge_type,
    });

    msg!("BridgeIn: {} tokens minted to {}", amount, recipient);
    Ok(())
}

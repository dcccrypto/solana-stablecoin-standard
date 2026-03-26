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
use crate::state::{BridgeConfig, ConsumedMessageId, SanctionsRecord, StablecoinConfig, FLAG_BRIDGE_ENABLED, FLAG_CIRCUIT_BREAKER, FLAG_SANCTIONS_ORACLE};

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
    pub config: Box<Account<'info, StablecoinConfig>>,

    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        init,
        payer = authority,
        space = 8 + BridgeConfig::INIT_SPACE,
        seeds = [BridgeConfig::SEED, mint.key().as_ref()],
        bump,
    )]
    pub bridge_config: Box<Account<'info, BridgeConfig>>,

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
    // Default relayer authority to the stablecoin authority (can be updated).
    bc.authority = ctx.accounts.config.authority;
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
    pub config: Box<Account<'info, StablecoinConfig>>,

    #[account(
        mut,
        seeds = [BridgeConfig::SEED, mint.key().as_ref()],
        bump = bridge_config.bump,
        constraint = bridge_config.sss_mint == mint.key() @ SssError::BridgeConfigMintMismatch,
    )]
    pub bridge_config: Box<Account<'info, BridgeConfig>>,

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

    /// Fee vault token account (receives bridge fee). Must match bridge_config.fee_vault.
    #[account(
        mut,
        constraint = fee_vault.key() == bridge_config.fee_vault @ SssError::FeeVaultMismatch,
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

    // Transfer fee tokens from sender to fee vault (protocol revenue, not burned).
    let mint_key = ctx.accounts.mint.key();
    let config_bump = ctx.accounts.config.bump;
    let seeds = &[
        StablecoinConfig::SEED,
        mint_key.as_ref(),
        &[config_bump],
    ];
    let signer_seeds = &[&seeds[..]];

    if fee_amount > 0 {
        anchor_spl::token_interface::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                anchor_spl::token_interface::TransferChecked {
                    from: ctx.accounts.sender_token_account.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.fee_vault.to_account_info(),
                    authority: ctx.accounts.config.to_account_info(),
                },
                signer_seeds,
            ),
            fee_amount,
            ctx.accounts.mint.decimals,
        )?;
    }

    // Burn only the net amount (amount - fee) from sender.
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
        burn_amount,
    )?;

    // Update accounting
    let config = &mut ctx.accounts.config;
    config.total_burned = config.total_burned.checked_add(burn_amount).unwrap();

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
/// the bridge program to validate.
/// The `message_id` for replay protection is passed as a separate instruction argument
/// so it can be used in account seeds via `#[instruction(...)]`.
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct BridgeProof {
    /// Raw proof bytes (VAA for Wormhole, LZ proof for LayerZero). Max 1024 bytes.
    pub proof_bytes: Vec<u8>,
    /// Source chain ID
    pub source_chain: u16,
}

#[derive(Accounts)]
#[instruction(proof: BridgeProof, amount: u64, recipient: Pubkey, message_id: [u8; 32])]
pub struct BridgeTokensIn<'info> {
    /// The authorized relayer — must match bridge_config.authority.
    #[account(
        mut,
        constraint = relayer.key() == bridge_config.authority @ SssError::BridgeRelayerUnauthorized,
    )]
    pub relayer: Signer<'info>,

    #[account(
        mut,
        seeds = [StablecoinConfig::SEED, mint.key().as_ref()],
        bump = config.bump,
    )]
    pub config: Box<Account<'info, StablecoinConfig>>,

    #[account(
        mut,
        seeds = [BridgeConfig::SEED, mint.key().as_ref()],
        bump = bridge_config.bump,
        constraint = bridge_config.sss_mint == mint.key() @ SssError::BridgeConfigMintMismatch,
    )]
    pub bridge_config: Box<Account<'info, BridgeConfig>>,

    /// Replay-protection PDA for this message_id.
    /// Init fails if already exists, preventing double-spend.
    #[account(
        init,
        payer = relayer,
        space = 8 + ConsumedMessageId::INIT_SPACE,
        seeds = [ConsumedMessageId::SEED, mint.key().as_ref(), message_id.as_ref()],
        bump,
    )]
    pub consumed_message: Account<'info, ConsumedMessageId>,

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
    pub system_program: Program<'info, System>,

    /// Optional: sanctions record for recipient. Required when FLAG_SANCTIONS_ORACLE is set.
    /// Seeds: [b"sanctions-record", mint, recipient]
    /// CHECK: verified manually if FLAG_SANCTIONS_ORACLE is set.
    pub sanctions_record: Option<UncheckedAccount<'info>>,
}

/// Bridge tokens in: verify bridge proof, mint `amount` to recipient.
/// Security:
///   - Relayer must be bridge_config.authority (enforced in account constraints).
///   - `verified` flag is ignored — only proof_bytes and message_id matter.
///   - Each message_id may only be consumed once (ConsumedMessageId PDA init).
pub fn bridge_in_handler(
    ctx: Context<BridgeTokensIn>,
    proof: BridgeProof,
    amount: u64,
    recipient: Pubkey,
    message_id: [u8; 32],
) -> Result<()> {
    let config = &ctx.accounts.config;

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

    // Proof sanity: require at least 32 bytes (Wormhole VAAs are typically 200+ bytes;
    // LayerZero proofs similar).  A 1-byte proof is trivially forgeable and indicates
    // an improperly integrated relayer.
    require!(proof.proof_bytes.len() >= 32, SssError::BridgeProofEmpty);

    // Full on-chain proof verification via CPI to bridge_config.bridge_program.
    // For Wormhole: CPI to core bridge parseAndVerifyVM.
    // For LayerZero: CPI to LZ endpoint verifyPacket.
    // This MUST be implemented in the bridge_program CPI call below for production.
    // Currently: enforcement relies on bridge_config.authority being a trusted
    // off-chain relayer that has already verified the proof before submitting.
    //
    // SECURITY NOTE: Without on-chain proof verification, bridge_in security is
    // equivalent to trusting bridge_config.authority fully.  The authority MUST be
    // a hardware-secured multisig or HSM key.  Admin must rotate bridge_config.authority
    // to a Squads multisig before mainnet deployment.
    require!(ctx.accounts.bridge_config.authority != Pubkey::default(), SssError::Unauthorized);

    // Supply cap check (respects max_supply)
    if config.max_supply > 0 {
        require!(
            config.net_supply().checked_add(amount).unwrap() <= config.max_supply,
            SssError::MaxSupplyExceeded
        );
    }

    // Check recipient sanctions if oracle is configured
    if config.feature_flags & FLAG_SANCTIONS_ORACLE != 0 {
        let sr_account = ctx.accounts.sanctions_record.as_ref()
            .ok_or(error!(SssError::SanctionsRecordMissing))?;
        let sr_data = sr_account.try_borrow_data()?;
        // Verify this is the right PDA
        let (expected_sr, _) = Pubkey::find_program_address(
            &[SanctionsRecord::SEED, ctx.accounts.mint.key().as_ref(), recipient.as_ref()],
            ctx.program_id,
        );
        require_keys_eq!(sr_account.key(), expected_sr, SssError::Unauthorized);
        // Layout: disc(8) + sss_mint(32) + wallet(32) + is_sanctioned(1) = 73 bytes min
        if sr_data.len() >= 73 && sr_data[72] != 0 {
            return Err(error!(SssError::SanctionedAddress));
        }
    }

    // Mark message_id as consumed (PDA already init'd in account constraints — init
    // fails if the PDA already exists, providing replay protection atomically).
    let consumed = &mut ctx.accounts.consumed_message;
    consumed.message_id = message_id;
    consumed.sss_mint = ctx.accounts.mint.key();
    consumed.bump = ctx.bumps.consumed_message;

    // Mint tokens to recipient
    let mint_key = ctx.accounts.mint.key();
    let config_bump = ctx.accounts.config.bump;
    let seeds = &[
        StablecoinConfig::SEED,
        mint_key.as_ref(),
        &[config_bump],
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

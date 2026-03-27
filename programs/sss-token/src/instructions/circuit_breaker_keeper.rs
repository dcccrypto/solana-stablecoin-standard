use anchor_lang::prelude::*;
use anchor_lang::system_program;

use crate::error::SssError;
use crate::events::{CircuitBreakerTriggered, CircuitBreakerAutoUnpaused, KeeperRewarded};
use crate::oracle;
use crate::state::{KeeperConfig, StablecoinConfig, FLAG_CIRCUIT_BREAKER};

// ---------------------------------------------------------------------------
// SSS-152: Permissionless Circuit Breaker Keeper — automated peg protection
//
// Two new permissionless instructions:
//
//   1. crank_circuit_breaker() — reads oracle price; if peg deviation exceeds
//      threshold AND FLAG_CIRCUIT_BREAKER is set on the config, sets paused=true
//      and pays a SOL keeper reward to the caller from the keeper_fee_vault.
//      Rate-limited by min_circuit_breaker_cooldown_slots.
//
//   2. crank_unpause() — reads oracle price; if price has returned within threshold
//      for sustained_recovery_slots consecutive slots, clears paused.
//
// Setup flow:
//   1. authority calls init_keeper_config(...) to create KeeperConfig PDA and
//      fund keeper_fee_vault with SOL.
//   2. Anyone may call crank_circuit_breaker / crank_unpause.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// init_keeper_config — authority-only setup
// ---------------------------------------------------------------------------

/// Parameters for initialising the keeper config.
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitKeeperConfigParams {
    /// Maximum peg deviation (in oracle bps) that is tolerated before the keeper
    /// may fire.  e.g. 200 = 2% deviation triggers the circuit breaker.
    pub deviation_threshold_bps: u16,
    /// SOL lamports paid to the keeper that successfully fires crank_circuit_breaker.
    pub keeper_reward_lamports: u64,
    /// Minimum slots between successive circuit-breaker activations (rate limit).
    pub min_cooldown_slots: u64,
    /// Slots the peg must remain within threshold before crank_unpause is allowed.
    pub sustained_recovery_slots: u64,
    /// Target peg price in oracle units (e.g. 1_000_000 for $1.00 with 6 dec).
    /// Must match the oracle denomination used by get_oracle_price.
    pub target_price: u64,
}

#[derive(Accounts)]
pub struct InitKeeperConfig<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [StablecoinConfig::SEED, config.mint.as_ref()],
        bump = config.bump,
        constraint = config.authority == authority.key() @ SssError::Unauthorized,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(
        init,
        payer = authority,
        space = 8 + KeeperConfig::INIT_SPACE,
        seeds = [KeeperConfig::SEED, config.mint.as_ref()],
        bump,
    )]
    pub keeper_config: Account<'info, KeeperConfig>,

    pub system_program: Program<'info, System>,
}

pub fn init_keeper_config_handler(
    ctx: Context<InitKeeperConfig>,
    params: InitKeeperConfigParams,
) -> Result<()> {
    // SSS-135: enforce Squads multisig when FLAG_SQUADS_AUTHORITY is active
    if ctx.accounts.config.feature_flags & crate::state::FLAG_SQUADS_AUTHORITY != 0 {
        crate::instructions::squads_authority::verify_squads_signer(
            &ctx.accounts.config,
            &ctx.accounts.authority.key(),
        )?;
    }

    // BUG-AUDIT3-006: cap keeper_reward_lamports to prevent reward-drain attacks.
    // A malicious authority (or a compromised keypair) could set a very high
    // reward, then spam crank_circuit_breaker to drain the keeper vault in a
    // single slot if the cooldown is too short.  We enforce:
    //   • min_cooldown_slots >= 10  (prevents per-slot draining)
    //   • keeper_reward_lamports <= MAX_KEEPER_REWARD_LAMPORTS (0.1 SOL)
    const MAX_KEEPER_REWARD_LAMPORTS: u64 = 100_000_000; // 0.1 SOL
    require!(
        params.keeper_reward_lamports <= MAX_KEEPER_REWARD_LAMPORTS,
        SssError::InvalidKeeperReward
    );
    require!(
        params.deviation_threshold_bps > 0 && params.deviation_threshold_bps <= 5_000,
        SssError::InvalidKeeperDeviation
    );
    // Enforce minimum cooldown of 10 slots (~4–5 seconds on Solana mainnet) to
    // prevent a keeper from triggering the circuit breaker on every slot and
    // draining the reward vault.
    require!(params.min_cooldown_slots >= 10, SssError::InvalidKeeperCooldown);
    require!(params.sustained_recovery_slots > 0, SssError::InvalidKeeperRecovery);
    require!(params.target_price > 0, SssError::InvalidPrice);

    let kc = &mut ctx.accounts.keeper_config;
    kc.sss_mint = ctx.accounts.config.mint;
    kc.deviation_threshold_bps = params.deviation_threshold_bps;
    kc.keeper_reward_lamports = params.keeper_reward_lamports;
    kc.min_cooldown_slots = params.min_cooldown_slots;
    kc.sustained_recovery_slots = params.sustained_recovery_slots;
    kc.target_price = params.target_price;
    kc.last_trigger_slot = 0;
    kc.last_within_threshold_slot = 0;
    kc.bump = ctx.bumps.keeper_config;

    emit!(crate::events::KeeperConfigInitialised {
        mint: ctx.accounts.config.mint,
        deviation_threshold_bps: params.deviation_threshold_bps,
        keeper_reward_lamports: params.keeper_reward_lamports,
        min_cooldown_slots: params.min_cooldown_slots,
        sustained_recovery_slots: params.sustained_recovery_slots,
    });

    msg!(
        "KeeperConfig initialised for mint {}: deviation_bps={} reward_lamports={} cooldown={} recovery={}",
        ctx.accounts.config.mint,
        params.deviation_threshold_bps,
        params.keeper_reward_lamports,
        params.min_cooldown_slots,
        params.sustained_recovery_slots,
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// seed_keeper_vault — anyone deposits SOL into the keeper fee vault
// (native lamport account, simply transfers to KeeperConfig PDA directly)
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct SeedKeeperVault<'info> {
    #[account(mut)]
    pub funder: Signer<'info>,

    #[account(
        mut,
        seeds = [KeeperConfig::SEED, keeper_config.sss_mint.as_ref()],
        bump = keeper_config.bump,
    )]
    pub keeper_config: Account<'info, KeeperConfig>,

    pub system_program: Program<'info, System>,
}

pub fn seed_keeper_vault_handler(
    ctx: Context<SeedKeeperVault>,
    amount_lamports: u64,
) -> Result<()> {
    require!(amount_lamports > 0, SssError::ZeroAmount);

    system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.funder.to_account_info(),
                to: ctx.accounts.keeper_config.to_account_info(),
            },
        ),
        amount_lamports,
    )?;

    msg!(
        "Keeper vault seeded: {} lamports for mint {}",
        amount_lamports,
        ctx.accounts.keeper_config.sss_mint,
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// crank_circuit_breaker — permissionless, pays keeper reward on success
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct CrankCircuitBreaker<'info> {
    /// The keeper calling this instruction. Receives the reward on success.
    #[account(mut)]
    pub keeper: Signer<'info>,

    #[account(
        mut,
        seeds = [StablecoinConfig::SEED, config.mint.as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(
        mut,
        seeds = [KeeperConfig::SEED, config.mint.as_ref()],
        bump = keeper_config.bump,
        constraint = keeper_config.sss_mint == config.mint @ SssError::KeeperConfigMintMismatch,
    )]
    pub keeper_config: Account<'info, KeeperConfig>,

    /// Oracle price feed account (Pyth, Switchboard, or CustomPriceFeed).
    /// CHECK: validated by get_oracle_price via config.oracle_type + config.oracle_feed.
    pub oracle_feed: AccountInfo<'info>,

    pub system_program: Program<'info, System>,

    pub clock: Sysvar<'info, Clock>,
}

pub fn crank_circuit_breaker_handler(ctx: Context<CrankCircuitBreaker>) -> Result<()> {
    let clock = &ctx.accounts.clock;
    let kc = &mut ctx.accounts.keeper_config;
    let cfg = &mut ctx.accounts.config;

    // 1. FLAG_CIRCUIT_BREAKER must be enabled (feature flag armed by authority).
    require!(
        cfg.feature_flags & FLAG_CIRCUIT_BREAKER != 0,
        SssError::CircuitBreakerNotArmed
    );

    // 2. Not already triggered this cooldown window.
    if kc.last_trigger_slot > 0 {
        require!(
            clock.slot >= kc.last_trigger_slot + kc.min_cooldown_slots,
            SssError::KeeperCooldownActive
        );
    }

    // 3. Already paused — nothing to do.
    require!(!cfg.paused, SssError::MintPaused);

    // 4. Read oracle price.
    let price = oracle::get_oracle_price(
        &ctx.accounts.oracle_feed,
        cfg,
        clock,
    )?;

    // 5. Check deviation from peg.
    let target = kc.target_price as i64;
    let current = price.price; // same oracle units as target_price
    let raw_dev = if current > target { current - target } else { target - current };
    // deviation_bps = |current - target| * 10_000 / target
    let deviation_bps = (raw_dev as u128)
        .saturating_mul(10_000)
        .checked_div(target as u128)
        .unwrap_or(u128::MAX) as u64;

    require!(
        deviation_bps >= kc.deviation_threshold_bps as u64,
        SssError::PegWithinThreshold
    );

    // 6. Trigger: pause the mint.
    cfg.paused = true;
    kc.last_trigger_slot = clock.slot;
    // Reset recovery tracking.
    kc.last_within_threshold_slot = 0;

    // 7. Pay keeper reward from KeeperConfig PDA lamports.
    let reward = kc.keeper_reward_lamports;
    if reward > 0 {
        let vault_lamports = kc.to_account_info().lamports();
        // Ensure vault stays rent-exempt after reward.
        let min_rent = Rent::get()?.minimum_balance(8 + KeeperConfig::INIT_SPACE);
        if vault_lamports.saturating_sub(reward) >= min_rent {
            **kc.to_account_info().try_borrow_mut_lamports()? -= reward;
            **ctx.accounts.keeper.to_account_info().try_borrow_mut_lamports()? += reward;

            emit!(KeeperRewarded {
                mint: cfg.mint,
                keeper: ctx.accounts.keeper.key(),
                reward_lamports: reward,
                slot: clock.slot,
            });
        }
    }

    emit!(CircuitBreakerTriggered {
        mint: cfg.mint,
        keeper: ctx.accounts.keeper.key(),
        oracle_price: price.price,
        target_price: kc.target_price,
        deviation_bps,
        slot: clock.slot,
    });

    msg!(
        "CircuitBreaker TRIGGERED for mint {} at slot {}. deviation_bps={} price={} target={}",
        cfg.mint,
        clock.slot,
        deviation_bps,
        price.price,
        kc.target_price,
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// crank_unpause — permissionless; unpauses once price is stable for recovery window
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct CrankUnpause<'info> {
    /// Anyone may call this (no reward for unpause to avoid griefing).
    pub caller: Signer<'info>,

    #[account(
        mut,
        seeds = [StablecoinConfig::SEED, config.mint.as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(
        mut,
        seeds = [KeeperConfig::SEED, config.mint.as_ref()],
        bump = keeper_config.bump,
        constraint = keeper_config.sss_mint == config.mint @ SssError::KeeperConfigMintMismatch,
    )]
    pub keeper_config: Account<'info, KeeperConfig>,

    /// Oracle price feed account.
    /// CHECK: validated by get_oracle_price.
    pub oracle_feed: AccountInfo<'info>,

    pub clock: Sysvar<'info, Clock>,
}

pub fn crank_unpause_handler(ctx: Context<CrankUnpause>) -> Result<()> {
    let clock = &ctx.accounts.clock;
    let kc = &mut ctx.accounts.keeper_config;
    let cfg = &mut ctx.accounts.config;

    // Must currently be paused.
    require!(cfg.paused, SssError::NotPaused);

    // Read oracle price.
    let price = oracle::get_oracle_price(
        &ctx.accounts.oracle_feed,
        cfg,
        clock,
    )?;

    // Check deviation.
    let target = kc.target_price as i64;
    let current = price.price;
    let raw_dev = if current > target { current - target } else { target - current };
    let deviation_bps = (raw_dev as u128)
        .saturating_mul(10_000)
        .checked_div(target as u128)
        .unwrap_or(u128::MAX) as u64;

    if deviation_bps < kc.deviation_threshold_bps as u64 {
        // Price is within threshold this slot.
        if kc.last_within_threshold_slot == 0 {
            // First slot within threshold — start recovery clock.
            kc.last_within_threshold_slot = clock.slot;
        }
        // Check if recovery window is satisfied.
        let recovery_elapsed = clock.slot.saturating_sub(kc.last_within_threshold_slot);
        require!(
            recovery_elapsed >= kc.sustained_recovery_slots,
            SssError::KeeperRecoveryWindowNotMet
        );

        // Unpausing: price stable for sustained_recovery_slots.
        cfg.paused = false;
        kc.last_within_threshold_slot = 0; // reset

        emit!(CircuitBreakerAutoUnpaused {
            mint: cfg.mint,
            caller: ctx.accounts.caller.key(),
            oracle_price: price.price,
            target_price: kc.target_price,
            deviation_bps,
            recovery_slots: recovery_elapsed,
            slot: clock.slot,
        });

        msg!(
            "CircuitBreaker AUTO-UNPAUSED for mint {} at slot {}. recovery_slots={}",
            cfg.mint,
            clock.slot,
            recovery_elapsed,
        );
    } else {
        // Price still outside threshold — reset recovery window.
        kc.last_within_threshold_slot = 0;
        return err!(SssError::PegStillDeviating);
    }

    Ok(())
}

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    burn, thaw_account, transfer_checked, Burn, Mint, ThawAccount, TokenAccount, TokenInterface,
    TransferChecked,
};

use crate::error::SssError;
use crate::events::{RedemptionCancelled, RedemptionFulfilledQueued, RedemptionQueued};
use crate::state::{RedemptionEntry, RedemptionQueue, StablecoinConfig, FLAG_REDEMPTION_QUEUE};

// ---------------------------------------------------------------------------
// SSS-154: Redemption Queue + Front-Run Protection
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// init_redemption_queue
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct InitRedemptionQueue<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        seeds = [StablecoinConfig::SEED, config.mint.as_ref()],
        bump = config.bump,
        constraint = config.authority == authority.key() @ SssError::Unauthorized,
        constraint = config.feature_flags & FLAG_REDEMPTION_QUEUE != 0 @ SssError::FeatureNotEnabled,
    )]
    pub config: Box<Account<'info, StablecoinConfig>>,

    #[account(
        init,
        payer = authority,
        space = 8 + RedemptionQueue::INIT_SPACE,
        seeds = [RedemptionQueue::SEED, config.mint.as_ref()],
        bump,
    )]
    pub redemption_queue: Box<Account<'info, RedemptionQueue>>,

    pub system_program: Program<'info, System>,
}

pub fn init_redemption_queue_handler(ctx: Context<InitRedemptionQueue>) -> Result<()> {
    let rq = &mut ctx.accounts.redemption_queue;
    rq.bump = ctx.bumps.redemption_queue;
    rq.sss_mint = ctx.accounts.config.mint;
    rq.queue_head = 0;
    rq.queue_tail = 0;
    rq.min_delay_slots = RedemptionQueue::DEFAULT_MIN_DELAY_SLOTS;
    rq.max_queue_depth = RedemptionQueue::DEFAULT_MAX_QUEUE_DEPTH;
    rq.max_redemption_per_slot_bps = RedemptionQueue::DEFAULT_MAX_REDEMPTION_PER_SLOT_BPS;
    rq.last_slot_processed = 0;
    rq.slot_redemption_total = 0;
    rq.keeper_reward_lamports = RedemptionQueue::DEFAULT_KEEPER_REWARD_LAMPORTS;

    msg!(
        "RedemptionQueue initialised: mint={} min_delay={} max_depth={} slot_cap_bps={}",
        rq.sss_mint,
        rq.min_delay_slots,
        rq.max_queue_depth,
        rq.max_redemption_per_slot_bps,
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// enqueue_redemption
// ---------------------------------------------------------------------------

#[derive(Accounts)]
#[instruction(amount: u64)]
pub struct EnqueueRedemption<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        seeds = [StablecoinConfig::SEED, config.mint.as_ref()],
        bump = config.bump,
        constraint = config.feature_flags & FLAG_REDEMPTION_QUEUE != 0 @ SssError::FeatureNotEnabled,
    )]
    pub config: Box<Account<'info, StablecoinConfig>>,

    #[account(
        mut,
        seeds = [RedemptionQueue::SEED, config.mint.as_ref()],
        bump = redemption_queue.bump,
        constraint = redemption_queue.sss_mint == config.mint @ SssError::RedemptionQueueNotInitialized,
    )]
    pub redemption_queue: Box<Account<'info, RedemptionQueue>>,

    /// User's stable token account.
    #[account(
        mut,
        token::mint = stable_mint,
        token::authority = user,
    )]
    pub user_stable_ata: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Escrow: per-entry escrow account.
    /// Seeds: [b"queue-escrow", sss_mint, queue_index.to_le_bytes()]
    /// Authority = redemption_queue PDA.
    #[account(
        init,
        payer = user,
        seeds = [
            b"queue-escrow",
            config.mint.as_ref(),
            &redemption_queue.queue_tail.to_le_bytes(),
        ],
        bump,
        token::mint = stable_mint,
        token::authority = redemption_queue,
    )]
    pub escrow_stable: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        init,
        payer = user,
        space = 8 + RedemptionEntry::INIT_SPACE,
        seeds = [
            RedemptionEntry::SEED,
            config.mint.as_ref(),
            &redemption_queue.queue_tail.to_le_bytes(),
        ],
        bump,
    )]
    pub redemption_entry: Box<Account<'info, RedemptionEntry>>,

    /// SlotHashes sysvar — used to capture slot_hash_seed for front-run protection.
    /// CHECK: validated as SlotHashes sysvar
    #[account(address = anchor_lang::solana_program::sysvar::slot_hashes::ID)]
    pub slot_hashes: UncheckedAccount<'info>,

    pub stable_mint: Box<InterfaceAccount<'info, Mint>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn enqueue_redemption_handler(ctx: Context<EnqueueRedemption>, amount: u64) -> Result<()> {
    require!(amount > 0, SssError::InvalidAmount);

    let rq = &mut ctx.accounts.redemption_queue;
    let queue_depth = rq.queue_tail.saturating_sub(rq.queue_head);
    require!(queue_depth < rq.max_queue_depth, SssError::RedemptionQueueFull);

    let queue_index = rq.queue_tail;
    let clock = Clock::get()?;
    let current_slot = clock.slot;

    // Capture slot hash seed for front-run protection.
    // SlotHashes sysvar: first 8 bytes after the u64 length prefix are the
    // most-recent hash. We take the first 8 bytes of the first hash entry's
    // hash (bytes 8..16 of the raw data, as bytes 0..7 are the slot number).
    let slot_hash_seed = {
        let data = ctx.accounts.slot_hashes.try_borrow_data()?;
        // SlotHashes layout: u64 (count) then repeated (u64 slot, [u8;32] hash)
        // We want the hash of the most recent entry = data[8+8..8+8+8]
        let mut seed = [0u8; 8];
        if data.len() >= 24 {
            seed.copy_from_slice(&data[16..24]);
        }
        seed
    };

    // SSS-091: The escrow token account was just init'd with DefaultAccountState=Frozen.
    // Thaw it using the config PDA (which is the mint's freeze authority) before transfer.
    let mint_key = ctx.accounts.config.mint;
    let config_bump = ctx.accounts.config.bump;
    let thaw_signer_seeds: &[&[&[u8]]] = &[&[
        crate::state::StablecoinConfig::SEED,
        mint_key.as_ref(),
        &[config_bump],
    ]];
    thaw_account(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            ThawAccount {
                account: ctx.accounts.escrow_stable.to_account_info(),
                mint: ctx.accounts.stable_mint.to_account_info(),
                authority: ctx.accounts.config.to_account_info(),
            },
            thaw_signer_seeds,
        ),
    )?;

    // Transfer stable tokens to per-entry escrow
    let decimals = ctx.accounts.stable_mint.decimals;
    transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.user_stable_ata.to_account_info(),
                mint: ctx.accounts.stable_mint.to_account_info(),
                to: ctx.accounts.escrow_stable.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
        amount,
        decimals,
    )?;

    // Initialise entry
    let re = &mut ctx.accounts.redemption_entry;
    re.bump = ctx.bumps.redemption_entry;
    re.queue_index = queue_index;
    re.owner = ctx.accounts.user.key();
    re.amount = amount;
    re.enqueue_slot = current_slot;
    re.slot_hash_seed = slot_hash_seed;
    re.fulfilled = false;
    re.cancelled = false;

    // Advance tail
    rq.queue_tail = rq.queue_tail.saturating_add(1);

    let earliest_process_slot = current_slot.saturating_add(rq.min_delay_slots);

    emit!(RedemptionQueued {
        sss_mint: ctx.accounts.config.mint,
        owner: re.owner,
        queue_index,
        amount,
        enqueue_slot: current_slot,
        slot_hash_seed,
        earliest_process_slot,
    });

    msg!(
        "RedemptionQueued: user={} index={} amount={} earliest_slot={}",
        re.owner,
        queue_index,
        amount,
        earliest_process_slot,
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// process_redemption
// ---------------------------------------------------------------------------

#[derive(Accounts)]
#[instruction(queue_index: u64)]
pub struct ProcessRedemption<'info> {
    /// Keeper — receives lamport reward.
    #[account(mut)]
    pub keeper: Signer<'info>,

    #[account(
        mut,
        seeds = [StablecoinConfig::SEED, config.mint.as_ref()],
        bump = config.bump,
        constraint = config.feature_flags & FLAG_REDEMPTION_QUEUE != 0 @ SssError::FeatureNotEnabled,
    )]
    pub config: Box<Account<'info, StablecoinConfig>>,

    #[account(
        mut,
        seeds = [RedemptionQueue::SEED, config.mint.as_ref()],
        bump = redemption_queue.bump,
        constraint = redemption_queue.sss_mint == config.mint @ SssError::RedemptionQueueNotInitialized,
    )]
    pub redemption_queue: Box<Account<'info, RedemptionQueue>>,

    #[account(
        mut,
        seeds = [RedemptionEntry::SEED, config.mint.as_ref(), &queue_index.to_le_bytes()],
        bump = redemption_entry.bump,
        constraint = !redemption_entry.fulfilled @ SssError::RedemptionAlreadyProcessed,
        constraint = !redemption_entry.cancelled @ SssError::RedemptionAlreadyProcessed,
    )]
    pub redemption_entry: Box<Account<'info, RedemptionEntry>>,

    /// Per-entry escrow — stable tokens to burn.
    #[account(
        mut,
        seeds = [
            b"queue-escrow",
            config.mint.as_ref(),
            &queue_index.to_le_bytes(),
        ],
        bump,
        token::mint = stable_mint,
        token::authority = redemption_queue,
    )]
    pub escrow_stable: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Reserve vault — collateral source.
    #[account(
        mut,
        token::authority = reserve_vault_authority,
    )]
    pub reserve_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Authority over the reserve vault (signs the collateral transfer out).
    pub reserve_vault_authority: Signer<'info>,

    /// User's collateral ATA — receives reserve payout.
    #[account(mut)]
    pub user_collateral_ata: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(mut)]
    pub stable_mint: Box<InterfaceAccount<'info, Mint>>,
    pub collateral_mint: Box<InterfaceAccount<'info, Mint>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn process_redemption_handler(
    ctx: Context<ProcessRedemption>,
    queue_index: u64,
) -> Result<()> {
    let clock = Clock::get()?;
    let current_slot = clock.slot;

    // Phase 1: read/validate and collect values we need — drop mutable borrow before CPI
    let (amount, rq_bump, keeper_reward, collateral_decimals) = {
        let rq = &mut ctx.accounts.redemption_queue;
        let re = &ctx.accounts.redemption_entry;

        // BUG-AUDIT3-007: enforce strict FIFO ordering.
        // Without this check a keeper (or attacker) could skip queue_head and
        // process any arbitrary queue_index, allowing queue ordering to be
        // manipulated (e.g. front-running large redemptions or skipping a
        // temporarily-delayed entry to process a later one first).
        require!(
            queue_index == rq.queue_head,
            SssError::RedemptionQueueOutOfOrder
        );

        // Front-run protection: enforce min delay
        require!(
            current_slot >= re.enqueue_slot.saturating_add(rq.min_delay_slots),
            SssError::RedemptionNotReady
        );

        let amount = re.amount;

        // Per-slot cap enforcement
        if current_slot != rq.last_slot_processed {
            rq.last_slot_processed = current_slot;
            rq.slot_redemption_total = 0;
        }

        // Compute cap: max_redemption_per_slot_bps of stable mint supply
        let stable_supply = ctx.accounts.stable_mint.supply;
        let slot_cap = stable_supply
            .saturating_mul(rq.max_redemption_per_slot_bps as u64)
            .saturating_div(10_000)
            .max(1); // always allow at least 1 unit to avoid deadlock

        require!(
            rq.slot_redemption_total.saturating_add(amount) <= slot_cap,
            SssError::RedemptionSlotCapExceeded
        );

        rq.slot_redemption_total = rq.slot_redemption_total.saturating_add(amount);

        // Advance head: always safe now since queue_index == queue_head is enforced above.
        rq.queue_head = rq.queue_head.saturating_add(1);

        let keeper_reward = rq.keeper_reward_lamports;
        let rq_bump = rq.bump;
        let collateral_decimals = ctx.accounts.collateral_mint.decimals;
        (amount, rq_bump, keeper_reward, collateral_decimals)
    };

    let mint_key = ctx.accounts.config.mint;
    let signer_seeds: &[&[&[u8]]] = &[&[
        RedemptionQueue::SEED,
        mint_key.as_ref(),
        &[rq_bump],
    ]];

    // Burn escrowed stable tokens
    burn(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Burn {
                mint: ctx.accounts.stable_mint.to_account_info(),
                from: ctx.accounts.escrow_stable.to_account_info(),
                authority: ctx.accounts.redemption_queue.to_account_info(),
            },
            signer_seeds,
        ),
        amount,
    )?;

    // Release collateral from reserve vault to user (1:1 par)
    transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.reserve_vault.to_account_info(),
                mint: ctx.accounts.collateral_mint.to_account_info(),
                to: ctx.accounts.user_collateral_ata.to_account_info(),
                authority: ctx.accounts.reserve_vault_authority.to_account_info(),
            },
        ),
        amount,
        collateral_decimals,
    )?;

    // Update config total_burned
    {
        let config = &mut ctx.accounts.config;
        config.total_burned = config.total_burned.saturating_add(amount);
    }

    // Pay keeper reward from redemption_queue PDA lamports
    if keeper_reward > 0 {
        let rq_info = ctx.accounts.redemption_queue.to_account_info();
        let keeper_info = ctx.accounts.keeper.to_account_info();
        let rq_lamports = rq_info.lamports();
        // Only pay if queue has surplus lamports beyond rent-exempt minimum
        let rent = Rent::get()?;
        let min_lamports = rent.minimum_balance(rq_info.data_len());
        let available = rq_lamports.saturating_sub(min_lamports);
        let actual_reward = keeper_reward.min(available);
        if actual_reward > 0 {
            **rq_info.try_borrow_mut_lamports()? -= actual_reward;
            **keeper_info.try_borrow_mut_lamports()? += actual_reward;
        }
    }

    // Mark fulfilled
    let re = &mut ctx.accounts.redemption_entry;
    re.fulfilled = true;

    let owner = re.owner;
    let enqueue_slot = re.enqueue_slot;

    emit!(RedemptionFulfilledQueued {
        sss_mint: mint_key,
        owner,
        queue_index,
        amount,
        enqueue_slot,
        fulfilled_slot: current_slot,
        keeper: ctx.accounts.keeper.key(),
        keeper_reward_lamports: keeper_reward,
    });

    msg!(
        "RedemptionFulfilledQueued: owner={} index={} amount={} keeper={}",
        owner,
        queue_index,
        amount,
        ctx.accounts.keeper.key(),
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// update_redemption_queue — authority can adjust queue parameters
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct UpdateRedemptionQueue<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        seeds = [StablecoinConfig::SEED, config.mint.as_ref()],
        bump = config.bump,
        constraint = config.authority == authority.key() @ SssError::Unauthorized,
    )]
    pub config: Box<Account<'info, StablecoinConfig>>,

    #[account(
        mut,
        seeds = [RedemptionQueue::SEED, config.mint.as_ref()],
        bump = redemption_queue.bump,
        constraint = redemption_queue.sss_mint == config.mint @ SssError::RedemptionQueueNotInitialized,
    )]
    pub redemption_queue: Box<Account<'info, RedemptionQueue>>,
}

pub fn update_redemption_queue_handler(
    ctx: Context<UpdateRedemptionQueue>,
    min_delay_slots: Option<u64>,
    max_queue_depth: Option<u64>,
    max_redemption_per_slot_bps: Option<u16>,
    keeper_reward_lamports: Option<u64>,
) -> Result<()> {
    let rq = &mut ctx.accounts.redemption_queue;
    if let Some(v) = min_delay_slots {
        rq.min_delay_slots = v;
    }
    if let Some(v) = max_queue_depth {
        require!(v > 0, SssError::InvalidAmount);
        rq.max_queue_depth = v;
    }
    if let Some(v) = max_redemption_per_slot_bps {
        require!(v <= 10_000, SssError::InvalidAmount);
        rq.max_redemption_per_slot_bps = v;
    }
    if let Some(v) = keeper_reward_lamports {
        rq.keeper_reward_lamports = v;
    }
    msg!(
        "RedemptionQueue updated: min_delay={} max_depth={} slot_cap_bps={} keeper_reward={}",
        rq.min_delay_slots,
        rq.max_queue_depth,
        rq.max_redemption_per_slot_bps,
        rq.keeper_reward_lamports,
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// cancel_redemption
// ---------------------------------------------------------------------------

#[derive(Accounts)]
#[instruction(queue_index: u64)]
pub struct CancelRedemption<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        seeds = [StablecoinConfig::SEED, config.mint.as_ref()],
        bump = config.bump,
    )]
    pub config: Box<Account<'info, StablecoinConfig>>,

    #[account(
        mut,
        seeds = [RedemptionQueue::SEED, config.mint.as_ref()],
        bump = redemption_queue.bump,
        constraint = redemption_queue.sss_mint == config.mint @ SssError::RedemptionQueueNotInitialized,
    )]
    pub redemption_queue: Box<Account<'info, RedemptionQueue>>,

    #[account(
        mut,
        seeds = [RedemptionEntry::SEED, config.mint.as_ref(), &queue_index.to_le_bytes()],
        bump = redemption_entry.bump,
        constraint = redemption_entry.owner == owner.key() @ SssError::RedemptionNotOwner,
        constraint = !redemption_entry.fulfilled @ SssError::RedemptionAlreadyProcessed,
        constraint = !redemption_entry.cancelled @ SssError::RedemptionAlreadyProcessed,
    )]
    pub redemption_entry: Box<Account<'info, RedemptionEntry>>,

    /// Per-entry escrow — stable tokens returned to user on cancel.
    #[account(
        mut,
        seeds = [
            b"queue-escrow",
            config.mint.as_ref(),
            &queue_index.to_le_bytes(),
        ],
        bump,
        token::mint = stable_mint,
        token::authority = redemption_queue,
    )]
    pub escrow_stable: Box<InterfaceAccount<'info, TokenAccount>>,

    /// User's stable token ATA — receives tokens back.
    #[account(
        mut,
        token::mint = stable_mint,
        token::authority = owner,
    )]
    pub user_stable_ata: Box<InterfaceAccount<'info, TokenAccount>>,

    pub stable_mint: Box<InterfaceAccount<'info, Mint>>,
    pub token_program: Interface<'info, TokenInterface>,
}

pub fn cancel_redemption_handler(
    ctx: Context<CancelRedemption>,
    queue_index: u64,
) -> Result<()> {
    let clock = Clock::get()?;
    let current_slot = clock.slot;

    let re = &ctx.accounts.redemption_entry;
    let amount = re.amount;

    let mint_key = ctx.accounts.config.mint;
    let rq_bump = ctx.accounts.redemption_queue.bump;
    let signer_seeds: &[&[&[u8]]] = &[&[
        RedemptionQueue::SEED,
        mint_key.as_ref(),
        &[rq_bump],
    ]];

    let stable_decimals = ctx.accounts.stable_mint.decimals;

    // Return stable tokens to user
    transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            TransferChecked {
                from: ctx.accounts.escrow_stable.to_account_info(),
                mint: ctx.accounts.stable_mint.to_account_info(),
                to: ctx.accounts.user_stable_ata.to_account_info(),
                authority: ctx.accounts.redemption_queue.to_account_info(),
            },
            signer_seeds,
        ),
        amount,
        stable_decimals,
    )?;

    // Mark cancelled
    let re = &mut ctx.accounts.redemption_entry;
    re.cancelled = true;

    // If cancelling the head, advance head
    let rq = &mut ctx.accounts.redemption_queue;
    if queue_index == rq.queue_head {
        rq.queue_head = rq.queue_head.saturating_add(1);
    }

    emit!(RedemptionCancelled {
        sss_mint: mint_key,
        owner: ctx.accounts.owner.key(),
        queue_index,
        amount,
        cancel_slot: current_slot,
    });

    msg!(
        "RedemptionCancelled: owner={} index={} amount={}",
        ctx.accounts.owner.key(),
        queue_index,
        amount,
    );

    Ok(())
}

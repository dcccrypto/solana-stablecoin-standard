//! SSS-153: Multi-oracle consensus — median/TWAP aggregation with outlier rejection.
//!
//! Provides an `OracleConsensus` PDA that aggregates price from N oracle sources
//! (Pyth, Switchboard, Custom). Instructions:
//!   - `init_oracle_consensus`   — authority-only; create/configure the PDA.
//!   - `update_oracle_consensus` — permissionless keeper; reads N feeds, computes
//!     consensus price, stores result + TWAP, emits events.
//!   - `set_oracle_source`       — authority-only; add/update a source entry.
//!   - `remove_oracle_source`    — authority-only; zero out a source slot.

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenInterface};

use crate::error::SssError;
use crate::events::{OracleConsensusUpdated, OracleOutlierRejected, OracleStalenessDetected};
use crate::oracle::{OraclePrice, ORACLE_CUSTOM, ORACLE_PYTH, ORACLE_SWITCHBOARD};
use crate::state::{
    CustomPriceFeed, OracleConsensus, OracleSource, StablecoinConfig, FLAG_MULTI_ORACLE_CONSENSUS,
};

// ---------------------------------------------------------------------------
// init_oracle_consensus
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct InitOracleConsensus<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [StablecoinConfig::SEED, sss_mint.key().as_ref()],
        bump = config.bump,
        constraint = config.authority == authority.key() @ SssError::Unauthorized,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(constraint = sss_mint.key() == config.mint)]
    pub sss_mint: InterfaceAccount<'info, Mint>,

    /// OracleConsensus PDA — one per stablecoin mint.
    #[account(
        init,
        payer = authority,
        space = 8 + OracleConsensus::INIT_SPACE,
        seeds = [OracleConsensus::SEED, sss_mint.key().as_ref()],
        bump,
    )]
    pub oracle_consensus: Account<'info, OracleConsensus>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

/// Initialise the OracleConsensus PDA and enable FLAG_MULTI_ORACLE_CONSENSUS.
///
/// `min_oracles`: minimum number of fresh, non-outlier sources required to
///   compute a consensus price. If fewer qualify, TWAP fallback is used (if available).
/// `outlier_threshold_bps`: deviation from median (basis points) beyond which a
///   source is classified as an outlier and rejected. E.g. 200 = 2%.
/// `max_age_slots`: maximum age in slots for a source price to be considered fresh.
pub fn init_oracle_consensus_handler(
    ctx: Context<InitOracleConsensus>,
    min_oracles: u8,
    outlier_threshold_bps: u16,
    max_age_slots: u64,
) -> Result<()> {
    require!(min_oracles >= 1 && min_oracles <= OracleConsensus::MAX_SOURCES as u8,
        SssError::InvalidOracleConsensusConfig);
    require!(outlier_threshold_bps > 0 && outlier_threshold_bps <= 5_000,
        SssError::InvalidOracleConsensusConfig);
    require!(max_age_slots > 0, SssError::InvalidOracleConsensusConfig);

    // Enable the feature flag
    let config = &mut ctx.accounts.config;
    config.feature_flags |= FLAG_MULTI_ORACLE_CONSENSUS;

    let oc = &mut ctx.accounts.oracle_consensus;
    oc.mint = ctx.accounts.sss_mint.key();
    oc.min_oracles = min_oracles;
    oc.outlier_threshold_bps = outlier_threshold_bps;
    oc.max_age_slots = max_age_slots;
    oc.source_count = 0;
    oc.sources = vec![OracleSource::default(); OracleConsensus::MAX_SOURCES];
    oc.last_consensus_price = 0;
    oc.last_consensus_slot = 0;
    oc.twap_price = 0;
    oc.twap_last_slot = 0;
    oc.last_consensus_conf = 0;
    oc.bump = ctx.bumps.oracle_consensus;

    msg!("SSS-153: OracleConsensus initialised for mint {}", oc.mint);
    Ok(())
}

// ---------------------------------------------------------------------------
// set_oracle_source
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct SetOracleSource<'info> {
    pub authority: Signer<'info>,

    #[account(
        seeds = [StablecoinConfig::SEED, sss_mint.key().as_ref()],
        bump = config.bump,
        constraint = config.authority == authority.key() @ SssError::Unauthorized,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(constraint = sss_mint.key() == config.mint)]
    pub sss_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [OracleConsensus::SEED, sss_mint.key().as_ref()],
        bump = oracle_consensus.bump,
        constraint = oracle_consensus.mint == sss_mint.key() @ SssError::OracleConsensusNotFound,
    )]
    pub oracle_consensus: Account<'info, OracleConsensus>,

    pub token_program: Interface<'info, TokenInterface>,
}

/// Add or update a source slot in the OracleConsensus PDA.
///
/// `slot_index`: 0..MAX_SOURCES-1 — which slot to write.
/// `oracle_type`: 0=Pyth, 1=Switchboard, 2=Custom.
/// `feed_pubkey`: the price feed account address for this source.
pub fn set_oracle_source_handler(
    ctx: Context<SetOracleSource>,
    slot_index: u8,
    oracle_type: u8,
    feed_pubkey: Pubkey,
) -> Result<()> {
    require!(
        (slot_index as usize) < OracleConsensus::MAX_SOURCES,
        SssError::InvalidOracleSourceIndex
    );
    require!(
        oracle_type == ORACLE_PYTH
            || oracle_type == ORACLE_SWITCHBOARD
            || oracle_type == ORACLE_CUSTOM,
        SssError::InvalidOracleType
    );
    let oc = &mut ctx.accounts.oracle_consensus;
    let was_empty = oc.sources[slot_index as usize].feed == Pubkey::default();
    oc.sources[slot_index as usize] = OracleSource {
        oracle_type,
        feed: feed_pubkey,
    };
    if was_empty && feed_pubkey != Pubkey::default() {
        // Slot was empty, now filled → increment.
        oc.source_count = oc.source_count.saturating_add(1).min(OracleConsensus::MAX_SOURCES as u8);
    } else if !was_empty && feed_pubkey == Pubkey::default() {
        // Slot was filled, now cleared → decrement.
        oc.source_count = oc.source_count.saturating_sub(1);
    }
    // Overwriting a filled slot with another feed (was_empty=false, feed_pubkey≠default)
    // leaves source_count unchanged — count stays the same.
    msg!(
        "SSS-153: source[{}] type={} feed={}",
        slot_index, oracle_type, feed_pubkey
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// remove_oracle_source
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct RemoveOracleSource<'info> {
    pub authority: Signer<'info>,

    #[account(
        seeds = [StablecoinConfig::SEED, sss_mint.key().as_ref()],
        bump = config.bump,
        constraint = config.authority == authority.key() @ SssError::Unauthorized,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(constraint = sss_mint.key() == config.mint)]
    pub sss_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [OracleConsensus::SEED, sss_mint.key().as_ref()],
        bump = oracle_consensus.bump,
        constraint = oracle_consensus.mint == sss_mint.key() @ SssError::OracleConsensusNotFound,
    )]
    pub oracle_consensus: Account<'info, OracleConsensus>,

    pub token_program: Interface<'info, TokenInterface>,
}

pub fn remove_oracle_source_handler(ctx: Context<RemoveOracleSource>, slot_index: u8) -> Result<()> {
    require!(
        (slot_index as usize) < OracleConsensus::MAX_SOURCES,
        SssError::InvalidOracleSourceIndex
    );
    let oc = &mut ctx.accounts.oracle_consensus;
    let was_filled = oc.sources[slot_index as usize].feed != Pubkey::default();
    oc.sources[slot_index as usize] = OracleSource::default();
    if was_filled {
        oc.source_count = oc.source_count.saturating_sub(1);
    }
    msg!("SSS-153: source[{}] removed", slot_index);
    Ok(())
}

// ---------------------------------------------------------------------------
// update_oracle_consensus  (permissionless keeper crank)
// ---------------------------------------------------------------------------

/// Accounts for the multi-oracle consensus update.
///
/// The oracle feed accounts are passed in `remaining_accounts` in the same
/// slot order as `oracle_consensus.sources`.  Slots whose `feed` is
/// `Pubkey::default()` must still have a placeholder (any account) in
/// remaining_accounts at that position so indices line up.
#[derive(Accounts)]
pub struct UpdateOracleConsensus<'info> {
    /// Permissionless: anyone may crank.
    pub keeper: Signer<'info>,

    #[account(
        seeds = [StablecoinConfig::SEED, sss_mint.key().as_ref()],
        bump = config.bump,
    )]
    pub config: Account<'info, StablecoinConfig>,

    #[account(constraint = sss_mint.key() == config.mint)]
    pub sss_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [OracleConsensus::SEED, sss_mint.key().as_ref()],
        bump = oracle_consensus.bump,
        constraint = oracle_consensus.mint == sss_mint.key() @ SssError::OracleConsensusNotFound,
    )]
    pub oracle_consensus: Account<'info, OracleConsensus>,

    pub clock: Sysvar<'info, Clock>,
}

/// Compute a consensus price from the registered oracle sources.
///
/// Algorithm:
/// 1. For each source: read price, check staleness.  Emit OracleStalenessDetected and skip if stale.
/// 2. Compute median of fresh prices.
/// 3. Reject any source whose price deviates > outlier_threshold_bps from the median.
///    Emit OracleOutlierRejected for each.
/// 4. If remaining sources >= min_oracles: use median of accepted prices as consensus.
/// 5. Else: use TWAP fallback (last_consensus_price from previous slot window).
///    Emit OracleConsensusUpdated with `used_twap=true`.
/// 6. Update TWAP as exponential moving average.
pub fn update_oracle_consensus_handler<'info>(
    ctx: Context<'_, '_, 'info, 'info, UpdateOracleConsensus<'info>>,
) -> Result<()> {
    let clock = &ctx.accounts.clock;
    let oc = &mut ctx.accounts.oracle_consensus;
    let remaining = ctx.remaining_accounts;

    require!(
        ctx.accounts.config.feature_flags & FLAG_MULTI_ORACLE_CONSENSUS != 0,
        SssError::MultiOracleNotEnabled
    );

    // H-2: Enforce that caller always passes exactly MAX_SOURCES remaining_accounts
    // (use Pubkey::default() placeholder for empty slots).  This prevents wrong-feed
    // binding caused by a caller omitting trailing placeholder accounts.
    require!(
        remaining.len() == OracleConsensus::MAX_SOURCES,
        SssError::OracleRemainingAccountsMismatch
    );

    // M-2: Return a clear error when the flag is set but no sources are configured.
    require!(oc.config_is_set(), SssError::OracleNoSourcesConfigured);

    let max_age = oc.max_age_slots;
    let outlier_bps = oc.outlier_threshold_bps as u64;
    let min_oracles = oc.min_oracles as usize;
    let current_slot = clock.slot;

    // ── Step 1: collect fresh prices ──────────────────────────────────────
    let mut fresh_prices: [u64; OracleConsensus::MAX_SOURCES] = [0; OracleConsensus::MAX_SOURCES];
    let mut fresh_count = 0usize;
    let mut fresh_idxs: [usize; OracleConsensus::MAX_SOURCES] = [0; OracleConsensus::MAX_SOURCES];

    for i in 0..OracleConsensus::MAX_SOURCES {
        let src = oc.sources[i];
        if src.feed == Pubkey::default() {
            continue;
        }
        // remaining_accounts must have an account at position i
        if i >= remaining.len() {
            emit!(OracleStalenessDetected {
                mint: oc.mint,
                source_index: i as u8,
                feed: src.feed,
                last_slot: 0,
                current_slot,
            });
            continue;
        }
        let feed_acct = &remaining[i];
        // Validate feed key
        require!(
            feed_acct.key() == src.feed,
            SssError::UnexpectedPriceFeed
        );

        // Read price from oracle adapter
        let price_result = read_source_price(src.oracle_type, feed_acct, &ctx.accounts.config, clock);
        match price_result {
            Err(_) | Ok(None) => {
                emit!(OracleStalenessDetected {
                    mint: oc.mint,
                    source_index: i as u8,
                    feed: src.feed,
                    last_slot: 0,
                    current_slot,
                });
            }
            Ok(Some((price, last_slot))) => {
                // Staleness check (slot-based)
                if current_slot.saturating_sub(last_slot) > max_age {
                    emit!(OracleStalenessDetected {
                        mint: oc.mint,
                        source_index: i as u8,
                        feed: src.feed,
                        last_slot,
                        current_slot,
                    });
                } else {
                    fresh_prices[fresh_count] = price;
                    fresh_idxs[fresh_count] = i;
                    fresh_count += 1;
                }
            }
        }
    }

    if fresh_count == 0 {
        // No fresh sources at all — fall back to TWAP if available
        if oc.twap_price > 0 {
            let twap_age = current_slot.saturating_sub(oc.twap_last_slot);
            // Reject TWAP older than 1000 slots (~7 minutes)
            require!(twap_age <= 1000, SssError::StalePriceFeed);
            let twap = oc.twap_price;
            let oc_mint = oc.mint;
            update_twap(oc, twap, current_slot);
            emit!(OracleConsensusUpdated {
                mint: oc_mint,
                consensus_price: twap,
                source_count: 0,
                used_twap: true,
                slot: current_slot,
            });
            return Ok(());
        }
        return err!(SssError::InsufficientOracles);
    }

    // ── Step 2: median of fresh prices ────────────────────────────────────
    let mut sorted = [0u64; OracleConsensus::MAX_SOURCES];
    sorted[..fresh_count].copy_from_slice(&fresh_prices[..fresh_count]);
    sort_slice(&mut sorted[..fresh_count]);
    let median = median_of(&sorted[..fresh_count]);

    // ── Step 3: reject outliers ────────────────────────────────────────────
    let mut accepted_prices: [u64; OracleConsensus::MAX_SOURCES] = [0; OracleConsensus::MAX_SOURCES];
    let mut accepted_count = 0usize;
    for fi in 0..fresh_count {
        let p = fresh_prices[fi];
        let dev_bps = if p >= median {
            p.saturating_sub(median).saturating_mul(10_000) / median.max(1)
        } else {
            median.saturating_sub(p).saturating_mul(10_000) / median.max(1)
        };
        if dev_bps > outlier_bps {
            emit!(OracleOutlierRejected {
                mint: oc.mint,
                source_index: fresh_idxs[fi] as u8,
                feed: oc.sources[fresh_idxs[fi]].feed,
                price: p,
                median,
                deviation_bps: dev_bps,
                slot: current_slot,
            });
        } else {
            accepted_prices[accepted_count] = p;
            accepted_count += 1;
        }
    }

    // ── Step 4/5: consensus or TWAP ───────────────────────────────────────
    let (consensus_price, used_twap) = if accepted_count >= min_oracles {
        let mut accepted_sorted = [0u64; OracleConsensus::MAX_SOURCES];
        accepted_sorted[..accepted_count].copy_from_slice(&accepted_prices[..accepted_count]);
        sort_slice(&mut accepted_sorted[..accepted_count]);
        (median_of(&accepted_sorted[..accepted_count]), false)
    } else if oc.twap_price > 0 {
        let twap_age = current_slot.saturating_sub(oc.twap_last_slot);
        // Reject TWAP older than 1000 slots (~7 minutes)
        require!(twap_age <= 1000, SssError::StalePriceFeed);
        (oc.twap_price, true)
    } else {
        return err!(SssError::InsufficientOracles);
    };

    // Reject zero consensus price (e.g. all sources reported zero)
    require!(consensus_price > 0, SssError::InvalidPrice);

    // Compute confidence as max deviation of any accepted price from consensus
    let max_dev = if !used_twap {
        let mut md: u64 = 0;
        for i in 0..accepted_count {
            let p = accepted_prices[i];
            let dev = if p > consensus_price {
                p.saturating_sub(consensus_price)
            } else {
                consensus_price.saturating_sub(p)
            };
            if dev > md {
                md = dev;
            }
        }
        md
    } else {
        0
    };

    // ── Step 6: update TWAP (EMA: alpha=1/8 ≈ 12.5%) ─────────────────────
    update_twap(oc, consensus_price, current_slot);
    oc.last_consensus_price = consensus_price;
    oc.last_consensus_conf = max_dev;
    oc.last_consensus_slot = current_slot;

    emit!(OracleConsensusUpdated {
        mint: oc.mint,
        consensus_price,
        source_count: accepted_count as u8,
        used_twap,
        slot: current_slot,
    });

    Ok(())
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Read a normalised u64 price (same scale as OraclePrice.price) and the slot
/// of last update from an oracle feed account.
/// Returns Ok(None) if the adapter returns an error or the price is zero.
fn read_source_price(
    oracle_type: u8,
    feed_acct: &AccountInfo,
    config: &StablecoinConfig,
    clock: &Clock,
) -> Result<Option<(u64, u64)>> {
    match oracle_type {
        ORACLE_PYTH => {
            // H-1: Read the actual Pyth publish slot (agg.pub_slot) instead of
            // clock.slot, so the per-source max_age_slots staleness check in
            // update_oracle_consensus is meaningful for Pyth feeds.
            use pyth_sdk_solana::state::load_price_account;
            let data = feed_acct.try_borrow_data()?;
            let price_acct = load_price_account::<32, ()>(&data)
                .map_err(|_| error!(SssError::InvalidPriceFeed))?;
            let actual_slot = price_acct.agg.pub_slot;
            let price = price_acct.agg.price;
            drop(data);
            if price <= 0 {
                return Ok(None);
            }
            Ok(Some((price as u64, actual_slot)))
        }
        ORACLE_SWITCHBOARD => {
            use crate::oracle::switchboard;
            match switchboard::get_price(feed_acct) {
                Ok(op) if op.price > 0 => Ok(Some((op.price as u64, clock.slot))),
                _ => Ok(None),
            }
        }
        ORACLE_CUSTOM => {
            // Read CustomPriceFeed PDA directly (zero-copy raw read).
            // Anchor account layout (8-byte discriminator + fields):
            //   discriminator:     8 bytes  @ offset  0
            //   authority:        Pubkey    @ offset  8 (32 bytes)
            //   price:            i64       @ offset 40 (8 bytes)
            //   expo:             i32       @ offset 48 (4 bytes)
            //   conf:             u64       @ offset 52 (8 bytes)
            //   last_update_slot: u64       @ offset 60 (8 bytes)
            //   last_update_unix_timestamp: i64 @ offset 68
            //   bump:             u8        @ offset 76
            const PRICE_OFF: usize = 40;
            const SLOT_OFF: usize = 60; // last_update_slot
            const MIN_LEN: usize = 77;
            let data = feed_acct.try_borrow_data()?;
            if data.len() < MIN_LEN {
                return Ok(None);
            }
            let price_bytes: [u8; 8] = data[PRICE_OFF..PRICE_OFF + 8].try_into().unwrap();
            let slot_bytes: [u8; 8] = data[SLOT_OFF..SLOT_OFF + 8].try_into().unwrap();
            let price = i64::from_le_bytes(price_bytes);
            let last_slot = u64::from_le_bytes(slot_bytes);
            if price <= 0 { return Ok(None); }
            Ok(Some((price as u64, last_slot)))
        }
        _ => Ok(None),
    }
}

/// Simple insertion sort (N≤5; no std::sort in BPF).
fn sort_slice(slice: &mut [u64]) {
    let n = slice.len();
    for i in 1..n {
        let key = slice[i];
        let mut j = i;
        while j > 0 && slice[j - 1] > key {
            slice[j] = slice[j - 1];
            j -= 1;
        }
        slice[j] = key;
    }
}

/// Median of a sorted (ascending) slice.
fn median_of(sorted: &[u64]) -> u64 {
    let n = sorted.len();
    if n == 0 {
        return 0;
    }
    if n % 2 == 1 {
        sorted[n / 2]
    } else {
        // average of two middle values
        let lo = sorted[n / 2 - 1];
        let hi = sorted[n / 2];
        lo / 2 + hi / 2 + (lo & hi & 1)
    }
}

/// Update TWAP as EMA: twap = (twap * 7 + new_price) / 8.
///
/// M-1 fix: compute the full product before dividing to avoid precision loss
/// from the previous `twap/8*7 + new/8` form (which discarded up to 14 ULP
/// per update step).
fn update_twap(oc: &mut OracleConsensus, new_price: u64, slot: u64) {
    if oc.twap_price == 0 {
        oc.twap_price = new_price;
    } else {
        // Use u128 intermediary to avoid overflow before division.
        let next = (oc.twap_price as u128)
            .saturating_mul(7)
            .saturating_add(new_price as u128)
            / 8;
        oc.twap_price = next.min(u64::MAX as u128) as u64;
    }
    oc.twap_last_slot = slot;
}

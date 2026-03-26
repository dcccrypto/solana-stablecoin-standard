use anchor_lang::prelude::*;
use anchor_lang::system_program;
use spl_tlv_account_resolution::{account::ExtraAccountMeta, seeds::Seed, state::ExtraAccountMetaList};
use spl_transfer_hook_interface::instruction::ExecuteInstruction;

declare_id!("phAtzRyRUJGpMC3ftAtWzoaX7UkghRe9x5KTig8jPQp");

// ---------------------------------------------------------------------------
// Constants mirrored from sss-token/src/state.rs
// Kept in sync manually — update here whenever state.rs changes.
// ---------------------------------------------------------------------------

/// Discriminator for StablecoinConfig accounts (first 8 bytes of sha256("account:StablecoinConfig")).
/// Computed: sha256(b"account:StablecoinConfig")[0..8] = 7f19f4d501c06506
const STABLECOIN_CONFIG_DISCRIMINATOR: [u8; 8] = [0x7f, 0x19, 0xf4, 0xd5, 0x01, 0xc0, 0x65, 0x06];

/// Byte offset of `feature_flags` within StablecoinConfig account data.
/// Borsh serialization (no alignment padding):
///   discriminator                  8   @ 0
///   mint         Pubkey           32   @ 8
///   authority    Pubkey           32   @ 40
///   compliance_authority Pubkey   32   @ 72
///   preset       u8                1   @ 104
///   paused       bool              1   @ 105
///   total_minted u64               8   @ 106
///   total_burned u64               8   @ 114
///   transfer_hook_program Pubkey  32   @ 122
///   collateral_mint Pubkey        32   @ 154
///   reserve_vault Pubkey          32   @ 186
///   total_collateral u64           8   @ 218
///   max_supply   u64               8   @ 226
///   pending_authority Pubkey      32   @ 234
///   pending_compliance_authority  32   @ 266
///   feature_flags u64              8   @ 298  <--
///   max_transfer_amount u64        8   @ 306  <--
///   bump         u8                1   @ 314
const FEATURE_FLAGS_OFFSET: usize = 298;
const MAX_TRANSFER_AMOUNT_OFFSET: usize = 306;

/// FLAG_SPEND_POLICY bit in feature_flags (bit 1 = 1 << 1).
const FLAG_SPEND_POLICY: u64 = 1 << 1;

/// FLAG_ZK_COMPLIANCE bit in feature_flags (bit 4 = 1 << 4).
const FLAG_ZK_COMPLIANCE: u64 = 1 << 4;

/// FLAG_SANCTIONS_ORACLE bit in feature_flags (bit 9 = 1 << 9).
const FLAG_SANCTIONS_ORACLE: u64 = 1 << 9;

/// FLAG_ZK_CREDENTIALS bit in feature_flags (bit 10 = 1 << 10).
const FLAG_ZK_CREDENTIALS: u64 = 1 << 10;

/// FLAG_WALLET_RATE_LIMITS bit in feature_flags (bit 14 = 1 << 14).
const FLAG_WALLET_RATE_LIMITS: u64 = 1 << 14;

/// PDA seed for WalletRateLimit in the sss-token program.
const WALLET_RATE_LIMIT_SEED: &[u8] = b"wallet-rate-limit";

/// Byte offsets within WalletRateLimit account data (Borsh layout):
///   discriminator                8  @ 0
///   sss_mint         Pubkey     32  @ 8
///   wallet           Pubkey     32  @ 40
///   max_transfer_per_window u64  8  @ 72
///   window_slots             u64  8  @ 80
///   transferred_this_window  u64  8  @ 88
///   window_start_slot        u64  8  @ 96
///   bump             u8           1  @ 104
const WRL_MAX_TRANSFER_OFFSET: usize = 72;
const WRL_WINDOW_SLOTS_OFFSET: usize = 80;
const WRL_TRANSFERRED_OFFSET: usize = 88;
const WRL_WINDOW_START_OFFSET: usize = 96;
const WRL_MIN_SIZE: usize = 104;

/// PDA seed for CredentialRecord in the sss-token program.
const CREDENTIAL_RECORD_SEED: &[u8] = b"credential-record";

/// Program ID of the sss-token program that owns CredentialRecord PDAs.
/// CredentialRecord PDAs are derived against THIS program, not the transfer-hook.
const SSS_TOKEN_PROGRAM_ID: &str = "AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat";

/// PDA seed for VerificationRecord in the sss-token program.
const ZK_VERIFICATION_SEED: &[u8] = b"zk-verification";

/// Byte offsets within VerificationRecord account data (Borsh layout):
///   discriminator          8  @ 0
///   sss_mint  Pubkey      32  @ 8
///   user      Pubkey      32  @ 40
///   expires_at_slot u64    8  @ 72
///   bump      u8           1  @ 80
const ZK_RECORD_EXPIRES_OFFSET: usize = 72;
const ZK_RECORD_MIN_SIZE: usize = 80;

/// PDA seed for SanctionsRecord in the sss-token program.
const SANCTIONS_RECORD_SEED: &[u8] = b"sanctions-record";

/// Byte offset of `sanctions_oracle` (Pubkey, 32 bytes) in StablecoinConfig.
/// Layout from FEATURE_FLAGS_OFFSET=298:
///   306  max_transfer_amount  u64   8
///   314  expected_pyth_feed   Pubkey 32
///   346  admin_op_mature_slot u64   8
///   354  admin_op_kind        u8    1
///   355  admin_op_param       u64   8
///   363  admin_op_target      Pubkey 32
///   395  admin_timelock_delay u64   8
///   403  max_oracle_age_secs  u32   4
///   407  max_oracle_conf_bps  u16   2
///   409  stability_fee_bps    u16   2
///   411  redemption_fee_bps   u16   2
///   413  insurance_fund_pubkey Pubkey 32
///   445  max_backstop_bps     u16   2
///   447  auditor_elgamal_pubkey [u8;32] 32
///   479  min_reserve_ratio_bps u16  2
///   481  reserve_attestor_whitelist [Pubkey;4] 128
///   609  travel_rule_threshold u64  8
///   617  sanctions_oracle     Pubkey 32   <--
///   649  sanctions_max_staleness_slots u64 8
///   657  bump                 u8    1
const SANCTIONS_ORACLE_OFFSET: usize = 617;
const SANCTIONS_MAX_STALENESS_OFFSET: usize = 649;
const SANCTIONS_CONFIG_MIN_SIZE: usize = 658; // discriminator(8) + up through bump(1)

/// Byte offsets within SanctionsRecord account data (Borsh layout):
///   discriminator      8  @ 0
///   is_sanctioned bool 1  @ 8
///   updated_slot  u64  8  @ 9
///   bump          u8   1  @ 17
const SANCTIONS_IS_SANCTIONED_OFFSET: usize = 8;
const SANCTIONS_UPDATED_SLOT_OFFSET: usize = 9;
const SANCTIONS_RECORD_MIN_SIZE: usize = 17;

/// PDA seed for StablecoinConfig in the sss-token program.
const STABLECOIN_CONFIG_SEED: &[u8] = b"stablecoin-config";

/// sss-token program ID (for PDA derivation of StablecoinConfig).
/// Used to verify the stablecoin_config PDA address in transfer_hook.
pub mod sss_token_program {
    use anchor_lang::declare_id;
    declare_id!("AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat");
}

/// SSS-2 Transfer Hook — enforces blacklist and spend policy on every transfer.
///
/// This program is invoked by Token-2022 on every transfer for mints
/// that have registered this as their transfer hook.
///
/// Token-2022 Transfer Hook Interface:
/// - `initialize_extra_account_meta_list` sets up the canonical PDA at
///   seeds [b"extra-account-metas", mint] telling Token-2022 which extra
///   accounts to resolve and pass when invoking the hook.
/// - `transfer_hook` (with `#[interface]` attribute) is the execute entry
///   point. Token-2022 dispatches here using the SPL discriminator.
#[program]
pub mod sss_transfer_hook {
    use super::*;

    /// Called by Token-2022 on every transfer.
    ///
    /// CRITICAL: The `#[interface(spl_transfer_hook_interface::execute)]`
    /// attribute makes Anchor emit the correct SPL discriminator so Token-2022
    /// can find and invoke this instruction.
    ///
    /// Checks performed (in order):
    ///   1. Sender not blacklisted
    ///   2. Receiver not blacklisted
    ///   3. If FLAG_SPEND_POLICY is set: amount ≤ max_transfer_amount
    ///
    /// Accounts (in Token-2022's required order):
    ///   0. source_token_account
    ///   1. mint
    ///   2. destination_token_account
    ///   3. owner (source owner/delegate)
    ///   4. extra_account_meta_list (validation account)
    ///   5. blacklist_state       — PDA [b"blacklist-state", mint]
    ///   6. stablecoin_config     — PDA [b"stablecoin-config", mint] (sss-token program)
    #[interface(spl_transfer_hook_interface::execute)]
    pub fn transfer_hook(ctx: Context<TransferHook>, amount: u64) -> Result<()> {
        let blacklist = &ctx.accounts.blacklist_state;

        // Check sender — read owner from Token-2022 token account layout (owner at offset 32..64)
        let src_data = ctx.accounts.source_token_account.try_borrow_data()?;
        let src_owner =
            Pubkey::try_from(&src_data[32..64]).map_err(|_| error!(HookError::SenderBlacklisted))?;
        require!(
            !blacklist.is_blacklisted(&src_owner),
            HookError::SenderBlacklisted
        );

        // Check receiver
        let dst_data = ctx.accounts.destination_token_account.try_borrow_data()?;
        let dst_owner =
            Pubkey::try_from(&dst_data[32..64]).map_err(|_| error!(HookError::ReceiverBlacklisted))?;
        require!(
            !blacklist.is_blacklisted(&dst_owner),
            HookError::ReceiverBlacklisted
        );

        // --- Spend policy check ---
        // Read feature_flags and max_transfer_amount from StablecoinConfig via
        // manual byte-level deserialization (avoids cross-program crate dep).
        {
            // Verify the stablecoin_config PDA is derived from the expected program + seeds.
            let (expected_pda, _bump) = Pubkey::find_program_address(
                &[STABLECOIN_CONFIG_SEED, ctx.accounts.mint.key().as_ref()],
                &sss_token_program::ID,
            );
            require!(
                ctx.accounts.stablecoin_config.key() == expected_pda,
                HookError::InvalidConfig
            );

            let config_data = ctx.accounts.stablecoin_config.try_borrow_data()?;
            // Verify discriminator and minimum size
            require!(
                config_data.len() >= MAX_TRANSFER_AMOUNT_OFFSET + 8,
                HookError::InvalidConfig
            );
            require!(
                &config_data[0..8] == &STABLECOIN_CONFIG_DISCRIMINATOR,
                HookError::InvalidConfig
            );
            let feature_flags = u64::from_le_bytes(
                config_data[FEATURE_FLAGS_OFFSET..FEATURE_FLAGS_OFFSET + 8]
                    .try_into()
                    .unwrap(),
            );
            if feature_flags & FLAG_SPEND_POLICY != 0 {
                let max_transfer_amount = u64::from_le_bytes(
                    config_data[MAX_TRANSFER_AMOUNT_OFFSET..MAX_TRANSFER_AMOUNT_OFFSET + 8]
                        .try_into()
                        .unwrap(),
                );
                require!(
                    amount <= max_transfer_amount,
                    HookError::SpendLimitExceeded
                );
                msg!(
                    "SpendPolicy OK: {} <= max {}",
                    amount,
                    max_transfer_amount
                );
            }

            // --- ZK compliance check ---
            // If FLAG_ZK_COMPLIANCE is set, the sender must have a valid, non-expired
            // VerificationRecord PDA at seeds [b"zk-verification", mint, src_owner].
            if feature_flags & FLAG_ZK_COMPLIANCE != 0 {
                let vr_account = &ctx.accounts.verification_record;
                // BUG-036 fix: derive VR PDA using src_owner (token account owner from
                // bytes 32..64) NOT ctx.accounts.owner (index 3 = delegate for delegated
                // transfers). Using the delegate allowed a sender with no VerificationRecord
                // to delegate to a verified party and bypass ZK compliance.
                // Consistency: blacklist checks also use src_owner (bytes 32..64), so ZK
                // compliance must match. Both now key off the true token account owner.
                let (expected_vr_pda, _bump) = Pubkey::find_program_address(
                    &[
                        ZK_VERIFICATION_SEED,
                        ctx.accounts.mint.key().as_ref(),
                        src_owner.as_ref(),
                    ],
                    &sss_token_program::ID,
                );
                require!(
                    vr_account.key() == expected_vr_pda,
                    HookError::ZkRecordMissing
                );
                let vr_data = vr_account.try_borrow_data()?;
                require!(
                    vr_data.len() >= ZK_RECORD_MIN_SIZE,
                    HookError::ZkRecordMissing
                );
                let clock = Clock::get()?;
                let expires_at = u64::from_le_bytes(
                    vr_data[ZK_RECORD_EXPIRES_OFFSET..ZK_RECORD_EXPIRES_OFFSET + 8]
                        .try_into()
                        .unwrap(),
                );
                require!(
                    clock.slot < expires_at,
                    HookError::ZkRecordExpired
                );
                msg!(
                    "ZkCompliance OK: sender {} verified until slot {}",
                    src_owner,
                    expires_at
                );
            }

            // --- Sanctions oracle check ---
            // If FLAG_SANCTIONS_ORACLE is set, check if the sender has a SanctionsRecord
            // PDA that marks them as sanctioned.  The SanctionsRecord is written by the
            // registered oracle signer via update_sanctions_record in the sss-token program.
            // Seeds: [b"sanctions-record", mint, src_owner]
            if feature_flags & FLAG_SANCTIONS_ORACLE != 0
                && config_data.len() >= SANCTIONS_CONFIG_MIN_SIZE
            {
                let sanctions_oracle_bytes: [u8; 32] = config_data
                    [SANCTIONS_ORACLE_OFFSET..SANCTIONS_ORACLE_OFFSET + 32]
                    .try_into()
                    .unwrap();
                let sanctions_oracle = Pubkey::from(sanctions_oracle_bytes);

                let sanctions_max_staleness = u64::from_le_bytes(
                    config_data[SANCTIONS_MAX_STALENESS_OFFSET..SANCTIONS_MAX_STALENESS_OFFSET + 8]
                        .try_into()
                        .unwrap(),
                );

                // Only enforce when oracle is configured (non-default pubkey).
                if sanctions_oracle != Pubkey::default() {
                    // BUG-035 fix: derive expected PDA first, then REQUIRE it be present.
                    // Previously, omitting remaining_accounts[0] silently bypassed this check
                    // — sanctioned wallets could transfer by simply not passing the PDA.
                    // Fix: the check is FAIL-CLOSED. If FLAG_SANCTIONS_ORACLE is set and the
                    // expected SanctionsRecord PDA is not present in remaining_accounts with
                    // the correct key, the transfer is REJECTED.
                    let (expected_sr_pda, _bump) = Pubkey::find_program_address(
                        &[
                            SANCTIONS_RECORD_SEED,
                            ctx.accounts.mint.key().as_ref(),
                            src_owner.as_ref(),
                        ],
                        &sss_token_program::ID,
                    );
                    // Find the SanctionsRecord PDA in remaining_accounts.
                    let sr_account = ctx
                        .remaining_accounts
                        .iter()
                        .find(|a| a.key() == expected_sr_pda)
                        .ok_or_else(|| error!(HookError::SanctionsRecordMissing))?;

                    let sr_data = sr_account.try_borrow_data()?;
                    require!(
                        sr_data.len() >= SANCTIONS_RECORD_MIN_SIZE,
                        HookError::SanctionsRecordMissing
                    );
                    let is_sanctioned = sr_data[SANCTIONS_IS_SANCTIONED_OFFSET] != 0;
                    if is_sanctioned {
                        // Staleness check.
                        if sanctions_max_staleness > 0 {
                            let clock = Clock::get()?;
                            let updated_slot = u64::from_le_bytes(
                                sr_data[SANCTIONS_UPDATED_SLOT_OFFSET
                                    ..SANCTIONS_UPDATED_SLOT_OFFSET + 8]
                                    .try_into()
                                    .unwrap(),
                            );
                            let age = clock.slot.saturating_sub(updated_slot);
                            if age > sanctions_max_staleness {
                                return Err(error!(HookError::SanctionsRecordStale));
                            }
                        }
                        return Err(error!(HookError::SanctionedAddress));
                    }
                    msg!("SanctionsOracle OK: sender {} not sanctioned", src_owner);
                }
            }

            // SSS-129: If FLAG_ZK_CREDENTIALS is set, the sender must hold a
            // valid (non-revoked, non-expired) CredentialRecord PDA.
            // Seeds: [b"credential-record", mint, src_owner]  in sss-token program.
            if feature_flags & FLAG_ZK_CREDENTIALS != 0 {
                // CredentialRecord is passed as the last remaining_account
                // (after sanctions_record when both flags are active).
                // Find it by deriving the expected PDA and matching.
                // BUG-002 fix: CredentialRecord lives in sss-token, not transfer-hook.
                // Using crate::ID (transfer-hook) would derive the wrong PDA address.
                let sss_token_pid: Pubkey = SSS_TOKEN_PROGRAM_ID.parse().unwrap();
                let (expected_cr_pda, _bump) = Pubkey::find_program_address(
                    &[CREDENTIAL_RECORD_SEED, ctx.accounts.mint.key().as_ref(), src_owner.as_ref()],
                    &sss_token_pid,
                );
                // Walk remaining_accounts looking for the CredentialRecord PDA.
                let cr_account_opt = ctx.remaining_accounts.iter().find(|a| a.key() == expected_cr_pda);

                if let Some(cr_account) = cr_account_opt {
                    let cr_data = cr_account.try_borrow_data()?;
                    if cr_data.len() >= 8 + 32 + 32 + 8 + 8 + 1 + 1 {
                        // Layout (after 8-byte discriminator):
                        //   sss_mint   Pubkey  32  @ 8
                        //   holder     Pubkey  32  @ 40
                        //   issued_slot u64     8  @ 72
                        //   expires_slot u64    8  @ 80
                        //   revoked    bool     1  @ 88
                        const CR_REVOKED_OFFSET: usize = 88;
                        const CR_EXPIRES_SLOT_OFFSET: usize = 80;

                        let revoked = cr_data[CR_REVOKED_OFFSET] != 0;
                        if revoked {
                            return Err(error!(HookError::CredentialRevoked));
                        }

                        let expires_slot = u64::from_le_bytes(
                            cr_data[CR_EXPIRES_SLOT_OFFSET..CR_EXPIRES_SLOT_OFFSET + 8]
                                .try_into()
                                .unwrap(),
                        );
                        if expires_slot > 0 {
                            let clock = Clock::get()?;
                            if clock.slot > expires_slot {
                                return Err(error!(HookError::CredentialExpired));
                            }
                        }
                        msg!("ZkCredentials OK: sender {} credential valid", src_owner);
                    } else {
                        return Err(error!(HookError::CredentialRequired));
                    }
                } else {
                    // No CredentialRecord PDA found — reject.
                    return Err(error!(HookError::CredentialRequired));
                }
            }

            // --- Per-wallet rate limit check ---
            //
            // When FLAG_WALLET_RATE_LIMITS is set, look for a WalletRateLimit PDA
            // for the sender in remaining_accounts.  If found, enforce the rolling
            // window limit and update the window counters atomically.
            // Seeds: [b"wallet-rate-limit", mint, src_owner]  in sss-token program.
            //
            // SECURITY: if FLAG_WALLET_RATE_LIMITS is set and the WRL PDA is NOT
            // present in remaining_accounts, the transfer is REJECTED.  Omitting
            // the PDA is not a bypass — callers must provide the WRL PDA or the
            // admin must disable FLAG_WALLET_RATE_LIMITS for this mint.
            //
            // NOTE (architectural): The write-back uses try_borrow_mut_data on a
            // sss-token-owned account.  This works correctly on Solana (account
            // data is mutable within a transaction regardless of owner) but the
            // long-term fix is CPI to sss-token::update_wallet_rate_limit
            // (requires ExtraAccountMetaList update + transfer-hook program upgrade).
            if feature_flags & FLAG_WALLET_RATE_LIMITS != 0 {
                let (expected_wrl_pda, _bump) = Pubkey::find_program_address(
                    &[
                        WALLET_RATE_LIMIT_SEED,
                        ctx.accounts.mint.key().as_ref(),
                        src_owner.as_ref(),
                    ],
                    &sss_token_program::ID,
                );

                // Look for the WalletRateLimit PDA in remaining_accounts.
                // SECURITY FIX: if not found, REJECT the transfer.
                let wrl_account = ctx
                    .remaining_accounts
                    .iter()
                    .find(|a| a.key() == expected_wrl_pda)
                    .ok_or(error!(HookError::WalletRateLimitAccountNotWritable))?;

                require!(
                    wrl_account.is_writable,
                    HookError::WalletRateLimitAccountNotWritable
                );

                let mut wrl_data = wrl_account.try_borrow_mut_data()?;
                require!(
                    wrl_data.len() >= WRL_MIN_SIZE,
                    HookError::WalletRateLimitAccountNotWritable
                );

                // Read current state
                let max_transfer = u64::from_le_bytes(
                    wrl_data[WRL_MAX_TRANSFER_OFFSET..WRL_MAX_TRANSFER_OFFSET + 8]
                        .try_into()
                        .unwrap(),
                );
                let window_slots = u64::from_le_bytes(
                    wrl_data[WRL_WINDOW_SLOTS_OFFSET..WRL_WINDOW_SLOTS_OFFSET + 8]
                        .try_into()
                        .unwrap(),
                );
                let transferred = u64::from_le_bytes(
                    wrl_data[WRL_TRANSFERRED_OFFSET..WRL_TRANSFERRED_OFFSET + 8]
                        .try_into()
                        .unwrap(),
                );
                let window_start = u64::from_le_bytes(
                    wrl_data[WRL_WINDOW_START_OFFSET..WRL_WINDOW_START_OFFSET + 8]
                        .try_into()
                        .unwrap(),
                );

                let clock = Clock::get()?;
                let current_slot = clock.slot;

                // Determine if we are in the same window or need to reset
                let window_elapsed = window_start == 0
                    || current_slot >= window_start.saturating_add(window_slots);

                let new_transferred: u64;
                let new_window_start: u64;

                if window_elapsed {
                    // New window — reset counter, start fresh
                    new_window_start = current_slot;
                    new_transferred = amount;
                } else {
                    // Same window — accumulate
                    new_window_start = window_start;
                    new_transferred = transferred.saturating_add(amount);
                }

                // Enforce the cap
                require!(
                    new_transferred <= max_transfer,
                    HookError::WalletRateLimitExceeded
                );

                // Write updated state back
                wrl_data[WRL_TRANSFERRED_OFFSET..WRL_TRANSFERRED_OFFSET + 8]
                    .copy_from_slice(&new_transferred.to_le_bytes());
                wrl_data[WRL_WINDOW_START_OFFSET..WRL_WINDOW_START_OFFSET + 8]
                    .copy_from_slice(&new_window_start.to_le_bytes());

                msg!(
                    "WalletRateLimit OK: wallet={} transferred={}/{} window_reset={}",
                    src_owner,
                    new_transferred,
                    max_transfer,
                    window_elapsed
                );
            }
        }

        msg!("Transfer hook: {} tokens OK", amount);
        Ok(())
    }

    /// Initialize the ExtraAccountMetaList and the blacklist state.
    ///
    /// Must be called once after mint creation (SSS-2 preset) before any
    /// transfers can occur.
    ///
    /// This creates the canonical `extra_account_meta_list` PDA at seeds
    /// [b"extra-account-metas", mint] that Token-2022 looks up on every
    /// transfer to know which additional accounts to resolve and forward.
    ///
    /// Extra accounts registered (resolved by Token-2022 at transfer time):
    ///   5. blacklist_state        — seeds [b"blacklist-state", mint (index 1)]
    ///   6. stablecoin_config      — seeds [b"stablecoin-config", mint (index 1)] (sss-token program)
    ///   7. verification_record    — seeds [b"zk-verification", mint (index 1), owner (index 3)] (sss-token program)
    pub fn initialize_extra_account_meta_list(
        ctx: Context<InitializeExtraAccountMetaList>,
    ) -> Result<()> {
        // Build the extra account list:
        // In the Execute instruction accounts:
        //   index 0 = source_token_account
        //   index 1 = mint
        //   index 2 = destination_token_account
        //   index 3 = owner
        //   index 4 = extra_account_meta_list (validation account itself)
        //   index 5 = blacklist_state    (our extra #1)
        //   index 6 = stablecoin_config  (our extra #2)
        let account_metas = vec![
            // blacklist_state PDA: seeds = [b"blacklist-state", mint (index 1)]
            ExtraAccountMeta::new_with_seeds(
                &[
                    Seed::Literal {
                        bytes: b"blacklist-state".to_vec(),
                    },
                    Seed::AccountKey { index: 1 }, // mint is at index 1
                ],
                false, // is_signer
                false, // is_writable
            )?,
            // stablecoin_config PDA: seeds = [b"stablecoin-config", mint (index 1)]
            // owned by sss-token program — resolved by Token-2022 from seeds
            ExtraAccountMeta::new_with_seeds(
                &[
                    Seed::Literal {
                        bytes: b"stablecoin-config".to_vec(),
                    },
                    Seed::AccountKey { index: 1 }, // mint is at index 1
                ],
                false, // is_signer
                false, // is_writable
            )?,
            // verification_record PDA: seeds = [b"zk-verification", mint (index 1), src_owner]
            // BUG-036 fix: use source token account owner (bytes 32..64 from index 0),
            // NOT the delegate/signer at index 3. This ensures a delegated transfer
            // cannot bypass ZK compliance by delegating to a verified party.
            // owned by sss-token program — only enforced when FLAG_ZK_COMPLIANCE is set
            ExtraAccountMeta::new_with_seeds(
                &[
                    Seed::Literal {
                        bytes: b"zk-verification".to_vec(),
                    },
                    Seed::AccountKey { index: 1 }, // mint is at index 1
                    // Read src_owner from source_token_account (index 0) at data offset 32, length 32
                    Seed::AccountData {
                        account_index: 0, // source_token_account
                        data_index: 32,   // owner field starts at byte 32 in Token-2022 account
                        length: 32,       // Pubkey length
                    },
                ],
                false, // is_signer
                false, // is_writable
            )?,
        ];

        // Calculate space required for the ExtraAccountMetaList TLV data
        let account_size = ExtraAccountMetaList::size_of(account_metas.len())? as usize;

        // Create the extra_account_meta_list account with the correct size upfront.
        // Using create_account (not transfer+realloc) so the account is allocated
        // and owned by this program in a single CPI, avoiding the two-step
        // "transfer then realloc" which fails on system-owned accounts.
        let rent = Rent::get()?;
        let lamports = rent.minimum_balance(account_size);
        let (_, bump_seed) = Pubkey::find_program_address(
            &[b"extra-account-metas", ctx.accounts.mint.key().as_ref()],
            ctx.program_id,
        );
        system_program::create_account(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                system_program::CreateAccount {
                    from: ctx.accounts.authority.to_account_info(),
                    to: ctx.accounts.extra_account_meta_list.to_account_info(),
                },
                &[&[
                    b"extra-account-metas",
                    ctx.accounts.mint.key().as_ref(),
                    &[bump_seed],
                ]],
            ),
            lamports,
            account_size as u64,
            ctx.program_id,
        )?;

        // Write the ExtraAccountMetaList data
        {
            let mut data = ctx
                .accounts
                .extra_account_meta_list
                .try_borrow_mut_data()?;
            ExtraAccountMetaList::init::<ExecuteInstruction>(&mut data, &account_metas)?;
        }

        // Initialize the blacklist state PDA
        let bl = &mut ctx.accounts.blacklist_state;
        bl.mint = ctx.accounts.mint.key();
        bl.authority = ctx.accounts.authority.key();
        bl.blacklisted = Vec::new();
        bl.bump = ctx.bumps.blacklist_state;

        msg!(
            "TransferHook initialized: mint={} extra_account_meta_list={}",
            ctx.accounts.mint.key(),
            ctx.accounts.extra_account_meta_list.key()
        );

        Ok(())
    }

    /// Add an address to the blacklist (no token account freeze).
    ///
    /// For atomic freeze-on-blacklist, use `blacklist_add_and_freeze` on the
    /// sss-token program (BUG-022 fix). This instruction is kept for
    /// pre-emptive blacklisting of wallets that do not yet have a token account.
    pub fn blacklist_add(ctx: Context<ManageBlacklist>, address: Pubkey) -> Result<()> {
        let bl = &mut ctx.accounts.blacklist_state;
        if !bl.blacklisted.contains(&address) {
            bl.blacklisted.push(address);
        }
        msg!("Blacklisted {}", address);
        Ok(())
    }

    /// Remove an address from the blacklist.
    pub fn blacklist_remove(ctx: Context<ManageBlacklist>, address: Pubkey) -> Result<()> {
        let bl = &mut ctx.accounts.blacklist_state;
        bl.blacklisted.retain(|a| *a != address);
        msg!("Removed {} from blacklist", address);
        Ok(())
    }

    /// Migrate the ExtraAccountMetaList to include the ZK VerificationRecord slot.
    ///
    /// Required for SSS-2 mints initialized before SSS-075 (ZK compliance).
    /// The original ExtraAccountMetaList had 2 extra accounts; after migration
    /// it has 3 (adding the verification_record PDA at index 7).
    ///
    /// Must be called by the blacklist authority before enabling FLAG_ZK_COMPLIANCE
    /// on an existing mint.
    pub fn migrate_hook_extra_accounts(ctx: Context<MigrateHookExtraAccounts>) -> Result<()> {
        let account_metas = vec![
            ExtraAccountMeta::new_with_seeds(
                &[
                    Seed::Literal { bytes: b"blacklist-state".to_vec() },
                    Seed::AccountKey { index: 1 },
                ],
                false,
                false,
            )?,
            ExtraAccountMeta::new_with_seeds(
                &[
                    Seed::Literal { bytes: b"stablecoin-config".to_vec() },
                    Seed::AccountKey { index: 1 },
                ],
                false,
                false,
            )?,
            ExtraAccountMeta::new_with_seeds(
                &[
                    Seed::Literal { bytes: b"zk-verification".to_vec() },
                    Seed::AccountKey { index: 1 }, // mint
                    // BUG-036 fix: use src_owner from token account data (index 0 @ offset 32),
                    // not the delegate/signer at index 3.
                    Seed::AccountData {
                        account_index: 0, // source_token_account
                        data_index: 32,   // owner field starts at byte 32
                        length: 32,       // Pubkey length
                    },
                ],
                false,
                false,
            )?,
        ];

        let new_size = ExtraAccountMetaList::size_of(account_metas.len())? as usize;
        let extra_meta_info = ctx.accounts.extra_account_meta_list.to_account_info();
        let current_size = extra_meta_info.data_len();

        // Realloc and re-fund if necessary
        if new_size > current_size {
            let rent = Rent::get()?;
            let current_lamports = extra_meta_info.lamports();
            let required_lamports = rent.minimum_balance(new_size);
            if required_lamports > current_lamports {
                let diff = required_lamports.saturating_sub(current_lamports);
                system_program::transfer(
                    CpiContext::new(
                        ctx.accounts.system_program.to_account_info(),
                        system_program::Transfer {
                            from: ctx.accounts.authority.to_account_info(),
                            to: extra_meta_info.clone(),
                        },
                    ),
                    diff,
                )?;
            }
            extra_meta_info.realloc(new_size, false)
                .map_err(|_| error!(HookError::InvalidConfig))?;
        }

        {
            let mut data = ctx.accounts.extra_account_meta_list.try_borrow_mut_data()?;
            ExtraAccountMetaList::init::<ExecuteInstruction>(&mut data, &account_metas)?;
        }

        msg!(
            "TransferHook: migrated ExtraAccountMetaList for mint {} to include verification_record slot",
            ctx.accounts.mint.key()
        );
        Ok(())
    }
}

#[error_code]
pub enum HookError {
    #[msg("Sender is blacklisted")]
    SenderBlacklisted,
    #[msg("Receiver is blacklisted")]
    ReceiverBlacklisted,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Spend policy: transfer amount exceeds max_transfer_amount")]
    SpendLimitExceeded,
    #[msg("Invalid stablecoin config account (wrong discriminator or size)")]
    InvalidConfig,
    #[msg("ZK compliance: sender has no valid verification record")]
    ZkRecordMissing,
    #[msg("ZK compliance: sender's verification record has expired")]
    ZkRecordExpired,
    #[msg("Sanctions oracle: sender is on the sanctions list")]
    SanctionedAddress,
    #[msg("Sanctions oracle: SanctionsRecord PDA missing from remaining_accounts — required when FLAG_SANCTIONS_ORACLE is set")]
    SanctionsRecordMissing,
    #[msg("Sanctions oracle: record is stale — oracle has not updated within max_staleness_slots")]
    SanctionsRecordStale,
    #[msg("ZK credentials: sender does not hold a valid CredentialRecord")]
    CredentialRequired,
    #[msg("ZK credentials: sender's CredentialRecord has expired")]
    CredentialExpired,
    #[msg("ZK credentials: sender's CredentialRecord has been revoked")]
    CredentialRevoked,
    #[msg("Per-wallet rate limit exceeded: sender has transferred too much in this window")]
    WalletRateLimitExceeded,
    #[msg("WalletRateLimit account must be passed as writable")]
    WalletRateLimitAccountNotWritable,
}

/// Blacklist state PDA for a given mint.
#[account]
pub struct BlacklistState {
    pub mint: Pubkey,
    pub authority: Pubkey,
    pub blacklisted: Vec<Pubkey>,
    pub bump: u8,
}

impl BlacklistState {
    pub const SEED: &'static [u8] = b"blacklist-state";

    pub fn is_blacklisted(&self, address: &Pubkey) -> bool {
        self.blacklisted.contains(address)
    }

    /// Space: discriminator(8) + mint(32) + authority(32) + vec_len(4) + 100*32 + u8(1)
    pub const INIT_SPACE: usize = 8 + 32 + 32 + 4 + (100 * 32) + 1;
}

/// Accounts for the transfer hook execute instruction.
///
/// MUST match Token-2022's expected layout for the Execute instruction:
///   0. source_token_account
///   1. mint
///   2. destination_token_account
///   3. owner (source owner/delegate)
///   4. extra_account_meta_list (validation account, passed by Token-2022)
///   5. blacklist_state        — resolved by Token-2022 from extra_account_meta_list
///   6. stablecoin_config      — resolved by Token-2022 from extra_account_meta_list
///   7. verification_record    — resolved by Token-2022 from extra_account_meta_list
///
/// All of 0-4 are passed and validated by Token-2022 itself; we use
/// UncheckedAccount + CHECK comments as required by Anchor's safety linter.
#[derive(Accounts)]
pub struct TransferHook<'info> {
    /// CHECK: Source token account — Token-2022 validates this before calling hook
    pub source_token_account: UncheckedAccount<'info>,

    /// CHECK: Token-2022 mint — Token-2022 validates this before calling hook
    pub mint: UncheckedAccount<'info>,

    /// CHECK: Destination token account — Token-2022 validates this before calling hook
    pub destination_token_account: UncheckedAccount<'info>,

    /// CHECK: Owner/delegate of source account — Token-2022 validates this before calling hook
    pub owner: UncheckedAccount<'info>,

    /// CHECK: ExtraAccountMetaList PDA — contains the list of extra accounts for this hook
    #[account(
        seeds = [b"extra-account-metas", mint.key().as_ref()],
        bump,
    )]
    pub extra_account_meta_list: UncheckedAccount<'info>,

    /// Blacklist state — resolved by Token-2022 from extra_account_meta_list using PDA seeds
    #[account(
        seeds = [BlacklistState::SEED, mint.key().as_ref()],
        bump = blacklist_state.bump,
    )]
    pub blacklist_state: Account<'info, BlacklistState>,

    /// CHECK: StablecoinConfig PDA from sss-token program — seeds [b"stablecoin-config", mint].
    /// Resolved by Token-2022 from extra_account_meta_list. We manually verify the
    /// PDA address and discriminator in transfer_hook before reading feature_flags.
    pub stablecoin_config: UncheckedAccount<'info>,

    /// CHECK: VerificationRecord PDA from sss-token program —
    /// seeds [b"zk-verification", mint, source_owner].
    /// Resolved by Token-2022 from extra_account_meta_list (index 7).
    /// Only enforced when FLAG_ZK_COMPLIANCE is set; we manually verify PDA
    /// address and expiry in transfer_hook.
    pub verification_record: UncheckedAccount<'info>,
}

/// Accounts for initializing the ExtraAccountMetaList and blacklist state.
#[derive(Accounts)]
pub struct InitializeExtraAccountMetaList<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    /// CHECK: The Token-2022 mint (already created by sss-token program)
    pub mint: UncheckedAccount<'info>,

    /// CHECK: The canonical extra-account-metas PDA that Token-2022 looks up on every transfer.
    /// We write ExtraAccountMetaList TLV data into it; no Anchor type validation needed.
    /// Seeds: [b"extra-account-metas", mint]
    #[account(
        mut,
        seeds = [b"extra-account-metas", mint.key().as_ref()],
        bump,
    )]
    pub extra_account_meta_list: UncheckedAccount<'info>,

    /// Blacklist state PDA — initialized here alongside the meta list.
    #[account(
        init,
        payer = authority,
        space = BlacklistState::INIT_SPACE,
        seeds = [BlacklistState::SEED, mint.key().as_ref()],
        bump,
    )]
    pub blacklist_state: Account<'info, BlacklistState>,

    pub system_program: Program<'info, System>,
}

/// Accounts for managing the blacklist.
#[derive(Accounts)]
pub struct ManageBlacklist<'info> {
    pub authority: Signer<'info>,

    /// CHECK: The Token-2022 mint
    pub mint: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [BlacklistState::SEED, mint.key().as_ref()],
        bump = blacklist_state.bump,
        constraint = blacklist_state.authority == authority.key() @ HookError::Unauthorized,
    )]
    pub blacklist_state: Account<'info, BlacklistState>,
}

/// Accounts for migrating the ExtraAccountMetaList to include the ZK
/// VerificationRecord slot (needed for mints initialized before SSS-075).
#[derive(Accounts)]
pub struct MigrateHookExtraAccounts<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    /// CHECK: The Token-2022 mint
    pub mint: UncheckedAccount<'info>,

    /// CHECK: The canonical extra-account-metas PDA. We rewrite it.
    #[account(
        mut,
        seeds = [b"extra-account-metas", mint.key().as_ref()],
        bump,
    )]
    pub extra_account_meta_list: UncheckedAccount<'info>,

    /// Blacklist state — validates caller is the authority
    #[account(
        seeds = [BlacklistState::SEED, mint.key().as_ref()],
        bump = blacklist_state.bump,
        constraint = blacklist_state.authority == authority.key() @ HookError::Unauthorized,
    )]
    pub blacklist_state: Account<'info, BlacklistState>,

    pub system_program: Program<'info, System>,
}

use anchor_lang::prelude::*;
use crate::state::StablecoinConfig;
use crate::error::SssError;

// ---------------------------------------------------------------------------
// SSS-122: Program upgrade path — versioned state migration
// ---------------------------------------------------------------------------

/// Current program version. Increment each time a breaking state layout change
/// is deployed. Handlers reject configs with version < MIN_SUPPORTED_VERSION.
pub const CURRENT_VERSION: u8 = 1;

/// Minimum config version accepted by this program build.
/// v0 = pre-SSS-122 (no version field); handlers set it to 1 on first migration.
pub const MIN_SUPPORTED_VERSION: u8 = 1;

// Byte offsets into a StablecoinConfig account (including 8-byte discriminator).
// Layout matches Borsh serialization order in state.rs:
//   [0..8]     Anchor discriminator       (8 bytes)
//   [8..40]    mint                       (Pubkey, 32 bytes)
//   [40..72]   authority                  (Pubkey, 32 bytes)
//   [72..104]  compliance_authority       (Pubkey, 32 bytes)
//   [104]      preset                     (u8, 1 byte)
//   [105]      paused                     (bool, 1 byte)
//   [106..114] total_minted              (u64, 8 bytes)
//   [114..122] total_burned              (u64, 8 bytes)
//   [122..154] transfer_hook_program     (Pubkey, 32 bytes)
//   [154..186] collateral_mint           (Pubkey, 32 bytes)
//   [186..218] reserve_vault             (Pubkey, 32 bytes)
//   [218..226] total_collateral          (u64, 8 bytes)
//   [226..234] max_supply                (u64, 8 bytes)
//   [234..266] pending_authority         (Pubkey, 32 bytes)
//   [266..298] pending_compliance_authority (Pubkey, 32 bytes)
//   [298..306] feature_flags             (u64, 8 bytes)
//   [306..314] max_transfer_amount       (u64, 8 bytes)
//   [314..346] expected_pyth_feed        (Pubkey, 32 bytes)
//   [346..354] admin_op_mature_slot      (u64, 8 bytes)
//   [354]      admin_op_kind             (u8, 1 byte)
//   [355..363] admin_op_param            (u64, 8 bytes)
//   [363..395] admin_op_target           (Pubkey, 32 bytes)
//   [395..403] admin_timelock_delay      (u64, 8 bytes)
//   [403..407] max_oracle_age_secs       (u32, 4 bytes)
//   [407..409] max_oracle_conf_bps       (u16, 2 bytes)
//   [409..411] stability_fee_bps         (u16, 2 bytes)
//   [411..413] redemption_fee_bps        (u16, 2 bytes)
//   [413..445] insurance_fund_pubkey     (Pubkey, 32 bytes)
//   [445..447] max_backstop_bps          (u16, 2 bytes)
//   [447..479] auditor_elgamal_pubkey    ([u8;32], 32 bytes)
//   [479]      oracle_type               (u8, 1 byte)
//   [480..512] oracle_feed               (Pubkey, 32 bytes)
//   [512]      supply_cap_locked         (bool, 1 byte)
//   [513]      version                   (u8, 1 byte)
//
// These offsets must stay in sync with StablecoinConfig field declaration order.
const DISC_LEN: usize = 8;
const OFFSET_MINT: usize = DISC_LEN;                    // 8
const OFFSET_AUTHORITY: usize = DISC_LEN + 32;          // 40
const OFFSET_VERSION: usize = 513;                      // after all preceding fields
const V0_MIN_READ: usize = DISC_LEN + 32 + 32;          // 72 bytes minimum (disc+mint+authority)

/// Anchor discriminator for StablecoinConfig.
/// = sha256("account:StablecoinConfig")[0..8]
/// Pre-computed: [0x7f, 0x19, 0xf4, 0xd5, 0x01, 0xc0, 0x65, 0x06]
const STABLECOIN_CONFIG_DISC: [u8; 8] = [0x7f, 0x19, 0xf4, 0xd5, 0x01, 0xc0, 0x65, 0x06];

/// Migrate a StablecoinConfig from v0 (no version field / default-zero) to
/// the current version. This is the only instruction that accepts v0 configs.
///
/// Idempotent: calling it on an already-migrated config is a no-op (returns Ok).
/// Token-2022 mint accounts are NOT touched — only the config PDA is updated.
/// Existing CDPs, vaults, minter records, and ATAs continue working unchanged.
///
/// Resizes the PDA if it is smaller than the current `InitSpace` allocation
/// (i.e. was created by a v0 build that had fewer fields).
///
/// Security:
/// - Uses `UncheckedAccount` for `config` so Anchor deserialization cannot
///   fail on undersized v0 PDAs.  Authority and PDA seeds are verified manually.
pub fn migrate_config_handler(ctx: Context<MigrateConfig>) -> Result<()> {
    let config_info = ctx.accounts.config.to_account_info();
    let mint_key = ctx.accounts.mint.key();
    let authority_key = ctx.accounts.authority.key();

    // ------------------------------------------------------------------
    // 1. Verify the config PDA seeds manually.
    // ------------------------------------------------------------------
    let (expected_pda, _) = Pubkey::find_program_address(
        &[StablecoinConfig::SEED, mint_key.as_ref()],
        ctx.program_id,
    );
    require_keys_eq!(config_info.key(), expected_pda, SssError::Unauthorized);

    // ------------------------------------------------------------------
    // 2. Verify discriminator and read authority + version from raw bytes.
    // ------------------------------------------------------------------
    let (raw_version, raw_authority, is_full_size) = {
        let data = config_info.try_borrow_data()?;
        require!(data.len() >= V0_MIN_READ, SssError::Unauthorized);

        // Check discriminator.
        require!(
            data[..8] == STABLECOIN_CONFIG_DISC,
            SssError::Unauthorized
        );

        // If the account is too small to contain the version field, treat as v0.
        let version = if data.len() <= OFFSET_VERSION {
            0u8
        } else {
            data[OFFSET_VERSION]
        };
        let authority = Pubkey::try_from(&data[OFFSET_AUTHORITY..OFFSET_AUTHORITY + 32])
            .map_err(|_| error!(SssError::Unauthorized))?;
        let full_size = DISC_LEN + StablecoinConfig::INIT_SPACE;
        (version, authority, data.len() >= full_size)
    };

    // Verify caller is the authority.
    require_keys_eq!(raw_authority, authority_key, SssError::Unauthorized);

    // Idempotent: already current → no-op.
    if raw_version >= CURRENT_VERSION {
        return Ok(());
    }

    // ------------------------------------------------------------------
    // 3. SSS-135: Squads check for full-size accounts only.
    //    True v0 accounts predate FLAG_SQUADS_AUTHORITY (SSS-135) so their
    //    feature_flags field doesn't exist yet — skip the check.
    // ------------------------------------------------------------------
    if is_full_size {
        // Account is full-size — read feature_flags from raw data.
        // feature_flags offset: disc(8) + mint(32) + version(1) + authority(32) + bump(1) + ...
        // We derive the offset from the StablecoinConfig field layout.
        // Offset of feature_flags: need to count all preceding fields.
        // For safety, use the typed deserialization helper that works on
        // the ctx.accounts reference (which has the correct lifetime).
        let data = config_info.try_borrow_data()?;
        // Read feature_flags at the correct offset.
        // feature_flags is a u64 at: disc(8) + mint(32) + version(1) + authority(32) + bump(1) = 74
        // Then timelock_duration: u64 = 8 bytes → offset 82
        // Then pending_authority: Option<Pubkey> = 1+32 = 33 bytes → offset 90 (if no value = 1 byte)
        // Actually feature_flags comes after bump. Let's use Borsh deserialization of just that field.
        // Safest: deserialize the whole struct since we know the account is full-size.
        use anchor_lang::AnchorDeserialize;
        let config = StablecoinConfig::try_deserialize(&mut &data[..])?;
        drop(data);
        if config.feature_flags & crate::state::FLAG_SQUADS_AUTHORITY != 0 {
            crate::instructions::squads_authority::verify_squads_signer(
                &config,
                &authority_key,
            )?;
        }
    }

    // ------------------------------------------------------------------
    // 4. Realloc to current InitSpace if the account is undersized.
    // ------------------------------------------------------------------
    let target_space = DISC_LEN + StablecoinConfig::INIT_SPACE;
    let current_len = config_info.data_len();

    if current_len < target_space {
        config_info.realloc(target_space, false)?;

        // Fund any additional rent from the authority wallet.
        let rent = Rent::get()?;
        let needed = rent.minimum_balance(target_space);
        let current_lamports = config_info.lamports();
        if current_lamports < needed {
            let diff = needed - current_lamports;
            let authority_info = ctx.accounts.authority.to_account_info();
            **authority_info.try_borrow_mut_lamports()? -= diff;
            **config_info.try_borrow_mut_lamports()? += diff;
        }
    }

    // ------------------------------------------------------------------
    // 5. Write the new version byte directly (v0 → CURRENT_VERSION).
    // ------------------------------------------------------------------
    {
        let mut data = config_info.try_borrow_mut_data()?;
        data[OFFSET_VERSION] = CURRENT_VERSION;
    }

    emit!(ConfigMigrated {
        mint: mint_key,
        from_version: 0,
        to_version: CURRENT_VERSION,
        slot: Clock::get()?.slot,
    });

    msg!(
        "SSS-122: config migrated v0→{} for mint {}",
        CURRENT_VERSION,
        mint_key,
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// Contexts
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct MigrateConfig<'info> {
    /// The authority of the stablecoin — only they may trigger migration.
    #[account(mut)]
    pub authority: Signer<'info>,

    /// The SSS-token mint — used to verify config PDA seeds.
    /// CHECK: used only as a seed for PDA derivation.
    pub mint: UncheckedAccount<'info>,

    /// The config PDA to migrate.
    ///
    /// SAFETY: Declared as `UncheckedAccount` because Anchor's typed
    /// deserialization (`Account<StablecoinConfig>`) would reject undersized
    /// v0 accounts before realloc can run.  The handler manually verifies:
    ///   1. PDA seeds ([StablecoinConfig::SEED, mint]) match this account's key.
    ///   2. First 8 bytes match the StablecoinConfig Anchor discriminator.
    ///   3. The serialised `authority` field matches the `authority` signer.
    ///   4. Account is owned by this program (`owner` constraint below).
    /// CHECK: manually verified — see migrate_config_handler.
    #[account(
        mut,
        owner = crate::ID,
    )]
    pub config: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

#[event]
pub struct ConfigMigrated {
    pub mint: Pubkey,
    pub from_version: u8,
    pub to_version: u8,
    pub slot: u64,
}

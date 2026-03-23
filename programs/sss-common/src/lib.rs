use anchor_lang::prelude::*;

// Not a deployed program — ID is only needed to satisfy #[account] macro.
// Actual owner validation is performed by consumers at runtime.
declare_id!("11111111111111111111111111111111");

// ── SSS-Core PDA Seeds ────────────────────────────────────────────────
pub const SSS_CONFIG_SEED: &[u8] = b"sss-config";
pub const ROLE_SEED: &[u8] = b"role";
pub const MINTER_INFO_SEED: &[u8] = b"minter";
pub const RESERVE_SEED: &[u8] = b"reserve";

// ── Blacklist Hook PDA Seeds ──────────────────────────────────────────
pub const HOOK_CONFIG_SEED: &[u8] = b"config";
pub const BLACKLIST_SEED: &[u8] = b"blacklist";
pub const EXTRA_ACCOUNT_METAS_SEED: &[u8] = b"extra-account-metas";

// ── Role Identifiers ─────────────────────────────────────────────────
pub const ROLE_MINTER: u8 = 0;
pub const ROLE_BURNER: u8 = 1;
pub const ROLE_FREEZER: u8 = 2;
pub const ROLE_PAUSER: u8 = 3;
pub const ROLE_BLACKLISTER: u8 = 4;
pub const ROLE_SEIZER: u8 = 5;
pub const ROLE_ATTESTOR: u8 = 6;
pub const ROLE_MAX: u8 = 6;

// ── Preset Constants ──────────────────────────────────────────────────
pub const PRESET_SSS1: u8 = 1;
pub const PRESET_SSS2: u8 = 2;

// ── Shared Account Structs ────────────────────────────────────────────

/// Blacklist entry for a single wallet on a single mint.
/// Defined here so both sss-core (for deserialization) and blacklist_hook
/// (as the owning program) share the same canonical layout.
#[account]
#[derive(InitSpace)]
pub struct BlacklistEntry {
    pub wallet: Pubkey,
    pub mint: Pubkey,
    pub blocked: bool,
    #[max_len(128)]
    pub reason: String,
    pub evidence_hash: [u8; 32],
    #[max_len(256)]
    pub evidence_uri: String,
    pub bump: u8,
}

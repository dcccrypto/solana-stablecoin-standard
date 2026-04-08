use anchor_lang::prelude::*;

pub mod error;
pub mod events;
pub mod fuzz_tests;
pub mod instructions;
pub mod oracle;
pub mod proofs;
pub mod state;

use instructions::*;

declare_id!("ApQTVMKdtUUrGXgL6Hhzt9W2JFyLt6vGnHuimcdXe811");

/// Solana Stablecoin Standard — SSS-1 (Minimal) + SSS-2 (Compliant) + SSS-3 (Reserve-Backed)
///
/// SSS-1: Token-2022 mint with freeze authority + metadata
/// SSS-2: SSS-1 + permanent delegate + transfer hook + blacklist enforcement
/// SSS-3: SSS-1 + collateral reserve vault (deposit/redeem against on-chain reserves)
#[program]
pub mod sss_token {
    use super::*;

    /// Initialize a new stablecoin.
    /// preset = 1 => SSS-1 (minimal)
    /// preset = 2 => SSS-2 (compliant, requires transfer_hook_program)
    pub fn initialize(ctx: Context<Initialize>, params: InitializeParams) -> Result<()> {
        instructions::initialize::handler(ctx, params)
    }

    /// Mint tokens to a recipient. Caller must be a registered minter.
    pub fn mint<'info>(ctx: Context<'_, '_, 'info, 'info, MintTokens<'info>>, amount: u64) -> Result<()> {
        instructions::mint::handler(ctx, amount)
    }

    /// Burn tokens from source. Caller must be a registered minter.
    pub fn burn(ctx: Context<BurnTokens>, amount: u64) -> Result<()> {
        instructions::burn::handler(ctx, amount)
    }

    /// Freeze an account (compliance action). Caller must be compliance authority.
    pub fn freeze_account(ctx: Context<FreezeAccount>) -> Result<()> {
        instructions::freeze::handler(ctx)
    }

    /// Thaw a frozen account. Caller must be compliance authority.
    pub fn thaw_account(ctx: Context<ThawAccount>) -> Result<()> {
        instructions::thaw::handler(ctx)
    }

    /// BUG-022: Add wallet to blacklist AND atomically freeze its token account.
    ///
    /// This is the primary blacklist operation for SSS-2 mints. Calling this instead
    /// of the transfer-hook's `blacklist_add` directly ensures there is no window
    /// between the blacklist write and the freeze — the wallet cannot front-run the
    /// blacklist by moving tokens to a clean wallet.
    ///
    /// Steps performed atomically in one transaction:
    ///   1. CPI → transfer-hook `blacklist_add(wallet)` to record in BlacklistState.
    ///   2. Token-2022 `freeze_account` on the wallet's token account (config PDA signer).
    ///
    /// For pre-emptive blacklisting (wallet has no token account yet), call
    /// `blacklist_add` on the transfer-hook program directly.
    pub fn blacklist_add_and_freeze(ctx: Context<BlacklistAddAndFreeze>) -> Result<()> {
        instructions::blacklist::handler(ctx)
    }

    /// Pause the entire mint (SSS-2). No minting/burning while paused.
    pub fn pause(ctx: Context<Pause>) -> Result<()> {
        instructions::pause::handler(ctx, true)
    }

    /// Unpause the mint.
    pub fn unpause(ctx: Context<Pause>) -> Result<()> {
        instructions::pause::handler(ctx, false)
    }

    /// Register or update a minter with a cap. Authority only.
    pub fn update_minter(ctx: Context<UpdateMinter>, cap: u64) -> Result<()> {
        instructions::update_minter::handler(ctx, cap)
    }

    /// Revoke a minter. Authority only.
    pub fn revoke_minter(ctx: Context<RevokeMinter>) -> Result<()> {
        instructions::revoke_minter::handler(ctx)
    }

    /// Transfer admin/compliance authorities.
    pub fn update_roles(ctx: Context<UpdateRoles>, params: UpdateRolesParams) -> Result<()> {
        instructions::update_roles::handler(ctx, params)
    }

    /// Deposit collateral into the reserve vault (SSS-3 only).
    pub fn deposit_collateral(ctx: Context<DepositCollateralCtx>, amount: u64) -> Result<()> {
        instructions::deposit_collateral::deposit_collateral_handler(ctx, amount)
    }

    /// Redeem SSS tokens by burning them and releasing collateral (SSS-3 only).
    pub fn redeem(ctx: Context<RedeemCtx>, amount: u64) -> Result<()> {
        instructions::redeem::redeem_handler(ctx, amount)
    }

    /// Accept a pending authority transfer (two-step). Caller must be pending_authority.
    pub fn accept_authority(ctx: Context<AcceptAuthority>) -> Result<()> {
        instructions::accept_authority::accept_authority_handler(ctx)
    }

    /// Accept a pending compliance authority transfer. Caller must be pending_compliance_authority.
    pub fn accept_compliance_authority(ctx: Context<AcceptComplianceAuthority>) -> Result<()> {
        instructions::accept_authority::accept_compliance_authority_handler(ctx)
    }

    // ─── Direction 2: Multi-Collateral CDP ───────────────────────────────────

    /// CDP: Deposit SPL token collateral into a per-user vault (Direction 2).
    /// Each (user, collateral_mint) pair gets its own CollateralVault PDA.
    pub fn cdp_deposit_collateral(
        ctx: Context<CdpDepositCollateral>,
        amount: u64,
    ) -> Result<()> {
        instructions::cdp_deposit_collateral::cdp_deposit_collateral_handler(ctx, amount)
    }

    /// CDP: Borrow SSS-3 stablecoins against deposited collateral.
    /// Enforces min 150% collateral ratio via Pyth oracle price.
    pub fn cdp_borrow_stable(ctx: Context<CdpBorrowStable>, amount: u64) -> Result<()> {
        instructions::cdp_borrow_stable::cdp_borrow_stable_handler(ctx, amount)
    }

    /// CDP: Repay SSS-3 debt by burning stablecoins, release collateral proportionally.
    pub fn cdp_repay_stable(ctx: Context<CdpRepayStable>, amount: u64) -> Result<()> {
        instructions::cdp_repay_stable::cdp_repay_stable_handler(ctx, amount)
    }

    /// CDP: Liquidate an undercollateralised position (ratio < 120%).
    /// Callable by anyone; liquidator burns full debt and receives all collateral.
    /// Liquidate an undercollateralised CDP position.
    /// SSS-100: Extended with partial liquidation and per-collateral config support.
    /// `params.min_collateral_amount`: slippage protection (0 = disabled, backward compatible).
    /// `params.partial_repay_amount`: if > 0, only burn this much debt and seize proportional
    /// collateral+bonus, restoring the CDP to healthy ratio.  0 = full liquidation.
    pub fn cdp_liquidate(ctx: Context<CdpLiquidate>, params: instructions::cdp_liquidate::CdpLiquidateParams) -> Result<()> {
        instructions::cdp_liquidate::cdp_liquidate_handler(ctx, params)
    }

    /// SSS-100: Multi-collateral liquidation engine with partial liquidation support.
    /// `debt_to_repay`: SSS tokens to burn (0 = full liquidation).
    /// `min_collateral_amount`: slippage guard — minimum collateral tokens to receive (0 = disabled).
    pub fn cdp_liquidate_v2(
        ctx: Context<CdpLiquidateV2>,
        debt_to_repay: u64,
        min_collateral_amount: u64,
    ) -> Result<()> {
        instructions::cdp_liquidate_v2::cdp_liquidate_v2_handler(ctx, debt_to_repay, min_collateral_amount)
    }

    /// SSS-092: Accrue stability fees on a CDP position (keeper-callable, no burn).
    /// BUG-012 HIGH-05: debtor does NOT need to sign — any keeper can force accrual.
    /// Fees are accrued to `accrued_fees`; actual burn occurs on repay or via
    /// `burn_accrued_fees` (requires debtor signature).
    pub fn collect_stability_fee(ctx: Context<CollectStabilityFee>) -> Result<()> {
        instructions::stability_fee::collect_stability_fee_handler(ctx)
    }

    /// SSS-092: Burn previously accrued stability fees from debtor's token account.
    /// BUG-012 CRIT-07: resets `accrued_fees` to 0 after burn to prevent double-count.
    /// Requires debtor signature.
    pub fn burn_accrued_fees(ctx: Context<BurnAccruedFees>) -> Result<()> {
        instructions::stability_fee::burn_accrued_fees_handler(ctx)
    }

    // ─── Direction 3: CPI Composability Standard ──────────────────────────────

    /// Initialize the InterfaceVersion PDA for this mint.
    /// One-time call by the stablecoin authority; required before `cpi_mint`/`cpi_burn`.
    pub fn init_interface_version(ctx: Context<InitInterfaceVersion>) -> Result<()> {
        instructions::interface_version::init_interface_version_handler(ctx)
    }

    /// Update the InterfaceVersion PDA (bump version or deprecate). Authority only.
    pub fn update_interface_version(
        ctx: Context<UpdateInterfaceVersion>,
        new_version: Option<u8>,
        active: Option<bool>,
    ) -> Result<()> {
        instructions::interface_version::update_interface_version_handler(
            ctx,
            new_version,
            active,
        )
    }

    /// Standardized CPI mint entrypoint.
    /// External programs should call this instead of `mint` for forward-compatible integration.
    /// `required_version` must match the on-chain InterfaceVersion — guards against silent breaks.
    pub fn cpi_mint(ctx: Context<CpiMint>, amount: u64, required_version: u8) -> Result<()> {
        instructions::cpi_mint::cpi_mint_handler(ctx, amount, required_version)
    }

    /// Standardized CPI burn entrypoint.
    /// External programs should call this instead of `burn` for forward-compatible integration.
    pub fn cpi_burn(ctx: Context<CpiBurn>, amount: u64, required_version: u8) -> Result<()> {
        instructions::cpi_burn::cpi_burn_handler(ctx, amount, required_version)
    }

    /// Set a feature flag bit. Authority only. Pass the FLAG_* constant value.
    pub fn set_feature_flag(ctx: Context<UpdateFeatureFlag>, flag: u64) -> Result<()> {
        instructions::feature_flags::set_feature_flag_handler(ctx, flag)
    }

    /// Clear a feature flag bit. Authority only. Pass the FLAG_* constant value.
    pub fn clear_feature_flag(ctx: Context<UpdateFeatureFlag>, flag: u64) -> Result<()> {
        instructions::feature_flags::clear_feature_flag_handler(ctx, flag)
    }

    /// Set the per-tx spend limit and atomically enable FLAG_SPEND_POLICY.
    /// `max_amount` must be > 0. Authority only.
    pub fn set_spend_limit(ctx: Context<UpdateSpendLimit>, max_amount: u64) -> Result<()> {
        instructions::spend_policy::set_spend_limit_handler(ctx, max_amount)
    }

    /// Clear the spend limit and disable FLAG_SPEND_POLICY. Authority only.
    pub fn clear_spend_limit(ctx: Context<UpdateSpendLimit>) -> Result<()> {
        instructions::spend_policy::clear_spend_limit_handler(ctx)
    }

    // ─── SSS-067: DAO Committee Governance ───────────────────────────────────

    /// Initialize the DAO committee for a stablecoin config.
    ///
    /// Registers `members` (1–10 pubkeys) as committee voters and sets the
    /// `quorum` threshold.  Atomically enables FLAG_DAO_COMMITTEE.
    /// Authority only; can only be called once per config (PDA is `init`).
    pub fn init_dao_committee(
        ctx: Context<InitDaoCommittee>,
        members: Vec<Pubkey>,
        quorum: u8,
    ) -> Result<()> {
        instructions::dao_committee::init_dao_committee_handler(ctx, members, quorum)
    }

    /// Open a governance proposal.
    ///
    /// Authority opens a proposal for a specific `action` + optional `param`
    /// and `target`.  The proposal collects YES votes from committee members
    /// before it can be executed.
    pub fn propose_action(
        ctx: Context<ProposeAction>,
        action: crate::state::ProposalAction,
        param: u64,
        target: Pubkey,
    ) -> Result<()> {
        instructions::dao_committee::propose_action_handler(ctx, action, param, target)
    }

    /// Cast a YES vote on a governance proposal.
    ///
    /// Caller must be a registered committee member.  Duplicate votes are rejected.
    pub fn vote_action(ctx: Context<VoteAction>, proposal_id: u64) -> Result<()> {
        instructions::dao_committee::vote_action_handler(ctx, proposal_id)
    }

    /// Execute a passed governance proposal.
    ///
    /// Verifies that `votes.len() >= quorum` and then applies the action
    /// (pause, feature flag change, etc.) to the StablecoinConfig.
    /// Can be called by anyone once quorum is reached; one-shot (idempotent after execution).
    pub fn execute_action(ctx: Context<ExecuteAction>, proposal_id: u64) -> Result<()> {
        instructions::dao_committee::execute_action_handler(ctx, proposal_id)
    }

    // ─── SSS-070: Yield-Bearing Collateral ───────────────────────────────────

    /// Initialize yield-bearing collateral support for a stablecoin config.
    ///
    /// Creates the `YieldCollateralConfig` PDA and atomically enables
    /// `FLAG_YIELD_COLLATERAL`.  Only valid for SSS-3 presets.  Authority only.
    ///
    /// `initial_mints`: optional list of yield-bearing SPL token mints to
    /// whitelist immediately (e.g. stSOL, mSOL).  Max 8 total.
    pub fn init_yield_collateral(
        ctx: Context<InitYieldCollateral>,
        initial_mints: Vec<Pubkey>,
    ) -> Result<()> {
        instructions::yield_collateral::init_yield_collateral_handler(ctx, initial_mints)
    }

    /// Add a yield-bearing SPL token mint to the whitelist.
    ///
    /// `FLAG_YIELD_COLLATERAL` must already be enabled.  Authority only.
    /// Rejects duplicates and enforces the 8-mint cap.
    pub fn add_yield_collateral_mint(
        ctx: Context<AddYieldCollateralMint>,
        collateral_mint: Pubkey,
    ) -> Result<()> {
        instructions::yield_collateral::add_yield_collateral_mint_handler(ctx, collateral_mint)
    }

    // ─── SSS-075: ZK Compliance ───────────────────────────────────────────────

    /// Initialize ZK compliance support for a stablecoin config.
    ///
    /// Creates the `ZkComplianceConfig` PDA and atomically enables
    /// `FLAG_ZK_COMPLIANCE`.  Only valid for SSS-2 presets (requires transfer hook).
    /// Authority only.
    ///
    /// `ttl_slots`: proof validity window in slots (0 = use default 1500 slots,
    /// ~10 minutes at 400ms/slot).
    pub fn init_zk_compliance(
        ctx: Context<InitZkCompliance>,
        ttl_slots: u64,
        verifier_pubkey: Option<Pubkey>,
    ) -> Result<()> {
        instructions::zk_compliance::init_zk_compliance_handler(ctx, ttl_slots, verifier_pubkey)
    }

    /// Submit or refresh a ZK compliance proof for the calling user.
    ///
    /// Creates or updates the caller's `VerificationRecord` PDA with an expiry
    /// of `Clock::slot + ttl_slots` from `ZkComplianceConfig`.
    ///
    /// `FLAG_ZK_COMPLIANCE` must already be enabled.  Any user may call this.
    /// The transfer hook will enforce this record on each transfer.
    pub fn submit_zk_proof(ctx: Context<SubmitZkProof>) -> Result<()> {
        instructions::zk_compliance::submit_zk_proof_handler(ctx)
    }

    /// Close an expired `VerificationRecord` PDA, returning rent to authority.
    ///
    /// Fails if the record has not yet expired.  Authority only.
    /// Users cannot be forcibly de-verified before their record expires.
    pub fn close_verification_record(ctx: Context<CloseVerificationRecord>) -> Result<()> {
        instructions::zk_compliance::close_verification_record_handler(ctx)
    }

    // ─── SSS-085: Security Fixes ──────────────────────────────────────────────

    /// Register the expected Pyth price feed pubkey for this SSS-3 config.
    /// After setting, CDP borrow and liquidate reject any other feed account.
    pub fn set_pyth_feed(ctx: Context<SetPythFeed>, feed: Pubkey) -> Result<()> {
        instructions::admin_timelock::set_pyth_feed_handler(ctx, feed)
    }

    /// SSS-090: Configure oracle staleness and confidence parameters.
    /// `max_age_secs`: max seconds a Pyth price may be old (0 = default 60s).
    /// `max_conf_bps`: max confidence/price ratio in bps (0 = disabled).
    pub fn set_oracle_params(
        ctx: Context<SetOracleParams>,
        max_age_secs: u32,
        max_conf_bps: u16,
    ) -> Result<()> {
        instructions::admin_timelock::set_oracle_params_handler(ctx, max_age_secs, max_conf_bps)
    }

    // ─── SSS-119: Oracle Abstraction Layer ────────────────────────────────────

    /// SSS-119: Set the oracle type (0=Pyth, 1=Switchboard, 2=Custom) and feed address.
    /// Authority-only. Requires timelock when admin_timelock_delay > 0.
    pub fn set_oracle_config(
        ctx: Context<SetOracleConfig>,
        oracle_type: u8,
        oracle_feed: Pubkey,
    ) -> Result<()> {
        instructions::oracle_config::set_oracle_config_handler(ctx, oracle_type, oracle_feed)
    }

    /// SSS-119: Initialise the CustomPriceFeed PDA for an SSS-3 stablecoin.
    /// Must be called before `update_custom_price` or `cdp_borrow_stable` with oracle_type=2.
    /// Authority-only. Preset-3 only.
    pub fn init_custom_price_feed(ctx: Context<InitCustomPriceFeed>) -> Result<()> {
        instructions::oracle_config::init_custom_price_feed_handler(ctx)
    }

    /// SSS-119: Publish a new price to the CustomPriceFeed PDA.
    /// Authority-only. `price` must be > 0; `expo` is the price exponent (e.g. -8).
    pub fn update_custom_price(
        ctx: Context<UpdateCustomPrice>,
        price: i64,
        expo: i32,
        conf: u64,
    ) -> Result<()> {
        instructions::oracle_config::update_custom_price_handler(ctx, price, expo, conf)
    }

    /// SSS-092: Set the annual stability fee (in basis points) for CDP borrows.
    /// Max 2000 bps (20% p.a.).  0 = no fee (default).
    /// Authority-only; takes effect on next `collect_stability_fee` call.
    pub fn set_stability_fee(ctx: Context<SetStabilityFee>, fee_bps: u16) -> Result<()> {
        instructions::stability_fee::set_stability_fee_handler(ctx, fee_bps)
    }

    /// BUG-015: Add a keeper pubkey to the stability-fee keeper whitelist.
    pub fn add_authorized_keeper(
        ctx: Context<AddAuthorizedKeeper>,
        keeper: Pubkey,
    ) -> Result<()> {
        instructions::stability_fee::add_authorized_keeper_handler(ctx, keeper)
    }

    /// BUG-015: Remove a keeper pubkey from the stability-fee keeper whitelist.
    pub fn remove_authorized_keeper(
        ctx: Context<RemoveAuthorizedKeeper>,
        keeper: Pubkey,
    ) -> Result<()> {
        instructions::stability_fee::remove_authorized_keeper_handler(ctx, keeper)
    }

    /// Propose a timelocked admin operation (2-epoch delay by default).
    /// `op_kind`: 1=TransferAuthority, 2=SetFeatureFlag, 3=ClearFeatureFlag.
    pub fn propose_timelocked_op(
        ctx: Context<ProposeTimelockOp>,
        op_kind: u8,
        param: u64,
        target: Pubkey,
    ) -> Result<()> {
        instructions::admin_timelock::propose_timelocked_op_handler(ctx, op_kind, param, target)
    }

    /// Execute a pending timelocked admin operation after the delay has elapsed.
    pub fn execute_timelocked_op(ctx: Context<ExecuteTimelockOp>) -> Result<()> {
        instructions::admin_timelock::execute_timelocked_op_handler(ctx)
    }

    /// Cancel a pending timelocked admin operation.
    pub fn cancel_timelocked_op(ctx: Context<CancelTimelockOp>) -> Result<()> {
        instructions::admin_timelock::cancel_timelocked_op_handler(ctx)
    }

    // -----------------------------------------------------------------------
    // SSS-093: PSM fee + per-minter velocity limit
    // -----------------------------------------------------------------------

    /// Set the PSM redemption fee in basis points (SSS-3 only). Authority-only.
    /// 0 = no fee.  Max 1000 bps (10%).
    pub fn set_psm_fee(ctx: Context<SetPsmFee>, fee_bps: u16) -> Result<()> {
        instructions::psm_fee::set_psm_fee_handler(ctx, fee_bps)
    }

    /// Set a per-epoch velocity limit for a registered minter.
    /// `max_mint_per_epoch` = 0 disables the limit.  Authority-only.
    pub fn set_mint_velocity_limit(
        ctx: Context<SetMintVelocityLimit>,
        max_mint_per_epoch: u64,
    ) -> Result<()> {
        instructions::psm_fee::set_mint_velocity_limit_handler(ctx, max_mint_per_epoch)
    }

    // ─── SSS-097: Bad Debt Backstop ───────────────────────────────────────────

    /// Authority-only: configure the insurance fund vault and max backstop draw cap.
    /// Set `insurance_fund_pubkey` to `Pubkey::default()` to disable the backstop.
    /// `max_backstop_bps`: max draw as pct of net supply in bps (0 = unlimited).
    pub fn set_backstop_params(
        ctx: Context<SetBackstopParams>,
        insurance_fund_pubkey: Pubkey,
        max_backstop_bps: u16,
    ) -> Result<()> {
        instructions::bad_debt_backstop::set_backstop_params_handler(
            ctx,
            insurance_fund_pubkey,
            max_backstop_bps,
        )
    }

    /// Trigger the bad debt backstop after a liquidation leaves collateral < debt.
    /// Draws up to `max_backstop_bps` of outstanding debt from the insurance fund.
    /// Only callable by the config PDA (i.e. via CPI from `cdp_liquidate`).
    /// Shortfall is computed entirely on-chain from CDP position + oracle price (BUG-031).
    /// Emits `BadDebtTriggered`.
    pub fn trigger_backstop(
        ctx: Context<TriggerBackstop>,
        cdp_owner: Pubkey,
    ) -> Result<()> {
        instructions::bad_debt_backstop::trigger_backstop_handler(ctx, cdp_owner)
    }

    // ─── SSS-151: First-loss Insurance Vault ─────────────────────────────────

    /// Authority-only: initialise the InsuranceVault PDA and set
    /// FLAG_INSURANCE_VAULT_REQUIRED.  Minting is blocked until the vault is
    /// adequately seeded.
    pub fn init_insurance_vault(
        ctx: Context<InitInsuranceVault>,
        min_seed_bps: u16,
        max_draw_per_event_bps: u16,
    ) -> Result<()> {
        instructions::insurance_vault::init_insurance_vault_handler(
            ctx,
            min_seed_bps,
            max_draw_per_event_bps,
        )
    }

    /// Deposit collateral into the insurance vault (anyone may seed; issuer must
    /// hit min_seed_bps before minting is unlocked).
    pub fn seed_insurance_vault(
        ctx: Context<SeedInsuranceVault>,
        amount: u64,
    ) -> Result<()> {
        instructions::insurance_vault::seed_insurance_vault_handler(ctx, amount)
    }

    /// Governance-controlled: draw from the insurance vault to cover protocol losses.
    /// Requires authority (+ DAO quorum when FLAG_DAO_COMMITTEE is set).
    pub fn draw_insurance(
        ctx: Context<DrawInsurance>,
        amount: u64,
        reason_hash: [u8; 32],
    ) -> Result<()> {
        instructions::insurance_vault::draw_insurance_handler(ctx, amount, reason_hash)
    }

    /// Permissionless: anyone may replenish the insurance vault after a draw.
    pub fn replenish_insurance_vault(
        ctx: Context<ReplenishInsuranceVault>,
        amount: u64,
    ) -> Result<()> {
        instructions::insurance_vault::replenish_insurance_vault_handler(ctx, amount)
    }

    // ─── SSS-098: CollateralConfig PDA ───────────────────────────────────────

    /// Register a new collateral type with per-collateral params (SSS-3, authority-only).
    /// Creates the CollateralConfig PDA keyed by (sss_mint, collateral_mint).
    pub fn register_collateral(
        ctx: Context<RegisterCollateral>,
        params: RegisterCollateralParams,
    ) -> Result<()> {
        instructions::collateral_config::register_collateral_handler(ctx, params)
    }

    /// Update an existing CollateralConfig PDA (SSS-3, authority-only).
    pub fn update_collateral_config(
        ctx: Context<UpdateCollateralConfig>,
        params: UpdateCollateralConfigParams,
    ) -> Result<()> {
        instructions::collateral_config::update_collateral_config_handler(ctx, params)
    }

    // ── SSS-121 / BUG-018: Guardian Multisig Emergency Pause ─────────────────

    /// Initialise the guardian multisig for a stablecoin.
    /// Registers 1–7 guardian pubkeys and a vote threshold.
    /// Authority only; can only be called once.
    pub fn init_guardian_config(
        ctx: Context<InitGuardianConfig>,
        guardians: Vec<Pubkey>,
        threshold: u8,
    ) -> Result<()> {
        instructions::guardian::init_guardian_config_handler(ctx, guardians, threshold)
    }

    /// Any registered guardian proposes an emergency pause.
    /// Creates a PauseProposal PDA.  If threshold == 1 the pause is immediate.
    pub fn guardian_propose_pause(
        ctx: Context<GuardianProposePause>,
        reason: [u8; 32],
    ) -> Result<()> {
        instructions::guardian::guardian_propose_pause_handler(ctx, reason)
    }

    /// Cast a YES vote on an open pause proposal.
    /// When votes >= threshold the mint is paused immediately.
    /// BUG-018: sets guardian_pause_active=true and starts the authority-override timelock.
    pub fn guardian_vote_pause(
        ctx: Context<GuardianVotePause>,
        proposal_id: u64,
    ) -> Result<()> {
        instructions::guardian::guardian_vote_pause_handler(ctx, proposal_id)
    }

    /// Lift a guardian-imposed pause.
    /// BUG-018: Authority alone cannot lift a guardian-initiated pause until
    /// GUARDIAN_PAUSE_AUTHORITY_OVERRIDE_DELAY (24h) has elapsed.
    /// Full guardian quorum can always lift immediately.
    pub fn guardian_lift_pause(ctx: Context<GuardianLiftPause>) -> Result<()> {
        instructions::guardian::guardian_lift_pause_handler(ctx)
    }

    // ── SSS-156: Issuer Legal Entity Registry ─────────────────────────────

    /// Authority-only: register the issuer's legal entity on-chain.
    /// Creates an IssuerRegistry PDA and enables FLAG_LEGAL_REGISTRY.
    pub fn register_legal_entity(
        ctx: Context<RegisterLegalEntity>,
        legal_entity_hash: [u8; 32],
        jurisdiction: [u8; 4],
        registration_number_hash: [u8; 32],
        attestor: Pubkey,
        expiry_slot: u64,
    ) -> Result<()> {
        instructions::legal_entity_registry::register_legal_entity(
            ctx,
            legal_entity_hash,
            jurisdiction,
            registration_number_hash,
            attestor,
            expiry_slot,
        )
    }

    /// Attestor-only: co-sign the IssuerRegistry, marking it as attested.
    pub fn attest_legal_entity(ctx: Context<AttestLegalEntity>) -> Result<()> {
        instructions::legal_entity_registry::attest_legal_entity(ctx)
    }

    /// Authority-only: update the legal entity record (resets attestation).
    pub fn update_legal_entity(
        ctx: Context<UpdateLegalEntity>,
        legal_entity_hash: [u8; 32],
        jurisdiction: [u8; 4],
        registration_number_hash: [u8; 32],
        attestor: Pubkey,
        expiry_slot: u64,
    ) -> Result<()> {
        instructions::legal_entity_registry::update_legal_entity(
            ctx,
            legal_entity_hash,
            jurisdiction,
            registration_number_hash,
            attestor,
            expiry_slot,
        )
    }

    /// SSS-122: Migrate a StablecoinConfig PDA from v0 → current version.
    ///
    /// Idempotent — safe to call on already-migrated configs.
    /// Required before mint/burn/redeem on configs created by a pre-SSS-122 build.
    pub fn migrate_config(ctx: Context<MigrateConfig>) -> Result<()> {
        instructions::upgrade::migrate_config_handler(ctx)
    }

    // ── SSS-154: Redemption Queue + Front-Run Protection ──────────────────────

    /// Initialise the RedemptionQueue PDA for a stablecoin.
    /// Requires FLAG_REDEMPTION_QUEUE to be set on the StablecoinConfig.
    pub fn init_redemption_queue(ctx: Context<InitRedemptionQueue>) -> Result<()> {
        instructions::redemption_queue::init_redemption_queue_handler(ctx)
    }

    /// Enqueue a redemption request. Caller locks `amount` stable tokens into
    /// a per-entry escrow and records the slot for front-run protection.
    pub fn enqueue_redemption(ctx: Context<EnqueueRedemption>, amount: u64) -> Result<()> {
        instructions::redemption_queue::enqueue_redemption_handler(ctx, amount)
    }

    /// Process a queued redemption entry. Keeper calls after min_delay_slots
    /// have elapsed. Releases collateral to the redeemer and pays keeper reward.
    pub fn process_redemption(ctx: Context<ProcessRedemption>, queue_index: u64) -> Result<()> {
        instructions::redemption_queue::process_redemption_handler(ctx, queue_index)
    }

    /// Cancel a pending redemption entry. Only the original redeemer may cancel.
    /// Returns locked stable tokens to the redeemer.
    pub fn cancel_redemption(ctx: Context<CancelRedemption>, queue_index: u64) -> Result<()> {
        instructions::redemption_queue::cancel_redemption_handler(ctx, queue_index)
    }

    /// Advance queue_head past a cancelled or fulfilled entry (permissionless).
    /// Keepers call this to compact stale cancelled heads that would otherwise
    /// deadlock the strict-FIFO queue (BUG-AUDIT3 CodeRabbit CRITICAL fix).
    pub fn compact_redemption_head(
        ctx: Context<CompactRedemptionHead>,
        head_index: u64,
    ) -> Result<()> {
        instructions::redemption_queue::compact_redemption_head_handler(ctx, head_index)
    }

    /// Update RedemptionQueue parameters (authority-only).
    pub fn update_redemption_queue(
        ctx: Context<UpdateRedemptionQueue>,
        min_delay_slots: Option<u64>,
        max_queue_depth: Option<u64>,
        max_redemption_per_slot_bps: Option<u16>,
        keeper_reward_lamports: Option<u64>,
    ) -> Result<()> {
        instructions::redemption_queue::update_redemption_queue_handler(
            ctx,
            min_delay_slots,
            max_queue_depth,
            max_redemption_per_slot_bps,
            keeper_reward_lamports,
        )
    }

    // ─── SSS-109: Probabilistic Balance Standard (PBS) ───────────────────────

    /// Lock stablecoin tokens in a ProbabilisticVault conditioned on a hash proof.
    /// Requires FLAG_PROBABILISTIC_MONEY to be set on the config.
    pub fn commit_probabilistic(
        ctx: Context<CommitProbabilistic>,
        params: CommitProbabilisticParams,
    ) -> Result<()> {
        instructions::pbs::commit_probabilistic_handler(ctx, params)
    }

    /// Release vault funds to claimant upon matching proof hash.
    pub fn prove_and_resolve(
        ctx: Context<ProveAndResolve>,
        proof_hash: [u8; 32],
    ) -> Result<()> {
        instructions::pbs::prove_and_resolve_handler(ctx, proof_hash)
    }

    /// Partially release vault funds to claimant (partial payment).
    pub fn partial_resolve(
        ctx: Context<PartialResolve>,
        amount: u64,
        proof_hash: [u8; 32],
    ) -> Result<()> {
        instructions::pbs::partial_resolve_handler(ctx, amount, proof_hash)
    }

    /// Return expired vault funds to the issuer after expiry_slot.
    pub fn expire_and_refund(ctx: Context<ExpireAndRefund>) -> Result<()> {
        instructions::pbs::expire_and_refund_handler(ctx)
    }

    // ─── SSS-111: Agent Payment Channel (APC) ────────────────────────────────

    /// Open a payment channel between two agents.
    /// Requires FLAG_AGENT_PAYMENT_CHANNEL to be set on the config.
    pub fn open_channel(
        ctx: Context<OpenChannel>,
        params: OpenChannelParams,
    ) -> Result<()> {
        instructions::apc::open_channel_handler(ctx, params)
    }

    /// Submit a work proof hash to an open channel.
    pub fn submit_work_proof(
        ctx: Context<SubmitWorkProof>,
        channel_id: u64,
        task_hash: [u8; 32],
        output_hash: [u8; 32],
        proof_type: u8,
    ) -> Result<()> {
        instructions::apc::submit_work_proof_handler(ctx, channel_id, task_hash, output_hash, proof_type)
    }

    /// Propose cooperative settlement of a payment channel.
    pub fn propose_settle(
        ctx: Context<ProposeSettle>,
        channel_id: u64,
        amount: u64,
    ) -> Result<()> {
        instructions::apc::propose_settle_handler(ctx, channel_id, amount)
    }

    /// Countersign and execute a proposed settlement.
    pub fn countersign_settle(
        ctx: Context<CountersignSettle>,
        channel_id: u64,
        amount: u64,
    ) -> Result<()> {
        instructions::apc::countersign_settle_handler(ctx, channel_id, amount)
    }

    /// Raise a dispute on a payment channel (triggers timeout window).
    pub fn dispute(
        ctx: Context<Dispute>,
        channel_id: u64,
        evidence_hash: [u8; 32],
    ) -> Result<()> {
        instructions::apc::dispute_handler(ctx, channel_id, evidence_hash)
    }

    /// Force-close a timed-out payment channel.
    pub fn force_close(ctx: Context<ForceClose>, channel_id: u64) -> Result<()> {
        instructions::apc::force_close_handler(ctx, channel_id)
    }

    /// Resolve a disputed payment channel by mutual agreement or authority arbitration.
    /// Requires either (a) both initiator + counterparty sign, or (b) the config authority signs.
    pub fn resolve_dispute(
        ctx: Context<ResolveDispute>,
        channel_id: u64,
        settlement_amount: u64,
    ) -> Result<()> {
        instructions::apc::resolve_dispute_handler(ctx, channel_id, settlement_amount)
    }

    // ─── SSS-120: Authority Rotation ─────────────────────────────────────────

    /// Propose a timelocked authority rotation with a backup recovery key.
    pub fn propose_authority_rotation(ctx: Context<ProposeAuthorityRotation>, new_authority: Pubkey, backup_authority: Pubkey) -> Result<()> {
        instructions::authority_rotation::propose_authority_rotation_handler(ctx, new_authority, backup_authority)
    }

    /// Accept a proposed authority rotation after the timelock has elapsed.
    pub fn accept_authority_rotation(ctx: Context<AcceptAuthorityRotation>) -> Result<()> {
        instructions::authority_rotation::accept_authority_rotation_handler(ctx)
    }

    /// Cancel an in-flight authority rotation proposal. Current authority only.
    pub fn cancel_authority_rotation(ctx: Context<CancelAuthorityRotation>) -> Result<()> {
        instructions::authority_rotation::cancel_authority_rotation_handler(ctx)
    }

    /// Emergency recovery: backup authority claims authority after extended timelock.
    pub fn emergency_recover_authority(ctx: Context<EmergencyRecoverAuthority>) -> Result<()> {
        instructions::authority_rotation::emergency_recover_authority_handler(ctx)
    }

    // ─── SSS-BUG-008: Proof of Reserves ─────────────────────────────────────

    /// Initialize the ProofOfReserves PDA for a mint. Authority only.
    pub fn init_proof_of_reserves(
        ctx: Context<InitProofOfReserves>,
        attester: Pubkey,
    ) -> Result<()> {
        instructions::proof_of_reserves::init_proof_of_reserves_handler(ctx, attester)
    }

    /// Submit a new attestation for a mint's proof of reserves.
    pub fn attest_proof_of_reserves(
        ctx: Context<AttestProofOfReserves>,
        verified_ratio_bps: u64,
    ) -> Result<()> {
        instructions::proof_of_reserves::attest_proof_of_reserves_handler(ctx, verified_ratio_bps)
    }

    // ─── SSS-130: Stability Fee PID Auto-Adjustment ─────────────────────────

    /// Initialize PID controller config for automatic stability fee adjustment.
    pub fn init_pid_config(
        ctx: Context<InitPidConfig>,
        params: instructions::pid_fee::InitPidConfigParams,
    ) -> Result<()> {
        instructions::pid_fee::init_pid_config_handler(ctx, params)
    }

    /// Permissionless keeper call: update stability fee via PID controller.
    pub fn update_stability_fee_pid(
        ctx: Context<UpdateStabilityFeePid>,
        current_price: u64,
    ) -> Result<()> {
        instructions::pid_fee::update_stability_fee_pid_handler(ctx, current_price)
    }

    // ─── SSS-131: Graduated Liquidation Bonuses ─────────────────────────────

    /// Initialize graduated liquidation bonus config. Authority only.
    pub fn init_liquidation_bonus_config(
        ctx: Context<InitLiquidationBonusConfig>,
        params: instructions::liquidation_bonus::InitLiquidationBonusConfigParams,
    ) -> Result<()> {
        instructions::liquidation_bonus::init_liquidation_bonus_config_handler(ctx, params)
    }

    /// Update graduated liquidation bonus config. Authority only.
    pub fn update_liquidation_bonus_config(
        ctx: Context<UpdateLiquidationBonusConfig>,
        params: instructions::liquidation_bonus::UpdateLiquidationBonusConfigParams,
    ) -> Result<()> {
        instructions::liquidation_bonus::update_liquidation_bonus_config_handler(ctx, params)
    }

    // ─── SSS-132: PSM Dynamic AMM-Style Slippage Curves ─────────────────────

    /// Initialize PSM curve config for dynamic AMM-style fees. Authority only.
    pub fn init_psm_curve_config(
        ctx: Context<InitPsmCurveConfig>,
        params: instructions::psm_amm_slippage::InitPsmCurveConfigParams,
    ) -> Result<()> {
        instructions::psm_amm_slippage::init_psm_curve_config_handler(ctx, params)
    }

    /// Update PSM curve config. Authority only.
    pub fn update_psm_curve_config(
        ctx: Context<UpdatePsmCurveConfig>,
        params: instructions::psm_amm_slippage::UpdatePsmCurveConfigParams,
    ) -> Result<()> {
        instructions::psm_amm_slippage::update_psm_curve_config_handler(ctx, params)
    }

    /// PSM redeem with dynamic AMM-style fee.
    pub fn psm_dynamic_swap(ctx: Context<PsmDynamicSwap>, amount: u64) -> Result<()> {
        instructions::psm_amm_slippage::psm_dynamic_swap_handler(ctx, amount)
    }

    /// Read-only PSM fee preview (no state mutation). Emits PsmQuoteEvent.
    pub fn get_psm_quote(ctx: Context<GetPsmQuote>, amount_in: u64) -> Result<()> {
        instructions::psm_amm_slippage::get_psm_quote_handler(ctx, amount_in)
    }

    // ─── SSS-134: Squads Protocol V4 Authority ──────────────────────────────

    /// Transfer authority to a Squads V4 multisig PDA. Irreversible.
    pub fn init_squads_authority(
        ctx: Context<InitSquadsAuthority>,
        params: instructions::squads_authority::InitSquadsAuthorityParams,
    ) -> Result<()> {
        instructions::squads_authority::init_squads_authority_handler(ctx, params)
    }

    /// Verify that a signer is the registered Squads multisig PDA. Read-only.
    pub fn verify_squads_authority(ctx: Context<VerifySquadsAuthority>) -> Result<()> {
        instructions::squads_authority::verify_squads_authority_handler(ctx)
    }

    // ─── SSS-133: Per-Wallet Rate Limiting ──────────────────────────────────

    /// Set or update a per-wallet rate limit. Authority only.
    pub fn set_wallet_rate_limit(
        ctx: Context<SetWalletRateLimit>,
        params: instructions::wallet_rate_limit::SetWalletRateLimitParams,
    ) -> Result<()> {
        instructions::wallet_rate_limit::set_wallet_rate_limit_handler(ctx, params)
    }

    /// Remove a per-wallet rate limit and reclaim rent. Authority only.
    pub fn remove_wallet_rate_limit(
        ctx: Context<RemoveWalletRateLimit>,
        wallet: Pubkey,
    ) -> Result<()> {
        instructions::wallet_rate_limit::remove_wallet_rate_limit_handler(ctx, wallet)
    }

    /// Update wallet rate limit counters (called via CPI from transfer hook).
    pub fn update_wallet_rate_limit(
        ctx: Context<UpdateWalletRateLimit>,
        params: instructions::wallet_rate_limit::UpdateWalletRateLimitParams,
    ) -> Result<()> {
        instructions::wallet_rate_limit::update_wallet_rate_limit_handler(ctx, params)
    }

    // ─── Reserve Composition ────────────────────────────────────────────────

    /// Create or update the reserve composition breakdown. Authority only.
    pub fn update_reserve_composition(
        ctx: Context<UpdateReserveComposition>,
        params: instructions::reserve_composition::ReserveCompositionParams,
    ) -> Result<()> {
        instructions::reserve_composition::update_reserve_composition_handler(ctx, params)
    }

    /// Read and log the current reserve composition. Callable by anyone.
    pub fn get_reserve_composition(ctx: Context<GetReserveComposition>) -> Result<()> {
        instructions::reserve_composition::get_reserve_composition_handler(ctx)
    }

    // ─── SSS-125: On-Chain Redemption Guarantee ─────────────────────────────

    /// Register a reserve vault as the redemption pool source. Authority only.
    pub fn register_redemption_pool(
        ctx: Context<RegisterRedemptionPool>,
        max_daily_redemption: u64,
    ) -> Result<()> {
        instructions::redemption_guarantee::register_redemption_pool_handler(ctx, max_daily_redemption)
    }

    /// Request a redemption — locks stable tokens in escrow.
    pub fn request_redemption(ctx: Context<RequestRedemption>, amount: u64) -> Result<()> {
        instructions::redemption_guarantee::request_redemption_handler(ctx, amount)
    }

    /// Fulfill a redemption request within the SLA window.
    pub fn fulfill_redemption(ctx: Context<FulfillRedemption>) -> Result<()> {
        instructions::redemption_guarantee::fulfill_redemption_handler(ctx)
    }

    /// Claim an expired redemption (SLA breached) — returns stable + penalty.
    pub fn claim_expired_redemption(ctx: Context<ClaimExpiredRedemption>) -> Result<()> {
        instructions::redemption_guarantee::claim_expired_redemption_handler(ctx)
    }

    // ─── SSS-137: On-Chain Redemption Pools ─────────────────────────────────

    /// Seed a redemption pool with collateral. Authority only.
    pub fn seed_redemption_pool(
        ctx: Context<SeedRedemptionPool>,
        amount: u64,
        max_pool_size: u64,
        instant_redemption_fee_bps: u16,
    ) -> Result<()> {
        instructions::redemption_pool::seed_redemption_pool_handler(ctx, amount, max_pool_size, instant_redemption_fee_bps)
    }

    /// Instant redemption — burn SSS tokens, receive collateral from pool.
    pub fn instant_redemption(ctx: Context<InstantRedemptionCtx>, amount: u64) -> Result<()> {
        instructions::redemption_pool::instant_redemption_handler(ctx, amount)
    }

    /// Replenish a redemption pool. Permissionless.
    pub fn replenish_redemption_pool(
        ctx: Context<ReplenishRedemptionPool>,
        amount: u64,
    ) -> Result<()> {
        instructions::redemption_pool::replenish_redemption_pool_handler(ctx, amount)
    }

    /// Drain the redemption pool. Authority only.
    pub fn drain_redemption_pool(ctx: Context<DrainRedemptionPool>) -> Result<()> {
        instructions::redemption_pool::drain_redemption_pool_handler(ctx)
    }

    // ─── SSS-127: Travel Rule Compliance ────────────────────────────────────

    /// Set the travel rule threshold. Authority only.
    pub fn set_travel_rule_threshold(
        ctx: Context<SetTravelRuleThreshold>,
        threshold: u64,
    ) -> Result<()> {
        instructions::travel_rule::set_travel_rule_threshold_handler(ctx, threshold)
    }

    /// Submit a Travel Rule record for a qualifying transfer.
    pub fn submit_travel_rule_record(
        ctx: Context<SubmitTravelRuleRecord>,
        nonce: u64,
        encrypted_payload: [u8; 256],
        beneficiary_vasp: Pubkey,
        transfer_amount: u64,
    ) -> Result<()> {
        instructions::travel_rule::submit_travel_rule_record_handler(ctx, nonce, encrypted_payload, beneficiary_vasp, transfer_amount)
    }

    /// Close a Travel Rule record and reclaim rent.
    pub fn close_travel_rule_record(
        ctx: Context<CloseTravelRuleRecord>,
        nonce: u64,
    ) -> Result<()> {
        instructions::travel_rule::close_travel_rule_record_handler(ctx, nonce)
    }

    // ─── SSS-128: Sanctions Screening Oracle ────────────────────────────────

    /// Register a sanctions oracle and staleness window. Authority only.
    pub fn set_sanctions_oracle(
        ctx: Context<SetSanctionsOracle>,
        oracle: Pubkey,
        max_staleness_slots: u64,
    ) -> Result<()> {
        instructions::sanctions_oracle::set_sanctions_oracle_handler(ctx, oracle, max_staleness_slots)
    }

    /// Disable the sanctions oracle. Authority only.
    pub fn clear_sanctions_oracle(ctx: Context<ClearSanctionsOracle>) -> Result<()> {
        instructions::sanctions_oracle::clear_sanctions_oracle_handler(ctx)
    }

    /// Oracle signer creates/updates a wallet's sanctions record.
    pub fn update_sanctions_record(
        ctx: Context<UpdateSanctionsRecord>,
        wallet: Pubkey,
        is_sanctioned: bool,
    ) -> Result<()> {
        instructions::sanctions_oracle::update_sanctions_record_handler(ctx, wallet, is_sanctioned)
    }

    /// Oracle signer closes a sanctions record and reclaims rent.
    pub fn close_sanctions_record(
        ctx: Context<CloseSanctionsRecord>,
        wallet: Pubkey,
    ) -> Result<()> {
        instructions::sanctions_oracle::close_sanctions_record_handler(ctx, wallet)
    }

    // ─── SSS Bridge: Cross-Chain Hooks ──────────────────────────────────────

    /// Initialize bridge config for a mint. Authority only.
    pub fn init_bridge_config(
        ctx: Context<InitBridgeConfig>,
        bridge_type: u8,
        bridge_program: Pubkey,
        max_bridge_amount_per_tx: u64,
        bridge_fee_bps: u16,
        fee_vault: Pubkey,
    ) -> Result<()> {
        instructions::bridge::init_bridge_config_handler(ctx, bridge_type, bridge_program, max_bridge_amount_per_tx, bridge_fee_bps, fee_vault)
    }

    /// Bridge tokens out of Solana — burns tokens, emits BridgeOut event.
    pub fn bridge_out(
        ctx: Context<BridgeTokensOut>,
        amount: u64,
        target_chain: u16,
        recipient_address: [u8; 32],
    ) -> Result<()> {
        instructions::bridge::bridge_out_handler(ctx, amount, target_chain, recipient_address)
    }

    /// Bridge tokens in — verify bridge proof, mint to recipient.
    pub fn bridge_in(
        ctx: Context<BridgeTokensIn>,
        proof: instructions::bridge::BridgeProof,
        amount: u64,
        recipient: Pubkey,
        message_id: [u8; 32],
    ) -> Result<()> {
        instructions::bridge::bridge_in_handler(ctx, proof, amount, recipient, message_id)
    }

    // ─── SSS-153: Multi-Oracle Consensus ────────────────────────────────────

    /// Initialize OracleConsensus PDA with median/TWAP aggregation. Authority only.
    pub fn init_oracle_consensus(
        ctx: Context<InitOracleConsensus>,
        min_oracles: u8,
        outlier_threshold_bps: u16,
        max_age_slots: u64,
    ) -> Result<()> {
        instructions::multi_oracle::init_oracle_consensus_handler(ctx, min_oracles, outlier_threshold_bps, max_age_slots)
    }

    /// Add or update an oracle source in the consensus PDA. Authority only.
    pub fn set_oracle_source(
        ctx: Context<SetOracleSource>,
        slot_index: u8,
        oracle_type: u8,
        feed_pubkey: Pubkey,
    ) -> Result<()> {
        instructions::multi_oracle::set_oracle_source_handler(ctx, slot_index, oracle_type, feed_pubkey)
    }

    /// Remove an oracle source from the consensus PDA. Authority only.
    pub fn remove_oracle_source(ctx: Context<RemoveOracleSource>, slot_index: u8) -> Result<()> {
        instructions::multi_oracle::remove_oracle_source_handler(ctx, slot_index)
    }

    /// Permissionless keeper: compute consensus price from registered sources.
    pub fn update_oracle_consensus<'info>(
        ctx: Context<'_, '_, 'info, 'info, UpdateOracleConsensus<'info>>,
    ) -> Result<()> {
        instructions::multi_oracle::update_oracle_consensus_handler(ctx)
    }

    // ─── SSS-138: Market Maker Hooks ────────────────────────────────────────

    /// Initialize market maker config. Authority only.
    pub fn init_market_maker_config(
        ctx: Context<InitMarketMakerConfig>,
        params: instructions::market_maker::InitMarketMakerConfigParams,
    ) -> Result<()> {
        instructions::market_maker::init_market_maker_config_handler(ctx, params)
    }

    /// Register a whitelisted market maker pubkey. Authority only.
    pub fn register_market_maker(
        ctx: Context<RegisterMarketMaker>,
        mm_pubkey: Pubkey,
    ) -> Result<()> {
        instructions::market_maker::register_market_maker_handler(ctx, mm_pubkey)
    }

    /// Whitelisted market maker mints tokens (subject to per-slot limit + oracle spread).
    pub fn mm_mint(ctx: Context<MmMintAccounts>, amount: u64) -> Result<()> {
        instructions::market_maker::mm_mint_handler(ctx, amount)
    }

    /// Whitelisted market maker burns tokens (subject to per-slot limit + oracle spread).
    pub fn mm_burn(ctx: Context<MmBurnAccounts>, amount: u64) -> Result<()> {
        instructions::market_maker::mm_burn_handler(ctx, amount)
    }

    /// Read-only: emits remaining mint/burn capacity for the current slot.
    pub fn get_mm_capacity(ctx: Context<GetMmCapacity>) -> Result<()> {
        instructions::market_maker::get_mm_capacity_handler(ctx)
    }

    // ─── SSS-150: Upgrade Authority Guard ───────────────────────────────────

    /// Record the expected BPF upgrade authority in the config. Irreversible.
    pub fn set_upgrade_authority_guard(
        ctx: Context<SetUpgradeAuthorityGuard>,
        upgrade_authority: Pubkey,
    ) -> Result<()> {
        instructions::upgrade_authority_guard::set_upgrade_authority_guard_handler(ctx, upgrade_authority)
    }

    /// Verify that the provided upgrade authority matches the recorded guard.
    pub fn verify_upgrade_authority(
        ctx: Context<VerifyUpgradeAuthority>,
        current_upgrade_authority: Pubkey,
    ) -> Result<()> {
        instructions::upgrade_authority_guard::verify_upgrade_authority_handler(ctx, current_upgrade_authority)
    }

    // ─── SSS-152: Circuit Breaker Keeper ────────────────────────────────────

    /// Initialize the keeper config for automated circuit breaker. Authority only.
    pub fn init_keeper_config(
        ctx: Context<InitKeeperConfig>,
        params: instructions::circuit_breaker_keeper::InitKeeperConfigParams,
    ) -> Result<()> {
        instructions::circuit_breaker_keeper::init_keeper_config_handler(ctx, params)
    }

    /// Deposit SOL into the keeper fee vault. Anyone may fund.
    pub fn seed_keeper_vault(
        ctx: Context<SeedKeeperVault>,
        amount_lamports: u64,
    ) -> Result<()> {
        instructions::circuit_breaker_keeper::seed_keeper_vault_handler(ctx, amount_lamports)
    }

    /// Permissionless: trigger circuit breaker if peg deviates beyond threshold.
    pub fn crank_circuit_breaker(ctx: Context<CrankCircuitBreaker>) -> Result<()> {
        instructions::circuit_breaker_keeper::crank_circuit_breaker_handler(ctx)
    }

    /// Permissionless: unpause after price returns within threshold for recovery window.
    pub fn crank_unpause(ctx: Context<CrankUnpause>) -> Result<()> {
        instructions::circuit_breaker_keeper::crank_unpause_handler(ctx)
    }
}

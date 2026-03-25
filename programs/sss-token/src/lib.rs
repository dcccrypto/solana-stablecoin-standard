use anchor_lang::prelude::*;

pub mod error;
pub mod events;
pub mod fuzz_tests;
pub mod instructions;
pub mod oracle;
pub mod proofs;
pub mod state;

use instructions::*;

declare_id!("AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat");

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

    /// SSS-092: Accrue and burn stability fees on a CDP position.
    /// Callable by the debtor (or any keeper); debtor signs to authorise the burn.
    pub fn collect_stability_fee(ctx: Context<CollectStabilityFee>) -> Result<()> {
        instructions::stability_fee::collect_stability_fee_handler(ctx)
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
    /// Emits `BadDebtTriggered`.
    pub fn trigger_backstop(
        ctx: Context<TriggerBackstop>,
        shortfall_amount: u64,
    ) -> Result<()> {
        instructions::bad_debt_backstop::trigger_backstop_handler(ctx, shortfall_amount)
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

    // ─── SSS-109: Probabilistic Balance Standard ──────────────────────────────

    /// Lock stablecoin tokens in a ProbabilisticVault PDA conditioned on
    /// a hash-based proof.  Requires FLAG_PROBABILISTIC_MONEY on the config.
    pub fn commit_probabilistic(
        ctx: Context<CommitProbabilistic>,
        params: instructions::pbs::CommitProbabilisticParams,
    ) -> Result<()> {
        instructions::pbs::commit_probabilistic_handler(ctx, params)
    }

    /// Release the full committed amount to the claimant by supplying the
    /// matching proof hash.  Marks vault as Resolved.
    pub fn prove_and_resolve(
        ctx: Context<ProveAndResolve>,
        proof_hash: [u8; 32],
    ) -> Result<()> {
        instructions::pbs::prove_and_resolve_handler(ctx, proof_hash)
    }

    /// Release `amount` tokens to the claimant and return the remainder to
    /// the issuer immediately.  Marks vault as PartiallyResolved.
    pub fn partial_resolve(
        ctx: Context<PartialResolve>,
        amount: u64,
        proof_hash: [u8; 32],
    ) -> Result<()> {
        instructions::pbs::partial_resolve_handler(ctx, amount, proof_hash)
    }

    /// Permissionless: refund committed tokens to the issuer once
    /// `current_slot >= expiry_slot`.  Marks vault as Expired.
    pub fn expire_and_refund(ctx: Context<ExpireAndRefund>) -> Result<()> {
        instructions::pbs::expire_and_refund_handler(ctx)
    }

    // ─── SSS-110: Agent Payment Channel ───────────────────────────────────────

    pub fn open_channel(
        ctx: Context<OpenChannel>,
        params: instructions::apc::OpenChannelParams,
    ) -> Result<()> {
        instructions::apc::open_channel_handler(ctx, params)
    }

    pub fn submit_work_proof(
        ctx: Context<SubmitWorkProof>,
        channel_id: u64,
        task_hash: [u8; 32],
        output_hash: [u8; 32],
        proof_type: u8,
    ) -> Result<()> {
        instructions::apc::submit_work_proof_handler(ctx, channel_id, task_hash, output_hash, proof_type)
    }

    pub fn propose_settle(
        ctx: Context<ProposeSettle>,
        channel_id: u64,
        amount: u64,
    ) -> Result<()> {
        instructions::apc::propose_settle_handler(ctx, channel_id, amount)
    }

    pub fn countersign_settle(
        ctx: Context<CountersignSettle>,
        channel_id: u64,
        amount: u64,
    ) -> Result<()> {
        instructions::apc::countersign_settle_handler(ctx, channel_id, amount)
    }

    pub fn dispute(
        ctx: Context<Dispute>,
        channel_id: u64,
        evidence_hash: [u8; 32],
    ) -> Result<()> {
        instructions::apc::dispute_handler(ctx, channel_id, evidence_hash)
    }

    pub fn force_close(ctx: Context<ForceClose>, channel_id: u64) -> Result<()> {
        instructions::apc::force_close_handler(ctx, channel_id)
    }

    // ─── SSS-123: Proof of Reserves ───────────────────────────────────────────

    /// Submit or refresh a reserve attestation.
    ///
    /// Stores `reserve_amount`, 32-byte `attestation_hash`, attestor pubkey,
    /// and the current slot into the `ProofOfReserves` PDA.
    /// Callable by: authority, Pyth publisher (expected_pyth_feed), or whitelisted custodian.
    /// Emits `ReserveAttestationSubmitted`.
    pub fn submit_reserve_attestation(
        ctx: Context<SubmitReserveAttestation>,
        reserve_amount: u64,
        attestation_hash: [u8; 32],
    ) -> Result<()> {
        instructions::proof_of_reserves::submit_reserve_attestation_handler(
            ctx,
            reserve_amount,
            attestation_hash,
        )
    }

    /// Compute the current reserve ratio and emit `ReserveRatioEvent`.
    /// If ratio drops below `config.min_reserve_ratio_bps`, also emits `ReserveBreach`.
    /// Callable by anyone (permissionless) — intended for keepers and monitoring.
    pub fn verify_reserve_ratio(ctx: Context<VerifyReserveRatio>) -> Result<()> {
        instructions::proof_of_reserves::verify_reserve_ratio_handler(ctx)
    }

    /// Read the current reserve status and emit a log summary.
    /// Returns: reserve_amount, net_supply, ratio_bps, last_attestation_slot, attestor.
    /// Read-only; callable by anyone.
    pub fn get_reserve_status(ctx: Context<GetReserveStatus>) -> Result<()> {
        instructions::proof_of_reserves::get_reserve_status_handler(ctx)
    }

    /// Update the reserve attestor whitelist. Authority only.
    /// Replaces the current whitelist with the provided `whitelist` (max 4 entries).
    pub fn set_reserve_attestor_whitelist(
        ctx: Context<SetReserveAttestorWhitelist>,
        whitelist: Vec<Pubkey>,
    ) -> Result<()> {
        instructions::proof_of_reserves::set_reserve_attestor_whitelist_handler(ctx, whitelist)
    }

    // ─── SSS-124: Reserve Composition ────────────────────────────────────────

    /// Create or update the on-chain reserve composition breakdown.
    /// `params.cash_bps + params.t_bills_bps + params.crypto_bps + params.other_bps` must equal 10_000.
    /// Authority only. Emits `ReserveCompositionUpdated`.
    pub fn update_reserve_composition(
        ctx: Context<UpdateReserveComposition>,
        params: ReserveCompositionParams,
    ) -> Result<()> {
        instructions::reserve_composition::update_reserve_composition_handler(ctx, params)
    }

    /// Read and log the current reserve composition. Callable by anyone.
    pub fn get_reserve_composition(ctx: Context<GetReserveComposition>) -> Result<()> {
        instructions::reserve_composition::get_reserve_composition_handler(ctx)
    }

    // ─── SSS-125: Redemption Guarantee ───────────────────────────────────────

    /// Register (or update) a reserve vault as the redemption pool source.
    /// `max_daily_redemption`: maximum stable tokens redeemable in a 24h window (~216000 slots).
    /// Authority only.
    pub fn register_redemption_pool(
        ctx: Context<RegisterRedemptionPool>,
        max_daily_redemption: u64,
    ) -> Result<()> {
        instructions::redemption_guarantee::register_redemption_pool_handler(
            ctx,
            max_daily_redemption,
        )
    }

    /// Initiate a redemption request. Transfers `amount` stable tokens to escrow
    /// and creates a RedemptionRequest PDA with `expiry_slot = now + sla_slots`.
    /// Callable by any token holder.
    pub fn request_redemption(ctx: Context<RequestRedemption>, amount: u64) -> Result<()> {
        instructions::redemption_guarantee::request_redemption_handler(ctx, amount)
    }

    /// Fulfill a pending redemption: stable tokens move to burn destination,
    /// reserve tokens released to user at 1:1 par. Emits `RedemptionFulfilled`.
    /// Must be called before `expiry_slot`.
    pub fn fulfill_redemption(ctx: Context<FulfillRedemption>) -> Result<()> {
        instructions::redemption_guarantee::fulfill_redemption_handler(ctx)
    }

    /// Claim an expired (SLA-breached) redemption: stable tokens returned to user,
    /// penalty from insurance fund paid to user. Emits `RedemptionSLABreached`.
    /// Must be called after `expiry_slot` by the requesting user.
    pub fn claim_expired_redemption(ctx: Context<ClaimExpiredRedemption>) -> Result<()> {
        instructions::redemption_guarantee::claim_expired_redemption_handler(ctx)
    }

    // -------------------------------------------------------------------------
    // SSS-127: Travel Rule compliance hooks
    // -------------------------------------------------------------------------

    /// Set the Travel Rule transfer threshold (token native units). 0 = disabled.
    pub fn set_travel_rule_threshold(
        ctx: Context<SetTravelRuleThreshold>,
        threshold: u64,
    ) -> Result<()> {
        instructions::travel_rule::set_travel_rule_threshold_handler(ctx, threshold)
    }

    /// Submit a Travel Rule record for a qualifying transfer.
    /// Must be called in the same transaction as the transfer.
    pub fn submit_travel_rule_record(
        ctx: Context<SubmitTravelRuleRecord>,
        nonce: u64,
        encrypted_payload: [u8; 256],
        beneficiary_vasp: Pubkey,
        transfer_amount: u64,
    ) -> Result<()> {
        instructions::travel_rule::submit_travel_rule_record_handler(
            ctx,
            nonce,
            encrypted_payload,
            beneficiary_vasp,
            transfer_amount,
        )
    }

    /// Close a Travel Rule record and reclaim rent after the transfer settles.
    pub fn close_travel_rule_record(
        ctx: Context<CloseTravelRuleRecord>,
        nonce: u64,
    ) -> Result<()> {
        instructions::travel_rule::close_travel_rule_record_handler(ctx, nonce)
    }

    // -------------------------------------------------------------------------
    // SSS-128: Sanctions screening oracle
    // -------------------------------------------------------------------------

    /// Register a sanctions oracle signer on this stablecoin config.
    /// Sets `sanctions_oracle`, `sanctions_max_staleness_slots`, and enables
    /// FLAG_SANCTIONS_ORACLE.  Authority only.
    pub fn set_sanctions_oracle(
        ctx: Context<SetSanctionsOracle>,
        oracle: Pubkey,
        max_staleness_slots: u64,
    ) -> Result<()> {
        instructions::sanctions_oracle::set_sanctions_oracle_handler(ctx, oracle, max_staleness_slots)
    }

    /// Deregister the sanctions oracle and disable FLAG_SANCTIONS_ORACLE.
    /// Authority only.
    pub fn clear_sanctions_oracle(ctx: Context<ClearSanctionsOracle>) -> Result<()> {
        instructions::sanctions_oracle::clear_sanctions_oracle_handler(ctx)
    }

    /// Create or update a `SanctionsRecord` PDA for a given wallet.
    /// Caller must sign as the registered `config.sanctions_oracle`.
    /// Used by compliance providers (Chainalysis, Elliptic, TRM, etc.) to flag wallets.
    pub fn update_sanctions_record(
        ctx: Context<UpdateSanctionsRecord>,
        wallet: Pubkey,
        is_sanctioned: bool,
    ) -> Result<()> {
        instructions::sanctions_oracle::update_sanctions_record_handler(ctx, wallet, is_sanctioned)
    }

    /// Close a `SanctionsRecord` PDA and reclaim rent.
    /// Caller must sign as the registered `config.sanctions_oracle`.
    pub fn close_sanctions_record(
        ctx: Context<CloseSanctionsRecord>,
        wallet: Pubkey,
    ) -> Result<()> {
        instructions::sanctions_oracle::close_sanctions_record_handler(ctx, wallet)
    }

    // -----------------------------------------------------------------------
    // SSS-130: Stability fee PID auto-adjustment
    // -----------------------------------------------------------------------

    /// Initialise a `PidConfig` PDA and enable FLAG_PID_FEE_CONTROL.
    /// Authority-only.  Sets the PID gains, target price, and fee range.
    pub fn init_pid_config(
        ctx: Context<InitPidConfig>,
        params: InitPidConfigParams,
    ) -> Result<()> {
        instructions::pid_fee::init_pid_config_handler(ctx, params)
    }

    /// Update `stability_fee_bps` via the PID controller.
    /// Permissionless — any keeper may call this.
    /// `current_price`: oracle price in the same units as `PidConfig.target_price`.
    pub fn update_stability_fee_pid(
        ctx: Context<UpdateStabilityFeePid>,
        current_price: u64,
    ) -> Result<()> {
        instructions::pid_fee::update_stability_fee_pid_handler(ctx, current_price)
    }

    // -----------------------------------------------------------------------
    // SSS-129: ZK credential registry — Groth16-based selective disclosure
    // -----------------------------------------------------------------------

    /// Initialise a `CredentialRegistry` PDA and enable FLAG_ZK_CREDENTIALS.
    /// Authority-only.  Sets the issuer, Merkle root, and TTL for credential records.
    pub fn init_credential_registry(
        ctx: Context<InitCredentialRegistry>,
        params: InitCredentialRegistryParams,
    ) -> Result<()> {
        instructions::zk_credential::init_credential_registry_handler(ctx, params)
    }

    /// Rotate the Groth16 Merkle root on an existing CredentialRegistry.
    /// Issuer-only.  Existing CredentialRecords remain valid until they expire or
    /// are revoked.
    pub fn rotate_credential_root(
        ctx: Context<RotateCredentialRoot>,
        new_merkle_root: [u8; 32],
    ) -> Result<()> {
        instructions::zk_credential::rotate_credential_root_handler(ctx, new_merkle_root)
    }

    /// Verify a Groth16 ZK credential proof and create/refresh a `CredentialRecord`
    /// PDA for the calling holder.  Any wallet may call this.
    /// `proof`: 192-byte Groth16 proof.
    /// `public_signals`: ABI-encoded public signals (first 32 bytes = Merkle root commitment).
    pub fn verify_zk_credential(
        ctx: Context<VerifyZkCredential>,
        proof: Vec<u8>,
        public_signals: Vec<u8>,
    ) -> Result<()> {
        instructions::zk_credential::verify_zk_credential_handler(ctx, proof, public_signals)
    }

    /// Revoke a holder's `CredentialRecord`.  Issuer-only.
    /// Revoked records cause transfer hook to reject the holder's transfers immediately.
    pub fn revoke_credential(ctx: Context<RevokeCredential>) -> Result<()> {
        instructions::zk_credential::revoke_credential_handler(ctx)
    }

    /// Close a `CredentialRecord` PDA and reclaim rent.
    /// Only the record holder may close their own record.
    pub fn close_credential_record(ctx: Context<CloseCredentialRecord>) -> Result<()> {
        instructions::zk_credential::close_credential_record_handler(ctx)
    }

    // -----------------------------------------------------------------------
    // SSS-131: Graduated liquidation bonuses
    // -----------------------------------------------------------------------

    /// Initialise a `LiquidationBonusConfig` PDA and enable FLAG_GRAD_LIQUIDATION_BONUS.
    /// Authority-only. Defines three tiers of graduated bonuses based on CDP collateral ratio.
    pub fn init_liquidation_bonus_config(
        ctx: Context<InitLiquidationBonusConfig>,
        params: InitLiquidationBonusConfigParams,
    ) -> Result<()> {
        instructions::liquidation_bonus::init_liquidation_bonus_config_handler(ctx, params)
    }

    /// Update the tier thresholds and bonus rates in an existing `LiquidationBonusConfig`.
    /// Authority-only.
    pub fn update_liquidation_bonus_config(
        ctx: Context<UpdateLiquidationBonusConfig>,
        params: UpdateLiquidationBonusConfigParams,
    ) -> Result<()> {
        instructions::liquidation_bonus::update_liquidation_bonus_config_handler(ctx, params)
    }

    // -----------------------------------------------------------------------
    // SSS-132: PSM dynamic AMM-style slippage curves
    // -----------------------------------------------------------------------

    /// Initialise a `PsmCurveConfig` PDA and enable FLAG_PSM_DYNAMIC_FEES.
    /// Authority-only.  SSS-3 only.
    /// Sets base_fee_bps, curve_k (steepness), and max_fee_bps.
    /// After init, `psm_dynamic_swap` replaces `redeem` for dynamic-fee PSM ops.
    pub fn init_psm_curve_config(
        ctx: Context<InitPsmCurveConfig>,
        params: InitPsmCurveConfigParams,
    ) -> Result<()> {
        instructions::psm_amm_slippage::init_psm_curve_config_handler(ctx, params)
    }

    /// Update curve parameters on an existing `PsmCurveConfig`.
    /// Authority-only.
    pub fn update_psm_curve_config(
        ctx: Context<UpdatePsmCurveConfig>,
        params: UpdatePsmCurveConfigParams,
    ) -> Result<()> {
        instructions::psm_amm_slippage::update_psm_curve_config_handler(ctx, params)
    }

    /// PSM swap with dynamic AMM-style fee.
    /// Burns `amount` SSS tokens; releases `amount - dynamic_fee` collateral.
    /// FLAG_PSM_DYNAMIC_FEES must be set; uses `PsmCurveConfig` for fee computation.
    pub fn psm_dynamic_swap(ctx: Context<PsmDynamicSwap>, amount: u64) -> Result<()> {
        instructions::psm_amm_slippage::psm_dynamic_swap_handler(ctx, amount)
    }

    /// Read-only PSM fee preview — emits `PsmQuoteEvent` with expected output and fee.
    /// Use with `simulateTransaction` — no state is mutated.
    pub fn get_psm_quote(ctx: Context<GetPsmQuote>, amount_in: u64) -> Result<()> {
        instructions::psm_amm_slippage::get_psm_quote_handler(ctx, amount_in)
    }

    // -----------------------------------------------------------------------
    // SSS-133: Per-wallet rate limiting — address-level spend controls
    // -----------------------------------------------------------------------

    /// Create or update a `WalletRateLimit` PDA for a specific wallet.
    /// Authority-only.  FLAG_WALLET_RATE_LIMITS must be set.
    ///
    /// `params.wallet`: token account owner to rate-limit.
    /// `params.max_transfer_per_window`: maximum tokens per rolling window.
    /// `params.window_slots`: window duration in slots.
    ///
    /// Resets the current window counters on every call (allowing admins
    /// to adjust limits without waiting for window expiry).
    pub fn set_wallet_rate_limit(
        ctx: Context<SetWalletRateLimit>,
        params: SetWalletRateLimitParams,
    ) -> Result<()> {
        instructions::wallet_rate_limit::set_wallet_rate_limit_handler(ctx, params)
    }

    /// Remove a `WalletRateLimit` PDA for a specific wallet and reclaim rent.
    /// Authority-only.  Removes all rate limiting for the given wallet address.
    pub fn remove_wallet_rate_limit(
        ctx: Context<RemoveWalletRateLimit>,
        wallet: Pubkey,
    ) -> Result<()> {
        instructions::wallet_rate_limit::remove_wallet_rate_limit_handler(ctx, wallet)
    }

    /// Update WalletRateLimit counters — called via CPI from the transfer-hook program.
    /// The transfer-hook cannot write directly to WalletRateLimit PDAs owned by sss-token;
    /// it must CPI to this instruction which has authority over its own PDAs.
    ///
    /// Caller must be the registered `transfer_hook_program` on the config, or the authority.
    pub fn update_wallet_rate_limit(
        ctx: Context<UpdateWalletRateLimit>,
        params: UpdateWalletRateLimitParams,
    ) -> Result<()> {
        instructions::wallet_rate_limit::update_wallet_rate_limit_handler(ctx, params)
    }

    // -----------------------------------------------------------------------
    // SSS-134: PRESET_INSTITUTIONAL — Squads V4 multisig native authority
    // -----------------------------------------------------------------------

    /// Transfer stablecoin authority to a Squads Protocol V4 multisig PDA.
    ///
    /// - Sets `config.authority` to the Squads multisig PDA (irreversible).
    /// - Sets `FLAG_SQUADS_AUTHORITY` in `config.feature_flags`.
    /// - Sets `config.preset = PRESET_INSTITUTIONAL (4)`.
    /// - Creates a `SquadsMultisigConfig` PDA with threshold and member list.
    ///
    /// After calling this instruction, all authority-gated instructions must be
    /// invoked via Squads CPI so the multisig PDA appears as a signer.
    ///
    /// Recommended for any issuer holding > $1 M in reserves.
    pub fn init_squads_authority(
        ctx: Context<InitSquadsAuthority>,
        params: InitSquadsAuthorityParams,
    ) -> Result<()> {
        instructions::squads_authority::init_squads_authority_handler(ctx, params)
    }

    /// Verify that a signer is the registered Squads V4 multisig PDA for this
    /// stablecoin.  Emits `SquadsAuthorityVerified`.  Read-only; no state mutation.
    ///
    /// Useful for integrators and SDK callers to confirm Squads configuration
    /// before executing a multisig workflow.
    pub fn verify_squads_authority(ctx: Context<VerifySquadsAuthority>) -> Result<()> {
        instructions::squads_authority::verify_squads_authority_handler(ctx)
    }

    // -----------------------------------------------------------------------
    // SSS-121: Guardian Multisig Emergency Pause
    // -----------------------------------------------------------------------

    /// Initialise the guardian multisig for a stablecoin config.
    /// Registers 1–7 guardian pubkeys and a threshold (≥1, ≤len).
    /// Authority only; can only be called once.
    pub fn init_guardian_config(
        ctx: Context<InitGuardianConfig>,
        guardians: Vec<Pubkey>,
        threshold: u8,
    ) -> Result<()> {
        instructions::guardian::init_guardian_config_handler(ctx, guardians, threshold)
    }

    /// Open a new PauseProposal PDA. Any registered guardian may call this.
    pub fn guardian_propose_pause(
        ctx: Context<GuardianProposePause>,
        reason: [u8; 32],
    ) -> Result<()> {
        instructions::guardian::guardian_propose_pause_handler(ctx, reason)
    }

    /// Cast a vote on an open PauseProposal. Once votes ≥ threshold, auto-executes pause.
    pub fn guardian_vote_pause(
        ctx: Context<GuardianVotePause>,
        proposal_id: u64,
    ) -> Result<()> {
        instructions::guardian::guardian_vote_pause_handler(ctx, proposal_id)
    }

    /// Lift a guardian-initiated pause. Requires authority OR full guardian quorum.
    pub fn guardian_lift_pause(ctx: Context<GuardianLiftPause>) -> Result<()> {
        instructions::guardian::guardian_lift_pause_handler(ctx)
    }

    // -----------------------------------------------------------------------
    // SSS-122: Config upgrade path / migrate_config
    // -----------------------------------------------------------------------

    /// Migrate StablecoinConfig from v0 to the current version.
    /// Resizes the PDA if needed and initialises new fields to safe defaults.
    pub fn migrate_config(ctx: Context<MigrateConfig>) -> Result<()> {
        instructions::upgrade::migrate_config_handler(ctx)
    }

    // ─── SSS-135: Cross-Chain Bridge ─────────────────────────────────────────

    /// Initialize the bridge config for a mint.  Authority-only.
    /// Enables FLAG_BRIDGE_ENABLED separately via set_feature_flag (timelock guarded).
    pub fn init_bridge_config(
        ctx: Context<InitBridgeConfig>,
        bridge_type: u8,
        bridge_program: Pubkey,
        max_bridge_amount_per_tx: u64,
        bridge_fee_bps: u16,
        fee_vault: Pubkey,
    ) -> Result<()> {
        instructions::bridge::init_bridge_config_handler(
            ctx,
            bridge_type,
            bridge_program,
            max_bridge_amount_per_tx,
            bridge_fee_bps,
            fee_vault,
        )
    }

    /// Bridge tokens out: burns `amount` from sender's token account,
    /// emits BridgeOut event for off-chain relayer to process.
    /// Respects paused, circuit breaker, max_bridge_amount_per_tx, fee.
    pub fn bridge_out(
        ctx: Context<BridgeTokensOut>,
        amount: u64,
        target_chain: u16,
        recipient_address: [u8; 32],
    ) -> Result<()> {
        instructions::bridge::bridge_out_handler(ctx, amount, target_chain, recipient_address)
    }

    /// Bridge tokens in: verifies bridge proof, mints `amount` to recipient.
    /// Respects paused, circuit breaker, max_supply.
    /// `message_id` is the unique cross-chain message identifier used for replay protection.
    pub fn bridge_in(
        ctx: Context<BridgeTokensIn>,
        proof: BridgeProof,
        amount: u64,
        recipient: Pubkey,
        message_id: [u8; 32],
    ) -> Result<()> {
        instructions::bridge::bridge_in_handler(ctx, proof, amount, recipient, message_id)
    }

    // -----------------------------------------------------------------------
    // SSS-138: Market Maker Hooks
    // -----------------------------------------------------------------------

    /// Initialize the MarketMakerConfig PDA for a mint.
    /// Authority-only. Sets per-slot mint/burn limits and spread tolerance.
    /// Requires FLAG_MARKET_MAKER_HOOKS to be set on the stablecoin config.
    pub fn init_market_maker_config(
        ctx: Context<InitMarketMakerConfig>,
        params: InitMarketMakerConfigParams,
    ) -> Result<()> {
        instructions::market_maker::init_market_maker_config_handler(ctx, params)
    }

    /// Register a market maker pubkey on the whitelist.
    /// Authority-only. Requires FLAG_MARKET_MAKER_HOOKS to be active.
    pub fn register_market_maker(
        ctx: Context<RegisterMarketMaker>,
        mm_pubkey: Pubkey,
    ) -> Result<()> {
        instructions::market_maker::register_market_maker_handler(ctx, mm_pubkey)
    }

    /// Mint tokens as a whitelisted market maker.
    /// Bypasses stability fees; subject to per-slot rate limit and oracle spread check.
    /// Enforces max_supply and updates StablecoinConfig.total_minted.
    pub fn mm_mint(ctx: Context<MmMintAccounts>, amount: u64) -> Result<()> {
        instructions::market_maker::mm_mint_handler(ctx, amount)
    }

    /// Burn tokens as a whitelisted market maker.
    /// Bypasses stability fees; subject to per-slot rate limit and oracle spread check.
    /// Updates StablecoinConfig.total_burned.
    pub fn mm_burn(ctx: Context<MmBurnAccounts>, amount: u64) -> Result<()> {
        instructions::market_maker::mm_burn_handler(ctx, amount)
    }

    /// Read-only: returns the current per-slot MM mint/burn capacity remaining.
    pub fn get_mm_capacity(ctx: Context<GetMmCapacity>) -> Result<()> {
        instructions::market_maker::get_mm_capacity_handler(ctx)
    }
}

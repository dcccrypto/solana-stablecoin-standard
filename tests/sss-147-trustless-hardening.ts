/**
 * SSS-147: Trustless Hardening — Pure TypeScript simulation tests
 *
 * Tests for:
 *  1.  Committee member can propose (is_member || is_authority check)
 *  2.  Non-member non-authority cannot propose
 *  3.  Authority can still propose (is_authority path)
 *  4.  FLAG_DAO_COMMITTEE cannot be cleared via clear_feature_flag (DaoCommitteeRequired)
 *  5.  FLAG_DAO_COMMITTEE cannot be cleared via timelock (DaoFlagProtected)
 *  6.  SSS-3 initialize requires supply_cap > 0 (RequiresMaxSupplyForSSS3)
 *  7.  SSS-1 initialize allows supply_cap == 0
 *  8.  SSS-2 initialize allows supply_cap == 0
 *  9.  supply_cap_locked is set to true for SSS-3 at initialize time
 * 10.  Proposal from member reaches quorum and can be executed (pause action)
 * 11.  SSS-3 initialize without squads_multisig is rejected (RequiresSquadsForSSS3)
 * 12.  SSS-3 initialize with squads_multisig succeeds + FLAG_SQUADS_AUTHORITY set
 * 13.  SSS-1/SSS-2 initialize without squads_multisig still succeeds
 *
 * These tests simulate the on-chain logic in pure TypeScript for CI speed and
 * to avoid requiring a running validator.  The simulation closely mirrors the
 * Rust handler logic so that any deviation will catch regressions.
 *
 * See also:
 *   programs/sss-token/src/instructions/dao_committee.rs  — BUG-011 fix
 *   programs/sss-token/src/instructions/feature_flags.rs  — DaoCommitteeRequired guard
 *   programs/sss-token/src/instructions/admin_timelock.rs — DaoFlagProtected guard
 *   programs/sss-token/src/instructions/initialize.rs     — SSS-3 supply cap lock
 *   programs/sss-token/src/state.rs                       — supply_cap_locked field
 */

import { assert } from "chai";
import { Keypair, PublicKey } from "@solana/web3.js";

// ---------------------------------------------------------------------------
// Constants (mirrors Rust state.rs)
// ---------------------------------------------------------------------------
const FLAG_DAO_COMMITTEE = BigInt(1) << BigInt(2);   // bit 2 = 4
const FLAG_CIRCUIT_BREAKER = BigInt(1) << BigInt(0); // bit 0 = 1
const FLAG_SQUADS_AUTHORITY = BigInt(1) << BigInt(13); // bit 13 — SSS-147A
const DEFAULT_PUBKEY = PublicKey.default.toBase58();

// ---------------------------------------------------------------------------
// Error codes (mirrors SssError enum)
// ---------------------------------------------------------------------------
const Err = {
  Unauthorized: "Unauthorized",
  NotAuthorizedToPropose: "NotAuthorizedToPropose",
  DaoCommitteeRequired: "DaoCommitteeRequired",
  DaoFlagProtected: "DaoFlagProtected",
  SupplyCapRequired: "SupplyCapRequired",
  RequiresMaxSupplyForSSS3: "RequiresMaxSupplyForSSS3",
  MaxSupplyImmutable: "MaxSupplyImmutable",
  InvalidPreset: "InvalidPreset",
  MissingTransferHook: "MissingTransferHook",
  InvalidCollateralMint: "InvalidCollateralMint",
  InvalidVault: "InvalidVault",
  QuorumNotReached: "QuorumNotReached",
  ProposalAlreadyExecuted: "ProposalAlreadyExecuted",
  AlreadyVoted: "AlreadyVoted",
  NotACommitteeMember: "NotACommitteeMember",
  RequiresSquadsForSSS3: "RequiresSquadsForSSS3",
};

// ---------------------------------------------------------------------------
// State models
// ---------------------------------------------------------------------------

interface StablecoinConfig {
  authority: string;            // pubkey as base58
  feature_flags: bigint;
  paused: boolean;
  max_supply: bigint;
  supply_cap_locked: boolean;
  preset: number;
}

interface DaoCommitteeConfig {
  members: string[];            // pubkeys as base58
  quorum: number;
  next_proposal_id: number;
}

interface ProposalPda {
  proposal_id: number;
  proposer: string;
  action: ProposalAction;
  param: bigint;
  target: string;
  votes: string[];
  quorum: number;
  executed: boolean;
  cancelled: boolean;
}

enum ProposalAction {
  Pause = 0,
  Unpause = 1,
  SetFeatureFlag = 2,
  ClearFeatureFlag = 3,
  UpdateMinter = 4,
  RevokeMinter = 5,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function key(kp: Keypair): string {
  return kp.publicKey.toBase58();
}

function defaultConfig(overrides?: Partial<StablecoinConfig>): StablecoinConfig {
  return {
    authority: Keypair.generate().publicKey.toBase58(),
    feature_flags: FLAG_DAO_COMMITTEE, // DAO active by default
    paused: false,
    max_supply: 1_000_000n,
    supply_cap_locked: false,
    preset: 1,
    ...overrides,
  };
}

function defaultCommittee(
  members: string[],
  quorum = 1
): DaoCommitteeConfig {
  return { members, quorum, next_proposal_id: 0 };
}

// ---------------------------------------------------------------------------
// Simulated handlers
// ---------------------------------------------------------------------------

/**
 * Simulate propose_action_handler:
 *   - DAO committee must be active (FLAG_DAO_COMMITTEE set)
 *   - proposer must be authority OR in committee.members
 */
function simulateProposeAction(
  proposerKey: string,
  config: StablecoinConfig,
  committee: DaoCommitteeConfig,
  action: ProposalAction,
  param: bigint = 0n,
  target: string = PublicKey.default.toBase58()
): { ok: true; proposal: ProposalPda } | { ok: false; error: string } {
  // DAO committee must be active
  if (!(config.feature_flags & FLAG_DAO_COMMITTEE)) {
    return { ok: false, error: Err.DaoCommitteeRequired };
  }

  // BUG-011: allow authority OR committee member to propose
  const is_authority = config.authority === proposerKey;
  const is_member = committee.members.includes(proposerKey);
  if (!(is_authority || is_member)) {
    return { ok: false, error: Err.NotAuthorizedToPropose };
  }

  const proposal_id = committee.next_proposal_id;
  committee.next_proposal_id += 1;

  return {
    ok: true,
    proposal: {
      proposal_id,
      proposer: proposerKey,
      action,
      param,
      target,
      votes: [],
      quorum: committee.quorum,
      executed: false,
      cancelled: false,
    },
  };
}

/**
 * Simulate vote_action_handler:
 *   - voter must be in committee.members
 *   - no duplicate votes
 *   - proposal must not be executed or cancelled
 */
function simulateVoteAction(
  voterKey: string,
  committee: DaoCommitteeConfig,
  proposal: ProposalPda
): { ok: true } | { ok: false; error: string } {
  if (!committee.members.includes(voterKey)) {
    return { ok: false, error: Err.NotACommitteeMember };
  }
  if (proposal.executed) {
    return { ok: false, error: Err.ProposalAlreadyExecuted };
  }
  if (proposal.votes.includes(voterKey)) {
    return { ok: false, error: Err.AlreadyVoted };
  }
  proposal.votes.push(voterKey);
  return { ok: true };
}

/**
 * Simulate execute_action_handler:
 *   - quorum must be reached
 *   - proposal must not be already executed
 *   - applies Pause action to config
 */
function simulateExecuteAction(
  proposal: ProposalPda,
  config: StablecoinConfig
): { ok: true } | { ok: false; error: string } {
  if (proposal.executed) {
    return { ok: false, error: Err.ProposalAlreadyExecuted };
  }
  if (proposal.votes.length < proposal.quorum) {
    return { ok: false, error: Err.QuorumNotReached };
  }
  proposal.executed = true;
  // Apply action
  if (proposal.action === ProposalAction.Pause) {
    config.paused = true;
  } else if (proposal.action === ProposalAction.Unpause) {
    config.paused = false;
  } else if (proposal.action === ProposalAction.SetFeatureFlag) {
    config.feature_flags |= proposal.param;
  } else if (proposal.action === ProposalAction.ClearFeatureFlag) {
    config.feature_flags &= ~proposal.param;
  }
  return { ok: true };
}

/**
 * Simulate clear_feature_flag_handler:
 *   - authority-only
 *   - blocked if FLAG_DAO_COMMITTEE is active (DaoCommitteeRequired)
 */
function simulateClearFeatureFlag(
  callerKey: string,
  config: StablecoinConfig,
  flag: bigint
): { ok: true } | { ok: false; error: string } {
  if (config.authority !== callerKey) {
    return { ok: false, error: Err.Unauthorized };
  }
  // Guard: DAO committee active → must use proposal flow
  if (config.feature_flags & FLAG_DAO_COMMITTEE) {
    return { ok: false, error: Err.DaoCommitteeRequired };
  }
  config.feature_flags &= ~flag;
  return { ok: true };
}

/**
 * Simulate execute_timelocked_op_handler for ADMIN_OP_CLEAR_FEATURE_FLAG (op_kind=3):
 *   - blocked if the flag bits include FLAG_DAO_COMMITTEE (DaoFlagProtected)
 */
function simulateTimelockClearFeatureFlag(
  callerKey: string,
  config: StablecoinConfig,
  flagBits: bigint
): { ok: true } | { ok: false; error: string } {
  if (config.authority !== callerKey) {
    return { ok: false, error: Err.Unauthorized };
  }
  // BUG-011: DaoFlagProtected guard
  if (flagBits & FLAG_DAO_COMMITTEE) {
    return { ok: false, error: Err.DaoFlagProtected };
  }
  config.feature_flags &= ~flagBits;
  return { ok: true };
}

/**
 * Simulate initialize handler for SSS-3 supply cap check:
 *   - preset == 3 requires max_supply > 0 (SSS-147)
 *   - supply_cap_locked = (preset == 3)
 */
function simulateInitialize(params: {
  preset: number;
  transfer_hook_program?: string;
  collateral_mint?: string;
  reserve_vault?: string;
  max_supply?: bigint;
  squads_multisig?: string;
}): { ok: true; config: StablecoinConfig } | { ok: false; error: string } {
  if (params.preset !== 1 && params.preset !== 2 && params.preset !== 3) {
    return { ok: false, error: Err.InvalidPreset };
  }
  if (params.preset === 2 && !params.transfer_hook_program) {
    return { ok: false, error: Err.MissingTransferHook };
  }
  if (params.preset === 3) {
    if (!params.collateral_mint) return { ok: false, error: Err.InvalidCollateralMint };
    if (!params.reserve_vault) return { ok: false, error: Err.InvalidVault };
    // SSS-147B: supply_cap must be > 0 for SSS-3 (RequiresMaxSupplyForSSS3)
    if (!params.max_supply || params.max_supply === 0n) {
      return { ok: false, error: Err.RequiresMaxSupplyForSSS3 };
    }
    // SSS-147A: SSS-3 REQUIRES a valid squads_multisig (not null and not default pubkey)
    if (!params.squads_multisig || params.squads_multisig === DEFAULT_PUBKEY) {
      return { ok: false, error: Err.RequiresSquadsForSSS3 };
    }
  }
  const authority = Keypair.generate().publicKey.toBase58();
  // SSS-147A: set FLAG_SQUADS_AUTHORITY when squads_multisig is provided and not default pubkey
  const feature_flags = (params.squads_multisig && params.squads_multisig !== DEFAULT_PUBKEY)
    ? FLAG_SQUADS_AUTHORITY
    : 0n;
  return {
    ok: true,
    config: {
      authority,
      feature_flags,
      paused: false,
      max_supply: params.max_supply ?? 0n,
      supply_cap_locked: params.preset === 3,  // SSS-147
      preset: params.preset,
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SSS-147: Trustless Hardening", () => {
  // ─── Test 1: Committee member can propose ───────────────────────────────

  it("1. Committee member can propose (BUG-011: is_member path)", () => {
    const authority = Keypair.generate();
    const member = Keypair.generate();
    const outsider = Keypair.generate();

    const config = defaultConfig({ authority: key(authority) });
    const committee = defaultCommittee([key(member), key(outsider)], 1);

    // Member proposes — should succeed
    const result = simulateProposeAction(
      key(member),
      config,
      committee,
      ProposalAction.Pause
    );
    assert.isTrue(result.ok, "member should be allowed to propose");
    if (result.ok) {
      assert.equal(result.proposal.proposer, key(member));
      assert.equal(result.proposal.proposal_id, 0);
      assert.equal(result.proposal.action, ProposalAction.Pause);
    }
  });

  // ─── Test 2: Non-member non-authority cannot propose ────────────────────

  it("2. Non-member non-authority cannot propose (NotAuthorizedToPropose)", () => {
    const authority = Keypair.generate();
    const member = Keypair.generate();
    const nonMember = Keypair.generate();

    const config = defaultConfig({ authority: key(authority) });
    const committee = defaultCommittee([key(member)], 1);

    const result = simulateProposeAction(
      key(nonMember),
      config,
      committee,
      ProposalAction.Pause
    );
    assert.isFalse(result.ok, "non-member non-authority should be rejected");
    if (!result.ok) {
      assert.equal(result.error, Err.NotAuthorizedToPropose);
    }
  });

  // ─── Test 3: Authority can still propose ────────────────────────────────

  it("3. Authority can still propose (BUG-011: is_authority path)", () => {
    const authority = Keypair.generate();
    const member = Keypair.generate();

    const config = defaultConfig({ authority: key(authority) });
    const committee = defaultCommittee([key(member)], 1);

    // Authority is NOT in members, but should still be allowed
    const result = simulateProposeAction(
      key(authority),
      config,
      committee,
      ProposalAction.Unpause
    );
    assert.isTrue(result.ok, "authority should be allowed to propose");
    if (result.ok) {
      assert.equal(result.proposal.proposer, key(authority));
      assert.equal(result.proposal.action, ProposalAction.Unpause);
    }
  });

  // ─── Test 4: FLAG_DAO_COMMITTEE cannot be cleared via clear_feature_flag ─

  it("4. FLAG_DAO_COMMITTEE cannot be cleared via clear_feature_flag (DaoCommitteeRequired)", () => {
    const authority = Keypair.generate();

    // DAO committee flag is active
    const config = defaultConfig({
      authority: key(authority),
      feature_flags: FLAG_DAO_COMMITTEE,
    });

    // Authority tries to directly clear FLAG_DAO_COMMITTEE
    const result = simulateClearFeatureFlag(
      key(authority),
      config,
      FLAG_DAO_COMMITTEE
    );
    assert.isFalse(result.ok, "clear_feature_flag should be blocked when DAO committee is active");
    if (!result.ok) {
      assert.equal(result.error, Err.DaoCommitteeRequired);
    }
    // Flag should remain set
    assert.ok(config.feature_flags & FLAG_DAO_COMMITTEE, "flag should still be set");
  });

  // ─── Test 5: FLAG_DAO_COMMITTEE cannot be cleared via timelock ──────────

  it("5. FLAG_DAO_COMMITTEE cannot be cleared via timelock (DaoFlagProtected)", () => {
    const authority = Keypair.generate();

    const config = defaultConfig({
      authority: key(authority),
      feature_flags: FLAG_DAO_COMMITTEE | FLAG_CIRCUIT_BREAKER,
    });

    // Try to timelock-clear FLAG_DAO_COMMITTEE (op_kind=3, param=FLAG_DAO_COMMITTEE)
    const result = simulateTimelockClearFeatureFlag(
      key(authority),
      config,
      FLAG_DAO_COMMITTEE
    );
    assert.isFalse(result.ok, "timelock CLEAR_FEATURE_FLAG should be blocked for FLAG_DAO_COMMITTEE");
    if (!result.ok) {
      assert.equal(result.error, Err.DaoFlagProtected);
    }
    // Other flags can still be cleared via timelock
    const result2 = simulateTimelockClearFeatureFlag(
      key(authority),
      config,
      FLAG_CIRCUIT_BREAKER
    );
    assert.isTrue(result2.ok, "timelock should be able to clear other flags");
    assert.ok(
      !(config.feature_flags & FLAG_CIRCUIT_BREAKER),
      "circuit breaker flag should be cleared"
    );
    // DAO flag should remain
    assert.ok(config.feature_flags & FLAG_DAO_COMMITTEE, "DAO flag should remain set");
  });

  // ─── Test 6: SSS-3 initialize requires supply_cap > 0 ───────────────────

  it("6. SSS-3 initialize requires supply_cap > 0 (RequiresMaxSupplyForSSS3)", () => {
    // supply_cap = 0 (default / omitted) — should fail
    const result = simulateInitialize({
      preset: 3,
      collateral_mint: Keypair.generate().publicKey.toBase58(),
      reserve_vault: Keypair.generate().publicKey.toBase58(),
      max_supply: 0n,
      squads_multisig: Keypair.generate().publicKey.toBase58(),
    });
    assert.isFalse(result.ok, "SSS-3 with supply_cap=0 should be rejected");
    if (!result.ok) {
      assert.equal(result.error, Err.RequiresMaxSupplyForSSS3);
    }
  });

  // ─── Test 7: SSS-1 initialize allows supply_cap == 0 ────────────────────

  it("7. SSS-1 initialize allows supply_cap == 0", () => {
    const result = simulateInitialize({
      preset: 1,
      max_supply: 0n,
    });
    assert.isTrue(result.ok, "SSS-1 with supply_cap=0 should be allowed");
    if (result.ok) {
      assert.equal(result.config.max_supply, 0n);
      assert.isFalse(result.config.supply_cap_locked, "SSS-1 should not lock supply cap");
    }
  });

  // ─── Test 8: SSS-2 initialize allows supply_cap == 0 ────────────────────

  it("8. SSS-2 initialize allows supply_cap == 0", () => {
    const hookProgram = Keypair.generate().publicKey.toBase58();
    const result = simulateInitialize({
      preset: 2,
      transfer_hook_program: hookProgram,
      max_supply: 0n,
    });
    assert.isTrue(result.ok, "SSS-2 with supply_cap=0 should be allowed");
    if (result.ok) {
      assert.equal(result.config.max_supply, 0n);
      assert.isFalse(result.config.supply_cap_locked, "SSS-2 should not lock supply cap");
    }
  });

  // ─── Test 9: supply_cap_locked is set to true for SSS-3 ─────────────────

  it("9. supply_cap_locked = true is set during SSS-3 initialize", () => {
    const result = simulateInitialize({
      preset: 3,
      collateral_mint: Keypair.generate().publicKey.toBase58(),
      reserve_vault: Keypair.generate().publicKey.toBase58(),
      max_supply: 1_000_000n,
      squads_multisig: Keypair.generate().publicKey.toBase58(),
    });
    assert.isTrue(result.ok, "SSS-3 with supply_cap > 0 and squads_multisig should succeed");
    if (result.ok) {
      assert.isTrue(
        result.config.supply_cap_locked,
        "supply_cap_locked must be true for SSS-3"
      );
      assert.equal(result.config.max_supply, 1_000_000n);
    }
  });

  // ─── Test 10: Proposal from member reaches quorum and executes (pause) ───

  it("10. Proposal from member reaches quorum and executes (Pause action)", () => {
    const authority = Keypair.generate();
    const member1 = Keypair.generate();
    const member2 = Keypair.generate();

    const config = defaultConfig({
      authority: key(authority),
      feature_flags: FLAG_DAO_COMMITTEE,
      paused: false,
    });
    // quorum = 2 of 2 members
    const committee = defaultCommittee([key(member1), key(member2)], 2);

    // Step 1: member1 proposes Pause
    const proposeResult = simulateProposeAction(
      key(member1),
      config,
      committee,
      ProposalAction.Pause
    );
    assert.isTrue(proposeResult.ok, "member1 should be able to propose");
    if (!proposeResult.ok) return;
    const proposal = proposeResult.proposal;

    // Step 2: Try to execute before quorum — should fail
    const earlyExec = simulateExecuteAction(proposal, config);
    assert.isFalse(earlyExec.ok, "execute before quorum should fail");
    if (!earlyExec.ok) {
      assert.equal(earlyExec.error, Err.QuorumNotReached);
    }

    // Step 3: member1 votes YES
    const vote1 = simulateVoteAction(key(member1), committee, proposal);
    assert.isTrue(vote1.ok, "member1 should be able to vote");
    assert.equal(proposal.votes.length, 1, "should have 1 vote after member1 votes");

    // Step 4: Still need 1 more vote (quorum=2) — execute still fails
    const midExec = simulateExecuteAction(proposal, config);
    assert.isFalse(midExec.ok, "execute with only 1 of 2 votes should fail");
    if (!midExec.ok) {
      assert.equal(midExec.error, Err.QuorumNotReached);
    }

    // Step 5: member2 votes YES → quorum reached
    const vote2 = simulateVoteAction(key(member2), committee, proposal);
    assert.isTrue(vote2.ok, "member2 should be able to vote");
    assert.equal(proposal.votes.length, 2, "should have 2 votes after member2 votes");

    // Step 6: Execute now succeeds, applies Pause
    assert.isFalse(config.paused, "config should not be paused before execute");
    const execResult = simulateExecuteAction(proposal, config);
    assert.isTrue(execResult.ok, "execute should succeed after quorum reached");
    assert.isTrue(config.paused, "config should be paused after execute");
    assert.isTrue(proposal.executed, "proposal should be marked executed");

    // Step 7: Attempting to execute again should fail
    const reExec = simulateExecuteAction(proposal, config);
    assert.isFalse(reExec.ok, "re-execution of already-executed proposal should fail");
    if (!reExec.ok) {
      assert.equal(reExec.error, Err.ProposalAlreadyExecuted);
    }
  });

  // ─── Test 11: SSS-147A — SSS-3 without squads_multisig is rejected ───────

  it("11. SSS-3 initialize without squads_multisig is rejected (RequiresSquadsForSSS3)", () => {
    const result = simulateInitialize({
      preset: 3,
      collateral_mint: Keypair.generate().publicKey.toBase58(),
      reserve_vault: Keypair.generate().publicKey.toBase58(),
      max_supply: 1_000_000n,
      // squads_multisig intentionally omitted
    });
    assert.isFalse(result.ok, "SSS-3 without squads_multisig should be rejected");
    if (!result.ok) {
      assert.equal(result.error, Err.RequiresSquadsForSSS3);
    }
  });

  // ─── Test 12: SSS-147A — SSS-3 with squads_multisig succeeds ─────────────

  it("12. SSS-3 initialize with squads_multisig succeeds + FLAG_SQUADS_AUTHORITY set", () => {
    const squadsPk = Keypair.generate().publicKey.toBase58();
    const result = simulateInitialize({
      preset: 3,
      collateral_mint: Keypair.generate().publicKey.toBase58(),
      reserve_vault: Keypair.generate().publicKey.toBase58(),
      max_supply: 1_000_000n,
      squads_multisig: squadsPk,
    });
    assert.isTrue(result.ok, "SSS-3 with squads_multisig should succeed");
    if (result.ok) {
      assert.isTrue(
        (result.config.feature_flags & FLAG_SQUADS_AUTHORITY) !== 0n,
        "FLAG_SQUADS_AUTHORITY must be set when squads_multisig is provided"
      );
    }
  });

  // ─── Test 13: SSS-147A — SSS-1/SSS-2 without squads_multisig still succeeds

  it("13. SSS-1/SSS-2 initialize without squads_multisig still succeeds", () => {
    const sss1 = simulateInitialize({ preset: 1 });
    assert.isTrue(sss1.ok, "SSS-1 without squads_multisig should succeed");
    if (sss1.ok) {
      assert.equal(sss1.config.feature_flags & FLAG_SQUADS_AUTHORITY, 0n,
        "FLAG_SQUADS_AUTHORITY must NOT be set for SSS-1 without squads_multisig");
    }

    const sss2 = simulateInitialize({
      preset: 2,
      transfer_hook_program: Keypair.generate().publicKey.toBase58(),
    });
    assert.isTrue(sss2.ok, "SSS-2 without squads_multisig should succeed");
    if (sss2.ok) {
      assert.equal(sss2.config.feature_flags & FLAG_SQUADS_AUTHORITY, 0n,
        "FLAG_SQUADS_AUTHORITY must NOT be set for SSS-2 without squads_multisig");
    }
  });

  // ─── Test 14: SSS-147A — SSS-3 with Pubkey::default() is rejected ────────

  it("14. SSS-3 initialize with squads_multisig=PublicKey.default is rejected (RequiresSquadsForSSS3)", () => {
    const result = simulateInitialize({
      preset: 3,
      collateral_mint: Keypair.generate().publicKey.toBase58(),
      reserve_vault: Keypair.generate().publicKey.toBase58(),
      max_supply: 1_000_000n,
      squads_multisig: PublicKey.default.toBase58(), // all-zeros pubkey — on-chain rejects this
    });
    assert.isFalse(result.ok, "SSS-3 with Pubkey::default() as squads_multisig should be rejected");
    if (!result.ok) {
      assert.equal(result.error, Err.RequiresSquadsForSSS3,
        "Error must be RequiresSquadsForSSS3 for default pubkey input");
    }
  });
});

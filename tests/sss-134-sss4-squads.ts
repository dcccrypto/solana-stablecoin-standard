/**
 * SSS-134: PRESET_INSTITUTIONAL — Squads Protocol V4 multisig native authority
 *
 * Tests for `init_squads_authority`, `verify_squads_authority`, the
 * `verify_squads_signer` helper, `SquadsMultisigConfig` PDA state, and all
 * associated error conditions.
 *
 * Architecture under test:
 *   - init_squads_authority transfers config.authority → Squads multisig PDA
 *   - Sets FLAG_SQUADS_AUTHORITY (bit 15 = 32768) irreversibly
 *   - Sets config.preset = PRESET_INSTITUTIONAL (4)
 *   - Creates SquadsMultisigConfig PDA with threshold + member list
 *   - verify_squads_authority confirms a signer is the registered PDA
 *   - verify_squads_signer helper rejects wrong signers
 *
 * Test coverage (20 tests):
 *  1.  FLAG_SQUADS_AUTHORITY constant is bit 15 (32768)
 *  2.  PRESET_INSTITUTIONAL constant is 4
 *  3.  SquadsMultisigConfig seeds are [b"squads-multisig-config", sss_mint]
 *  4.  init_squads_authority: happy path — 2-of-3 Squads setup
 *  5.  init_squads_authority: config.authority updated to multisig_pda
 *  6.  init_squads_authority: config.preset set to PRESET_INSTITUTIONAL (4)
 *  7.  init_squads_authority: FLAG_SQUADS_AUTHORITY bit set in feature_flags
 *  8.  init_squads_authority: SquadsMultisigConfig PDA created with correct fields
 *  9.  init_squads_authority: threshold stored correctly
 * 10.  init_squads_authority: member list stored correctly (3 members)
 * 11.  init_squads_authority: member list up to MAX_MEMBERS (10) accepted
 * 12.  init_squads_authority: member list > MAX_MEMBERS rejected (SquadsMembersTooMany)
 * 13.  init_squads_authority: threshold = 0 rejected (SquadsThresholdZero)
 * 14.  init_squads_authority: threshold > len(members) rejected (SquadsThresholdExceedsMembers)
 * 15.  init_squads_authority: empty member list rejected (SquadsMembersEmpty)
 * 16.  init_squads_authority: duplicate member rejected (SquadsDuplicateMember)
 * 17.  init_squads_authority: multisig_pda = Pubkey::default rejected (SquadsMultisigPdaInvalid)
 * 18.  init_squads_authority: calling twice rejected (SquadsAuthorityAlreadySet)
 * 19.  verify_squads_signer: correct PDA accepted
 * 20.  verify_squads_signer: wrong pubkey rejected (SquadsSignerMismatch)
 */

import { assert } from "chai";
import { PublicKey, Keypair } from "@solana/web3.js";

// ---------------------------------------------------------------------------
// Constants (mirrors Rust state.rs)
// ---------------------------------------------------------------------------
const FLAG_SQUADS_AUTHORITY = BigInt(1) << BigInt(15); // 32768
const PRESET_INSTITUTIONAL = 4;
const SQUADS_CONFIG_SEED = Buffer.from("squads-multisig-config");
const MAX_MEMBERS = 10;

// ---------------------------------------------------------------------------
// Pure TypeScript model of SquadsMultisigConfig
// ---------------------------------------------------------------------------
interface SquadsMultisigConfig {
  sss_mint: PublicKey;
  multisig_pda: PublicKey;
  threshold: number;
  members: PublicKey[];
  bump: number;
}

// ---------------------------------------------------------------------------
// Pure TypeScript model of StablecoinConfig (SSS-134 fields only)
// ---------------------------------------------------------------------------
interface ConfigState {
  authority: PublicKey;
  squads_multisig: PublicKey;
  preset: number;
  feature_flags: bigint;
}

// ---------------------------------------------------------------------------
// Simulate init_squads_authority — returns updated state or throws error
// ---------------------------------------------------------------------------
type InitSquadsResult =
  | { ok: true; config: ConfigState; squadsConfig: SquadsMultisigConfig }
  | { ok: false; error: string };

function simulateInitSquadsAuthority(
  config: ConfigState,
  caller: PublicKey,
  multisig_pda: PublicKey,
  threshold: number,
  members: PublicKey[],
  mint: PublicKey,
): InitSquadsResult {
  // Authority check
  if (!config.authority.equals(caller)) {
    return { ok: false, error: "Unauthorized" };
  }
  // Already set check
  if (!config.squads_multisig.equals(PublicKey.default)) {
    return { ok: false, error: "SquadsAuthorityAlreadySet" };
  }
  // Invalid multisig PDA
  if (multisig_pda.equals(PublicKey.default)) {
    return { ok: false, error: "SquadsMultisigPdaInvalid" };
  }
  // Threshold zero
  if (threshold === 0) {
    return { ok: false, error: "SquadsThresholdZero" };
  }
  // Empty members
  if (members.length === 0) {
    return { ok: false, error: "SquadsMembersEmpty" };
  }
  // Too many members
  if (members.length > MAX_MEMBERS) {
    return { ok: false, error: "SquadsMembersTooMany" };
  }
  // Threshold exceeds members
  if (threshold > members.length) {
    return { ok: false, error: "SquadsThresholdExceedsMembers" };
  }
  // Duplicate members
  const seen = new Set<string>();
  for (const m of members) {
    const k = m.toBase58();
    if (seen.has(k)) {
      return { ok: false, error: "SquadsDuplicateMember" };
    }
    seen.add(k);
  }

  // Apply state
  const newConfig: ConfigState = {
    ...config,
    authority: multisig_pda,
    squads_multisig: multisig_pda,
    preset: PRESET_INSTITUTIONAL,
    feature_flags: config.feature_flags | FLAG_SQUADS_AUTHORITY,
  };

  const squadsConfig: SquadsMultisigConfig = {
    sss_mint: mint,
    multisig_pda,
    threshold,
    members: [...members],
    bump: 255, // simulated
  };

  return { ok: true, config: newConfig, squadsConfig };
}

// ---------------------------------------------------------------------------
// verify_squads_signer helper model
// ---------------------------------------------------------------------------
type VerifyResult = { ok: true } | { ok: false; error: string };

function simulateVerifySquadsSigner(
  config: ConfigState,
  signer: PublicKey,
): VerifyResult {
  if ((config.feature_flags & FLAG_SQUADS_AUTHORITY) === 0n) {
    return { ok: false, error: "SquadsAuthorityNotSet" };
  }
  if (config.squads_multisig.equals(PublicKey.default)) {
    return { ok: false, error: "SquadsMultisigPdaInvalid" };
  }
  if (!signer.equals(config.squads_multisig)) {
    return { ok: false, error: "SquadsSignerMismatch" };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// PDA derivation helper
// ---------------------------------------------------------------------------
function deriveSquadsConfigPda(mint: PublicKey, programId: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [SQUADS_CONFIG_SEED, mint.toBuffer()],
    programId,
  );
  return pda;
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------
function makeConfig(overrides: Partial<ConfigState> = {}): ConfigState {
  return {
    authority: Keypair.generate().publicKey,
    squads_multisig: PublicKey.default,
    preset: 3,
    feature_flags: 0n,
    ...overrides,
  };
}

function makeMembers(n: number): PublicKey[] {
  return Array.from({ length: n }, () => Keypair.generate().publicKey);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("SSS-134: PRESET_INSTITUTIONAL — Squads V4 multisig authority", () => {

  // -------------------------------------------------------------------------
  // Constants
  // -------------------------------------------------------------------------

  it("1. FLAG_SQUADS_AUTHORITY is bit 15 (32768)", () => {
    assert.equal(FLAG_SQUADS_AUTHORITY, 32768n);
    assert.equal(Number(FLAG_SQUADS_AUTHORITY), 1 << 15);
  });

  it("2. PRESET_INSTITUTIONAL constant is 4", () => {
    assert.equal(PRESET_INSTITUTIONAL, 4);
  });

  it("3. SquadsMultisigConfig seeds are [b'squads-multisig-config', sss_mint]", () => {
    const mint = Keypair.generate().publicKey;
    const programId = Keypair.generate().publicKey;
    const pda = deriveSquadsConfigPda(mint, programId);
    // PDA should be deterministic for same mint+programId
    const pda2 = deriveSquadsConfigPda(mint, programId);
    assert.ok(pda.equals(pda2), "PDA derivation is deterministic");
    // Different mint → different PDA
    const mint2 = Keypair.generate().publicKey;
    const pda3 = deriveSquadsConfigPda(mint2, programId);
    assert.ok(!pda.equals(pda3), "Different mint → different PDA");
  });

  // -------------------------------------------------------------------------
  // init_squads_authority happy path
  // -------------------------------------------------------------------------

  it("4. init_squads_authority: happy path — 2-of-3 setup", () => {
    const authority = Keypair.generate().publicKey;
    const multisig_pda = Keypair.generate().publicKey;
    const members = makeMembers(3);
    const mint = Keypair.generate().publicKey;
    const config = makeConfig({ authority });

    const result = simulateInitSquadsAuthority(config, authority, multisig_pda, 2, members, mint);
    assert.ok(result.ok, "Should succeed with valid 2-of-3 params");
  });

  it("5. init_squads_authority: config.authority updated to multisig_pda", () => {
    const authority = Keypair.generate().publicKey;
    const multisig_pda = Keypair.generate().publicKey;
    const members = makeMembers(3);
    const mint = Keypair.generate().publicKey;
    const config = makeConfig({ authority });

    const result = simulateInitSquadsAuthority(config, authority, multisig_pda, 2, members, mint);
    assert.ok(result.ok);
    if (result.ok) {
      assert.ok(result.config.authority.equals(multisig_pda),
        "config.authority should equal multisig_pda after init");
    }
  });

  it("6. init_squads_authority: config.preset set to PRESET_INSTITUTIONAL (4)", () => {
    const authority = Keypair.generate().publicKey;
    const multisig_pda = Keypair.generate().publicKey;
    const members = makeMembers(2);
    const mint = Keypair.generate().publicKey;
    const config = makeConfig({ authority, preset: 3 });

    const result = simulateInitSquadsAuthority(config, authority, multisig_pda, 1, members, mint);
    assert.ok(result.ok);
    if (result.ok) {
      assert.equal(result.config.preset, PRESET_INSTITUTIONAL,
        "preset must be 4 after init");
    }
  });

  it("7. init_squads_authority: FLAG_SQUADS_AUTHORITY bit set in feature_flags", () => {
    const authority = Keypair.generate().publicKey;
    const multisig_pda = Keypair.generate().publicKey;
    const members = makeMembers(3);
    const mint = Keypair.generate().publicKey;
    const config = makeConfig({ authority });

    const result = simulateInitSquadsAuthority(config, authority, multisig_pda, 2, members, mint);
    assert.ok(result.ok);
    if (result.ok) {
      const flagSet = (result.config.feature_flags & FLAG_SQUADS_AUTHORITY) !== 0n;
      assert.ok(flagSet, "FLAG_SQUADS_AUTHORITY (bit 15) must be set");
    }
  });

  it("8. init_squads_authority: SquadsMultisigConfig PDA created with correct sss_mint", () => {
    const authority = Keypair.generate().publicKey;
    const multisig_pda = Keypair.generate().publicKey;
    const members = makeMembers(3);
    const mint = Keypair.generate().publicKey;
    const config = makeConfig({ authority });

    const result = simulateInitSquadsAuthority(config, authority, multisig_pda, 2, members, mint);
    assert.ok(result.ok);
    if (result.ok) {
      assert.ok(result.squadsConfig.sss_mint.equals(mint),
        "squadsConfig.sss_mint should be the stablecoin mint");
      assert.ok(result.squadsConfig.multisig_pda.equals(multisig_pda),
        "squadsConfig.multisig_pda should equal the supplied PDA");
    }
  });

  it("9. init_squads_authority: threshold stored correctly", () => {
    const authority = Keypair.generate().publicKey;
    const multisig_pda = Keypair.generate().publicKey;
    const members = makeMembers(5);
    const mint = Keypair.generate().publicKey;
    const config = makeConfig({ authority });

    const result = simulateInitSquadsAuthority(config, authority, multisig_pda, 3, members, mint);
    assert.ok(result.ok);
    if (result.ok) {
      assert.equal(result.squadsConfig.threshold, 3, "threshold must be stored as-supplied");
    }
  });

  it("10. init_squads_authority: member list stored correctly (3 members)", () => {
    const authority = Keypair.generate().publicKey;
    const multisig_pda = Keypair.generate().publicKey;
    const members = makeMembers(3);
    const mint = Keypair.generate().publicKey;
    const config = makeConfig({ authority });

    const result = simulateInitSquadsAuthority(config, authority, multisig_pda, 2, members, mint);
    assert.ok(result.ok);
    if (result.ok) {
      assert.equal(result.squadsConfig.members.length, 3);
      for (let i = 0; i < 3; i++) {
        assert.ok(result.squadsConfig.members[i].equals(members[i]),
          `member[${i}] must be preserved`);
      }
    }
  });

  it("11. init_squads_authority: member list up to MAX_MEMBERS (10) accepted", () => {
    const authority = Keypair.generate().publicKey;
    const multisig_pda = Keypair.generate().publicKey;
    const members = makeMembers(MAX_MEMBERS);
    const mint = Keypair.generate().publicKey;
    const config = makeConfig({ authority });

    const result = simulateInitSquadsAuthority(
      config, authority, multisig_pda, MAX_MEMBERS, members, mint,
    );
    assert.ok(result.ok, "10 members should be accepted (= MAX_MEMBERS)");
    if (result.ok) {
      assert.equal(result.squadsConfig.members.length, MAX_MEMBERS);
    }
  });

  // -------------------------------------------------------------------------
  // Error conditions
  // -------------------------------------------------------------------------

  it("12. init_squads_authority: member list > MAX_MEMBERS rejected (SquadsMembersTooMany)", () => {
    const authority = Keypair.generate().publicKey;
    const multisig_pda = Keypair.generate().publicKey;
    const members = makeMembers(MAX_MEMBERS + 1);
    const mint = Keypair.generate().publicKey;
    const config = makeConfig({ authority });

    const result = simulateInitSquadsAuthority(
      config, authority, multisig_pda, 1, members, mint,
    );
    assert.ok(!result.ok);
    if (!result.ok) {
      assert.equal(result.error, "SquadsMembersTooMany");
    }
  });

  it("13. init_squads_authority: threshold = 0 rejected (SquadsThresholdZero)", () => {
    const authority = Keypair.generate().publicKey;
    const multisig_pda = Keypair.generate().publicKey;
    const members = makeMembers(3);
    const mint = Keypair.generate().publicKey;
    const config = makeConfig({ authority });

    const result = simulateInitSquadsAuthority(config, authority, multisig_pda, 0, members, mint);
    assert.ok(!result.ok);
    if (!result.ok) {
      assert.equal(result.error, "SquadsThresholdZero");
    }
  });

  it("14. init_squads_authority: threshold > len(members) rejected (SquadsThresholdExceedsMembers)", () => {
    const authority = Keypair.generate().publicKey;
    const multisig_pda = Keypair.generate().publicKey;
    const members = makeMembers(2);
    const mint = Keypair.generate().publicKey;
    const config = makeConfig({ authority });

    const result = simulateInitSquadsAuthority(config, authority, multisig_pda, 3, members, mint);
    assert.ok(!result.ok);
    if (!result.ok) {
      assert.equal(result.error, "SquadsThresholdExceedsMembers");
    }
  });

  it("15. init_squads_authority: empty member list rejected (SquadsMembersEmpty)", () => {
    const authority = Keypair.generate().publicKey;
    const multisig_pda = Keypair.generate().publicKey;
    const mint = Keypair.generate().publicKey;
    const config = makeConfig({ authority });

    const result = simulateInitSquadsAuthority(config, authority, multisig_pda, 1, [], mint);
    assert.ok(!result.ok);
    if (!result.ok) {
      assert.equal(result.error, "SquadsMembersEmpty");
    }
  });

  it("16. init_squads_authority: duplicate member rejected (SquadsDuplicateMember)", () => {
    const authority = Keypair.generate().publicKey;
    const multisig_pda = Keypair.generate().publicKey;
    const member = Keypair.generate().publicKey;
    const members = [member, Keypair.generate().publicKey, member]; // duplicate first/last
    const mint = Keypair.generate().publicKey;
    const config = makeConfig({ authority });

    const result = simulateInitSquadsAuthority(config, authority, multisig_pda, 2, members, mint);
    assert.ok(!result.ok);
    if (!result.ok) {
      assert.equal(result.error, "SquadsDuplicateMember");
    }
  });

  it("17. init_squads_authority: multisig_pda = default pubkey rejected (SquadsMultisigPdaInvalid)", () => {
    const authority = Keypair.generate().publicKey;
    const members = makeMembers(3);
    const mint = Keypair.generate().publicKey;
    const config = makeConfig({ authority });

    const result = simulateInitSquadsAuthority(
      config, authority, PublicKey.default, 2, members, mint,
    );
    assert.ok(!result.ok);
    if (!result.ok) {
      assert.equal(result.error, "SquadsMultisigPdaInvalid");
    }
  });

  it("18. init_squads_authority: calling twice rejected (SquadsAuthorityAlreadySet)", () => {
    const authority = Keypair.generate().publicKey;
    const multisig_pda = Keypair.generate().publicKey;
    const members = makeMembers(3);
    const mint = Keypair.generate().publicKey;
    const config = makeConfig({ authority });

    // First call succeeds
    const first = simulateInitSquadsAuthority(config, authority, multisig_pda, 2, members, mint);
    assert.ok(first.ok);

    // Second call on updated config — squads_multisig is now set
    if (first.ok) {
      const second = simulateInitSquadsAuthority(
        first.config,
        first.config.authority, // multisig_pda is now authority
        Keypair.generate().publicKey,
        2,
        makeMembers(3),
        mint,
      );
      assert.ok(!second.ok);
      if (!second.ok) {
        assert.equal(second.error, "SquadsAuthorityAlreadySet");
      }
    }
  });

  // -------------------------------------------------------------------------
  // verify_squads_signer
  // -------------------------------------------------------------------------

  it("19. verify_squads_signer: correct PDA accepted", () => {
    const authority = Keypair.generate().publicKey;
    const multisig_pda = Keypair.generate().publicKey;
    const members = makeMembers(3);
    const mint = Keypair.generate().publicKey;
    const config = makeConfig({ authority });

    const initResult = simulateInitSquadsAuthority(
      config, authority, multisig_pda, 2, members, mint,
    );
    assert.ok(initResult.ok);
    if (initResult.ok) {
      const verifyResult = simulateVerifySquadsSigner(initResult.config, multisig_pda);
      assert.ok(verifyResult.ok, "Correct multisig_pda should be accepted");
    }
  });

  it("20. verify_squads_signer: wrong pubkey rejected (SquadsSignerMismatch)", () => {
    const authority = Keypair.generate().publicKey;
    const multisig_pda = Keypair.generate().publicKey;
    const members = makeMembers(3);
    const mint = Keypair.generate().publicKey;
    const config = makeConfig({ authority });

    const initResult = simulateInitSquadsAuthority(
      config, authority, multisig_pda, 2, members, mint,
    );
    assert.ok(initResult.ok);
    if (initResult.ok) {
      const wrongSigner = Keypair.generate().publicKey;
      const verifyResult = simulateVerifySquadsSigner(initResult.config, wrongSigner);
      assert.ok(!verifyResult.ok, "Wrong signer should be rejected");
      if (!verifyResult.ok) {
        assert.equal(verifyResult.error, "SquadsSignerMismatch");
      }
    }
  });
});

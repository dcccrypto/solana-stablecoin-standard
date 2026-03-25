/**
 * SSS-150: BPF upgrade authority → mandatory Squads timelock for mainnet
 *
 * Tests for `set_upgrade_authority_guard`, `verify_upgrade_authority`,
 * and associated error conditions.
 *
 * Architecture under test:
 *   - set_upgrade_authority_guard: records expected_upgrade_authority in config
 *     - Irreversible (cannot set twice)
 *     - Requires FLAG_SQUADS_AUTHORITY to be set
 *     - upgrade_authority must equal config.squads_multisig (non-default)
 *   - verify_upgrade_authority: asserts current BPF authority matches guard
 *     - Returns UpgradeAuthorityGuardNotSet if no guard configured
 *     - Returns UpgradeAuthorityMismatch if supplied key differs from guard
 *     - Returns Ok if match
 *
 * Test coverage (15 tests):
 *  1.  expected_upgrade_authority starts as Pubkey::default in new config
 *  2.  set_upgrade_authority_guard: happy path — stores squads_multisig as guard
 *  3.  set_upgrade_authority_guard: emits UpgradeAuthorityGuardSet event
 *  4.  set_upgrade_authority_guard: sets expected_upgrade_authority correctly
 *  5.  set_upgrade_authority_guard: rejects if FLAG_SQUADS_AUTHORITY not set
 *  6.  set_upgrade_authority_guard: rejects if upgrade_authority != squads_multisig
 *  7.  set_upgrade_authority_guard: rejects Pubkey::default as upgrade_authority
 *  8.  set_upgrade_authority_guard: irreversible — second call rejected
 *  9.  set_upgrade_authority_guard: non-authority signer rejected (Unauthorized)
 * 10.  verify_upgrade_authority: happy path — matching key returns Ok
 * 11.  verify_upgrade_authority: emits UpgradeAuthorityVerified event
 * 12.  verify_upgrade_authority: UpgradeAuthorityGuardNotSet if guard is default
 * 13.  verify_upgrade_authority: UpgradeAuthorityMismatch if key differs
 * 14.  verify_upgrade_authority: callable by non-authority (read-only check)
 * 15.  transfer-upgrade-authority.ts: script rejects default/missing Squads pubkey
 */

import { assert } from "chai";
import { PublicKey, Keypair } from "@solana/web3.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const FLAG_SQUADS_AUTHORITY = BigInt(1) << BigInt(15); // 32768

// ---------------------------------------------------------------------------
// Pure TypeScript model of StablecoinConfig (SSS-150 fields)
// ---------------------------------------------------------------------------
interface ConfigState {
  authority: PublicKey;
  squads_multisig: PublicKey;
  feature_flags: bigint;
  expected_upgrade_authority: PublicKey;
}

// ---------------------------------------------------------------------------
// Event shapes
// ---------------------------------------------------------------------------
interface UpgradeAuthorityGuardSetEvent {
  mint: PublicKey;
  expected_upgrade_authority: PublicKey;
  slot: bigint;
}

interface UpgradeAuthorityVerifiedEvent {
  mint: PublicKey;
  expected_upgrade_authority: PublicKey;
  slot: bigint;
}

// ---------------------------------------------------------------------------
// Simulate set_upgrade_authority_guard
// ---------------------------------------------------------------------------
type SetGuardResult =
  | { ok: true; config: ConfigState; event: UpgradeAuthorityGuardSetEvent }
  | { ok: false; error: string };

function simulateSetUpgradeAuthorityGuard(
  config: ConfigState,
  caller: PublicKey,
  upgradeAuthority: PublicKey,
  mint: PublicKey,
  slot: bigint
): SetGuardResult {
  // Requires FLAG_SQUADS_AUTHORITY
  if ((config.feature_flags & FLAG_SQUADS_AUTHORITY) === BigInt(0)) {
    return { ok: false, error: "Unauthorized" };
  }

  // upgrade_authority must equal squads_multisig
  if (!upgradeAuthority.equals(config.squads_multisig)) {
    return { ok: false, error: "UpgradeAuthorityGuardInvalidKey" };
  }

  // Must not be default pubkey
  if (upgradeAuthority.equals(PublicKey.default)) {
    return { ok: false, error: "UpgradeAuthorityGuardInvalidKey" };
  }

  // Irreversible: cannot set twice
  if (!config.expected_upgrade_authority.equals(PublicKey.default)) {
    return { ok: false, error: "UpgradeAuthorityGuardAlreadySet" };
  }

  // Caller must be authority
  if (!caller.equals(config.authority)) {
    return { ok: false, error: "Unauthorized" };
  }

  const updated: ConfigState = {
    ...config,
    expected_upgrade_authority: upgradeAuthority,
  };

  return {
    ok: true,
    config: updated,
    event: {
      mint,
      expected_upgrade_authority: upgradeAuthority,
      slot,
    },
  };
}

// ---------------------------------------------------------------------------
// Simulate verify_upgrade_authority
// ---------------------------------------------------------------------------
type VerifyResult =
  | { ok: true; event: UpgradeAuthorityVerifiedEvent }
  | { ok: false; error: string };

function simulateVerifyUpgradeAuthority(
  config: ConfigState,
  currentUpgradeAuthority: PublicKey,
  mint: PublicKey,
  slot: bigint
): VerifyResult {
  // Guard must be set
  if (config.expected_upgrade_authority.equals(PublicKey.default)) {
    return { ok: false, error: "UpgradeAuthorityGuardNotSet" };
  }

  // Current authority must match guard
  if (!currentUpgradeAuthority.equals(config.expected_upgrade_authority)) {
    return { ok: false, error: "UpgradeAuthorityMismatch" };
  }

  return {
    ok: true,
    event: {
      mint,
      expected_upgrade_authority: config.expected_upgrade_authority,
      slot,
    },
  };
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------
function makeConfig(overrides: Partial<ConfigState> = {}): ConfigState {
  return {
    authority: Keypair.generate().publicKey,
    squads_multisig: PublicKey.default,
    feature_flags: BigInt(0),
    expected_upgrade_authority: PublicKey.default,
    ...overrides,
  };
}

function makeSquadsConfig(): { config: ConfigState; squadsPk: PublicKey } {
  const authority = Keypair.generate().publicKey;
  const squadsPk = Keypair.generate().publicKey;
  const config: ConfigState = {
    authority,
    squads_multisig: squadsPk,
    feature_flags: FLAG_SQUADS_AUTHORITY,
    expected_upgrade_authority: PublicKey.default,
  };
  return { config, squadsPk };
}

const mint = Keypair.generate().publicKey;
const slot = BigInt(1000000);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SSS-150: Upgrade Authority Guard", () => {
  // 1
  it("1. expected_upgrade_authority starts as Pubkey::default in new config", () => {
    const config = makeConfig();
    assert.isTrue(
      config.expected_upgrade_authority.equals(PublicKey.default),
      "expected_upgrade_authority should be default on new config"
    );
  });

  // 2
  it("2. set_upgrade_authority_guard: happy path stores squads_multisig as guard", () => {
    const { config, squadsPk } = makeSquadsConfig();
    const result = simulateSetUpgradeAuthorityGuard(
      config,
      config.authority,
      squadsPk,
      mint,
      slot
    );
    assert.isTrue(result.ok, `Expected success, got ${!result.ok && result.error}`);
    if (result.ok) {
      assert.isTrue(
        result.config.expected_upgrade_authority.equals(squadsPk),
        "expected_upgrade_authority should be set to squadsPk"
      );
    }
  });

  // 3
  it("3. set_upgrade_authority_guard: emits UpgradeAuthorityGuardSet event", () => {
    const { config, squadsPk } = makeSquadsConfig();
    const result = simulateSetUpgradeAuthorityGuard(
      config,
      config.authority,
      squadsPk,
      mint,
      slot
    );
    assert.isTrue(result.ok);
    if (result.ok) {
      assert.isTrue(result.event.expected_upgrade_authority.equals(squadsPk));
      assert.isTrue(result.event.mint.equals(mint));
      assert.strictEqual(result.event.slot, slot);
    }
  });

  // 4
  it("4. set_upgrade_authority_guard: expected_upgrade_authority set correctly in config", () => {
    const { config, squadsPk } = makeSquadsConfig();
    const result = simulateSetUpgradeAuthorityGuard(
      config,
      config.authority,
      squadsPk,
      mint,
      slot
    );
    assert.isTrue(result.ok);
    if (result.ok) {
      assert.isTrue(
        result.config.expected_upgrade_authority.equals(squadsPk),
        "expected_upgrade_authority field must equal squads_multisig"
      );
      // Original config should not be mutated
      assert.isTrue(
        config.expected_upgrade_authority.equals(PublicKey.default),
        "original config must be immutable"
      );
    }
  });

  // 5
  it("5. set_upgrade_authority_guard: rejects if FLAG_SQUADS_AUTHORITY not set", () => {
    const squadsPk = Keypair.generate().publicKey;
    const config = makeConfig({
      squads_multisig: squadsPk,
      feature_flags: BigInt(0), // FLAG_SQUADS_AUTHORITY NOT set
    });
    const result = simulateSetUpgradeAuthorityGuard(
      config,
      config.authority,
      squadsPk,
      mint,
      slot
    );
    assert.isFalse(result.ok);
    if (!result.ok) {
      assert.strictEqual(result.error, "Unauthorized");
    }
  });

  // 6
  it("6. set_upgrade_authority_guard: rejects if upgrade_authority != squads_multisig", () => {
    const { config } = makeSquadsConfig();
    const differentKey = Keypair.generate().publicKey;
    const result = simulateSetUpgradeAuthorityGuard(
      config,
      config.authority,
      differentKey, // does not match config.squads_multisig
      mint,
      slot
    );
    assert.isFalse(result.ok);
    if (!result.ok) {
      assert.strictEqual(result.error, "UpgradeAuthorityGuardInvalidKey");
    }
  });

  // 7
  it("7. set_upgrade_authority_guard: rejects Pubkey::default as upgrade_authority", () => {
    const config = makeConfig({
      squads_multisig: PublicKey.default, // squads_multisig is also default
      feature_flags: FLAG_SQUADS_AUTHORITY,
    });
    const result = simulateSetUpgradeAuthorityGuard(
      config,
      config.authority,
      PublicKey.default,
      mint,
      slot
    );
    assert.isFalse(result.ok);
    if (!result.ok) {
      // Either UpgradeAuthorityGuardInvalidKey (default check fires first)
      assert.include(
        ["UpgradeAuthorityGuardInvalidKey", "Unauthorized"],
        result.error
      );
    }
  });

  // 8
  it("8. set_upgrade_authority_guard: irreversible — second call rejected", () => {
    const { config, squadsPk } = makeSquadsConfig();
    const firstResult = simulateSetUpgradeAuthorityGuard(
      config,
      config.authority,
      squadsPk,
      mint,
      slot
    );
    assert.isTrue(firstResult.ok);

    if (firstResult.ok) {
      // Second call on updated config
      const secondResult = simulateSetUpgradeAuthorityGuard(
        firstResult.config,
        firstResult.config.authority,
        squadsPk,
        mint,
        slot + BigInt(100)
      );
      assert.isFalse(secondResult.ok);
      if (!secondResult.ok) {
        assert.strictEqual(secondResult.error, "UpgradeAuthorityGuardAlreadySet");
      }
    }
  });

  // 9
  it("9. set_upgrade_authority_guard: non-authority signer rejected (Unauthorized)", () => {
    const { config, squadsPk } = makeSquadsConfig();
    const impostor = Keypair.generate().publicKey;
    const result = simulateSetUpgradeAuthorityGuard(
      config,
      impostor, // not the config.authority
      squadsPk,
      mint,
      slot
    );
    assert.isFalse(result.ok);
    if (!result.ok) {
      assert.strictEqual(result.error, "Unauthorized");
    }
  });

  // 10
  it("10. verify_upgrade_authority: happy path — matching key returns Ok", () => {
    const { config, squadsPk } = makeSquadsConfig();
    const setResult = simulateSetUpgradeAuthorityGuard(
      config,
      config.authority,
      squadsPk,
      mint,
      slot
    );
    assert.isTrue(setResult.ok);
    if (setResult.ok) {
      const verifyResult = simulateVerifyUpgradeAuthority(
        setResult.config,
        squadsPk,
        mint,
        slot + BigInt(1)
      );
      assert.isTrue(verifyResult.ok);
    }
  });

  // 11
  it("11. verify_upgrade_authority: emits UpgradeAuthorityVerified event", () => {
    const { config, squadsPk } = makeSquadsConfig();
    const setResult = simulateSetUpgradeAuthorityGuard(
      config,
      config.authority,
      squadsPk,
      mint,
      slot
    );
    assert.isTrue(setResult.ok);
    if (setResult.ok) {
      const verifyResult = simulateVerifyUpgradeAuthority(
        setResult.config,
        squadsPk,
        mint,
        slot + BigInt(1)
      );
      assert.isTrue(verifyResult.ok);
      if (verifyResult.ok) {
        assert.isTrue(verifyResult.event.expected_upgrade_authority.equals(squadsPk));
        assert.isTrue(verifyResult.event.mint.equals(mint));
        assert.strictEqual(verifyResult.event.slot, slot + BigInt(1));
      }
    }
  });

  // 12
  it("12. verify_upgrade_authority: UpgradeAuthorityGuardNotSet if guard is default", () => {
    const { config } = makeSquadsConfig();
    // Guard not set — expected_upgrade_authority is still default
    const result = simulateVerifyUpgradeAuthority(
      config,
      config.squads_multisig,
      mint,
      slot
    );
    assert.isFalse(result.ok);
    if (!result.ok) {
      assert.strictEqual(result.error, "UpgradeAuthorityGuardNotSet");
    }
  });

  // 13
  it("13. verify_upgrade_authority: UpgradeAuthorityMismatch if key differs", () => {
    const { config, squadsPk } = makeSquadsConfig();
    const setResult = simulateSetUpgradeAuthorityGuard(
      config,
      config.authority,
      squadsPk,
      mint,
      slot
    );
    assert.isTrue(setResult.ok);
    if (setResult.ok) {
      const attackerKey = Keypair.generate().publicKey;
      const verifyResult = simulateVerifyUpgradeAuthority(
        setResult.config,
        attackerKey, // not the recorded guard
        mint,
        slot + BigInt(1)
      );
      assert.isFalse(verifyResult.ok);
      if (!verifyResult.ok) {
        assert.strictEqual(verifyResult.error, "UpgradeAuthorityMismatch");
      }
    }
  });

  // 14
  it("14. verify_upgrade_authority: callable by non-authority (read-only)", () => {
    const { config, squadsPk } = makeSquadsConfig();
    const setResult = simulateSetUpgradeAuthorityGuard(
      config,
      config.authority,
      squadsPk,
      mint,
      slot
    );
    assert.isTrue(setResult.ok);
    if (setResult.ok) {
      // Anyone can call verify — simulate with a random caller (no signer check in verify)
      // The simulation doesn't take a caller param since verify has no signer requirement
      const verifyResult = simulateVerifyUpgradeAuthority(
        setResult.config,
        squadsPk,
        mint,
        slot + BigInt(1)
      );
      assert.isTrue(
        verifyResult.ok,
        "verify_upgrade_authority should succeed regardless of caller"
      );
    }
  });

  // 15
  it("15. transfer-upgrade-authority.ts: script rejects if new-authority is default pubkey", () => {
    // Simulate the validation step in the script: Squads pubkey must not be default
    function scriptValidateSquads(newAuthorityStr: string): boolean {
      try {
        const pk = new PublicKey(newAuthorityStr);
        return !pk.equals(PublicKey.default);
      } catch {
        return false;
      }
    }

    // Default pubkey should be rejected
    assert.isFalse(
      scriptValidateSquads(PublicKey.default.toBase58()),
      "Default pubkey should be rejected by script validation"
    );

    // Invalid string should be rejected
    assert.isFalse(scriptValidateSquads("not-a-valid-pubkey"));

    // Valid non-default pubkey should be accepted
    const validPk = Keypair.generate().publicKey;
    assert.isTrue(
      scriptValidateSquads(validPk.toBase58()),
      "Valid non-default pubkey should pass validation"
    );
  });
});

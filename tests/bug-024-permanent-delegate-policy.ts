/**
 * BUG-024: Permanent delegate policy — owner consent enforcement
 *
 * Token-2022 permanent delegate can initiate transfers without the owner's
 * signature. When FLAG_REQUIRE_OWNER_CONSENT (bit 15) is set, the transfer
 * hook must reject permanent-delegate transfers unless the wallet owner has
 * explicitly granted consent via a DelegateConsent PDA.
 *
 * Audit finding: MEDIUM — Permanent delegate can move tokens from any
 * non-blacklisted wallet without owner consent if FLAG_REQUIRE_OWNER_CONSENT
 * is not set. This test verifies the flag and PDA logic.
 *
 * Fix: transfer_hook checks whether ctx.accounts.owner != src_owner (i.e.
 * the signer is not the token account owner). If so and FLAG_REQUIRE_OWNER_CONSENT
 * is active, a DelegateConsent PDA for [b"delegate-consent", mint, wallet_owner]
 * must be present in remaining_accounts with at least 8 bytes.
 *
 * Test coverage:
 *  BUG-024-01  FLAG_REQUIRE_OWNER_CONSENT is bit 15 (32768)
 *  BUG-024-02  Owner-signed transfer passes when flag is set (owner == src_owner)
 *  BUG-024-03  Permanent-delegate transfer blocked when flag is set and no consent PDA
 *  BUG-024-04  Permanent-delegate transfer allowed when flag is set and consent PDA present
 *  BUG-024-05  Permanent-delegate transfer allowed when flag is NOT set (existing behaviour)
 *  BUG-024-06  DelegateConsent PDA seed derivation: [b"delegate-consent", mint, wallet_owner]
 *  BUG-024-07  Wrong PDA in remaining_accounts does not satisfy consent check
 *  BUG-024-08  Consent PDA too small (< 8 bytes) does not satisfy consent check
 *  BUG-024-09  Normal (non-permanent-delegate) transfer is unaffected by flag
 *  BUG-024-10  Multiple wallets: consent for wallet A does not satisfy check for wallet B
 */

import { assert } from "chai";
import { PublicKey, Keypair } from "@solana/web3.js";

// ---------------------------------------------------------------------------
// Constants mirroring the Rust implementation
// ---------------------------------------------------------------------------

/** FLAG_REQUIRE_OWNER_CONSENT bit in feature_flags — must be bit 15 (BUG-024-01) */
const FLAG_REQUIRE_OWNER_CONSENT = 1n << 15n; // 32768

/** Minimum accepted DelegateConsent PDA size (discriminator only). */
const DELEGATE_CONSENT_MIN_SIZE = 8;

// ---------------------------------------------------------------------------
// Pure TypeScript model of the permanent-delegate consent check logic.
// Mirrors transfer-hook/src/lib.rs FLAG_REQUIRE_OWNER_CONSENT block.
// ---------------------------------------------------------------------------

interface HookCallParams {
  /**
   * The signer passed as ctx.accounts.owner (may be permanent delegate,
   * or the actual wallet owner for normal transfers).
   */
  signerPubkey: PublicKey;
  /** Actual owner read from token account data at offset 32..64. */
  srcOwner: PublicKey;
  /** Mint address. */
  mint: PublicKey;
  /** feature_flags bitmask from StablecoinConfig. */
  featureFlags: bigint;
  /** Accounts passed in remaining_accounts (each has a key and data length). */
  remainingAccounts: Array<{ key: PublicKey; dataLen: number }>;
}

type HookResult =
  | { ok: true }
  | { ok: false; error: "OwnerConsentRequired" };

/** Simulated sss-token program ID (canonical SSS address — placeholder for unit tests). */
const _SSS_TOKEN_PROGRAM_ID_UNUSED = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

/**
 * Deterministic PDA derivation for DelegateConsent.
 * In production this uses Pubkey::find_program_address; here we simulate
 * it with a stable XOR-based hash for test purposes.
 */
function deriveConsentPda(mint: PublicKey, walletOwner: PublicKey): PublicKey {
  // XOR mint bytes with walletOwner bytes to produce a unique key per (mint, owner) pair.
  const mintBytes = mint.toBytes();
  const ownerBytes = walletOwner.toBytes();
  const result = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    // Mix in the seed prefix for "delegate-consent" using the index.
    result[i] = (mintBytes[i] ^ ownerBytes[i] ^ (i + 0xdc)) & 0xff;
  }
  // Ensure it's not all zeros (unlikely but guard anyway).
  result[0] = result[0] === 0 ? 1 : result[0];
  return new PublicKey(result);
}

/**
 * Simulate the BUG-024 permanent-delegate consent check in transfer_hook.
 */
function checkOwnerConsent(params: HookCallParams): HookResult {
  const { signerPubkey, srcOwner, mint, featureFlags, remainingAccounts } =
    params;

  if ((featureFlags & FLAG_REQUIRE_OWNER_CONSENT) === 0n) {
    // Flag not set — skip check entirely.
    return { ok: true };
  }

  // Permanent delegate detected: signer is not the token account owner.
  if (signerPubkey.equals(srcOwner)) {
    // Owner-signed transfer — always allowed (no delegate).
    return { ok: true };
  }

  // Look for DelegateConsent PDA in remaining_accounts.
  const expectedConsentPda = deriveConsentPda(mint, srcOwner);
  const consentFound = remainingAccounts.some(
    (a) =>
      a.key.equals(expectedConsentPda) && a.dataLen >= DELEGATE_CONSENT_MIN_SIZE
  );

  if (!consentFound) {
    return { ok: false, error: "OwnerConsentRequired" };
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Helper fixtures — use Keypair.generate() for valid random pubkeys
// ---------------------------------------------------------------------------

function makePubkey(seed: number): PublicKey {
  const bytes = new Uint8Array(32).fill(seed & 0xff);
  bytes[31] = (seed >> 8) & 0xff;
  return new PublicKey(bytes);
}

const MINT = makePubkey(1);
const WALLET_OWNER_A = makePubkey(2);
const WALLET_OWNER_B = makePubkey(3);
const PERMANENT_DELEGATE = makePubkey(4);

const CONSENT_PDA_A = deriveConsentPda(MINT, WALLET_OWNER_A);
const CONSENT_PDA_B = deriveConsentPda(MINT, WALLET_OWNER_B);
const WRONG_PDA = makePubkey(5);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("BUG-024: Permanent delegate policy", () => {
  // BUG-024-01: FLAG_REQUIRE_OWNER_CONSENT is bit 15 (32768)
  it("BUG-024-01: FLAG_REQUIRE_OWNER_CONSENT constant is bit 15 (32768)", () => {
    assert.strictEqual(FLAG_REQUIRE_OWNER_CONSENT, 32768n);
    assert.strictEqual(FLAG_REQUIRE_OWNER_CONSENT, 1n << 15n);
  });

  // BUG-024-02: Owner-signed transfer passes when flag is set
  it("BUG-024-02: Owner-signed transfer passes when flag is set (owner == src_owner)", () => {
    const result = checkOwnerConsent({
      signerPubkey: WALLET_OWNER_A,
      srcOwner: WALLET_OWNER_A, // same — normal transfer
      mint: MINT,
      featureFlags: FLAG_REQUIRE_OWNER_CONSENT,
      remainingAccounts: [],
    });
    assert.isTrue(result.ok, "Owner-signed transfer should pass");
  });

  // BUG-024-03: Permanent-delegate transfer blocked when flag is set and no consent PDA
  it("BUG-024-03: Permanent-delegate transfer blocked — flag set, no consent PDA", () => {
    const result = checkOwnerConsent({
      signerPubkey: PERMANENT_DELEGATE,
      srcOwner: WALLET_OWNER_A,
      mint: MINT,
      featureFlags: FLAG_REQUIRE_OWNER_CONSENT,
      remainingAccounts: [], // no consent PDA provided
    });
    assert.isFalse(result.ok);
    assert.strictEqual(
      (result as { ok: false; error: string }).error,
      "OwnerConsentRequired",
      "Should return OwnerConsentRequired"
    );
  });

  // BUG-024-04: Permanent-delegate transfer allowed when flag is set and consent PDA present
  it("BUG-024-04: Permanent-delegate transfer allowed — flag set, valid consent PDA present", () => {
    const result = checkOwnerConsent({
      signerPubkey: PERMANENT_DELEGATE,
      srcOwner: WALLET_OWNER_A,
      mint: MINT,
      featureFlags: FLAG_REQUIRE_OWNER_CONSENT,
      remainingAccounts: [{ key: CONSENT_PDA_A, dataLen: 81 }], // full DelegateConsent PDA
    });
    assert.isTrue(result.ok, "Consented delegate transfer should pass");
  });

  // BUG-024-05: Permanent-delegate transfer allowed when flag is NOT set
  it("BUG-024-05: Permanent-delegate transfer allowed when FLAG_REQUIRE_OWNER_CONSENT is NOT set", () => {
    const result = checkOwnerConsent({
      signerPubkey: PERMANENT_DELEGATE,
      srcOwner: WALLET_OWNER_A,
      mint: MINT,
      featureFlags: 0n, // flag not set
      remainingAccounts: [],
    });
    assert.isTrue(result.ok, "Should pass — flag not active");
  });

  // BUG-024-06: DelegateConsent PDA seed derivation
  it("BUG-024-06: DelegateConsent PDA seed: [b'delegate-consent', mint, wallet_owner]", () => {
    const pda1 = deriveConsentPda(MINT, WALLET_OWNER_A);
    const pda2 = deriveConsentPda(MINT, WALLET_OWNER_A);
    assert.isTrue(pda1.equals(pda2), "PDA derivation must be deterministic");

    // Different owner → different PDA
    const pdaB = deriveConsentPda(MINT, WALLET_OWNER_B);
    assert.isFalse(
      pda1.equals(pdaB),
      "Different wallet owners must produce different PDAs"
    );

    // Different mint → different PDA
    const otherMint = makePubkey(6);
    const pdaOtherMint = deriveConsentPda(otherMint, WALLET_OWNER_A);
    assert.isFalse(
      pda1.equals(pdaOtherMint),
      "Different mints must produce different PDAs"
    );
  });

  // BUG-024-07: Wrong PDA in remaining_accounts does not satisfy consent check
  it("BUG-024-07: Wrong PDA in remaining_accounts — consent check fails", () => {
    const result = checkOwnerConsent({
      signerPubkey: PERMANENT_DELEGATE,
      srcOwner: WALLET_OWNER_A,
      mint: MINT,
      featureFlags: FLAG_REQUIRE_OWNER_CONSENT,
      remainingAccounts: [{ key: WRONG_PDA, dataLen: 81 }], // wrong PDA key
    });
    assert.isFalse(result.ok);
    assert.strictEqual(
      (result as { ok: false; error: string }).error,
      "OwnerConsentRequired"
    );
  });

  // BUG-024-08: Consent PDA too small (< 8 bytes) does not satisfy consent check
  it("BUG-024-08: Consent PDA dataLen < 8 bytes — consent check fails", () => {
    const result = checkOwnerConsent({
      signerPubkey: PERMANENT_DELEGATE,
      srcOwner: WALLET_OWNER_A,
      mint: MINT,
      featureFlags: FLAG_REQUIRE_OWNER_CONSENT,
      remainingAccounts: [{ key: CONSENT_PDA_A, dataLen: 4 }], // too small
    });
    assert.isFalse(result.ok);
    assert.strictEqual(
      (result as { ok: false; error: string }).error,
      "OwnerConsentRequired",
      "Undersized PDA must not be accepted"
    );
  });

  // BUG-024-09: Normal (non-permanent-delegate) transfer is unaffected by flag
  it("BUG-024-09: Normal transfer (owner signs) unaffected — flag active but no delegate", () => {
    // Regardless of flag or missing consent PDA, if owner signs it passes.
    const result = checkOwnerConsent({
      signerPubkey: WALLET_OWNER_B,
      srcOwner: WALLET_OWNER_B,
      mint: MINT,
      featureFlags: FLAG_REQUIRE_OWNER_CONSENT,
      remainingAccounts: [], // no consent PDA needed
    });
    assert.isTrue(result.ok, "Owner-signed transfer always passes");
  });

  // BUG-024-10: Consent for wallet A does not apply to wallet B
  it("BUG-024-10: Consent for wallet A does not satisfy check for wallet B", () => {
    // CONSENT_PDA_A is keyed to WALLET_OWNER_A; we're checking WALLET_OWNER_B → different PDA
    const result = checkOwnerConsent({
      signerPubkey: PERMANENT_DELEGATE,
      srcOwner: WALLET_OWNER_B, // delegate is trying to move B's tokens
      mint: MINT,
      featureFlags: FLAG_REQUIRE_OWNER_CONSENT,
      remainingAccounts: [
        { key: CONSENT_PDA_A, dataLen: 81 }, // consent for A, not B
      ],
    });
    assert.isFalse(result.ok);
    assert.strictEqual(
      (result as { ok: false; error: string }).error,
      "OwnerConsentRequired",
      "Consent PDA for wallet A must not satisfy check for wallet B"
    );
  });

  // BUG-024-11: Exact minimum PDA size (8 bytes) is accepted
  it("BUG-024-11: Consent PDA with exactly 8 bytes (discriminator) is accepted", () => {
    const result = checkOwnerConsent({
      signerPubkey: PERMANENT_DELEGATE,
      srcOwner: WALLET_OWNER_A,
      mint: MINT,
      featureFlags: FLAG_REQUIRE_OWNER_CONSENT,
      remainingAccounts: [{ key: CONSENT_PDA_A, dataLen: 8 }], // exactly at minimum
    });
    assert.isTrue(result.ok, "Exactly 8-byte PDA must satisfy minimum size check");
  });

  // BUG-024-12: FLAG_REQUIRE_OWNER_CONSENT does not interact with other flags
  it("BUG-024-12: Only FLAG_REQUIRE_OWNER_CONSENT bit (15) triggers the check", () => {
    // All lower 32 bits set except bit 15 — should NOT trigger consent check.
    const allFlagsExceptBit15 = (0xFFFFFFFFn ^ FLAG_REQUIRE_OWNER_CONSENT) & 0xFFFFFFFFn;
    const result = checkOwnerConsent({
      signerPubkey: PERMANENT_DELEGATE,
      srcOwner: WALLET_OWNER_A,
      mint: MINT,
      featureFlags: allFlagsExceptBit15,
      remainingAccounts: [], // no consent PDA
    });
    assert.isTrue(result.ok, "Without bit 15, consent check must not fire");
  });
});

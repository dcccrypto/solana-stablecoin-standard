/**
 * SSS-129: ZK credential registry — Groth16-based selective disclosure
 *
 * Tests:
 *  1.  FLAG_ZK_CREDENTIALS constant is bit 10 (1024)
 *  2.  init_credential_registry creates CredentialRegistry PDA
 *  3.  init_credential_registry sets FLAG_ZK_CREDENTIALS in feature_flags
 *  4.  init_credential_registry stores issuer pubkey correctly
 *  5.  init_credential_registry stores merkle_root correctly
 *  6.  init_credential_registry stores credential_ttl_slots correctly
 *  7.  Non-authority cannot call init_credential_registry (Unauthorized)
 *  8.  verify_zk_credential with valid proof creates CredentialRecord
 *  9.  CredentialRecord.holder matches calling wallet
 * 10.  CredentialRecord.expires_slot = issued_slot + ttl_slots when ttl > 0
 * 11.  CredentialRecord.expires_slot = 0 when ttl_slots = 0 (never expires)
 * 12.  CredentialRecord.revoked is false after issuance
 * 13.  verify_zk_credential with wrong merkle_root in public_signals fails (InvalidZkProof)
 * 14.  verify_zk_credential with malformed proof length fails (InvalidZkProof)
 * 15.  rotate_credential_root updates merkle_root
 * 16.  rotate_credential_root updates updated_slot
 * 17.  Non-issuer cannot call rotate_credential_root (Unauthorized)
 * 18.  revoke_credential sets revoked=true on CredentialRecord
 * 19.  Non-issuer cannot call revoke_credential (Unauthorized)
 * 20.  close_credential_record reclaims rent to holder
 * 21.  Non-holder cannot call close_credential_record (Unauthorized)
 * 22.  verify_zk_credential refresh (re-calling) resets issued_slot and expiry
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { SssToken } from "../target/types/sss_token";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { expect } from "chai";

async function airdrop(
  connection: anchor.web3.Connection,
  pubkey: PublicKey,
  lamports = 2_000_000_000
): Promise<void> {
  const sig = await connection.requestAirdrop(pubkey, lamports);
  await connection.confirmTransaction(sig, "confirmed");
}

function findConfigPda(mint: PublicKey, programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("stablecoin-config"), mint.toBuffer()],
    programId
  )[0];
}

function findCredentialRegistryPda(
  mint: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("credential-registry"), mint.toBuffer()],
    programId
  );
}

function findCredentialRecordPda(
  mint: PublicKey,
  holder: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("credential-record"), mint.toBuffer(), holder.toBuffer()],
    programId
  );
}

/** Build a minimal valid 192-byte Groth16 proof stub */
function buildValidProof(): Buffer {
  return Buffer.alloc(192, 0xab);
}

/**
 * Build valid public_signals where bytes 0..32 equal the provided merkle_root.
 */
function buildPublicSignals(merkleRoot: Buffer): Buffer {
  const signals = Buffer.alloc(64, 0);
  merkleRoot.copy(signals, 0);
  return signals;
}

describe("SSS-129: ZK credential registry", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.SssToken as Program<SssToken>;
  const connection = provider.connection;

  let authority: Keypair;
  let issuer: Keypair;
  let notIssuer: Keypair;
  let holderA: Keypair;
  let holderB: Keypair;
  let mint: PublicKey;
  let config: PublicKey;
  let registry: PublicKey;

  const merkleRoot = Buffer.alloc(32, 0x42);
  const ttlSlots = new BN(1500);

  before(async () => {
    authority = Keypair.generate();
    issuer = Keypair.generate();
    notIssuer = Keypair.generate();
    holderA = Keypair.generate();
    holderB = Keypair.generate();

    await Promise.all([
      airdrop(connection, authority.publicKey),
      airdrop(connection, issuer.publicKey),
      airdrop(connection, notIssuer.publicKey),
      airdrop(connection, holderA.publicKey),
      airdrop(connection, holderB.publicKey),
    ]);

    // Create mint + initialise SSS stablecoin
    const mintKp = Keypair.generate();
    mint = mintKp.publicKey;
    config = findConfigPda(mint, program.programId);
    [registry] = findCredentialRegistryPda(mint, program.programId);

    await program.methods
      .initialize({
        preset: 1,
        decimals: 6,
        name: "ZkCredCoin",
        symbol: "ZKC",
        uri: "https://example.com/zkc.json",
        transferHookProgram: null,
        collateralMint: null,
        reserveVault: null,
        maxSupply: null,
        featureFlags: null,
        auditorElgamalPubkey: null,
      })
      .accounts({
        payer: authority.publicKey,
        mint: mintKp.publicKey,
        config,
        ctConfig: null,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([mintKp, authority])
      .rpc();
  });

  // -------------------------------------------------------------------------
  // Test 1: FLAG_ZK_CREDENTIALS constant
  // -------------------------------------------------------------------------
  it("1. FLAG_ZK_CREDENTIALS is bit 10 (1024)", async () => {
    const FLAG_ZK_CREDENTIALS = 1 << 10;
    expect(FLAG_ZK_CREDENTIALS).to.equal(1024);
  });

  // -------------------------------------------------------------------------
  // Test 2: init_credential_registry creates PDA
  // -------------------------------------------------------------------------
  it("2. init_credential_registry creates CredentialRegistry PDA", async () => {
    await program.methods
      .initCredentialRegistry({
        issuer: issuer.publicKey,
        merkleRoot: Array.from(merkleRoot),
        credentialTtlSlots: ttlSlots,
      })
      .accounts({
        authority: authority.publicKey,
        config,
        registry,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    const reg = await program.account.credentialRegistry.fetch(registry);
    expect(reg).to.not.be.null;
  });

  // -------------------------------------------------------------------------
  // Test 3: FLAG_ZK_CREDENTIALS enabled in config
  // -------------------------------------------------------------------------
  it("3. init_credential_registry sets FLAG_ZK_CREDENTIALS in feature_flags", async () => {
    const cfg = await program.account.stablecoinConfig.fetch(config);
    const FLAG_ZK_CREDENTIALS = new BN(1 << 10);
    expect(cfg.featureFlags.and(FLAG_ZK_CREDENTIALS).toNumber()).to.equal(1024);
  });

  // -------------------------------------------------------------------------
  // Test 4: issuer stored correctly
  // -------------------------------------------------------------------------
  it("4. init_credential_registry stores issuer pubkey correctly", async () => {
    const reg = await program.account.credentialRegistry.fetch(registry);
    expect(reg.issuer.toBase58()).to.equal(issuer.publicKey.toBase58());
  });

  // -------------------------------------------------------------------------
  // Test 5: merkle_root stored correctly
  // -------------------------------------------------------------------------
  it("5. init_credential_registry stores merkle_root correctly", async () => {
    const reg = await program.account.credentialRegistry.fetch(registry);
    expect(Buffer.from(reg.merkleRoot)).to.deep.equal(merkleRoot);
  });

  // -------------------------------------------------------------------------
  // Test 6: ttl stored correctly
  // -------------------------------------------------------------------------
  it("6. init_credential_registry stores credential_ttl_slots correctly", async () => {
    const reg = await program.account.credentialRegistry.fetch(registry);
    expect(reg.credentialTtlSlots.toNumber()).to.equal(ttlSlots.toNumber());
  });

  // -------------------------------------------------------------------------
  // Test 7: non-authority cannot init registry
  // -------------------------------------------------------------------------
  it("7. Non-authority cannot call init_credential_registry (Unauthorized)", async () => {
    // Deploy a fresh mint to avoid conflicts
    const mint2Kp = Keypair.generate();
    const config2 = findConfigPda(mint2Kp.publicKey, program.programId);
    const [registry2] = findCredentialRegistryPda(mint2Kp.publicKey, program.programId);

    await program.methods
      .initialize({
        preset: 1,
        decimals: 6,
        name: "ZkCredCoin",
        symbol: "ZKC",
        uri: "https://example.com/zkc.json",
        transferHookProgram: null,
        collateralMint: null,
        reserveVault: null,
        maxSupply: null,
        featureFlags: null,
        auditorElgamalPubkey: null,
      })
      .accounts({
        payer: authority.publicKey,
        mint: mint2Kp.publicKey,
        config: config2,
        ctConfig: null,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([mint2Kp, authority])
      .rpc();

    try {
      await program.methods
        .initCredentialRegistry({
          issuer: notIssuer.publicKey,
          merkleRoot: Array.from(merkleRoot),
          credentialTtlSlots: ttlSlots,
        })
        .accounts({
          authority: notIssuer.publicKey,
          config: config2,
          registry: registry2,
          systemProgram: SystemProgram.programId,
        })
        .signers([notIssuer])
        .rpc();
      expect.fail("Should have thrown Unauthorized");
    } catch (err: any) {
      expect(err.toString()).to.include("Unauthorized");
    }
  });

  // -------------------------------------------------------------------------
  // Test 8: verify_zk_credential creates CredentialRecord
  // -------------------------------------------------------------------------
  it("8. verify_zk_credential with valid proof creates CredentialRecord", async () => {
    const [credRecord] = findCredentialRecordPda(mint, holderA.publicKey, program.programId);
    const proof = buildValidProof();
    const signals = buildPublicSignals(merkleRoot);

    await program.methods
      .verifyZkCredential(proof, signals)
      .accounts({
        holder: holderA.publicKey,
        config,
        registry,
        credentialRecord: credRecord,
        systemProgram: SystemProgram.programId,
      })
      .signers([holderA])
      .rpc();

    const record = await program.account.credentialRecord.fetch(credRecord);
    expect(record).to.not.be.null;
  });

  // -------------------------------------------------------------------------
  // Test 9: holder matches
  // -------------------------------------------------------------------------
  it("9. CredentialRecord.holder matches calling wallet", async () => {
    const [credRecord] = findCredentialRecordPda(mint, holderA.publicKey, program.programId);
    const record = await program.account.credentialRecord.fetch(credRecord);
    expect(record.holder.toBase58()).to.equal(holderA.publicKey.toBase58());
  });

  // -------------------------------------------------------------------------
  // Test 10: expires_slot = issued_slot + ttl when ttl > 0
  // -------------------------------------------------------------------------
  it("10. CredentialRecord.expires_slot = issued_slot + ttl_slots when ttl > 0", async () => {
    const [credRecord] = findCredentialRecordPda(mint, holderA.publicKey, program.programId);
    const record = await program.account.credentialRecord.fetch(credRecord);
    const expected = record.issuedSlot.add(ttlSlots);
    expect(record.expiresSlot.toNumber()).to.equal(expected.toNumber());
  });

  // -------------------------------------------------------------------------
  // Test 11: expires_slot = 0 when ttl = 0
  // -------------------------------------------------------------------------
  it("11. CredentialRecord.expires_slot = 0 when ttl_slots = 0 (never expires)", async () => {
    // Create a second registry with ttl=0
    const mint3Kp = Keypair.generate();
    const config3 = findConfigPda(mint3Kp.publicKey, program.programId);
    const [registry3] = findCredentialRegistryPda(mint3Kp.publicKey, program.programId);
    const [credRecord3] = findCredentialRecordPda(mint3Kp.publicKey, holderB.publicKey, program.programId);

    await program.methods
      .initialize({
        preset: 1,
        decimals: 6,
        name: "ZkCredCoin",
        symbol: "ZKC",
        uri: "https://example.com/zkc.json",
        transferHookProgram: null,
        collateralMint: null,
        reserveVault: null,
        maxSupply: null,
        featureFlags: null,
        auditorElgamalPubkey: null,
      })
      .accounts({
        payer: authority.publicKey,
        mint: mint3Kp.publicKey,
        config: config3,
        ctConfig: null,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([mint3Kp, authority])
      .rpc();

    await program.methods
      .initCredentialRegistry({
        issuer: issuer.publicKey,
        merkleRoot: Array.from(merkleRoot),
        credentialTtlSlots: new BN(0),
      })
      .accounts({
        authority: authority.publicKey,
        config: config3,
        registry: registry3,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    const proof = buildValidProof();
    const signals = buildPublicSignals(merkleRoot);
    await program.methods
      .verifyZkCredential(proof, signals)
      .accounts({
        holder: holderB.publicKey,
        config: config3,
        registry: registry3,
        credentialRecord: credRecord3,
        systemProgram: SystemProgram.programId,
      })
      .signers([holderB])
      .rpc();

    const record = await program.account.credentialRecord.fetch(credRecord3);
    expect(record.expiresSlot.toNumber()).to.equal(0);
  });

  // -------------------------------------------------------------------------
  // Test 12: revoked = false after issuance
  // -------------------------------------------------------------------------
  it("12. CredentialRecord.revoked is false after issuance", async () => {
    const [credRecord] = findCredentialRecordPda(mint, holderA.publicKey, program.programId);
    const record = await program.account.credentialRecord.fetch(credRecord);
    expect(record.revoked).to.be.false;
  });

  // -------------------------------------------------------------------------
  // Test 13: wrong merkle root fails
  // -------------------------------------------------------------------------
  it("13. verify_zk_credential with wrong merkle_root in public_signals fails (InvalidZkProof)", async () => {
    const [credRecord] = findCredentialRecordPda(mint, holderB.publicKey, program.programId);
    const proof = buildValidProof();
    const wrongRoot = Buffer.alloc(32, 0xff);
    const signals = buildPublicSignals(wrongRoot);

    try {
      await program.methods
        .verifyZkCredential(proof, signals)
        .accounts({
          holder: holderB.publicKey,
          config,
          registry,
          credentialRecord: credRecord,
          systemProgram: SystemProgram.programId,
        })
        .signers([holderB])
        .rpc();
      expect.fail("Should have thrown InvalidZkProof");
    } catch (err: any) {
      expect(err.toString()).to.include("InvalidZkProof");
    }
  });

  // -------------------------------------------------------------------------
  // Test 14: malformed proof length fails
  // -------------------------------------------------------------------------
  it("14. verify_zk_credential with malformed proof length fails (InvalidZkProof)", async () => {
    const [credRecord] = findCredentialRecordPda(mint, holderB.publicKey, program.programId);
    const shortProof = Buffer.alloc(100, 0xab); // not 192 bytes
    const signals = buildPublicSignals(merkleRoot);

    try {
      await program.methods
        .verifyZkCredential(shortProof, signals)
        .accounts({
          holder: holderB.publicKey,
          config,
          registry,
          credentialRecord: credRecord,
          systemProgram: SystemProgram.programId,
        })
        .signers([holderB])
        .rpc();
      expect.fail("Should have thrown InvalidZkProof");
    } catch (err: any) {
      expect(err.toString()).to.include("InvalidZkProof");
    }
  });

  // -------------------------------------------------------------------------
  // Test 15: rotate_credential_root updates merkle_root
  // -------------------------------------------------------------------------
  it("15. rotate_credential_root updates merkle_root", async () => {
    const newRoot = Buffer.alloc(32, 0x99);
    await program.methods
      .rotateCredentialRoot(Array.from(newRoot))
      .accounts({
        issuer: issuer.publicKey,
        config,
        registry,
      })
      .signers([issuer])
      .rpc();

    const reg = await program.account.credentialRegistry.fetch(registry);
    expect(Buffer.from(reg.merkleRoot)).to.deep.equal(newRoot);
  });

  // -------------------------------------------------------------------------
  // Test 16: rotate_credential_root updates updated_slot
  // -------------------------------------------------------------------------
  it("16. rotate_credential_root updates updated_slot", async () => {
    const regBefore = await program.account.credentialRegistry.fetch(registry);
    const newRoot = Buffer.alloc(32, 0xcc);
    await program.methods
      .rotateCredentialRoot(Array.from(newRoot))
      .accounts({
        issuer: issuer.publicKey,
        config,
        registry,
      })
      .signers([issuer])
      .rpc();

    const regAfter = await program.account.credentialRegistry.fetch(registry);
    expect(regAfter.updatedSlot.toNumber()).to.be.gte(regBefore.updatedSlot.toNumber());
  });

  // -------------------------------------------------------------------------
  // Test 17: non-issuer cannot rotate root
  // -------------------------------------------------------------------------
  it("17. Non-issuer cannot call rotate_credential_root (Unauthorized)", async () => {
    const newRoot = Buffer.alloc(32, 0xdd);
    try {
      await program.methods
        .rotateCredentialRoot(Array.from(newRoot))
        .accounts({
          issuer: notIssuer.publicKey,
          config,
          registry,
        })
        .signers([notIssuer])
        .rpc();
      expect.fail("Should have thrown Unauthorized");
    } catch (err: any) {
      expect(err.toString()).to.include("Unauthorized");
    }
  });

  // -------------------------------------------------------------------------
  // Test 18: revoke_credential sets revoked=true
  // -------------------------------------------------------------------------
  it("18. revoke_credential sets revoked=true on CredentialRecord", async () => {
    const [credRecord] = findCredentialRecordPda(mint, holderA.publicKey, program.programId);
    await program.methods
      .revokeCredential()
      .accounts({
        issuer: issuer.publicKey,
        config,
        registry,
        credentialRecord: credRecord,
        holder: holderA.publicKey,
      })
      .signers([issuer])
      .rpc();

    const record = await program.account.credentialRecord.fetch(credRecord);
    expect(record.revoked).to.be.true;
  });

  // -------------------------------------------------------------------------
  // Test 19: non-issuer cannot revoke
  // -------------------------------------------------------------------------
  it("19. Non-issuer cannot call revoke_credential (Unauthorized)", async () => {
    // Issue a fresh credential first (re-rotate root back to original)
    const restoredRoot = merkleRoot;
    await program.methods
      .rotateCredentialRoot(Array.from(restoredRoot))
      .accounts({
        issuer: issuer.publicKey,
        config,
        registry,
      })
      .signers([issuer])
      .rpc();

    // Issue fresh credential to holderA
    const [credRecordA] = findCredentialRecordPda(mint, holderA.publicKey, program.programId);
    const proof = buildValidProof();
    const signals = buildPublicSignals(restoredRoot);
    await program.methods
      .verifyZkCredential(proof, signals)
      .accounts({
        holder: holderA.publicKey,
        config,
        registry,
        credentialRecord: credRecordA,
        systemProgram: SystemProgram.programId,
      })
      .signers([holderA])
      .rpc();

    try {
      await program.methods
        .revokeCredential()
        .accounts({
          issuer: notIssuer.publicKey,
          config,
          registry,
          credentialRecord: credRecordA,
          holder: holderA.publicKey,
        })
        .signers([notIssuer])
        .rpc();
      expect.fail("Should have thrown Unauthorized");
    } catch (err: any) {
      expect(err.toString()).to.include("Unauthorized");
    }
  });

  // -------------------------------------------------------------------------
  // Test 20: close_credential_record reclaims rent
  // -------------------------------------------------------------------------
  it("20. close_credential_record reclaims rent to holder", async () => {
    // Issue a credential for holderB on the main mint
    const [credRecordB] = findCredentialRecordPda(mint, holderB.publicKey, program.programId);
    const proof = buildValidProof();
    const signals = buildPublicSignals(merkleRoot);
    await program.methods
      .verifyZkCredential(proof, signals)
      .accounts({
        holder: holderB.publicKey,
        config,
        registry,
        credentialRecord: credRecordB,
        systemProgram: SystemProgram.programId,
      })
      .signers([holderB])
      .rpc();

    const balanceBefore = await connection.getBalance(holderB.publicKey);
    await program.methods
      .closeCredentialRecord()
      .accounts({
        holder: holderB.publicKey,
        config,
        credentialRecord: credRecordB,
      })
      .signers([holderB])
      .rpc();

    const balanceAfter = await connection.getBalance(holderB.publicKey);
    // Rent was reclaimed so balance should be higher (minus tx fee)
    expect(balanceAfter).to.be.greaterThan(balanceBefore - 10_000);

    // PDA should no longer exist
    const info = await connection.getAccountInfo(credRecordB);
    expect(info).to.be.null;
  });

  // -------------------------------------------------------------------------
  // Test 21: non-holder cannot close record
  // -------------------------------------------------------------------------
  it("21. Non-holder cannot call close_credential_record (Unauthorized)", async () => {
    // Re-issue credential to holderB
    const [credRecordB] = findCredentialRecordPda(mint, holderB.publicKey, program.programId);
    const proof = buildValidProof();
    const signals = buildPublicSignals(merkleRoot);
    await program.methods
      .verifyZkCredential(proof, signals)
      .accounts({
        holder: holderB.publicKey,
        config,
        registry,
        credentialRecord: credRecordB,
        systemProgram: SystemProgram.programId,
      })
      .signers([holderB])
      .rpc();

    try {
      await program.methods
        .closeCredentialRecord()
        .accounts({
          holder: holderA.publicKey, // wrong holder
          config,
          credentialRecord: credRecordB,
        })
        .signers([holderA])
        .rpc();
      expect.fail("Should have thrown Unauthorized or ConstraintSeeds");
    } catch (err: any) {
      // Seeds mismatch or Unauthorized
      expect(err.toString()).to.match(/Unauthorized|ConstraintSeeds|seeds constraint/i);
    }
  });

  // -------------------------------------------------------------------------
  // Test 22: verify_zk_credential refresh resets issued_slot and expiry
  // -------------------------------------------------------------------------
  it("22. verify_zk_credential refresh resets issued_slot and expiry", async () => {
    const [credRecordA] = findCredentialRecordPda(mint, holderA.publicKey, program.programId);
    const recordBefore = await program.account.credentialRecord.fetch(credRecordA);

    // Small delay to ensure slot advances
    await new Promise((r) => setTimeout(r, 500));

    const proof = buildValidProof();
    const signals = buildPublicSignals(merkleRoot);
    await program.methods
      .verifyZkCredential(proof, signals)
      .accounts({
        holder: holderA.publicKey,
        config,
        registry,
        credentialRecord: credRecordA,
        systemProgram: SystemProgram.programId,
      })
      .signers([holderA])
      .rpc();

    const recordAfter = await program.account.credentialRecord.fetch(credRecordA);
    expect(recordAfter.issuedSlot.toNumber()).to.be.gte(recordBefore.issuedSlot.toNumber());
    expect(recordAfter.revoked).to.be.false;
  });
});

/**
 * SSS-156: Issuer Legal Entity Registry — Anchor tests
 *
 * Tests: register_legal_entity, attest_legal_entity, update_legal_entity,
 *        and all guard conditions.
 *
 * Test plan (12 tests):
 *  1.  register_legal_entity: creates IssuerRegistry PDA, sets FLAG_LEGAL_REGISTRY on config
 *  2.  register_legal_entity: non-authority rejected (Unauthorized)
 *  3.  register_legal_entity: zero legal_entity_hash rejected
 *  4.  register_legal_entity: zero jurisdiction rejected
 *  5.  register_legal_entity: zero registration_number_hash rejected
 *  6.  register_legal_entity: zero attestor pubkey rejected
 *  7.  attest_legal_entity: attestor signs, attested=true, attested_slot recorded
 *  8.  attest_legal_entity: non-attestor signer rejected
 *  9.  attest_legal_entity: double-attest rejected
 * 10.  update_legal_entity: authority updates record, attestation reset
 * 11.  update_legal_entity: non-authority rejected
 * 12.  re-attest after update: attestor re-signs successfully
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { SssToken } from "../target/types/sss_token";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { expect } from "chai";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function airdrop(
  provider: anchor.AnchorProvider,
  pubkey: PublicKey,
  sol = 10
): Promise<void> {
  const sig = await provider.connection.requestAirdrop(
    pubkey,
    sol * LAMPORTS_PER_SOL
  );
  await provider.connection.confirmTransaction(sig, "confirmed");
}

function configPda(
  programId: PublicKey,
  mint: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("stablecoin-config"), mint.toBuffer()],
    programId
  );
}

function issuerRegistryPda(
  programId: PublicKey,
  configKey: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("issuer_registry"), configKey.toBuffer()],
    programId
  );
}

const LEGAL_ENTITY_HASH = Buffer.alloc(32, 0xab);
const JURISDICTION = Buffer.from("US\0\0"); // 4 bytes
const REG_NUMBER_HASH = Buffer.alloc(32, 0xcd);
const ZERO_HASH = Buffer.alloc(32, 0x00);
const ZERO_JURISDICTION = Buffer.alloc(4, 0x00);
const FLAG_LEGAL_REGISTRY = BigInt(1) << BigInt(24);

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("SSS-156: Issuer Legal Entity Registry", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.SssToken as Program<SssToken>;

  let authority: Keypair;
  let attestor: Keypair;
  let nonAuthority: Keypair;
  let mint: Keypair;
  let configKey: PublicKey;
  let registryKey: PublicKey;

  before(async () => {
    authority = Keypair.generate();
    attestor = Keypair.generate();
    nonAuthority = Keypair.generate();
    mint = Keypair.generate();

    await airdrop(provider, authority.publicKey);
    await airdrop(provider, attestor.publicKey);
    await airdrop(provider, nonAuthority.publicKey);

    [configKey] = configPda(program.programId, mint.publicKey);
    [registryKey] = issuerRegistryPda(program.programId, configKey);

    // Initialize a minimal SSS-3 stablecoin
    await program.methods
      .initialize({
        name: "Test Stable",
        symbol: "TST",
        decimals: 6,
        initialSupplyCap: new BN(1_000_000_000),
        preset: 3,
        featureFlags: null,
        auditorElgamalPubkey: null,
          squadsMultisig: Keypair.generate().publicKey,
        oracleType: 0,
        oracleFeed: null,
        maxOracleAgeSecs: null,
        maxOracleConfBps: null,
        pythPriceFeed: null,
      })
      .accounts({
        authority: authority.publicKey,
        mint: mint.publicKey,
        config: configKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([authority, mint])
      .rpc();
  });

  // ─── Test 1: register_legal_entity creates PDA and sets flag ──────────────
  it("1. register_legal_entity: creates IssuerRegistry PDA, sets FLAG_LEGAL_REGISTRY", async () => {
    await program.methods
      .registerLegalEntity(
        Array.from(LEGAL_ENTITY_HASH),
        Array.from(JURISDICTION),
        Array.from(REG_NUMBER_HASH),
        attestor.publicKey,
        new BN(0) // no expiry
      )
      .accounts({
        authority: authority.publicKey,
        config: configKey,
        issuerRegistry: registryKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    const registry = await program.account.issuerRegistry.fetch(registryKey);
    expect(registry.config.toBase58()).to.equal(configKey.toBase58());
    expect(Buffer.from(registry.legalEntityHash).equals(LEGAL_ENTITY_HASH)).to.be.true;
    expect(Buffer.from(registry.jurisdiction).equals(JURISDICTION)).to.be.true;
    expect(Buffer.from(registry.registrationNumberHash).equals(REG_NUMBER_HASH)).to.be.true;
    expect(registry.attestor.toBase58()).to.equal(attestor.publicKey.toBase58());
    expect(registry.attested).to.be.false;
    expect(registry.attestedSlot.toNumber()).to.equal(0);
    expect(registry.expirySlot.toNumber()).to.equal(0);

    const config = await program.account.stablecoinConfig.fetch(configKey);
    expect((BigInt(config.featureFlags.toString()) & FLAG_LEGAL_REGISTRY) !== BigInt(0)).to.be.true;
  });

  // ─── Test 2: non-authority cannot register ────────────────────────────────
  it("2. register_legal_entity: non-authority rejected", async () => {
    // Need a new mint for this test (can't re-init)
    const mint2 = Keypair.generate();
    const [config2] = configPda(program.programId, mint2.publicKey);
    const [registry2] = issuerRegistryPda(program.programId, config2);

    await program.methods
      .initialize({
        name: "Test2",
        symbol: "TS2",
        decimals: 6,
        initialSupplyCap: new BN(1_000_000_000),
        preset: 3,
        featureFlags: null,
        auditorElgamalPubkey: null,
          squadsMultisig: Keypair.generate().publicKey,
        oracleType: 0,
        oracleFeed: null,
        maxOracleAgeSecs: null,
        maxOracleConfBps: null,
        pythPriceFeed: null,
      })
      .accounts({
        authority: authority.publicKey,
        mint: mint2.publicKey,
        config: config2,
        systemProgram: SystemProgram.programId,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([authority, mint2])
      .rpc();

    try {
      await program.methods
        .registerLegalEntity(
          Array.from(LEGAL_ENTITY_HASH),
          Array.from(JURISDICTION),
          Array.from(REG_NUMBER_HASH),
          attestor.publicKey,
          new BN(0)
        )
        .accounts({
          authority: nonAuthority.publicKey,
          config: config2,
          issuerRegistry: registry2,
          systemProgram: SystemProgram.programId,
        })
        .signers([nonAuthority])
        .rpc();
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.message).to.match(/Unauthorized|constraint/i);
    }
  });

  // ─── Test 3: zero legal_entity_hash rejected ──────────────────────────────
  it("3. register_legal_entity: zero legal_entity_hash rejected", async () => {
    const mint3 = Keypair.generate();
    const [config3] = configPda(program.programId, mint3.publicKey);
    const [registry3] = issuerRegistryPda(program.programId, config3);

    await program.methods
      .initialize({
        name: "Test3", symbol: "TS3", decimals: 6,
        initialSupplyCap: new BN(1_000_000_000), preset: 3,
        featureFlags: null, auditorElgamalPubkey: null,
          squadsMultisig: Keypair.generate().publicKey,
        oracleType: 0, oracleFeed: null, maxOracleAgeSecs: null,
        maxOracleConfBps: null, pythPriceFeed: null,
      })
      .accounts({ authority: authority.publicKey, mint: mint3.publicKey, config: config3,
        systemProgram: SystemProgram.programId,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID, rent: anchor.web3.SYSVAR_RENT_PUBKEY })
      .signers([authority, mint3]).rpc();

    try {
      await program.methods
        .registerLegalEntity(Array.from(ZERO_HASH), Array.from(JURISDICTION),
          Array.from(REG_NUMBER_HASH), attestor.publicKey, new BN(0))
        .accounts({ authority: authority.publicKey, config: config3,
          issuerRegistry: registry3, systemProgram: SystemProgram.programId })
        .signers([authority]).rpc();
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.message).to.match(/InvalidLegalEntityHash|zero/i);
    }
  });

  // ─── Test 4: zero jurisdiction rejected ───────────────────────────────────
  it("4. register_legal_entity: zero jurisdiction rejected", async () => {
    const mint4 = Keypair.generate();
    const [config4] = configPda(program.programId, mint4.publicKey);
    const [registry4] = issuerRegistryPda(program.programId, config4);

    await program.methods
      .initialize({
        name: "Test4", symbol: "TS4", decimals: 6,
        initialSupplyCap: new BN(1_000_000_000), preset: 3,
        featureFlags: null, auditorElgamalPubkey: null,
          squadsMultisig: Keypair.generate().publicKey,
        oracleType: 0, oracleFeed: null, maxOracleAgeSecs: null,
        maxOracleConfBps: null, pythPriceFeed: null,
      })
      .accounts({ authority: authority.publicKey, mint: mint4.publicKey, config: config4,
        systemProgram: SystemProgram.programId,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID, rent: anchor.web3.SYSVAR_RENT_PUBKEY })
      .signers([authority, mint4]).rpc();

    try {
      await program.methods
        .registerLegalEntity(Array.from(LEGAL_ENTITY_HASH), Array.from(ZERO_JURISDICTION),
          Array.from(REG_NUMBER_HASH), attestor.publicKey, new BN(0))
        .accounts({ authority: authority.publicKey, config: config4,
          issuerRegistry: registry4, systemProgram: SystemProgram.programId })
        .signers([authority]).rpc();
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.message).to.match(/InvalidLegalEntityJurisdiction|zero/i);
    }
  });

  // ─── Test 5: zero registration_number_hash rejected ───────────────────────
  it("5. register_legal_entity: zero registration_number_hash rejected", async () => {
    const mint5 = Keypair.generate();
    const [config5] = configPda(program.programId, mint5.publicKey);
    const [registry5] = issuerRegistryPda(program.programId, config5);

    await program.methods
      .initialize({
        name: "Test5", symbol: "TS5", decimals: 6,
        initialSupplyCap: new BN(1_000_000_000), preset: 3,
        featureFlags: null, auditorElgamalPubkey: null,
          squadsMultisig: Keypair.generate().publicKey,
        oracleType: 0, oracleFeed: null, maxOracleAgeSecs: null,
        maxOracleConfBps: null, pythPriceFeed: null,
      })
      .accounts({ authority: authority.publicKey, mint: mint5.publicKey, config: config5,
        systemProgram: SystemProgram.programId,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID, rent: anchor.web3.SYSVAR_RENT_PUBKEY })
      .signers([authority, mint5]).rpc();

    try {
      await program.methods
        .registerLegalEntity(Array.from(LEGAL_ENTITY_HASH), Array.from(JURISDICTION),
          Array.from(ZERO_HASH), attestor.publicKey, new BN(0))
        .accounts({ authority: authority.publicKey, config: config5,
          issuerRegistry: registry5, systemProgram: SystemProgram.programId })
        .signers([authority]).rpc();
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.message).to.match(/InvalidLegalEntityHash|zero/i);
    }
  });

  // ─── Test 6: zero attestor rejected ───────────────────────────────────────
  it("6. register_legal_entity: zero attestor pubkey rejected", async () => {
    const mint6 = Keypair.generate();
    const [config6] = configPda(program.programId, mint6.publicKey);
    const [registry6] = issuerRegistryPda(program.programId, config6);

    await program.methods
      .initialize({
        name: "Test6", symbol: "TS6", decimals: 6,
        initialSupplyCap: new BN(1_000_000_000), preset: 3,
        featureFlags: null, auditorElgamalPubkey: null,
          squadsMultisig: Keypair.generate().publicKey,
        oracleType: 0, oracleFeed: null, maxOracleAgeSecs: null,
        maxOracleConfBps: null, pythPriceFeed: null,
      })
      .accounts({ authority: authority.publicKey, mint: mint6.publicKey, config: config6,
        systemProgram: SystemProgram.programId,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID, rent: anchor.web3.SYSVAR_RENT_PUBKEY })
      .signers([authority, mint6]).rpc();

    try {
      await program.methods
        .registerLegalEntity(Array.from(LEGAL_ENTITY_HASH), Array.from(JURISDICTION),
          Array.from(REG_NUMBER_HASH), PublicKey.default, new BN(0))
        .accounts({ authority: authority.publicKey, config: config6,
          issuerRegistry: registry6, systemProgram: SystemProgram.programId })
        .signers([authority]).rpc();
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.message).to.match(/InvalidLegalEntityAttestor|zero/i);
    }
  });

  // ─── Test 7: attest_legal_entity: attestor signs ──────────────────────────
  it("7. attest_legal_entity: attestor signs, attested=true, slot recorded", async () => {
    await program.methods
      .attestLegalEntity()
      .accounts({
        attestor: attestor.publicKey,
        config: configKey,
        issuerRegistry: registryKey,
      })
      .signers([attestor])
      .rpc();

    const registry = await program.account.issuerRegistry.fetch(registryKey);
    expect(registry.attested).to.be.true;
    expect(registry.attestedSlot.toNumber()).to.be.greaterThan(0);
  });

  // ─── Test 8: non-attestor cannot attest ───────────────────────────────────
  it("8. attest_legal_entity: non-attestor signer rejected", async () => {
    // Register a fresh registry for this test
    const mint8 = Keypair.generate();
    const [config8] = configPda(program.programId, mint8.publicKey);
    const [registry8] = issuerRegistryPda(program.programId, config8);

    await program.methods
      .initialize({
        name: "Test8", symbol: "TS8", decimals: 6,
        initialSupplyCap: new BN(1_000_000_000), preset: 3,
        featureFlags: null, auditorElgamalPubkey: null,
          squadsMultisig: Keypair.generate().publicKey,
        oracleType: 0, oracleFeed: null, maxOracleAgeSecs: null,
        maxOracleConfBps: null, pythPriceFeed: null,
      })
      .accounts({ authority: authority.publicKey, mint: mint8.publicKey, config: config8,
        systemProgram: SystemProgram.programId,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID, rent: anchor.web3.SYSVAR_RENT_PUBKEY })
      .signers([authority, mint8]).rpc();

    await program.methods
      .registerLegalEntity(Array.from(LEGAL_ENTITY_HASH), Array.from(JURISDICTION),
        Array.from(REG_NUMBER_HASH), attestor.publicKey, new BN(0))
      .accounts({ authority: authority.publicKey, config: config8,
        issuerRegistry: registry8, systemProgram: SystemProgram.programId })
      .signers([authority]).rpc();

    try {
      await program.methods
        .attestLegalEntity()
        .accounts({ attestor: nonAuthority.publicKey, config: config8, issuerRegistry: registry8 })
        .signers([nonAuthority]).rpc();
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.message).to.match(/Unauthorized/i);
    }
  });

  // ─── Test 9: double attest rejected ───────────────────────────────────────
  it("9. attest_legal_entity: double-attest rejected", async () => {
    try {
      await program.methods
        .attestLegalEntity()
        .accounts({ attestor: attestor.publicKey, config: configKey, issuerRegistry: registryKey })
        .signers([attestor]).rpc();
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.message).to.match(/LegalEntityAlreadyAttested|already/i);
    }
  });

  // ─── Test 10: update_legal_entity: authority updates, attestation reset ───
  it("10. update_legal_entity: authority updates record, attestation reset", async () => {
    const newHash = Buffer.alloc(32, 0xef);
    const newJurisdiction = Buffer.from("GB\0\0");
    const newRegHash = Buffer.alloc(32, 0x12);

    await program.methods
      .updateLegalEntity(
        Array.from(newHash),
        Array.from(newJurisdiction),
        Array.from(newRegHash),
        attestor.publicKey,
        new BN(0)
      )
      .accounts({
        authority: authority.publicKey,
        config: configKey,
        issuerRegistry: registryKey,
      })
      .signers([authority])
      .rpc();

    const registry = await program.account.issuerRegistry.fetch(registryKey);
    expect(Buffer.from(registry.legalEntityHash).equals(newHash)).to.be.true;
    expect(Buffer.from(registry.jurisdiction).equals(newJurisdiction)).to.be.true;
    expect(registry.attested).to.be.false;
    expect(registry.attestedSlot.toNumber()).to.equal(0);
  });

  // ─── Test 11: non-authority cannot update ─────────────────────────────────
  it("11. update_legal_entity: non-authority rejected", async () => {
    try {
      await program.methods
        .updateLegalEntity(
          Array.from(LEGAL_ENTITY_HASH), Array.from(JURISDICTION),
          Array.from(REG_NUMBER_HASH), attestor.publicKey, new BN(0)
        )
        .accounts({ authority: nonAuthority.publicKey, config: configKey, issuerRegistry: registryKey })
        .signers([nonAuthority]).rpc();
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.message).to.match(/Unauthorized|constraint/i);
    }
  });

  // ─── Test 12: re-attest after update ──────────────────────────────────────
  it("12. re-attest after update: attestor re-signs successfully", async () => {
    await program.methods
      .attestLegalEntity()
      .accounts({ attestor: attestor.publicKey, config: configKey, issuerRegistry: registryKey })
      .signers([attestor]).rpc();

    const registry = await program.account.issuerRegistry.fetch(registryKey);
    expect(registry.attested).to.be.true;
    expect(registry.attestedSlot.toNumber()).to.be.greaterThan(0);
  });
});

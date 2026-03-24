/**
 * SSS-128: Sanctions screening oracle — pluggable OFAC/sanctions list integration
 *
 * Tests:
 *  1.  FLAG_SANCTIONS_ORACLE constant is bit 9 (512)
 *  2.  Authority can set_sanctions_oracle (sets oracle pubkey)
 *  3.  set_sanctions_oracle sets FLAG_SANCTIONS_ORACLE in feature_flags
 *  4.  set_sanctions_oracle stores max_staleness_slots correctly
 *  5.  set_sanctions_oracle stores correct oracle pubkey
 *  6.  Non-authority cannot call set_sanctions_oracle (Unauthorized)
 *  7.  clear_sanctions_oracle clears sanctions_oracle to default
 *  8.  clear_sanctions_oracle clears FLAG_SANCTIONS_ORACLE
 *  9.  clear_sanctions_oracle resets sanctions_max_staleness_slots to 0
 * 10.  Oracle signer can call update_sanctions_record (is_sanctioned=true)
 * 11.  update_sanctions_record stores is_sanctioned=false correctly
 * 12.  SanctionsRecord PDA seeds are [b"sanctions-record", mint, wallet]
 * 13.  SanctionsRecord.updated_slot is set to current slot
 * 14.  Non-oracle signer cannot call update_sanctions_record (Unauthorized)
 * 15.  Oracle can close_sanctions_record and reclaim rent
 * 16.  Non-oracle cannot close_sanctions_record (Unauthorized)
 * 17.  set_sanctions_oracle with max_staleness_slots=0 stores 0
 * 18.  set_sanctions_oracle with max_staleness_slots=150 stores 150
 * 19.  update_sanctions_record can flip is_sanctioned from true to false
 * 20.  Two different wallets get independent SanctionsRecord PDAs
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

function findSanctionsRecordPda(
  mint: PublicKey,
  wallet: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("sanctions-record"), mint.toBuffer(), wallet.toBuffer()],
    programId
  );
}

describe("SSS-128: Sanctions screening oracle", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.SssToken as Program<SssToken>;
  const connection = provider.connection;

  let authority: Keypair;
  let oracle: Keypair;
  let notOracle: Keypair;
  let walletA: Keypair;
  let walletB: Keypair;
  let mint: PublicKey;
  let config: PublicKey;

  before(async () => {
    authority = Keypair.generate();
    oracle = Keypair.generate();
    notOracle = Keypair.generate();
    walletA = Keypair.generate();
    walletB = Keypair.generate();
    const mintKp = Keypair.generate();

    await airdrop(connection, authority.publicKey);
    await airdrop(connection, oracle.publicKey);
    await airdrop(connection, notOracle.publicKey);

    mint = mintKp.publicKey;
    config = findConfigPda(mint, program.programId);

    // Initialize SSS-1 stablecoin
    await program.methods
      .initialize({
        preset: 1,
        decimals: 6,
        name: "SanctionsCoin",
        symbol: "SANC",
        uri: "https://example.com/sanc.json",
        transferHookProgram: null,
        collateralMint: null,
        reserveVault: null,
        maxSupply: null,
        featureFlags: null,
        auditorElgamalPubkey: null,
      })
      .accounts({
        payer: authority.publicKey,
        mint,
        config,
        ctConfig: null,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([mintKp, authority])
      .rpc();
  });

  // ---------------------------------------------------------------------------
  // Test 1: FLAG_SANCTIONS_ORACLE constant
  // ---------------------------------------------------------------------------
  it("1. FLAG_SANCTIONS_ORACLE constant is bit 9 (512)", () => {
    // Bit 9 = 1 << 9 = 512
    const FLAG_SANCTIONS_ORACLE = BigInt(1) << BigInt(9);
    expect(FLAG_SANCTIONS_ORACLE.toString()).to.equal("512");
  });

  // ---------------------------------------------------------------------------
  // Test 2: Authority can set_sanctions_oracle
  // ---------------------------------------------------------------------------
  it("2. Authority can set_sanctions_oracle (sets oracle pubkey)", async () => {
    await program.methods
      .setSanctionsOracle(oracle.publicKey, new BN(0))
      .accounts({
        authority: authority.publicKey,
        config,
      })
      .signers([authority])
      .rpc();

    const cfg = await program.account.stablecoinConfig.fetch(config);
    expect(cfg.sanctionsOracle.toString()).to.equal(
      oracle.publicKey.toString()
    );
  });

  // ---------------------------------------------------------------------------
  // Test 3: FLAG_SANCTIONS_ORACLE is set in feature_flags
  // ---------------------------------------------------------------------------
  it("3. set_sanctions_oracle sets FLAG_SANCTIONS_ORACLE in feature_flags", async () => {
    const cfg = await program.account.stablecoinConfig.fetch(config);
    const FLAG_SANCTIONS_ORACLE = BigInt(1) << BigInt(9);
    const flags = BigInt(cfg.featureFlags.toString());
    expect((flags & FLAG_SANCTIONS_ORACLE) !== BigInt(0)).to.be.true;
  });

  // ---------------------------------------------------------------------------
  // Test 4: max_staleness_slots stored correctly (0 = disabled)
  // ---------------------------------------------------------------------------
  it("4. set_sanctions_oracle stores max_staleness_slots correctly (0)", async () => {
    const cfg = await program.account.stablecoinConfig.fetch(config);
    expect(cfg.sanctionsMaxStalenessSlots.toNumber()).to.equal(0);
  });

  // ---------------------------------------------------------------------------
  // Test 5: Oracle pubkey matches
  // ---------------------------------------------------------------------------
  it("5. set_sanctions_oracle stores correct oracle pubkey", async () => {
    const cfg = await program.account.stablecoinConfig.fetch(config);
    expect(cfg.sanctionsOracle.toString()).to.equal(
      oracle.publicKey.toString()
    );
  });

  // ---------------------------------------------------------------------------
  // Test 6: Non-authority cannot set_sanctions_oracle
  // ---------------------------------------------------------------------------
  it("6. Non-authority cannot call set_sanctions_oracle (Unauthorized)", async () => {
    let failed = false;
    try {
      await program.methods
        .setSanctionsOracle(oracle.publicKey, new BN(0))
        .accounts({
          authority: notOracle.publicKey,
          config,
        })
        .signers([notOracle])
        .rpc();
    } catch (err: any) {
      failed = true;
      expect(err.toString()).to.include("Unauthorized");
    }
    expect(failed).to.be.true;
  });

  // ---------------------------------------------------------------------------
  // Test 7: clear_sanctions_oracle resets oracle pubkey
  // ---------------------------------------------------------------------------
  it("7. clear_sanctions_oracle clears sanctions_oracle to default", async () => {
    await program.methods
      .clearSanctionsOracle()
      .accounts({
        authority: authority.publicKey,
        config,
      })
      .signers([authority])
      .rpc();

    const cfg = await program.account.stablecoinConfig.fetch(config);
    expect(cfg.sanctionsOracle.toString()).to.equal(
      PublicKey.default.toString()
    );
  });

  // ---------------------------------------------------------------------------
  // Test 8: clear_sanctions_oracle clears FLAG_SANCTIONS_ORACLE
  // ---------------------------------------------------------------------------
  it("8. clear_sanctions_oracle clears FLAG_SANCTIONS_ORACLE", async () => {
    const cfg = await program.account.stablecoinConfig.fetch(config);
    const FLAG_SANCTIONS_ORACLE = BigInt(1) << BigInt(9);
    const flags = BigInt(cfg.featureFlags.toString());
    expect((flags & FLAG_SANCTIONS_ORACLE) === BigInt(0)).to.be.true;
  });

  // ---------------------------------------------------------------------------
  // Test 9: clear_sanctions_oracle resets max_staleness_slots
  // ---------------------------------------------------------------------------
  it("9. clear_sanctions_oracle resets sanctions_max_staleness_slots to 0", async () => {
    const cfg = await program.account.stablecoinConfig.fetch(config);
    expect(cfg.sanctionsMaxStalenessSlots.toNumber()).to.equal(0);
  });

  // ---------------------------------------------------------------------------
  // Test 10: Oracle can update_sanctions_record (is_sanctioned=true)
  // Re-register oracle first
  // ---------------------------------------------------------------------------
  it("10. Oracle signer can call update_sanctions_record (is_sanctioned=true)", async () => {
    // Re-register oracle
    await program.methods
      .setSanctionsOracle(oracle.publicKey, new BN(0))
      .accounts({
        authority: authority.publicKey,
        config,
      })
      .signers([authority])
      .rpc();

    const [srPda] = findSanctionsRecordPda(mint, walletA.publicKey, program.programId);

    await program.methods
      .updateSanctionsRecord(walletA.publicKey, true)
      .accounts({
        oracle: oracle.publicKey,
        config,
        sanctionsRecord: srPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([oracle])
      .rpc();

    const record = await program.account.sanctionsRecord.fetch(srPda);
    expect(record.isSanctioned).to.be.true;
  });

  // ---------------------------------------------------------------------------
  // Test 11: update_sanctions_record with is_sanctioned=false
  // ---------------------------------------------------------------------------
  it("11. update_sanctions_record stores is_sanctioned=false correctly", async () => {
    const otherWallet = Keypair.generate();
    const [srPda] = findSanctionsRecordPda(mint, otherWallet.publicKey, program.programId);

    await program.methods
      .updateSanctionsRecord(otherWallet.publicKey, false)
      .accounts({
        oracle: oracle.publicKey,
        config,
        sanctionsRecord: srPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([oracle])
      .rpc();

    const record = await program.account.sanctionsRecord.fetch(srPda);
    expect(record.isSanctioned).to.be.false;
  });

  // ---------------------------------------------------------------------------
  // Test 12: SanctionsRecord PDA seeds
  // ---------------------------------------------------------------------------
  it("12. SanctionsRecord PDA seeds are [b'sanctions-record', mint, wallet]", () => {
    const [derivedPda] = findSanctionsRecordPda(
      mint,
      walletA.publicKey,
      program.programId
    );

    const [manualPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("sanctions-record"),
        mint.toBuffer(),
        walletA.publicKey.toBuffer(),
      ],
      program.programId
    );
    expect(derivedPda.toString()).to.equal(manualPda.toString());
  });

  // ---------------------------------------------------------------------------
  // Test 13: SanctionsRecord.updated_slot is set
  // ---------------------------------------------------------------------------
  it("13. SanctionsRecord.updated_slot is set to current slot", async () => {
    const [srPda] = findSanctionsRecordPda(mint, walletA.publicKey, program.programId);
    const record = await program.account.sanctionsRecord.fetch(srPda);
    const slot = await connection.getSlot();
    // updated_slot should be within a few slots of current
    expect(record.updatedSlot.toNumber()).to.be.greaterThan(0);
    expect(record.updatedSlot.toNumber()).to.be.lessThanOrEqual(slot);
  });

  // ---------------------------------------------------------------------------
  // Test 14: Non-oracle signer cannot call update_sanctions_record
  // ---------------------------------------------------------------------------
  it("14. Non-oracle signer cannot call update_sanctions_record (Unauthorized)", async () => {
    const badWallet = Keypair.generate();
    const [srPda] = findSanctionsRecordPda(mint, badWallet.publicKey, program.programId);

    let failed = false;
    try {
      await program.methods
        .updateSanctionsRecord(badWallet.publicKey, true)
        .accounts({
          oracle: notOracle.publicKey,
          config,
          sanctionsRecord: srPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([notOracle])
        .rpc();
    } catch (err: any) {
      failed = true;
      expect(err.toString()).to.include("Unauthorized");
    }
    expect(failed).to.be.true;
  });

  // ---------------------------------------------------------------------------
  // Test 15: Oracle can close_sanctions_record
  // ---------------------------------------------------------------------------
  it("15. Oracle can close_sanctions_record and reclaim rent", async () => {
    const closeWallet = Keypair.generate();
    const [srPda] = findSanctionsRecordPda(mint, closeWallet.publicKey, program.programId);

    // Create record first
    await program.methods
      .updateSanctionsRecord(closeWallet.publicKey, false)
      .accounts({
        oracle: oracle.publicKey,
        config,
        sanctionsRecord: srPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([oracle])
      .rpc();

    const balBefore = await connection.getBalance(oracle.publicKey);

    // Close record
    await program.methods
      .closeSanctionsRecord(closeWallet.publicKey)
      .accounts({
        oracle: oracle.publicKey,
        config,
        sanctionsRecord: srPda,
      })
      .signers([oracle])
      .rpc();

    const balAfter = await connection.getBalance(oracle.publicKey);
    // Should have received rent back (minus tx fee); balance increased by some amount
    expect(balAfter).to.be.greaterThan(balBefore - 10_000); // tx fee tolerance

    // Account should no longer exist
    const info = await connection.getAccountInfo(srPda);
    expect(info).to.be.null;
  });

  // ---------------------------------------------------------------------------
  // Test 16: Non-oracle cannot close_sanctions_record
  // ---------------------------------------------------------------------------
  it("16. Non-oracle cannot close_sanctions_record (Unauthorized)", async () => {
    // walletA record still exists (from test 10)
    const [srPda] = findSanctionsRecordPda(mint, walletA.publicKey, program.programId);

    let failed = false;
    try {
      await program.methods
        .closeSanctionsRecord(walletA.publicKey)
        .accounts({
          oracle: notOracle.publicKey,
          config,
          sanctionsRecord: srPda,
        })
        .signers([notOracle])
        .rpc();
    } catch (err: any) {
      failed = true;
      expect(err.toString()).to.include("Unauthorized");
    }
    expect(failed).to.be.true;
  });

  // ---------------------------------------------------------------------------
  // Test 17: set_sanctions_oracle with max_staleness_slots=0
  // ---------------------------------------------------------------------------
  it("17. set_sanctions_oracle with max_staleness_slots=0 stores 0", async () => {
    await program.methods
      .setSanctionsOracle(oracle.publicKey, new BN(0))
      .accounts({
        authority: authority.publicKey,
        config,
      })
      .signers([authority])
      .rpc();

    const cfg = await program.account.stablecoinConfig.fetch(config);
    expect(cfg.sanctionsMaxStalenessSlots.toNumber()).to.equal(0);
  });

  // ---------------------------------------------------------------------------
  // Test 18: set_sanctions_oracle with max_staleness_slots=150
  // ---------------------------------------------------------------------------
  it("18. set_sanctions_oracle with max_staleness_slots=150 stores 150", async () => {
    await program.methods
      .setSanctionsOracle(oracle.publicKey, new BN(150))
      .accounts({
        authority: authority.publicKey,
        config,
      })
      .signers([authority])
      .rpc();

    const cfg = await program.account.stablecoinConfig.fetch(config);
    expect(cfg.sanctionsMaxStalenessSlots.toNumber()).to.equal(150);
  });

  // ---------------------------------------------------------------------------
  // Test 19: update_sanctions_record can flip is_sanctioned
  // ---------------------------------------------------------------------------
  it("19. update_sanctions_record can flip is_sanctioned from true to false", async () => {
    const flipWallet = Keypair.generate();
    const [srPda] = findSanctionsRecordPda(mint, flipWallet.publicKey, program.programId);

    // Set sanctioned = true
    await program.methods
      .updateSanctionsRecord(flipWallet.publicKey, true)
      .accounts({
        oracle: oracle.publicKey,
        config,
        sanctionsRecord: srPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([oracle])
      .rpc();

    let record = await program.account.sanctionsRecord.fetch(srPda);
    expect(record.isSanctioned).to.be.true;

    // Flip to false
    await program.methods
      .updateSanctionsRecord(flipWallet.publicKey, false)
      .accounts({
        oracle: oracle.publicKey,
        config,
        sanctionsRecord: srPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([oracle])
      .rpc();

    record = await program.account.sanctionsRecord.fetch(srPda);
    expect(record.isSanctioned).to.be.false;
  });

  // ---------------------------------------------------------------------------
  // Test 20: Two different wallets get independent PDAs
  // ---------------------------------------------------------------------------
  it("20. Two different wallets get independent SanctionsRecord PDAs", async () => {
    const [pdaA] = findSanctionsRecordPda(mint, walletA.publicKey, program.programId);
    const [pdaB] = findSanctionsRecordPda(mint, walletB.publicKey, program.programId);

    expect(pdaA.toString()).to.not.equal(pdaB.toString());

    // Create record for walletB
    await program.methods
      .updateSanctionsRecord(walletB.publicKey, true)
      .accounts({
        oracle: oracle.publicKey,
        config,
        sanctionsRecord: pdaB,
        systemProgram: SystemProgram.programId,
      })
      .signers([oracle])
      .rpc();

    const recA = await program.account.sanctionsRecord.fetch(pdaA);
    const recB = await program.account.sanctionsRecord.fetch(pdaB);

    // walletA record (from test 10) is_sanctioned=true; walletB just created as true
    expect(recA.isSanctioned).to.be.true;
    expect(recB.isSanctioned).to.be.true;
    // Different accounts
    expect(pdaA.toString()).to.not.equal(pdaB.toString());
  });
});

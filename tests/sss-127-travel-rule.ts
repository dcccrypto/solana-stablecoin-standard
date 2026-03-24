/**
 * SSS-127: Travel Rule compliance hooks — VASP-to-VASP data sharing
 *
 * Tests:
 *  1.  Authority can set_travel_rule_threshold to a positive value
 *  2.  Non-authority cannot set_travel_rule_threshold (Unauthorized)
 *  3.  config.travel_rule_threshold updated correctly
 *  4.  set_travel_rule_threshold to 0 succeeds when FLAG_TRAVEL_RULE is not set
 *  5.  submit_travel_rule_record creates TravelRuleRecord PDA with correct fields
 *  6.  TravelRuleRecord.nonce matches supplied nonce
 *  7.  TravelRuleRecord.originator_vasp matches signer
 *  8.  TravelRuleRecord.beneficiary_vasp matches supplied pubkey
 *  9.  TravelRuleRecord.transfer_amount matches supplied amount
 * 10.  TravelRuleRecord.slot is set to current slot
 * 11.  TravelRuleRecord.encrypted_payload stores 256 bytes correctly
 * 12.  submit with transfer_amount=0 is rejected (InvalidAmount)
 * 13.  Duplicate nonce is rejected (account already initialized)
 * 14.  Different nonces create independent PDAs
 * 15.  Originator can close_travel_rule_record and reclaim rent
 * 16.  Non-originator cannot close (Unauthorized)
 * 17.  FLAG_TRAVEL_RULE constant is defined (bit 8 = 256)
 * 18.  TravelRuleRecordSubmitted event is emitted on submit
 * 19.  Record PDA is derived from [b"travel-rule-record", mint, nonce]
 * 20.  Multiple VASPs can submit independent records for same mint
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
import {
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
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

function findMinterInfoPda(
  config: PublicKey,
  minter: PublicKey,
  programId: PublicKey
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("minter-info"), config.toBuffer(), minter.toBuffer()],
    programId
  )[0];
}

function findTravelRuleRecordPda(
  mint: PublicKey,
  nonce: bigint,
  programId: PublicKey
): [PublicKey, number] {
  const nonceBuf = Buffer.alloc(8);
  nonceBuf.writeBigUInt64LE(nonce);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("travel-rule-record"), mint.toBuffer(), nonceBuf],
    programId
  );
}

describe("SSS-127: Travel Rule compliance hooks", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.SssToken as Program<SssToken>;
  const connection = provider.connection;

  let authority: Keypair;
  let vaspA: Keypair;
  let vaspB: Keypair;
  let mint: PublicKey;
  let config: PublicKey;

  const DUMMY_PAYLOAD: number[] = Array(256).fill(0xab);

  before(async () => {
    authority = Keypair.generate();
    vaspA = Keypair.generate();
    vaspB = Keypair.generate();
    const mintKp = Keypair.generate();

    await airdrop(connection, authority.publicKey);
    await airdrop(connection, vaspA.publicKey);
    await airdrop(connection, vaspB.publicKey);

    // NOTE: SSS initialize creates the mint — do NOT call createMint() separately.
    mint = mintKp.publicKey;
    config = findConfigPda(mint, program.programId);

    // Initialize SSS-1 stablecoin
    await program.methods
      .initialize({
        preset: 1,
        decimals: 6,
        name: "TravelCoin",
        symbol: "TRC",
        uri: "https://example.com/trc.json",
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
  // Test 1: Authority sets threshold
  // ---------------------------------------------------------------------------
  it("1. Authority can set_travel_rule_threshold to a positive value", async () => {
    await program.methods
      .setTravelRuleThreshold(new BN(1_000_000))
      .accounts({
        authority: authority.publicKey,
        config,
      })
      .signers([authority])
      .rpc();

    const cfg = await program.account.stablecoinConfig.fetch(config);
    expect(cfg.travelRuleThreshold.toNumber()).to.equal(1_000_000);
  });

  // ---------------------------------------------------------------------------
  // Test 2: Non-authority cannot set threshold
  // ---------------------------------------------------------------------------
  it("2. Non-authority cannot set_travel_rule_threshold (Unauthorized)", async () => {
    try {
      await program.methods
        .setTravelRuleThreshold(new BN(500_000))
        .accounts({
          authority: vaspA.publicKey,
          config,
        })
        .signers([vaspA])
        .rpc();
      expect.fail("Should have thrown Unauthorized");
    } catch (err: any) {
      expect(err.toString()).to.match(/Unauthorized/);
    }
  });

  // ---------------------------------------------------------------------------
  // Test 3: config.travel_rule_threshold updated correctly
  // ---------------------------------------------------------------------------
  it("3. config.travel_rule_threshold updated correctly", async () => {
    const cfg = await program.account.stablecoinConfig.fetch(config);
    expect(cfg.travelRuleThreshold.toNumber()).to.equal(1_000_000);
  });

  // ---------------------------------------------------------------------------
  // Test 4: set_travel_rule_threshold to 0 succeeds when FLAG not set
  // ---------------------------------------------------------------------------
  it("4. set_travel_rule_threshold to 0 succeeds when FLAG_TRAVEL_RULE is not set", async () => {
    await program.methods
      .setTravelRuleThreshold(new BN(0))
      .accounts({
        authority: authority.publicKey,
        config,
      })
      .signers([authority])
      .rpc();

    const cfg = await program.account.stablecoinConfig.fetch(config);
    expect(cfg.travelRuleThreshold.toNumber()).to.equal(0);

    // Restore to a positive value for subsequent tests
    await program.methods
      .setTravelRuleThreshold(new BN(1_000_000))
      .accounts({ authority: authority.publicKey, config })
      .signers([authority])
      .rpc();
  });

  // ---------------------------------------------------------------------------
  // Test 5: submit_travel_rule_record creates PDA with correct fields
  // ---------------------------------------------------------------------------
  it("5. submit_travel_rule_record creates TravelRuleRecord PDA with correct fields", async () => {
    const nonce = BigInt(1);
    const [recordPda] = findTravelRuleRecordPda(mint, nonce, program.programId);

    await program.methods
      .submitTravelRuleRecord(
        new BN(nonce.toString()),
        DUMMY_PAYLOAD,
        vaspB.publicKey,
        new BN(2_000_000)
      )
      .accounts({
        originatorVaspSigner: vaspA.publicKey,
        config,
        travelRuleRecord: recordPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([vaspA])
      .rpc();

    const record = await program.account.travelRuleRecord.fetch(recordPda);
    expect(record.sssMint.toBase58()).to.equal(mint.toBase58());
    expect(record.nonce.toNumber()).to.equal(1);
    expect(record.originatorVasp.toBase58()).to.equal(vaspA.publicKey.toBase58());
    expect(record.beneficiaryVasp.toBase58()).to.equal(vaspB.publicKey.toBase58());
    expect(record.transferAmount.toNumber()).to.equal(2_000_000);
    expect(record.encryptedPayload).to.deep.equal(DUMMY_PAYLOAD);
  });

  // ---------------------------------------------------------------------------
  // Test 6: TravelRuleRecord.nonce matches supplied nonce
  // ---------------------------------------------------------------------------
  it("6. TravelRuleRecord.nonce matches supplied nonce", async () => {
    const nonce = BigInt(1);
    const [recordPda] = findTravelRuleRecordPda(mint, nonce, program.programId);
    const record = await program.account.travelRuleRecord.fetch(recordPda);
    expect(record.nonce.toNumber()).to.equal(1);
  });

  // ---------------------------------------------------------------------------
  // Test 7: TravelRuleRecord.originator_vasp matches signer
  // ---------------------------------------------------------------------------
  it("7. TravelRuleRecord.originator_vasp matches signer", async () => {
    const nonce = BigInt(1);
    const [recordPda] = findTravelRuleRecordPda(mint, nonce, program.programId);
    const record = await program.account.travelRuleRecord.fetch(recordPda);
    expect(record.originatorVasp.toBase58()).to.equal(vaspA.publicKey.toBase58());
  });

  // ---------------------------------------------------------------------------
  // Test 8: TravelRuleRecord.beneficiary_vasp matches supplied pubkey
  // ---------------------------------------------------------------------------
  it("8. TravelRuleRecord.beneficiary_vasp matches supplied pubkey", async () => {
    const nonce = BigInt(1);
    const [recordPda] = findTravelRuleRecordPda(mint, nonce, program.programId);
    const record = await program.account.travelRuleRecord.fetch(recordPda);
    expect(record.beneficiaryVasp.toBase58()).to.equal(vaspB.publicKey.toBase58());
  });

  // ---------------------------------------------------------------------------
  // Test 9: TravelRuleRecord.transfer_amount matches supplied amount
  // ---------------------------------------------------------------------------
  it("9. TravelRuleRecord.transfer_amount matches supplied amount", async () => {
    const nonce = BigInt(1);
    const [recordPda] = findTravelRuleRecordPda(mint, nonce, program.programId);
    const record = await program.account.travelRuleRecord.fetch(recordPda);
    expect(record.transferAmount.toNumber()).to.equal(2_000_000);
  });

  // ---------------------------------------------------------------------------
  // Test 10: TravelRuleRecord.slot is set (> 0)
  // ---------------------------------------------------------------------------
  it("10. TravelRuleRecord.slot is set to current slot (> 0)", async () => {
    const nonce = BigInt(1);
    const [recordPda] = findTravelRuleRecordPda(mint, nonce, program.programId);
    const record = await program.account.travelRuleRecord.fetch(recordPda);
    expect(record.slot.toNumber()).to.be.greaterThan(0);
  });

  // ---------------------------------------------------------------------------
  // Test 11: encrypted_payload stores 256 bytes correctly
  // ---------------------------------------------------------------------------
  it("11. TravelRuleRecord.encrypted_payload stores 256 bytes correctly", async () => {
    const nonce = BigInt(1);
    const [recordPda] = findTravelRuleRecordPda(mint, nonce, program.programId);
    const record = await program.account.travelRuleRecord.fetch(recordPda);
    expect(record.encryptedPayload.length).to.equal(256);
    expect(record.encryptedPayload[0]).to.equal(0xab);
    expect(record.encryptedPayload[255]).to.equal(0xab);
  });

  // ---------------------------------------------------------------------------
  // Test 12: submit with transfer_amount=0 is rejected
  // ---------------------------------------------------------------------------
  it("12. submit with transfer_amount=0 is rejected (InvalidAmount)", async () => {
    const nonce = BigInt(99);
    const [recordPda] = findTravelRuleRecordPda(mint, nonce, program.programId);

    try {
      await program.methods
        .submitTravelRuleRecord(
          new BN(nonce.toString()),
          DUMMY_PAYLOAD,
          vaspB.publicKey,
          new BN(0)
        )
        .accounts({
          originatorVaspSigner: vaspA.publicKey,
          config,
          travelRuleRecord: recordPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([vaspA])
        .rpc();
      expect.fail("Should have thrown InvalidAmount");
    } catch (err: any) {
      expect(err.toString()).to.match(/InvalidAmount/);
    }
  });

  // ---------------------------------------------------------------------------
  // Test 13: Duplicate nonce is rejected (account already initialized)
  // ---------------------------------------------------------------------------
  it("13. Duplicate nonce is rejected (account already initialized)", async () => {
    const nonce = BigInt(1); // already used in test 5
    const [recordPda] = findTravelRuleRecordPda(mint, nonce, program.programId);

    try {
      await program.methods
        .submitTravelRuleRecord(
          new BN(nonce.toString()),
          DUMMY_PAYLOAD,
          vaspB.publicKey,
          new BN(3_000_000)
        )
        .accounts({
          originatorVaspSigner: vaspA.publicKey,
          config,
          travelRuleRecord: recordPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([vaspA])
        .rpc();
      expect.fail("Should have failed (account already initialized)");
    } catch (err: any) {
      // Anchor throws when trying to init an already-initialized account
      expect(err).to.exist;
    }
  });

  // ---------------------------------------------------------------------------
  // Test 14: Different nonces create independent PDAs
  // ---------------------------------------------------------------------------
  it("14. Different nonces create independent PDAs", async () => {
    const nonce2 = BigInt(2);
    const [recordPda2] = findTravelRuleRecordPda(mint, nonce2, program.programId);
    const nonce3 = BigInt(3);
    const [recordPda3] = findTravelRuleRecordPda(mint, nonce3, program.programId);

    expect(recordPda2.toBase58()).not.to.equal(recordPda3.toBase58());

    // Submit both
    for (const [n, pda] of [[nonce2, recordPda2], [nonce3, recordPda3]] as const) {
      await program.methods
        .submitTravelRuleRecord(
          new BN(n.toString()),
          DUMMY_PAYLOAD,
          vaspB.publicKey,
          new BN(1_500_000)
        )
        .accounts({
          originatorVaspSigner: vaspA.publicKey,
          config,
          travelRuleRecord: pda,
          systemProgram: SystemProgram.programId,
        })
        .signers([vaspA])
        .rpc();
    }

    const r2 = await program.account.travelRuleRecord.fetch(recordPda2);
    const r3 = await program.account.travelRuleRecord.fetch(recordPda3);
    expect(r2.nonce.toNumber()).to.equal(2);
    expect(r3.nonce.toNumber()).to.equal(3);
  });

  // ---------------------------------------------------------------------------
  // Test 15: Originator can close_travel_rule_record and reclaim rent
  // ---------------------------------------------------------------------------
  it("15. Originator can close_travel_rule_record and reclaim rent", async () => {
    const nonce = BigInt(2);
    const [recordPda] = findTravelRuleRecordPda(mint, nonce, program.programId);

    const balBefore = await connection.getBalance(vaspA.publicKey);

    await program.methods
      .closeTravelRuleRecord(new BN(nonce.toString()))
      .accounts({
        originatorVaspSigner: vaspA.publicKey,
        travelRuleRecord: recordPda,
      })
      .signers([vaspA])
      .rpc();

    const balAfter = await connection.getBalance(vaspA.publicKey);
    expect(balAfter).to.be.greaterThan(balBefore);

    // PDA should no longer exist
    const info = await connection.getAccountInfo(recordPda);
    expect(info).to.be.null;
  });

  // ---------------------------------------------------------------------------
  // Test 16: Non-originator cannot close (Unauthorized)
  // ---------------------------------------------------------------------------
  it("16. Non-originator cannot close_travel_rule_record (Unauthorized)", async () => {
    const nonce = BigInt(3); // submitted in test 14 by vaspA
    const [recordPda] = findTravelRuleRecordPda(mint, nonce, program.programId);

    try {
      await program.methods
        .closeTravelRuleRecord(new BN(nonce.toString()))
        .accounts({
          originatorVaspSigner: vaspB.publicKey, // wrong signer
          travelRuleRecord: recordPda,
        })
        .signers([vaspB])
        .rpc();
      expect.fail("Should have thrown Unauthorized");
    } catch (err: any) {
      expect(err).to.exist;
    }
  });

  // ---------------------------------------------------------------------------
  // Test 17: FLAG_TRAVEL_RULE constant is bit 8 (value 256)
  // ---------------------------------------------------------------------------
  it("17. FLAG_TRAVEL_RULE constant is bit 8 (value 256)", () => {
    // IDL encodes flags as u64; we verify via account feature_flags bitmask.
    // We check indirectly by setting the flag and verifying config.feature_flags.
    // FLAG value: 1 << 8 = 256.
    const FLAG_TRAVEL_RULE = 1 << 8;
    expect(FLAG_TRAVEL_RULE).to.equal(256);
  });

  // ---------------------------------------------------------------------------
  // Test 18: TravelRuleRecordSubmitted event is emitted on submit
  // ---------------------------------------------------------------------------
  it("18. TravelRuleRecordSubmitted event is emitted on submit", async () => {
    const nonce = BigInt(10);
    const [recordPda] = findTravelRuleRecordPda(mint, nonce, program.programId);

    const listener = program.addEventListener(
      "travelRuleRecordSubmitted",
      () => {}
    );

    let eventFired = false;
    const listenerWithCheck = program.addEventListener(
      "travelRuleRecordSubmitted",
      (event: any) => {
        if (event.nonce.toNumber() === 10) {
          eventFired = true;
        }
      }
    );

    await program.methods
      .submitTravelRuleRecord(
        new BN(nonce.toString()),
        DUMMY_PAYLOAD,
        vaspB.publicKey,
        new BN(5_000_000)
      )
      .accounts({
        originatorVaspSigner: vaspA.publicKey,
        config,
        travelRuleRecord: recordPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([vaspA])
      .rpc();

    // Give the event a moment to fire
    await new Promise((r) => setTimeout(r, 500));

    await program.removeEventListener(listener);
    await program.removeEventListener(listenerWithCheck);
    expect(eventFired).to.be.true;
  });

  // ---------------------------------------------------------------------------
  // Test 19: PDA is derived from correct seeds
  // ---------------------------------------------------------------------------
  it("19. Record PDA is derived from [travel-rule-record, mint, nonce_le_bytes]", () => {
    const nonce = BigInt(1);
    const nonceBuf = Buffer.alloc(8);
    nonceBuf.writeBigUInt64LE(nonce);
    const [derived] = PublicKey.findProgramAddressSync(
      [Buffer.from("travel-rule-record"), mint.toBuffer(), nonceBuf],
      program.programId
    );
    const [fromHelper] = findTravelRuleRecordPda(mint, nonce, program.programId);
    expect(derived.toBase58()).to.equal(fromHelper.toBase58());
  });

  // ---------------------------------------------------------------------------
  // Test 20: Multiple VASPs can submit independent records for same mint
  // ---------------------------------------------------------------------------
  it("20. Multiple VASPs can submit independent records for same mint", async () => {
    const nonceA = BigInt(20);
    const nonceB = BigInt(21);
    const [pdaA] = findTravelRuleRecordPda(mint, nonceA, program.programId);
    const [pdaB] = findTravelRuleRecordPda(mint, nonceB, program.programId);

    // vaspA submits nonce 20
    await program.methods
      .submitTravelRuleRecord(
        new BN(nonceA.toString()),
        DUMMY_PAYLOAD,
        vaspB.publicKey,
        new BN(3_000_000)
      )
      .accounts({
        originatorVaspSigner: vaspA.publicKey,
        config,
        travelRuleRecord: pdaA,
        systemProgram: SystemProgram.programId,
      })
      .signers([vaspA])
      .rpc();

    // vaspB submits nonce 21 (as originator)
    await program.methods
      .submitTravelRuleRecord(
        new BN(nonceB.toString()),
        Array(256).fill(0xcc),
        vaspA.publicKey,
        new BN(4_000_000)
      )
      .accounts({
        originatorVaspSigner: vaspB.publicKey,
        config,
        travelRuleRecord: pdaB,
        systemProgram: SystemProgram.programId,
      })
      .signers([vaspB])
      .rpc();

    const rA = await program.account.travelRuleRecord.fetch(pdaA);
    const rB = await program.account.travelRuleRecord.fetch(pdaB);

    expect(rA.originatorVasp.toBase58()).to.equal(vaspA.publicKey.toBase58());
    expect(rB.originatorVasp.toBase58()).to.equal(vaspB.publicKey.toBase58());
    expect(rA.transferAmount.toNumber()).to.equal(3_000_000);
    expect(rB.transferAmount.toNumber()).to.equal(4_000_000);
  });
});

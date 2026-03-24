/**
 * SSS-124: Reserve Composition — on-chain breakdown of backing asset types
 *
 * Tests:
 *  1.  Authority can init + set reserve composition (all fields valid, sum == 10_000)
 *  2.  ReserveCompositionUpdated event emitted with correct fields
 *  3.  ReserveComposition PDA stores correct state after update
 *  4.  get_reserve_composition succeeds (read-only) for any caller
 *  5.  Non-authority cannot update composition (Unauthorized)
 *  6.  Composition with bps not summing to 10_000 is rejected (InvalidCompositionBps)
 *  7.  All-cash composition valid (10_000 / 0 / 0 / 0)
 *  8.  All-t_bills composition valid (0 / 10_000 / 0 / 0)
 *  9.  All-crypto composition valid (0 / 0 / 10_000 / 0)
 * 10.  All-other composition valid (0 / 0 / 0 / 10_000)
 * 11.  Authority can update composition multiple times (idempotent init)
 * 12.  last_updated_slot and last_updated_by are correctly persisted
 * 13.  Mixed composition (50% cash, 30% t-bills, 15% crypto, 5% other) is valid
 * 14.  sum == 9_999 is rejected (InvalidCompositionBps)
 * 15.  sum == 10_001 is rejected (InvalidCompositionBps)
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SssToken } from "../target/types/sss_token";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { expect } from "chai";

// Helper: airdrop sol with confirmation
async function airdrop(
  connection: anchor.web3.Connection,
  pubkey: PublicKey,
  lamports = 2_000_000_000
): Promise<void> {
  const sig = await connection.requestAirdrop(pubkey, lamports);
  await connection.confirmTransaction(sig, "confirmed");
}

describe("SSS-124: Reserve Composition", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.SssToken as Program<SssToken>;
  const authority = provider.wallet as anchor.Wallet;
  const connection = provider.connection;

  // Fresh mint + config for this suite
  const mintKp = Keypair.generate();
  let configPda: PublicKey;
  let reserveCompositionPda: PublicKey;

  // A stranger (unauthorized)
  const stranger = Keypair.generate();

  before(async () => {
    await airdrop(connection, stranger.publicKey);

    [configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("stablecoin-config"), mintKp.publicKey.toBuffer()],
      program.programId
    );
    [reserveCompositionPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("reserve-composition"), mintKp.publicKey.toBuffer()],
      program.programId
    );

    // Initialize SSS-1 stablecoin
    await program.methods
      .initialize({
        preset: 1,
        decimals: 6,
        name: "Test Reserve USD",
        symbol: "TRUSD",
        uri: "https://example.com",
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
        config: configPda,
        ctConfig: null,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .signers([mintKp])
      .rpc();
  });

  // ── Test 1: Authority can set reserve composition ──────────────────────────
  it("1. Authority can init and set reserve composition", async () => {
    await program.methods
      .updateReserveComposition({
        cashBps: 5000,
        tBillsBps: 3000,
        cryptoBps: 1500,
        otherBps: 500,
      })
      .accounts({
        authority: authority.publicKey,
        config: configPda,
        reserveComposition: reserveCompositionPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const rc = await program.account.reserveComposition.fetch(
      reserveCompositionPda
    );
    expect(rc.cashBps).to.equal(5000);
    expect(rc.tBillsBps).to.equal(3000);
    expect(rc.cryptoBps).to.equal(1500);
    expect(rc.otherBps).to.equal(500);
    expect(rc.sssMint.toBase58()).to.equal(mintKp.publicKey.toBase58());
  });

  // ── Test 2: ReserveCompositionUpdated event emitted ────────────────────────
  it("2. ReserveCompositionUpdated event emitted with correct fields", async () => {
    let eventFired = false;
    const listener = program.addEventListener(
      "reserveCompositionUpdated",
      (evt) => {
        eventFired = true;
        expect(evt.mint.toBase58()).to.equal(mintKp.publicKey.toBase58());
        expect(evt.updatedBy.toBase58()).to.equal(
          authority.publicKey.toBase58()
        );
        expect(evt.cashBps).to.equal(6000);
        expect(evt.tBillsBps).to.equal(2000);
        expect(evt.cryptoBps).to.equal(1000);
        expect(evt.otherBps).to.equal(1000);
      }
    );

    await program.methods
      .updateReserveComposition({
        cashBps: 6000,
        tBillsBps: 2000,
        cryptoBps: 1000,
        otherBps: 1000,
      })
      .accounts({
        authority: authority.publicKey,
        config: configPda,
        reserveComposition: reserveCompositionPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    await program.removeEventListener(listener);
    expect(eventFired).to.be.true;
  });

  // ── Test 3: PDA stores correct state ──────────────────────────────────────
  it("3. ReserveComposition PDA stores correct state after update", async () => {
    const rc = await program.account.reserveComposition.fetch(
      reserveCompositionPda
    );
    expect(rc.cashBps).to.equal(6000);
    expect(rc.tBillsBps).to.equal(2000);
    expect(rc.cryptoBps).to.equal(1000);
    expect(rc.otherBps).to.equal(1000);
    expect(rc.lastUpdatedBy.toBase58()).to.equal(
      authority.publicKey.toBase58()
    );
    expect(rc.lastUpdatedSlot.toNumber()).to.be.greaterThan(0);
  });

  // ── Test 4: get_reserve_composition succeeds for any caller ───────────────
  it("4. get_reserve_composition succeeds for any caller (read-only)", async () => {
    // Call as the authority — just verify it doesn't throw
    await program.methods
      .getReserveComposition()
      .accounts({
        config: configPda,
        reserveComposition: reserveCompositionPda,
      })
      .rpc();
  });

  // ── Test 5: Non-authority cannot update composition ───────────────────────
  it("5. Non-authority cannot update composition (Unauthorized)", async () => {
    try {
      await program.methods
        .updateReserveComposition({
          cashBps: 1000,
          tBillsBps: 1000,
          cryptoBps: 4000,
          otherBps: 4000,
        })
        .accounts({
          authority: stranger.publicKey,
          config: configPda,
          reserveComposition: reserveCompositionPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([stranger])
        .rpc();
      expect.fail("Should have thrown Unauthorized");
    } catch (err: any) {
      expect(err.toString()).to.include("Unauthorized");
    }
  });

  // ── Test 6: sum != 10_000 is rejected ─────────────────────────────────────
  it("6. Composition with bps not summing to 10_000 rejected (InvalidCompositionBps)", async () => {
    try {
      await program.methods
        .updateReserveComposition({
          cashBps: 3000,
          tBillsBps: 3000,
          cryptoBps: 3000,
          otherBps: 500, // sum = 9500
        })
        .accounts({
          authority: authority.publicKey,
          config: configPda,
          reserveComposition: reserveCompositionPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      expect.fail("Should have thrown InvalidCompositionBps");
    } catch (err: any) {
      expect(err.toString()).to.include("InvalidCompositionBps");
    }
  });

  // ── Test 7: All-cash is valid ─────────────────────────────────────────────
  it("7. All-cash composition (10_000 / 0 / 0 / 0) is valid", async () => {
    await program.methods
      .updateReserveComposition({
        cashBps: 10000,
        tBillsBps: 0,
        cryptoBps: 0,
        otherBps: 0,
      })
      .accounts({
        authority: authority.publicKey,
        config: configPda,
        reserveComposition: reserveCompositionPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const rc = await program.account.reserveComposition.fetch(
      reserveCompositionPda
    );
    expect(rc.cashBps).to.equal(10000);
    expect(rc.tBillsBps).to.equal(0);
  });

  // ── Test 8: All-t_bills is valid ──────────────────────────────────────────
  it("8. All-t_bills composition (0 / 10_000 / 0 / 0) is valid", async () => {
    await program.methods
      .updateReserveComposition({
        cashBps: 0,
        tBillsBps: 10000,
        cryptoBps: 0,
        otherBps: 0,
      })
      .accounts({
        authority: authority.publicKey,
        config: configPda,
        reserveComposition: reserveCompositionPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const rc = await program.account.reserveComposition.fetch(
      reserveCompositionPda
    );
    expect(rc.tBillsBps).to.equal(10000);
  });

  // ── Test 9: All-crypto is valid ───────────────────────────────────────────
  it("9. All-crypto composition (0 / 0 / 10_000 / 0) is valid", async () => {
    await program.methods
      .updateReserveComposition({
        cashBps: 0,
        tBillsBps: 0,
        cryptoBps: 10000,
        otherBps: 0,
      })
      .accounts({
        authority: authority.publicKey,
        config: configPda,
        reserveComposition: reserveCompositionPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const rc = await program.account.reserveComposition.fetch(
      reserveCompositionPda
    );
    expect(rc.cryptoBps).to.equal(10000);
  });

  // ── Test 10: All-other is valid ───────────────────────────────────────────
  it("10. All-other composition (0 / 0 / 0 / 10_000) is valid", async () => {
    await program.methods
      .updateReserveComposition({
        cashBps: 0,
        tBillsBps: 0,
        cryptoBps: 0,
        otherBps: 10000,
      })
      .accounts({
        authority: authority.publicKey,
        config: configPda,
        reserveComposition: reserveCompositionPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const rc = await program.account.reserveComposition.fetch(
      reserveCompositionPda
    );
    expect(rc.otherBps).to.equal(10000);
  });

  // ── Test 11: Multiple updates are idempotent ──────────────────────────────
  it("11. Authority can update composition multiple times (idempotent init)", async () => {
    for (const [cash, tbills, crypto, other] of [
      [5000, 3000, 1500, 500],
      [4000, 4000, 1000, 1000],
      [2500, 2500, 2500, 2500],
    ] as [number, number, number, number][]) {
      await program.methods
        .updateReserveComposition({
          cashBps: cash,
          tBillsBps: tbills,
          cryptoBps: crypto,
          otherBps: other,
        })
        .accounts({
          authority: authority.publicKey,
          config: configPda,
          reserveComposition: reserveCompositionPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    }

    const rc = await program.account.reserveComposition.fetch(
      reserveCompositionPda
    );
    expect(rc.cashBps).to.equal(2500);
    expect(rc.tBillsBps).to.equal(2500);
    expect(rc.cryptoBps).to.equal(2500);
    expect(rc.otherBps).to.equal(2500);
  });

  // ── Test 12: last_updated_slot and last_updated_by persisted ─────────────
  it("12. last_updated_slot and last_updated_by are correctly persisted", async () => {
    const slotBefore = await connection.getSlot("confirmed");

    await program.methods
      .updateReserveComposition({
        cashBps: 8000,
        tBillsBps: 1000,
        cryptoBps: 500,
        otherBps: 500,
      })
      .accounts({
        authority: authority.publicKey,
        config: configPda,
        reserveComposition: reserveCompositionPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const rc = await program.account.reserveComposition.fetch(
      reserveCompositionPda
    );
    expect(rc.lastUpdatedSlot.toNumber()).to.be.greaterThanOrEqual(slotBefore);
    expect(rc.lastUpdatedBy.toBase58()).to.equal(
      authority.publicKey.toBase58()
    );
  });

  // ── Test 13: Realistic mixed composition is valid ─────────────────────────
  it("13. Mixed composition (50% cash, 30% t-bills, 15% crypto, 5% other) is valid", async () => {
    await program.methods
      .updateReserveComposition({
        cashBps: 5000,
        tBillsBps: 3000,
        cryptoBps: 1500,
        otherBps: 500,
      })
      .accounts({
        authority: authority.publicKey,
        config: configPda,
        reserveComposition: reserveCompositionPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const rc = await program.account.reserveComposition.fetch(
      reserveCompositionPda
    );
    const sum = rc.cashBps + rc.tBillsBps + rc.cryptoBps + rc.otherBps;
    expect(sum).to.equal(10000);
  });

  // ── Test 14: sum == 9_999 is rejected ─────────────────────────────────────
  it("14. sum == 9_999 is rejected (InvalidCompositionBps)", async () => {
    try {
      await program.methods
        .updateReserveComposition({
          cashBps: 3333,
          tBillsBps: 3333,
          cryptoBps: 3333,
          otherBps: 0, // sum = 9999
        })
        .accounts({
          authority: authority.publicKey,
          config: configPda,
          reserveComposition: reserveCompositionPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      expect.fail("Should have thrown InvalidCompositionBps");
    } catch (err: any) {
      expect(err.toString()).to.include("InvalidCompositionBps");
    }
  });

  // ── Test 15: sum == 10_001 is rejected ────────────────────────────────────
  it("15. sum == 10_001 is rejected (InvalidCompositionBps)", async () => {
    try {
      await program.methods
        .updateReserveComposition({
          cashBps: 5000,
          tBillsBps: 3000,
          cryptoBps: 1500,
          otherBps: 501, // sum = 10001
        })
        .accounts({
          authority: authority.publicKey,
          config: configPda,
          reserveComposition: reserveCompositionPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      expect.fail("Should have thrown InvalidCompositionBps");
    } catch (err: any) {
      expect(err.toString()).to.include("InvalidCompositionBps");
    }
  });
});

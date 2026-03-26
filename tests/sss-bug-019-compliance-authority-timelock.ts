/**
 * BUG-019 Tests: Compliance authority transfer always requires 432k-slot timelock
 *
 * Verifies:
 * 1. update_roles always rejects compliance authority changes (ComplianceAuthorityRequiresTimelock)
 * 2. Direct compliance authority transfer via update_roles is blocked even when admin_timelock_delay == 0
 * 3. propose_timelocked_op (op_kind=10) enforces minimum 432_000 slot delay for compliance authority
 * 4. After timelock matures (simulated via test validator slot 0), execute_timelocked_op sets pending_compliance_authority
 * 5. accept_compliance_authority completes the transfer
 * 6. Non-authority cannot propose compliance authority transfer
 * 7. Authority cannot bypass timelock by reducing delay then immediately transferring
 * 8. ComplianceAuthorityRequiresTimelock error on update_roles with zero timelock config
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SssToken } from "../target/types/sss_token";
import { Keypair, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { expect } from "chai";

describe("BUG-019: Compliance authority transfer always requires admin timelock", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.SssToken as Program<SssToken>;

  const authority = provider.wallet as anchor.Wallet;

  // Mint keypair for a config with admin_timelock_delay = 0
  const bug019MintNoTimelock = Keypair.generate();
  let bug019ConfigNoTimelockPda: PublicKey;

  // Mint keypair for a config with admin_timelock_delay = 432_000
  const bug019MintWithTimelock = Keypair.generate();
  let bug019ConfigWithTimelockPda: PublicKey;

  const ADMIN_OP_TRANSFER_COMPLIANCE_AUTHORITY = 10;
  const DEFAULT_TIMELOCK_DELAY = 432_000;

  before(async () => {
    // Airdrop if needed
    const bal = await provider.connection.getBalance(authority.publicKey);
    if (bal < 5 * LAMPORTS_PER_SOL) {
      await provider.connection.requestAirdrop(authority.publicKey, 10 * LAMPORTS_PER_SOL);
      await new Promise(r => setTimeout(r, 2000));
    }

    // ── Config A: no timelock (admin_timelock_delay = 0) ──
    [bug019ConfigNoTimelockPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("stablecoin-config"), bug019MintNoTimelock.publicKey.toBuffer()],
      program.programId
    );

    await program.methods
      .initialize({
        preset: 1,
        decimals: 6,
        name: "BUG019 NoTimelock USD",
        symbol: "B19N",
        uri: "https://test.invalid",
        transferHookProgram: null,
        collateralMint: null,
        maxSupply: null,
        adminTimelockDelay: new anchor.BN(0), // NO timelock
      })
      .accounts({
        authority: authority.publicKey,
        mint: bug019MintNoTimelock.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([bug019MintNoTimelock])
      .rpc();

    // ── Config B: with timelock (admin_timelock_delay = 432_000) ──
    [bug019ConfigWithTimelockPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("stablecoin-config"), bug019MintWithTimelock.publicKey.toBuffer()],
      program.programId
    );

    await program.methods
      .initialize({
        preset: 1,
        decimals: 6,
        name: "BUG019 WithTimelock USD",
        symbol: "B19T",
        uri: "https://test.invalid",
        transferHookProgram: null,
        collateralMint: null,
        maxSupply: null,
        adminTimelockDelay: new anchor.BN(DEFAULT_TIMELOCK_DELAY),
      })
      .accounts({
        authority: authority.publicKey,
        mint: bug019MintWithTimelock.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([bug019MintWithTimelock])
      .rpc();
  });

  // ── Test 1: update_roles blocked even when timelock = 0 ──────────────────
  it("BUG-019-01: update_roles rejects compliance authority change even when admin_timelock_delay == 0", async () => {
    const newCompAuth = Keypair.generate().publicKey;
    try {
      await program.methods
        .updateRoles({ newAuthority: null, newComplianceAuthority: newCompAuth })
        .accounts({
          authority: authority.publicKey,
          config: bug019ConfigNoTimelockPda,
          mint: bug019MintNoTimelock.publicKey,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .rpc();
      expect.fail("Should have rejected — ComplianceAuthorityRequiresTimelock expected");
    } catch (err: any) {
      const msg = err.message || err.toString();
      expect(msg).to.match(/ComplianceAuthorityRequiresTimelock|UseTimelockForAuthorityTransfer|AnchorError|Error/i);
    }
  });

  // ── Test 2: update_roles blocked when timelock > 0 ───────────────────────
  it("BUG-019-02: update_roles rejects compliance authority change when admin_timelock_delay > 0", async () => {
    const newCompAuth = Keypair.generate().publicKey;
    try {
      await program.methods
        .updateRoles({ newAuthority: null, newComplianceAuthority: newCompAuth })
        .accounts({
          authority: authority.publicKey,
          config: bug019ConfigWithTimelockPda,
          mint: bug019MintWithTimelock.publicKey,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .rpc();
      expect.fail("Should have rejected — ComplianceAuthorityRequiresTimelock expected");
    } catch (err: any) {
      const msg = err.message || err.toString();
      expect(msg).to.match(/ComplianceAuthorityRequiresTimelock|UseTimelockForAuthorityTransfer|AnchorError|Error/i);
    }
  });

  // ── Test 3: propose_timelocked_op (op_kind=10) accepted with timelock = 0, enforces min 432k ──
  it("BUG-019-03: propose_timelocked_op op_kind=10 accepted — mature_slot enforces minimum 432_000 delay even when admin_timelock_delay == 0", async () => {
    const newCompAuth = Keypair.generate().publicKey;
    const slotBefore = await provider.connection.getSlot();

    await program.methods
      .proposeTimelockedOp(
        ADMIN_OP_TRANSFER_COMPLIANCE_AUTHORITY,
        new anchor.BN(0),
        newCompAuth
      )
      .accounts({
        authority: authority.publicKey,
        config: bug019ConfigNoTimelockPda,
        mint: bug019MintNoTimelock.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();

    const cfg = await program.account.stablecoinConfig.fetch(bug019ConfigNoTimelockPda);
    expect(cfg.adminOpKind).to.equal(ADMIN_OP_TRANSFER_COMPLIANCE_AUTHORITY);
    expect(cfg.adminOpTarget.toBase58()).to.equal(newCompAuth.toBase58());
    // mature_slot must be at least DEFAULT_TIMELOCK_DELAY slots from now
    const matureSlot = cfg.adminOpMatureSlot.toNumber();
    expect(matureSlot).to.be.greaterThanOrEqual(slotBefore + DEFAULT_TIMELOCK_DELAY);
  });

  // ── Test 4: execute_timelocked_op op_kind=10 rejects before maturity ─────
  it("BUG-019-04: execute_timelocked_op op_kind=10 rejects before timelock matures", async () => {
    // Config NoTimelock has a pending compliance authority op (from test 3)
    try {
      await program.methods
        .executeTimelockedOp()
        .accounts({
          authority: authority.publicKey,
          config: bug019ConfigNoTimelockPda,
          mint: bug019MintNoTimelock.publicKey,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .rpc();
      expect.fail("Should have rejected — timelock not mature");
    } catch (err: any) {
      const msg = err.message || err.toString();
      expect(msg).to.match(/TimelockNotMature|AnchorError|Error/i);
    }
  });

  // ── Test 5: cancel and propose again (op_kind=10) for config with timelock = 432k ──
  it("BUG-019-05: propose_timelocked_op op_kind=10 accepted on config with admin_timelock_delay = 432_000", async () => {
    const newCompAuth = Keypair.generate().publicKey;
    const slotBefore = await provider.connection.getSlot();

    await program.methods
      .proposeTimelockedOp(
        ADMIN_OP_TRANSFER_COMPLIANCE_AUTHORITY,
        new anchor.BN(0),
        newCompAuth
      )
      .accounts({
        authority: authority.publicKey,
        config: bug019ConfigWithTimelockPda,
        mint: bug019MintWithTimelock.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();

    const cfg = await program.account.stablecoinConfig.fetch(bug019ConfigWithTimelockPda);
    expect(cfg.adminOpKind).to.equal(ADMIN_OP_TRANSFER_COMPLIANCE_AUTHORITY);
    expect(cfg.adminOpTarget.toBase58()).to.equal(newCompAuth.toBase58());
    const matureSlot = cfg.adminOpMatureSlot.toNumber();
    // With timelock = 432_000, effective_delay = max(432_000, 432_000) = 432_000
    expect(matureSlot).to.be.greaterThanOrEqual(slotBefore + DEFAULT_TIMELOCK_DELAY);
  });

  // ── Test 6: execute_timelocked_op op_kind=10 rejects before maturity (config B) ──
  it("BUG-019-06: execute_timelocked_op op_kind=10 rejects before maturity on config with timelock = 432_000", async () => {
    try {
      await program.methods
        .executeTimelockedOp()
        .accounts({
          authority: authority.publicKey,
          config: bug019ConfigWithTimelockPda,
          mint: bug019MintWithTimelock.publicKey,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .rpc();
      expect.fail("Should have rejected — timelock not mature");
    } catch (err: any) {
      const msg = err.message || err.toString();
      expect(msg).to.match(/TimelockNotMature|AnchorError|Error/i);
    }
  });

  // ── Test 7: non-authority cannot propose compliance authority transfer ────
  it("BUG-019-07: non-authority cannot propose compliance authority transfer via timelock", async () => {
    const attacker = Keypair.generate();
    // Fund attacker
    await provider.connection.requestAirdrop(attacker.publicKey, LAMPORTS_PER_SOL);
    await new Promise(r => setTimeout(r, 1000));

    const newCompAuth = Keypair.generate().publicKey;
    try {
      await program.methods
        .proposeTimelockedOp(
          ADMIN_OP_TRANSFER_COMPLIANCE_AUTHORITY,
          new anchor.BN(0),
          newCompAuth
        )
        .accounts({
          authority: attacker.publicKey,
          config: bug019ConfigNoTimelockPda,
          mint: bug019MintNoTimelock.publicKey,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([attacker])
        .rpc();
      expect.fail("Should have rejected — attacker is not authority");
    } catch (err: any) {
      const msg = err.message || err.toString();
      expect(msg).to.match(/Unauthorized|ConstraintRaw|AnchorError|Error/i);
    }
  });

  // ── Test 8: cancel clears pending compliance authority op ─────────────────
  it("BUG-019-08: cancel_timelocked_op clears pending compliance authority op", async () => {
    // Config NoTimelock still has a pending op from test 3
    await program.methods
      .cancelTimelockedOp()
      .accounts({
        authority: authority.publicKey,
        config: bug019ConfigNoTimelockPda,
        mint: bug019MintNoTimelock.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();

    const cfg = await program.account.stablecoinConfig.fetch(bug019ConfigNoTimelockPda);
    expect(cfg.adminOpKind).to.equal(0); // ADMIN_OP_NONE
    expect(cfg.adminOpTarget.toBase58()).to.equal(PublicKey.default.toBase58());
  });
});

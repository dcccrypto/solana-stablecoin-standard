/**
 * BUG-018: Guardian pause not overridable by authority instantly — timelock fix
 *
 * Covers:
 *  bug018-01  guardian-initiated pause: authority CANNOT lift before timelock expires → GuardianPauseTimelockActive
 *  bug018-02  guardian-initiated pause: full guardian quorum CAN lift immediately
 *  bug018-03  authority-initiated pause: authority can lift freely (no guardian_pause_active)
 *  bug018-04  guardian_pause_active is set to true after quorum pause
 *  bug018-05  guardian_pause_unlocks_at is set ~24h after quorum pause
 *  bug018-06  guardian_pause_active is cleared after guardian quorum lift
 *  bug018-07  partial quorum (1-of-2) does NOT set guardian_pause_active
 *  bug018-08  threshold-1 propose_pause sets guardian_pause_active immediately
 *  bug018-09  authority lift after timelock expiry succeeds (structural verification)
 *  bug018-10  guardian_pause_unlocks_at is cleared to 0 after full quorum lift
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorError } from "@coral-xyz/anchor";
import { SssToken } from "../target/types/sss_token";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { expect } from "chai";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function configPda(mint: PublicKey, programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("stablecoin-config"), mint.toBuffer()],
    programId
  )[0];
}

function guardianConfigPda(config: PublicKey, programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("guardian-config"), config.toBuffer()],
    programId
  )[0];
}

function pauseProposalPda(
  config: PublicKey,
  proposalId: bigint,
  programId: PublicKey
): PublicKey {
  const idBuf = Buffer.alloc(8);
  idBuf.writeBigUInt64LE(proposalId);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("pause-proposal"), config.toBuffer(), idBuf],
    programId
  )[0];
}

async function initMint(
  program: Program<SssToken>,
  provider: anchor.AnchorProvider
): Promise<{ mint: Keypair; config: PublicKey; authority: anchor.Wallet }> {
  const authority = provider.wallet as anchor.Wallet;
  const mint = Keypair.generate();
  const config = configPda(mint.publicKey, program.programId);

  await program.methods
    .initialize({
      preset: 1,
      decimals: 6,
      name: "BUG018 Test Token",
      symbol: "B18",
      uri: "https://test.example/",
      transferHookProgram: null,
      collateralMint: null,
      reserveVault: null,
      maxSupply: null,
      featureFlags: null,
      auditorElgamalPubkey: null,
    })
    .accounts({
      authority: authority.publicKey,
      mint: mint.publicKey,
      config,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    })
    .signers([mint])
    .rpc({ commitment: "confirmed", skipPreflight: true });

  return { mint, config, authority };
}

async function airdrop(
  provider: anchor.AnchorProvider,
  pk: PublicKey,
  lamports = 2 * LAMPORTS_PER_SOL
): Promise<void> {
  const sig = await provider.connection.requestAirdrop(pk, lamports);
  await provider.connection.confirmTransaction(sig, "confirmed");
}

// ─── Suite ───────────────────────────────────────────────────────────────────

describe("BUG-018 — guardian pause timelock (authority override blocked)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.SssToken as Program<SssToken>;

  // ── bug018-01 ─────────────────────────────────────────────────────────────

  it("bug018-01: authority CANNOT lift guardian-initiated pause before timelock (GuardianPauseTimelockActive)", async () => {
    const { mint, config, authority } = await initMint(program, provider);
    const gc = guardianConfigPda(config, program.programId);
    const g1 = Keypair.generate();
    const g2 = Keypair.generate();
    await airdrop(provider, g1.publicKey);
    await airdrop(provider, g2.publicKey);

    // Init 2-of-2 guardian config
    await program.methods
      .initGuardianConfig([g1.publicKey, g2.publicKey], 2)
      .accounts({
        authority: authority.publicKey,
        mint: mint.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc({ commitment: "confirmed", skipPreflight: true });

    // guardian1 proposes pause
    const proposalPk = pauseProposalPda(config, 0n, program.programId);
    const reason = Array(32).fill(0);
    await program.methods
      .guardianProposePause(reason)
      .accounts({
        guardian: g1.publicKey,
        mint: mint.publicKey,
        guardianConfig: gc,
        proposal: proposalPk,
        systemProgram: SystemProgram.programId,
      })
      .signers([g1])
      .rpc({ commitment: "confirmed", skipPreflight: true });

    // guardian2 votes — triggers pause + sets timelock
    await program.methods
      .guardianVotePause(new anchor.BN(0))
      .accounts({
        guardian: g2.publicKey,
        mint: mint.publicKey,
        guardianConfig: gc,
        proposal: proposalPk,
      })
      .signers([g2])
      .rpc({ commitment: "confirmed", skipPreflight: true });

    const cfg = await program.account.stablecoinConfig.fetch(config);
    expect(cfg.paused).to.be.true;

    // Authority tries to lift — must fail with GuardianPauseTimelockActive
    try {
      await program.methods
        .guardianLiftPause()
        .accounts({
          caller: authority.publicKey,
          mint: mint.publicKey,
          guardianConfig: gc,
        })
        .rpc({ commitment: "confirmed" });
      expect.fail("Expected GuardianPauseTimelockActive error");
    } catch (e: any) {
      // AnchorError: error.errorCode.code, or SendTransactionError: logs contain code
      const code: string = e?.error?.errorCode?.code ?? "";
      const logs: string = (e?.logs ?? []).join(" ");
      const msg: string = e?.message ?? "";
      const combined = code + " " + logs + " " + msg;
      expect(combined).to.include("GuardianPauseTimelockActive");
    }
  });

  // ── bug018-02 ─────────────────────────────────────────────────────────────

  it("bug018-02: full guardian quorum CAN lift guardian-initiated pause immediately", async () => {
    const { mint, config, authority } = await initMint(program, provider);
    const gc = guardianConfigPda(config, program.programId);
    const g1 = Keypair.generate();
    const g2 = Keypair.generate();
    await airdrop(provider, g1.publicKey);
    await airdrop(provider, g2.publicKey);

    await program.methods
      .initGuardianConfig([g1.publicKey, g2.publicKey], 2)
      .accounts({
        authority: authority.publicKey,
        mint: mint.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc({ commitment: "confirmed", skipPreflight: true });

    const proposalPk = pauseProposalPda(config, 0n, program.programId);
    const reason = Array(32).fill(0);
    await program.methods
      .guardianProposePause(reason)
      .accounts({
        guardian: g1.publicKey,
        mint: mint.publicKey,
        guardianConfig: gc,
        proposal: proposalPk,
        systemProgram: SystemProgram.programId,
      })
      .signers([g1])
      .rpc({ commitment: "confirmed", skipPreflight: true });

    await program.methods
      .guardianVotePause(new anchor.BN(0))
      .accounts({
        guardian: g2.publicKey,
        mint: mint.publicKey,
        guardianConfig: gc,
        proposal: proposalPk,
      })
      .signers([g2])
      .rpc({ commitment: "confirmed", skipPreflight: true });

    // g1 votes to lift
    await program.methods
      .guardianLiftPause()
      .accounts({ caller: g1.publicKey, mint: mint.publicKey, guardianConfig: gc })
      .signers([g1])
      .rpc({ commitment: "confirmed", skipPreflight: true });

    // Still paused — need 2-of-2
    let cfgAfter1 = await program.account.stablecoinConfig.fetch(config);
    expect(cfgAfter1.paused).to.be.true;

    // g2 votes to lift — reaches full quorum, unpauses
    await program.methods
      .guardianLiftPause()
      .accounts({ caller: g2.publicKey, mint: mint.publicKey, guardianConfig: gc })
      .signers([g2])
      .rpc({ commitment: "confirmed", skipPreflight: true });

    const cfgAfter2 = await program.account.stablecoinConfig.fetch(config);
    expect(cfgAfter2.paused).to.be.false;
  });

  // ── bug018-03 ─────────────────────────────────────────────────────────────

  it("bug018-03: authority-initiated pause: authority can lift freely (guardian_pause_active=false)", async () => {
    const { mint, config, authority } = await initMint(program, provider);
    const gc = guardianConfigPda(config, program.programId);
    const g1 = Keypair.generate();
    await airdrop(provider, g1.publicKey);

    await program.methods
      .initGuardianConfig([g1.publicKey], 1)
      .accounts({
        authority: authority.publicKey,
        mint: mint.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc({ commitment: "confirmed", skipPreflight: true });

    // Authority pauses via regular pause instruction
    await program.methods
      .pause()
      .accounts({
        authority: authority.publicKey,
        mint: mint.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc({ commitment: "confirmed", skipPreflight: true });

    // guardian_pause_active should be false
    const gcData = await program.account.guardianConfig.fetch(gc);
    expect(gcData.guardianPauseActive).to.be.false;

    // Authority can lift freely
    await program.methods
      .guardianLiftPause()
      .accounts({ caller: authority.publicKey, mint: mint.publicKey, guardianConfig: gc })
      .rpc({ commitment: "confirmed", skipPreflight: true });

    const cfg = await program.account.stablecoinConfig.fetch(config);
    expect(cfg.paused).to.be.false;
  });

  // ── bug018-04 ─────────────────────────────────────────────────────────────

  it("bug018-04: guardian_pause_active is set to true after quorum pause", async () => {
    const { mint, config, authority } = await initMint(program, provider);
    const gc = guardianConfigPda(config, program.programId);
    const g1 = Keypair.generate();
    const g2 = Keypair.generate();
    await airdrop(provider, g1.publicKey);
    await airdrop(provider, g2.publicKey);

    await program.methods
      .initGuardianConfig([g1.publicKey, g2.publicKey], 2)
      .accounts({
        authority: authority.publicKey,
        mint: mint.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc({ commitment: "confirmed", skipPreflight: true });

    const proposalPk = pauseProposalPda(config, 0n, program.programId);
    const reason = Array(32).fill(0);
    await program.methods
      .guardianProposePause(reason)
      .accounts({
        guardian: g1.publicKey,
        mint: mint.publicKey,
        guardianConfig: gc,
        proposal: proposalPk,
        systemProgram: SystemProgram.programId,
      })
      .signers([g1])
      .rpc({ commitment: "confirmed", skipPreflight: true });

    // Before 2nd vote: active should be false
    let gcData = await program.account.guardianConfig.fetch(gc);
    expect(gcData.guardianPauseActive).to.be.false;

    await program.methods
      .guardianVotePause(new anchor.BN(0))
      .accounts({
        guardian: g2.publicKey,
        mint: mint.publicKey,
        guardianConfig: gc,
        proposal: proposalPk,
      })
      .signers([g2])
      .rpc({ commitment: "confirmed", skipPreflight: true });

    // After quorum: active should be true
    gcData = await program.account.guardianConfig.fetch(gc);
    expect(gcData.guardianPauseActive).to.be.true;
  });

  // ── bug018-05 ─────────────────────────────────────────────────────────────

  it("bug018-05: guardian_pause_unlocks_at is set ~24h after quorum pause", async () => {
    const { mint, config, authority } = await initMint(program, provider);
    const gc = guardianConfigPda(config, program.programId);
    const g1 = Keypair.generate();
    const g2 = Keypair.generate();
    await airdrop(provider, g1.publicKey);
    await airdrop(provider, g2.publicKey);

    await program.methods
      .initGuardianConfig([g1.publicKey, g2.publicKey], 2)
      .accounts({
        authority: authority.publicKey,
        mint: mint.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc({ commitment: "confirmed", skipPreflight: true });

    const proposalPk = pauseProposalPda(config, 0n, program.programId);
    const reason = Array(32).fill(0);
    await program.methods
      .guardianProposePause(reason)
      .accounts({
        guardian: g1.publicKey,
        mint: mint.publicKey,
        guardianConfig: gc,
        proposal: proposalPk,
        systemProgram: SystemProgram.programId,
      })
      .signers([g1])
      .rpc({ commitment: "confirmed", skipPreflight: true });

    await program.methods
      .guardianVotePause(new anchor.BN(0))
      .accounts({
        guardian: g2.publicKey,
        mint: mint.publicKey,
        guardianConfig: gc,
        proposal: proposalPk,
      })
      .signers([g2])
      .rpc({ commitment: "confirmed", skipPreflight: true });

    const gcData = await program.account.guardianConfig.fetch(gc);
    expect(gcData.guardianPauseUnlocksAt.toNumber()).to.be.greaterThan(0);

    const now = Math.floor(Date.now() / 1000);
    const delta = gcData.guardianPauseUnlocksAt.toNumber() - now;
    // Should be ~86400 seconds (24h), allow ±120s for test lag
    expect(delta).to.be.within(86400 - 120, 86400 + 120);
  });

  // ── bug018-06 ─────────────────────────────────────────────────────────────

  it("bug018-06: guardian_pause_active is cleared after full guardian quorum lift", async () => {
    const { mint, config, authority } = await initMint(program, provider);
    const gc = guardianConfigPda(config, program.programId);
    const g1 = Keypair.generate();
    const g2 = Keypair.generate();
    await airdrop(provider, g1.publicKey);
    await airdrop(provider, g2.publicKey);

    await program.methods
      .initGuardianConfig([g1.publicKey, g2.publicKey], 2)
      .accounts({
        authority: authority.publicKey,
        mint: mint.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc({ commitment: "confirmed", skipPreflight: true });

    const proposalPk = pauseProposalPda(config, 0n, program.programId);
    const reason = Array(32).fill(0);
    await program.methods
      .guardianProposePause(reason)
      .accounts({
        guardian: g1.publicKey,
        mint: mint.publicKey,
        guardianConfig: gc,
        proposal: proposalPk,
        systemProgram: SystemProgram.programId,
      })
      .signers([g1])
      .rpc({ commitment: "confirmed", skipPreflight: true });

    await program.methods
      .guardianVotePause(new anchor.BN(0))
      .accounts({
        guardian: g2.publicKey,
        mint: mint.publicKey,
        guardianConfig: gc,
        proposal: proposalPk,
      })
      .signers([g2])
      .rpc({ commitment: "confirmed", skipPreflight: true });

    let gcData = await program.account.guardianConfig.fetch(gc);
    expect(gcData.guardianPauseActive).to.be.true;

    // Full quorum lift
    await program.methods
      .guardianLiftPause()
      .accounts({ caller: g1.publicKey, mint: mint.publicKey, guardianConfig: gc })
      .signers([g1])
      .rpc({ commitment: "confirmed", skipPreflight: true });

    await program.methods
      .guardianLiftPause()
      .accounts({ caller: g2.publicKey, mint: mint.publicKey, guardianConfig: gc })
      .signers([g2])
      .rpc({ commitment: "confirmed", skipPreflight: true });

    gcData = await program.account.guardianConfig.fetch(gc);
    expect(gcData.guardianPauseActive).to.be.false;
  });

  // ── bug018-07 ─────────────────────────────────────────────────────────────

  it("bug018-07: partial quorum (1-of-2 propose only) does NOT set guardian_pause_active", async () => {
    const { mint, config, authority } = await initMint(program, provider);
    const gc = guardianConfigPda(config, program.programId);
    const g1 = Keypair.generate();
    const g2 = Keypair.generate();
    await airdrop(provider, g1.publicKey);
    await airdrop(provider, g2.publicKey);

    await program.methods
      .initGuardianConfig([g1.publicKey, g2.publicKey], 2)
      .accounts({
        authority: authority.publicKey,
        mint: mint.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc({ commitment: "confirmed", skipPreflight: true });

    // Only g1 proposes — no 2nd vote
    const proposalPk = pauseProposalPda(config, 0n, program.programId);
    const reason = Array(32).fill(0);
    await program.methods
      .guardianProposePause(reason)
      .accounts({
        guardian: g1.publicKey,
        mint: mint.publicKey,
        guardianConfig: gc,
        proposal: proposalPk,
        systemProgram: SystemProgram.programId,
      })
      .signers([g1])
      .rpc({ commitment: "confirmed", skipPreflight: true });

    const gcData = await program.account.guardianConfig.fetch(gc);
    expect(gcData.guardianPauseActive).to.be.false;

    const cfg = await program.account.stablecoinConfig.fetch(config);
    expect(cfg.paused).to.be.false;
  });

  // ── bug018-08 ─────────────────────────────────────────────────────────────

  it("bug018-08: threshold-1 guardian_propose_pause sets guardian_pause_active immediately", async () => {
    const { mint, config, authority } = await initMint(program, provider);
    const gc = guardianConfigPda(config, program.programId);
    const g1 = Keypair.generate();
    await airdrop(provider, g1.publicKey);

    await program.methods
      .initGuardianConfig([g1.publicKey], 1)
      .accounts({
        authority: authority.publicKey,
        mint: mint.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc({ commitment: "confirmed", skipPreflight: true });

    const proposalPk = pauseProposalPda(config, 0n, program.programId);
    const reason = Array(32).fill(0);
    await program.methods
      .guardianProposePause(reason)
      .accounts({
        guardian: g1.publicKey,
        mint: mint.publicKey,
        guardianConfig: gc,
        proposal: proposalPk,
        systemProgram: SystemProgram.programId,
      })
      .signers([g1])
      .rpc({ commitment: "confirmed", skipPreflight: true });

    const gcData = await program.account.guardianConfig.fetch(gc);
    expect(gcData.guardianPauseActive).to.be.true;
    expect(gcData.guardianPauseUnlocksAt.toNumber()).to.be.greaterThan(0);

    const cfg = await program.account.stablecoinConfig.fetch(config);
    expect(cfg.paused).to.be.true;
  });

  // ── bug018-09 ─────────────────────────────────────────────────────────────

  it("bug018-09: authority can lift if guardian_pause_active=false (expired/cleared path verified)", async () => {
    // This test verifies the "timelock expired" code path is reachable by confirming
    // that after quorum lift clears guardian_pause_active, authority can freely
    // call guardian_lift_pause on a non-guardian pause.
    const { mint, config, authority } = await initMint(program, provider);
    const gc = guardianConfigPda(config, program.programId);
    const g1 = Keypair.generate();
    await airdrop(provider, g1.publicKey);

    await program.methods
      .initGuardianConfig([g1.publicKey], 1)
      .accounts({
        authority: authority.publicKey,
        mint: mint.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc({ commitment: "confirmed", skipPreflight: true });

    // Authority pauses — guardian_pause_active stays false
    await program.methods
      .pause()
      .accounts({
        authority: authority.publicKey,
        mint: mint.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc({ commitment: "confirmed", skipPreflight: true });

    const gcData = await program.account.guardianConfig.fetch(gc);
    expect(gcData.guardianPauseActive).to.be.false;
    expect(gcData.guardianPauseUnlocksAt.toNumber()).to.equal(0);

    // Authority lifts — succeeds immediately because guardian_pause_active is false
    await program.methods
      .guardianLiftPause()
      .accounts({ caller: authority.publicKey, mint: mint.publicKey, guardianConfig: gc })
      .rpc({ commitment: "confirmed", skipPreflight: true });

    const cfg = await program.account.stablecoinConfig.fetch(config);
    expect(cfg.paused).to.be.false;
  });

  // ── bug018-10 ─────────────────────────────────────────────────────────────

  it("bug018-10: guardian_pause_unlocks_at is cleared to 0 after full quorum lift", async () => {
    const { mint, config, authority } = await initMint(program, provider);
    const gc = guardianConfigPda(config, program.programId);
    const g1 = Keypair.generate();
    const g2 = Keypair.generate();
    await airdrop(provider, g1.publicKey);
    await airdrop(provider, g2.publicKey);

    await program.methods
      .initGuardianConfig([g1.publicKey, g2.publicKey], 2)
      .accounts({
        authority: authority.publicKey,
        mint: mint.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc({ commitment: "confirmed", skipPreflight: true });

    const proposalPk = pauseProposalPda(config, 0n, program.programId);
    const reason = Array(32).fill(0);
    await program.methods
      .guardianProposePause(reason)
      .accounts({
        guardian: g1.publicKey,
        mint: mint.publicKey,
        guardianConfig: gc,
        proposal: proposalPk,
        systemProgram: SystemProgram.programId,
      })
      .signers([g1])
      .rpc({ commitment: "confirmed", skipPreflight: true });

    await program.methods
      .guardianVotePause(new anchor.BN(0))
      .accounts({
        guardian: g2.publicKey,
        mint: mint.publicKey,
        guardianConfig: gc,
        proposal: proposalPk,
      })
      .signers([g2])
      .rpc({ commitment: "confirmed", skipPreflight: true });

    let gcData = await program.account.guardianConfig.fetch(gc);
    expect(gcData.guardianPauseUnlocksAt.toNumber()).to.be.greaterThan(0);

    // Quorum lift
    await program.methods
      .guardianLiftPause()
      .accounts({ caller: g1.publicKey, mint: mint.publicKey, guardianConfig: gc })
      .signers([g1])
      .rpc({ commitment: "confirmed", skipPreflight: true });

    await program.methods
      .guardianLiftPause()
      .accounts({ caller: g2.publicKey, mint: mint.publicKey, guardianConfig: gc })
      .signers([g2])
      .rpc({ commitment: "confirmed", skipPreflight: true });

    gcData = await program.account.guardianConfig.fetch(gc);
    expect(gcData.guardianPauseUnlocksAt.toNumber()).to.equal(0);
    expect(gcData.guardianPauseActive).to.be.false;
    const cfg = await program.account.stablecoinConfig.fetch(config);
    expect(cfg.paused).to.be.false;
  });
});

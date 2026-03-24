/**
 * SSS-121: Guardian Multisig Emergency Pause — Anchor tests
 *
 * Covers:
 *  guard-01  init_guardian_config happy path
 *  guard-02  init_guardian_config rejects empty guardian list
 *  guard-03  init_guardian_config rejects threshold > len
 *  guard-04  init_guardian_config rejects threshold == 0
 *  guard-05  init_guardian_config rejects > 7 guardians
 *  guard-06  init_guardian_config rejects duplicate guardians
 *  guard-07  guardian_propose_pause: threshold-1 single guardian auto-executes pause
 *  guard-08  guardian_propose_pause: non-guardian rejected
 *  guard-09  guardian_vote_pause: 2-of-3 threshold — no pause after 1st vote
 *  guard-10  guardian_vote_pause: 2-of-3 threshold — pause executes on 2nd vote
 *  guard-11  guardian_vote_pause: double-vote rejected
 *  guard-12  guardian_vote_pause: non-guardian rejected
 *  guard-13  guardian_vote_pause: already-executed proposal rejected
 *  guard-14  guardian_lift_pause: authority can always lift pause
 *  guard-15  guardian_lift_pause: guardian alone cannot lift (needs full quorum)
 *  guard-16  guardian_lift_pause: full guardian quorum lifts pause
 *  guard-17  guardian cannot mint (no mint instruction access)
 *  guard-18  3-of-5 guardian config — pause executes exactly at 3 votes
 *  guard-19  IDL includes GuardianConfig account type
 *  guard-20  IDL includes PauseProposal account type
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SssToken } from "../target/types/sss_token";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { expect } from "chai";

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function airdrop(
  provider: anchor.AnchorProvider,
  pk: PublicKey,
  lamports = 2 * LAMPORTS_PER_SOL
): Promise<void> {
  const sig = await provider.connection.requestAirdrop(pk, lamports);
  await provider.connection.confirmTransaction(sig, "confirmed");
}

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
  proposalId: number,
  programId: PublicKey
): PublicKey {
  const idBuf = Buffer.alloc(8);
  idBuf.writeBigUInt64LE(BigInt(proposalId));
  return PublicKey.findProgramAddressSync(
    [Buffer.from("pause-proposal"), config.toBuffer(), idBuf],
    programId
  )[0];
}

function minterInfoPda(
  config: PublicKey,
  minter: PublicKey,
  programId: PublicKey
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("minter-info"), config.toBuffer(), minter.toBuffer()],
    programId
  )[0];
}

/** Retry tx builder up to 5 attempts for blockhash flakiness */
async function sendWithRetry(
  provider: anchor.AnchorProvider,
  buildTx: () => Promise<anchor.web3.Transaction>,
  signers: anchor.web3.Signer[] = [],
  attempts = 5
): Promise<void> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    const tx = await buildTx();
    const { blockhash, lastValidBlockHeight } =
      await provider.connection.getLatestBlockhash("finalized");
    tx.recentBlockhash = blockhash;
    tx.lastValidBlockHeight = lastValidBlockHeight;
    tx.feePayer = provider.wallet.publicKey;
    try {
      await provider.sendAndConfirm(tx, signers, {
        commitment: "confirmed",
        skipPreflight: true,
      });
      return;
    } catch (err: any) {
      const msg: string = err?.message ?? "";
      if (
        msg.includes("Blockhash not found") ||
        msg.includes("BlockhashNotFound")
      ) {
        lastErr = err;
        await new Promise((r) => setTimeout(r, 800 * (i + 1)));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

// ─── Fixture: initialise a fresh SSS-1 mint for each describe block ──────────

async function initMint(
  program: Program<SssToken>,
  provider: anchor.AnchorProvider
): Promise<{ mint: Keypair; config: PublicKey; authority: anchor.Wallet }> {
  // Use provider wallet as authority (pre-funded, recognised as signer)
  const authority = provider.wallet as anchor.Wallet;
  const mint = Keypair.generate();

  const config = configPda(mint.publicKey, program.programId);

  await program.methods
    .initialize({
      preset: 1,
      decimals: 6,
      name: "Guardian Test Token",
      symbol: "GTT",
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

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("SSS-121: Guardian Multisig Emergency Pause", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.SssToken as Program<SssToken>;

  // ── guard-01: happy path ───────────────────────────────────────────────────

  it("guard-01: init_guardian_config sets guardians and threshold", async () => {
    const { mint, config, authority } = await initMint(program, provider);
    const gc = guardianConfigPda(config, program.programId);
    const g1 = Keypair.generate();
    const g2 = Keypair.generate();
    const g3 = Keypair.generate();

    await sendWithRetry(
      provider,
      async () =>
        program.methods
          .initGuardianConfig([g1.publicKey, g2.publicKey, g3.publicKey], 2)
          .accounts({
            authority: authority.publicKey,
            config,
            mint: mint.publicKey,
            guardianConfig: gc,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([])
          .transaction(),
      []
    );

    const gcAccount = await program.account.guardianConfig.fetch(gc);
    expect(gcAccount.guardians).to.have.length(3);
    expect(gcAccount.threshold).to.equal(2);
    expect(gcAccount.nextProposalId.toNumber()).to.equal(0);
  });

  // ── guard-02: rejects empty guardian list ─────────────────────────────────

  it("guard-02: init_guardian_config rejects empty guardian list", async () => {
    const { mint, config, authority } = await initMint(program, provider);
    const gc = guardianConfigPda(config, program.programId);

    try {
      await sendWithRetry(
        provider,
        async () =>
          program.methods
            .initGuardianConfig([], 1)
            .accounts({
              authority: authority.publicKey,
              config,
              mint: mint.publicKey,
              guardianConfig: gc,
              tokenProgram: TOKEN_2022_PROGRAM_ID,
              systemProgram: SystemProgram.programId,
            })
            .signers([])
            .transaction(),
        []
      );
      expect.fail("Should have thrown GuardianListEmpty");
    } catch (e: any) {
      expect(e.toString()).to.include("GuardianListEmpty");
    }
  });

  // ── guard-03: rejects threshold > len ─────────────────────────────────────

  it("guard-03: init_guardian_config rejects threshold > guardians.len()", async () => {
    const { mint, config, authority } = await initMint(program, provider);
    const gc = guardianConfigPda(config, program.programId);
    const g1 = Keypair.generate();

    try {
      await sendWithRetry(
        provider,
        async () =>
          program.methods
            .initGuardianConfig([g1.publicKey], 3)
            .accounts({
              authority: authority.publicKey,
              config,
              mint: mint.publicKey,
              guardianConfig: gc,
              tokenProgram: TOKEN_2022_PROGRAM_ID,
              systemProgram: SystemProgram.programId,
            })
            .signers([])
            .transaction(),
        []
      );
      expect.fail("Should have thrown InvalidGuardianThreshold");
    } catch (e: any) {
      expect(e.toString()).to.include("InvalidGuardianThreshold");
    }
  });

  // ── guard-04: rejects threshold == 0 ─────────────────────────────────────

  it("guard-04: init_guardian_config rejects threshold == 0", async () => {
    const { mint, config, authority } = await initMint(program, provider);
    const gc = guardianConfigPda(config, program.programId);
    const g1 = Keypair.generate();

    try {
      await sendWithRetry(
        provider,
        async () =>
          program.methods
            .initGuardianConfig([g1.publicKey], 0)
            .accounts({
              authority: authority.publicKey,
              config,
              mint: mint.publicKey,
              guardianConfig: gc,
              tokenProgram: TOKEN_2022_PROGRAM_ID,
              systemProgram: SystemProgram.programId,
            })
            .signers([])
            .transaction(),
        []
      );
      expect.fail("Should have thrown InvalidGuardianThreshold");
    } catch (e: any) {
      expect(e.toString()).to.include("InvalidGuardianThreshold");
    }
  });

  // ── guard-05: rejects > 7 guardians ──────────────────────────────────────

  it("guard-05: init_guardian_config rejects > 7 guardians", async () => {
    const { mint, config, authority } = await initMint(program, provider);
    const gc = guardianConfigPda(config, program.programId);
    const guardians = Array.from({ length: 8 }, () => Keypair.generate().publicKey);

    try {
      await sendWithRetry(
        provider,
        async () =>
          program.methods
            .initGuardianConfig(guardians, 4)
            .accounts({
              authority: authority.publicKey,
              config,
              mint: mint.publicKey,
              guardianConfig: gc,
              tokenProgram: TOKEN_2022_PROGRAM_ID,
              systemProgram: SystemProgram.programId,
            })
            .signers([])
            .transaction(),
        []
      );
      expect.fail("Should have thrown GuardianListFull");
    } catch (e: any) {
      expect(e.toString()).to.include("GuardianListFull");
    }
  });

  // ── guard-06: rejects duplicate guardians ────────────────────────────────

  it("guard-06: init_guardian_config rejects duplicate guardians", async () => {
    const { mint, config, authority } = await initMint(program, provider);
    const gc = guardianConfigPda(config, program.programId);
    const g1 = Keypair.generate();

    try {
      await sendWithRetry(
        provider,
        async () =>
          program.methods
            .initGuardianConfig([g1.publicKey, g1.publicKey], 1)
            .accounts({
              authority: authority.publicKey,
              config,
              mint: mint.publicKey,
              guardianConfig: gc,
              tokenProgram: TOKEN_2022_PROGRAM_ID,
              systemProgram: SystemProgram.programId,
            })
            .signers([])
            .transaction(),
        []
      );
      expect.fail("Should have thrown DuplicateGuardian");
    } catch (e: any) {
      expect(e.toString()).to.include("DuplicateGuardian");
    }
  });

  // ── guard-07: single guardian auto-executes pause ─────────────────────────

  it("guard-07: 1-of-1 guardian propose immediately pauses the mint", async () => {
    const { mint, config, authority } = await initMint(program, provider);
    const gc = guardianConfigPda(config, program.programId);
    const g1 = Keypair.generate();
    await airdrop(provider, g1.publicKey);

    await sendWithRetry(
      provider,
      async () =>
        program.methods
          .initGuardianConfig([g1.publicKey], 1)
          .accounts({
            authority: authority.publicKey,
            config,
            mint: mint.publicKey,
            guardianConfig: gc,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([])
          .transaction(),
      []
    );

    const proposal0 = pauseProposalPda(config, 0, program.programId);
    const reason = Buffer.alloc(32, 0);
    reason.write("hack", 0);

    await sendWithRetry(
      provider,
      async () =>
        program.methods
          .guardianProposePause([...reason])
          .accounts({
            guardian: g1.publicKey,
            config,
            mint: mint.publicKey,
            guardianConfig: gc,
            proposal: proposal0,
            systemProgram: SystemProgram.programId,
          })
          .signers([g1])
          .transaction(),
      [g1]
    );

    const configAccount = await program.account.stablecoinConfig.fetch(config);
    expect(configAccount.paused).to.equal(true);

    const proposalAccount = await program.account.pauseProposal.fetch(proposal0);
    expect(proposalAccount.executed).to.equal(true);
  });

  // ── guard-08: non-guardian propose rejected ───────────────────────────────

  it("guard-08: non-guardian cannot propose pause", async () => {
    const { mint, config, authority } = await initMint(program, provider);
    const gc = guardianConfigPda(config, program.programId);
    const g1 = Keypair.generate();
    const stranger = Keypair.generate();
    await airdrop(provider, stranger.publicKey);

    await sendWithRetry(
      provider,
      async () =>
        program.methods
          .initGuardianConfig([g1.publicKey], 1)
          .accounts({
            authority: authority.publicKey,
            config,
            mint: mint.publicKey,
            guardianConfig: gc,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([])
          .transaction(),
      []
    );

    const proposal0 = pauseProposalPda(config, 0, program.programId);
    const reason = Buffer.alloc(32, 0);

    try {
      await sendWithRetry(
        provider,
        async () =>
          program.methods
            .guardianProposePause([...reason])
            .accounts({
              guardian: stranger.publicKey,
              config,
              mint: mint.publicKey,
              guardianConfig: gc,
              proposal: proposal0,
              systemProgram: SystemProgram.programId,
            })
            .signers([stranger])
            .transaction(),
        [stranger]
      );
      expect.fail("Should have thrown NotAGuardian");
    } catch (e: any) {
      expect(e.toString()).to.include("NotAGuardian");
    }
  });

  // ── guard-09: 2-of-3: 1 vote → no pause ──────────────────────────────────

  it("guard-09: 2-of-3 threshold — no pause after 1 vote", async () => {
    const { mint, config, authority } = await initMint(program, provider);
    const gc = guardianConfigPda(config, program.programId);
    const [g1, g2, g3] = [Keypair.generate(), Keypair.generate(), Keypair.generate()];
    await airdrop(provider, g1.publicKey);

    await sendWithRetry(
      provider,
      async () =>
        program.methods
          .initGuardianConfig([g1.publicKey, g2.publicKey, g3.publicKey], 2)
          .accounts({
            authority: authority.publicKey,
            config,
            mint: mint.publicKey,
            guardianConfig: gc,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([])
          .transaction(),
      []
    );

    const proposal0 = pauseProposalPda(config, 0, program.programId);
    const reason = Buffer.alloc(32, 0);

    await sendWithRetry(
      provider,
      async () =>
        program.methods
          .guardianProposePause([...reason])
          .accounts({
            guardian: g1.publicKey,
            config,
            mint: mint.publicKey,
            guardianConfig: gc,
            proposal: proposal0,
            systemProgram: SystemProgram.programId,
          })
          .signers([g1])
          .transaction(),
      [g1]
    );

    const configAccount = await program.account.stablecoinConfig.fetch(config);
    expect(configAccount.paused).to.equal(false);
    const proposalAccount = await program.account.pauseProposal.fetch(proposal0);
    expect(proposalAccount.executed).to.equal(false);
    expect(proposalAccount.votes).to.have.length(1);
  });

  // ── guard-10: 2-of-3: 2nd vote executes pause ─────────────────────────────

  it("guard-10: 2-of-3 threshold — pause executes on 2nd vote", async () => {
    const { mint, config, authority } = await initMint(program, provider);
    const gc = guardianConfigPda(config, program.programId);
    const [g1, g2, g3] = [Keypair.generate(), Keypair.generate(), Keypair.generate()];
    await airdrop(provider, g1.publicKey);
    await airdrop(provider, g2.publicKey);

    await sendWithRetry(
      provider,
      async () =>
        program.methods
          .initGuardianConfig([g1.publicKey, g2.publicKey, g3.publicKey], 2)
          .accounts({
            authority: authority.publicKey,
            config,
            mint: mint.publicKey,
            guardianConfig: gc,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([])
          .transaction(),
      []
    );

    const proposal0 = pauseProposalPda(config, 0, program.programId);
    const reason = Buffer.alloc(32, 0);

    // g1 proposes (1 vote, no pause)
    await sendWithRetry(
      provider,
      async () =>
        program.methods
          .guardianProposePause([...reason])
          .accounts({
            guardian: g1.publicKey,
            config,
            mint: mint.publicKey,
            guardianConfig: gc,
            proposal: proposal0,
            systemProgram: SystemProgram.programId,
          })
          .signers([g1])
          .transaction(),
      [g1]
    );

    // g2 votes (2 votes = threshold → pause)
    await sendWithRetry(
      provider,
      async () =>
        program.methods
          .guardianVotePause(new anchor.BN(0))
          .accounts({
            guardian: g2.publicKey,
            config,
            mint: mint.publicKey,
            guardianConfig: gc,
            proposal: proposal0,
          })
          .signers([g2])
          .transaction(),
      [g2]
    );

    const configAccount = await program.account.stablecoinConfig.fetch(config);
    expect(configAccount.paused).to.equal(true);
    const proposalAccount = await program.account.pauseProposal.fetch(proposal0);
    expect(proposalAccount.executed).to.equal(true);
    expect(proposalAccount.votes).to.have.length(2);
  });

  // ── guard-11: double-vote rejected ───────────────────────────────────────

  it("guard-11: double-vote on same proposal is rejected", async () => {
    const { mint, config, authority } = await initMint(program, provider);
    const gc = guardianConfigPda(config, program.programId);
    const [g1, g2] = [Keypair.generate(), Keypair.generate()];
    await airdrop(provider, g1.publicKey);

    await sendWithRetry(
      provider,
      async () =>
        program.methods
          .initGuardianConfig([g1.publicKey, g2.publicKey], 2)
          .accounts({
            authority: authority.publicKey,
            config,
            mint: mint.publicKey,
            guardianConfig: gc,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([])
          .transaction(),
      []
    );

    const proposal0 = pauseProposalPda(config, 0, program.programId);
    const reason = Buffer.alloc(32, 0);
    await sendWithRetry(
      provider,
      async () =>
        program.methods
          .guardianProposePause([...reason])
          .accounts({
            guardian: g1.publicKey,
            config,
            mint: mint.publicKey,
            guardianConfig: gc,
            proposal: proposal0,
            systemProgram: SystemProgram.programId,
          })
          .signers([g1])
          .transaction(),
      [g1]
    );

    try {
      await sendWithRetry(
        provider,
        async () =>
          program.methods
            .guardianVotePause(new anchor.BN(0))
            .accounts({
              guardian: g1.publicKey,
              config,
              mint: mint.publicKey,
              guardianConfig: gc,
              proposal: proposal0,
            })
            .signers([g1])
            .transaction(),
        [g1]
      );
      expect.fail("Should have thrown AlreadyVoted");
    } catch (e: any) {
      expect(e.toString()).to.include("AlreadyVoted");
    }
  });

  // ── guard-12: non-guardian vote rejected ─────────────────────────────────

  it("guard-12: non-guardian vote is rejected", async () => {
    const { mint, config, authority } = await initMint(program, provider);
    const gc = guardianConfigPda(config, program.programId);
    const [g1, g2] = [Keypair.generate(), Keypair.generate()];
    const stranger = Keypair.generate();
    await airdrop(provider, g1.publicKey);
    await airdrop(provider, stranger.publicKey);

    await sendWithRetry(
      provider,
      async () =>
        program.methods
          .initGuardianConfig([g1.publicKey, g2.publicKey], 2)
          .accounts({
            authority: authority.publicKey,
            config,
            mint: mint.publicKey,
            guardianConfig: gc,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([])
          .transaction(),
      []
    );

    const proposal0 = pauseProposalPda(config, 0, program.programId);
    const reason = Buffer.alloc(32, 0);
    await sendWithRetry(
      provider,
      async () =>
        program.methods
          .guardianProposePause([...reason])
          .accounts({
            guardian: g1.publicKey,
            config,
            mint: mint.publicKey,
            guardianConfig: gc,
            proposal: proposal0,
            systemProgram: SystemProgram.programId,
          })
          .signers([g1])
          .transaction(),
      [g1]
    );

    try {
      await sendWithRetry(
        provider,
        async () =>
          program.methods
            .guardianVotePause(new anchor.BN(0))
            .accounts({
              guardian: stranger.publicKey,
              config,
              mint: mint.publicKey,
              guardianConfig: gc,
              proposal: proposal0,
            })
            .signers([stranger])
            .transaction(),
        [stranger]
      );
      expect.fail("Should have thrown NotAGuardian");
    } catch (e: any) {
      expect(e.toString()).to.include("NotAGuardian");
    }
  });

  // ── guard-13: vote on executed proposal rejected ──────────────────────────

  it("guard-13: voting on already-executed proposal is rejected", async () => {
    const { mint, config, authority } = await initMint(program, provider);
    const gc = guardianConfigPda(config, program.programId);
    const [g1, g2, g3] = [Keypair.generate(), Keypair.generate(), Keypair.generate()];
    await airdrop(provider, g1.publicKey);
    await airdrop(provider, g2.publicKey);
    await airdrop(provider, g3.publicKey);

    await sendWithRetry(
      provider,
      async () =>
        program.methods
          .initGuardianConfig([g1.publicKey, g2.publicKey, g3.publicKey], 2)
          .accounts({
            authority: authority.publicKey,
            config,
            mint: mint.publicKey,
            guardianConfig: gc,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([])
          .transaction(),
      []
    );

    const proposal0 = pauseProposalPda(config, 0, program.programId);
    const reason = Buffer.alloc(32, 0);

    // g1 proposes
    await sendWithRetry(
      provider,
      async () =>
        program.methods
          .guardianProposePause([...reason])
          .accounts({
            guardian: g1.publicKey,
            config,
            mint: mint.publicKey,
            guardianConfig: gc,
            proposal: proposal0,
            systemProgram: SystemProgram.programId,
          })
          .signers([g1])
          .transaction(),
      [g1]
    );

    // g2 votes — executes
    await sendWithRetry(
      provider,
      async () =>
        program.methods
          .guardianVotePause(new anchor.BN(0))
          .accounts({
            guardian: g2.publicKey,
            config,
            mint: mint.publicKey,
            guardianConfig: gc,
            proposal: proposal0,
          })
          .signers([g2])
          .transaction(),
      [g2]
    );

    // g3 tries to vote on already-executed proposal
    try {
      await sendWithRetry(
        provider,
        async () =>
          program.methods
            .guardianVotePause(new anchor.BN(0))
            .accounts({
              guardian: g3.publicKey,
              config,
              mint: mint.publicKey,
              guardianConfig: gc,
              proposal: proposal0,
            })
            .signers([g3])
            .transaction(),
        [g3]
      );
      expect.fail("Should have thrown ProposalAlreadyExecuted");
    } catch (e: any) {
      expect(e.toString()).to.include("ProposalAlreadyExecuted");
    }
  });

  // ── guard-14: authority can lift pause ────────────────────────────────────

  it("guard-14: authority can lift a guardian-imposed pause", async () => {
    const { mint, config, authority } = await initMint(program, provider);
    const gc = guardianConfigPda(config, program.programId);
    const g1 = Keypair.generate();
    await airdrop(provider, g1.publicKey);

    await sendWithRetry(
      provider,
      async () =>
        program.methods
          .initGuardianConfig([g1.publicKey], 1)
          .accounts({
            authority: authority.publicKey,
            config,
            mint: mint.publicKey,
            guardianConfig: gc,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([])
          .transaction(),
      []
    );

    // Pause
    const proposal0 = pauseProposalPda(config, 0, program.programId);
    const reason = Buffer.alloc(32, 0);
    await sendWithRetry(
      provider,
      async () =>
        program.methods
          .guardianProposePause([...reason])
          .accounts({
            guardian: g1.publicKey,
            config,
            mint: mint.publicKey,
            guardianConfig: gc,
            proposal: proposal0,
            systemProgram: SystemProgram.programId,
          })
          .signers([g1])
          .transaction(),
      [g1]
    );

    let configAccount = await program.account.stablecoinConfig.fetch(config);
    expect(configAccount.paused).to.equal(true);

    // Authority lifts pause
    await sendWithRetry(
      provider,
      async () =>
        program.methods
          .guardianLiftPause()
          .accounts({
            caller: authority.publicKey,
            config,
            mint: mint.publicKey,
            guardianConfig: gc,
          })
          .signers([])
          .transaction(),
      []
    );

    configAccount = await program.account.stablecoinConfig.fetch(config);
    expect(configAccount.paused).to.equal(false);
  });

  // ── guard-15: single guardian cannot lift without full quorum ─────────────

  it("guard-15: single guardian cannot lift pause (needs full quorum)", async () => {
    const { mint, config, authority } = await initMint(program, provider);
    const gc = guardianConfigPda(config, program.programId);
    const [g1, g2] = [Keypair.generate(), Keypair.generate()];
    await airdrop(provider, g1.publicKey);

    await sendWithRetry(
      provider,
      async () =>
        program.methods
          .initGuardianConfig([g1.publicKey, g2.publicKey], 1)
          .accounts({
            authority: authority.publicKey,
            config,
            mint: mint.publicKey,
            guardianConfig: gc,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([])
          .transaction(),
      []
    );

    // Pause via g1
    const proposal0 = pauseProposalPda(config, 0, program.programId);
    const reason = Buffer.alloc(32, 0);
    await sendWithRetry(
      provider,
      async () =>
        program.methods
          .guardianProposePause([...reason])
          .accounts({
            guardian: g1.publicKey,
            config,
            mint: mint.publicKey,
            guardianConfig: gc,
            proposal: proposal0,
            systemProgram: SystemProgram.programId,
          })
          .signers([g1])
          .transaction(),
      [g1]
    );

    // g1 votes to lift — only 1 of 2 guardians, not full quorum
    await sendWithRetry(
      provider,
      async () =>
        program.methods
          .guardianLiftPause()
          .accounts({
            caller: g1.publicKey,
            config,
            mint: mint.publicKey,
            guardianConfig: gc,
          })
          .signers([g1])
          .transaction(),
      [g1]
    );

    // Still paused — needs both guardians
    const configAccount = await program.account.stablecoinConfig.fetch(config);
    expect(configAccount.paused).to.equal(true);
  });

  // ── guard-16: full guardian quorum lifts pause ────────────────────────────

  it("guard-16: full guardian quorum (2-of-2) lifts pause", async () => {
    const { mint, config, authority } = await initMint(program, provider);
    const gc = guardianConfigPda(config, program.programId);
    const [g1, g2] = [Keypair.generate(), Keypair.generate()];
    await airdrop(provider, g1.publicKey);
    await airdrop(provider, g2.publicKey);

    await sendWithRetry(
      provider,
      async () =>
        program.methods
          .initGuardianConfig([g1.publicKey, g2.publicKey], 1)
          .accounts({
            authority: authority.publicKey,
            config,
            mint: mint.publicKey,
            guardianConfig: gc,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([])
          .transaction(),
      []
    );

    // Pause
    const proposal0 = pauseProposalPda(config, 0, program.programId);
    const reason = Buffer.alloc(32, 0);
    await sendWithRetry(
      provider,
      async () =>
        program.methods
          .guardianProposePause([...reason])
          .accounts({
            guardian: g1.publicKey,
            config,
            mint: mint.publicKey,
            guardianConfig: gc,
            proposal: proposal0,
            systemProgram: SystemProgram.programId,
          })
          .signers([g1])
          .transaction(),
      [g1]
    );

    // g1 votes to lift
    await sendWithRetry(
      provider,
      async () =>
        program.methods
          .guardianLiftPause()
          .accounts({
            caller: g1.publicKey,
            config,
            mint: mint.publicKey,
            guardianConfig: gc,
          })
          .signers([g1])
          .transaction(),
      [g1]
    );

    let configAccount = await program.account.stablecoinConfig.fetch(config);
    expect(configAccount.paused, "Still paused after 1 vote").to.equal(true);

    // g2 votes to lift — full quorum
    await sendWithRetry(
      provider,
      async () =>
        program.methods
          .guardianLiftPause()
          .accounts({
            caller: g2.publicKey,
            config,
            mint: mint.publicKey,
            guardianConfig: gc,
          })
          .signers([g2])
          .transaction(),
      [g2]
    );

    configAccount = await program.account.stablecoinConfig.fetch(config);
    expect(configAccount.paused, "Should be unpaused after full quorum").to.equal(false);
  });

  // ── guard-17: guardian cannot mint ────────────────────────────────────────

  it("guard-17: guardian is not a registered minter and cannot mint", async () => {
    const { mint, config, authority } = await initMint(program, provider);
    const gc = guardianConfigPda(config, program.programId);
    const g1 = Keypair.generate();
    await airdrop(provider, g1.publicKey);

    await sendWithRetry(
      provider,
      async () =>
        program.methods
          .initGuardianConfig([g1.publicKey], 1)
          .accounts({
            authority: authority.publicKey,
            config,
            mint: mint.publicKey,
            guardianConfig: gc,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([])
          .transaction(),
      []
    );

    // Guardian is NOT a minter — minter info PDA doesn't exist
    const minterPda = minterInfoPda(config, g1.publicKey, program.programId);
    const minterAccount = await provider.connection.getAccountInfo(minterPda);
    expect(minterAccount).to.be.null;
  });

  // ── guard-18: 3-of-5 config ───────────────────────────────────────────────

  it("guard-18: 3-of-5 threshold — pause executes exactly at 3rd vote", async () => {
    const { mint, config, authority } = await initMint(program, provider);
    const gc = guardianConfigPda(config, program.programId);
    const [g1, g2, g3, g4, g5] = Array.from({ length: 5 }, () => Keypair.generate());
    for (const g of [g1, g2, g3]) await airdrop(provider, g.publicKey);

    await sendWithRetry(
      provider,
      async () =>
        program.methods
          .initGuardianConfig(
            [g1.publicKey, g2.publicKey, g3.publicKey, g4.publicKey, g5.publicKey],
            3
          )
          .accounts({
            authority: authority.publicKey,
            config,
            mint: mint.publicKey,
            guardianConfig: gc,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([])
          .transaction(),
      []
    );

    const proposal0 = pauseProposalPda(config, 0, program.programId);
    const reason = Buffer.alloc(32, 0);

    // Vote 1 (g1 proposes)
    await sendWithRetry(
      provider,
      async () =>
        program.methods
          .guardianProposePause([...reason])
          .accounts({
            guardian: g1.publicKey,
            config,
            mint: mint.publicKey,
            guardianConfig: gc,
            proposal: proposal0,
            systemProgram: SystemProgram.programId,
          })
          .signers([g1])
          .transaction(),
      [g1]
    );
    let ca = await program.account.stablecoinConfig.fetch(config);
    expect(ca.paused, "1/3").to.equal(false);

    // Vote 2 (g2)
    await sendWithRetry(
      provider,
      async () =>
        program.methods
          .guardianVotePause(new anchor.BN(0))
          .accounts({
            guardian: g2.publicKey,
            config,
            mint: mint.publicKey,
            guardianConfig: gc,
            proposal: proposal0,
          })
          .signers([g2])
          .transaction(),
      [g2]
    );
    ca = await program.account.stablecoinConfig.fetch(config);
    expect(ca.paused, "2/3").to.equal(false);

    // Vote 3 (g3) — threshold reached
    await sendWithRetry(
      provider,
      async () =>
        program.methods
          .guardianVotePause(new anchor.BN(0))
          .accounts({
            guardian: g3.publicKey,
            config,
            mint: mint.publicKey,
            guardianConfig: gc,
            proposal: proposal0,
          })
          .signers([g3])
          .transaction(),
      [g3]
    );
    ca = await program.account.stablecoinConfig.fetch(config);
    expect(ca.paused, "3/3 — should be paused").to.equal(true);
  });

  // ── guard-19: IDL includes GuardianConfig ────────────────────────────────

  it("guard-19: IDL includes GuardianConfig account type", () => {
    const rawIdl = program.idl as any;
    const accounts = rawIdl.accounts as Array<{ name: string }>;
    const acc = accounts?.find(
      (a: any) =>
        a.name === "GuardianConfig" || a.name === "guardianConfig"
    );
    expect(acc, "GuardianConfig must be in IDL").to.not.be.undefined;
  });

  // ── guard-20: IDL includes PauseProposal ─────────────────────────────────

  it("guard-20: IDL includes PauseProposal account type", () => {
    const rawIdl = program.idl as any;
    const accounts = rawIdl.accounts as Array<{ name: string }>;
    const acc = accounts?.find(
      (a: any) =>
        a.name === "PauseProposal" || a.name === "pauseProposal"
    );
    expect(acc, "PauseProposal must be in IDL").to.not.be.undefined;
  });
});

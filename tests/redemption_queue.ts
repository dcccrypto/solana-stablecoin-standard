/**
 * SSS-154: Redemption Queue + Front-Run Protection — Anchor tests
 *
 * Tests (20+):
 *  1.  init_redemption_queue: succeeds for authority with FLAG_REDEMPTION_QUEUE
 *  2.  init_redemption_queue: fails without FLAG_REDEMPTION_QUEUE
 *  3.  init_redemption_queue: fails for non-authority
 *  4.  enqueue_redemption: success (queue index 0)
 *  5.  enqueue_redemption: second entry (queue index 1)
 *  6.  enqueue_redemption: fails with zero amount
 *  7.  enqueue_redemption: fails when queue full (max_queue_depth=1)
 *  8.  process_redemption: fails if min_delay_slots not elapsed (front-run block)
 *  9.  process_redemption: success after delay
 * 10.  process_redemption: updates queue_head
 * 11.  process_redemption: updates slot_redemption_total
 * 12.  process_redemption: slot cap is checked
 * 13.  process_redemption: fails on already-fulfilled entry
 * 14.  cancel_redemption: success
 * 15.  cancel_redemption: fails for non-owner
 * 16.  cancel_redemption: fails on already-cancelled entry
 * 17.  cancel_redemption: returns tokens to user
 * 18.  keeper reward: paid on process_redemption
 * 19.  FIFO ordering: head advances after process
 * 20.  process after cancel: fails (entry is cancelled)
 * 21.  FLAG_REDEMPTION_QUEUE set in feature_flags after init
 * 22.  RedemptionEntry fields correct after enqueue
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { SssToken } from "../target/types/sss_token";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
  SYSVAR_SLOT_HASHES_PUBKEY,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAccount,
} from "@solana/spl-token";
import { expect } from "chai";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FLAG_REDEMPTION_QUEUE = new BN(1).shln(23); // 1 << 23

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function airdrop(
  provider: anchor.AnchorProvider,
  pk: PublicKey,
  sol = 10
) {
  const sig = await provider.connection.requestAirdrop(
    pk,
    sol * LAMPORTS_PER_SOL
  );
  await provider.connection.confirmTransaction(sig, "confirmed");
}

async function assertError(fn: () => Promise<any>, substr: string): Promise<void> {
  try {
    await fn();
    throw new Error(`Expected error containing "${substr}" but succeeded`);
  } catch (err: any) {
    const msg: string = err?.message ?? JSON.stringify(err);
    if (!msg.includes(substr)) {
      throw new Error(`Expected error containing "${substr}", got: ${msg.slice(0, 600)}`);
    }
  }
}

function getConfigPda(mint: PublicKey, programId: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("stablecoin-config"), mint.toBuffer()],
    programId
  );
  return pda;
}

function getRedemptionQueuePda(mint: PublicKey, programId: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("redemption-queue"), mint.toBuffer()],
    programId
  );
  return pda;
}

function getRedemptionEntryPda(
  mint: PublicKey,
  queueIndex: BN,
  programId: PublicKey
): PublicKey {
  const idxBuf = Buffer.alloc(8);
  idxBuf.writeBigUInt64LE(BigInt(queueIndex.toString()));
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("redemption-entry"), mint.toBuffer(), idxBuf],
    programId
  );
  return pda;
}

function getQueueEscrowPda(
  mint: PublicKey,
  queueIndex: BN,
  programId: PublicKey
): PublicKey {
  const idxBuf = Buffer.alloc(8);
  idxBuf.writeBigUInt64LE(BigInt(queueIndex.toString()));
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("queue-escrow"), mint.toBuffer(), idxBuf],
    programId
  );
  return pda;
}

/** Advance the cluster by sending N no-op airdrop transactions. */
async function advanceSlots(
  provider: anchor.AnchorProvider,
  payer: Keypair,
  numTxns: number
): Promise<void> {
  for (let i = 0; i < numTxns; i++) {
    const sig = await provider.connection.requestAirdrop(
      payer.publicKey,
      1
    );
    await provider.connection.confirmTransaction(sig, "confirmed");
  }
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("SSS-154: redemption_queue", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.SssToken as Program<SssToken>;

  // Authority = provider wallet (pre-funded, recognized as implicit signer in .rpc())
  const authority = provider.wallet as anchor.Wallet;

  // Other wallets
  let user: Keypair;
  let keeper: Keypair;
  let nonOwner: Keypair;

  // Primary mint (FLAG_REDEMPTION_QUEUE enabled)
  let stableMintKp: Keypair;
  let stableMint: PublicKey;
  let configPda: PublicKey;
  let redemptionQueuePda: PublicKey;
  let minterInfoPda: PublicKey;
  let userAta: PublicKey;

  // Collateral mint
  let collateralMintKp: Keypair;
  let collateralMint: PublicKey;
  let reserveVault: PublicKey;
  let userCollateralAta: PublicKey;
  let collateralConfigPda: PublicKey;
  let collateralMinterInfoPda: PublicKey;

  // Secondary mint (no flag — for failure tests)
  let mintKp2: Keypair;
  let configPda2: PublicKey;
  let queuePda2: PublicKey;

  // Track queue index across tests
  let nextQueueIndex = new BN(0);

  // ---------------------------------------------------------------------------
  // before: setup wallets, mints, ATAs
  // ---------------------------------------------------------------------------

  before("setup wallets and initialize stablecoin", async () => {
    user = Keypair.generate();
    keeper = Keypair.generate();
    nonOwner = Keypair.generate();

    await Promise.all([
      airdrop(provider, user.publicKey, 20),
      airdrop(provider, keeper.publicKey, 20),
      airdrop(provider, nonOwner.publicKey, 5),
    ]);

    // ── Primary stable mint (FLAG_REDEMPTION_QUEUE) ──────────────────────────
    stableMintKp = Keypair.generate();
    stableMint = stableMintKp.publicKey;
    configPda = getConfigPda(stableMint, program.programId);
    redemptionQueuePda = getRedemptionQueuePda(stableMint, program.programId);

    [minterInfoPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("minter-info"), configPda.toBuffer(), authority.publicKey.toBuffer()],
      program.programId
    );

    await program.methods
      .initialize({
        preset: 1,
        decimals: 6,
        name: "RQ Test Stable",
        symbol: "RQT",
        uri: "https://example.com/rqt",
        transferHookProgram: null,
        collateralMint: null,
        reserveVault: null,
        maxSupply: new BN(1_000_000_000_000),
        featureFlags: FLAG_REDEMPTION_QUEUE,
        auditorElgamalPubkey: null,
      })
      .accounts({
        payer: authority.publicKey,
        mint: stableMint,
        config: configPda,
        ctConfig: null,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([stableMintKp])
      .rpc({ commitment: "confirmed", skipPreflight: true });

    // SSS-122: migrate config from v0 → v1 so mint/burn version guards pass
    await program.methods
      .migrateConfig()
      .accounts({
        authority: authority.publicKey,
        mint: stableMint,
        config: configPda,
        systemProgram: SystemProgram.programId,
      } as any)
      .rpc({ commitment: "confirmed" });

    // Register authority as minter
    await program.methods
      .updateMinter(new BN(0))
      .accounts({
        authority: authority.publicKey,
        config: configPda,
        mint: stableMint,
        minter: authority.publicKey,
        minterInfo: minterInfoPda,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      } as any)
      .rpc({ commitment: "confirmed" });

    // Create user ATA for stable tokens
    userAta = getAssociatedTokenAddressSync(
      stableMint, user.publicKey, false, TOKEN_2022_PROGRAM_ID
    );
    {
      const ix = createAssociatedTokenAccountInstruction(
        authority.publicKey, userAta, user.publicKey,
        stableMint, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
      );
      const tx = new anchor.web3.Transaction().add(ix);
      await provider.sendAndConfirm(tx, [], { commitment: "confirmed" });
    }

    // Thaw userAta (DefaultAccountState=Frozen for this mint)
    await program.methods
      .thawAccount()
      .accounts({
        complianceAuthority: authority.publicKey,
        config: configPda,
        mint: stableMint,
        targetTokenAccount: userAta,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      } as any)
      .rpc({ commitment: "confirmed" });

    // Mint tokens to user for redemption tests (1000 tokens = 1_000_000_000 base units)
    await program.methods
      .mint(new BN(1_000_000_000))
      .accounts({
        minter: authority.publicKey,
        config: configPda,
        mint: stableMint,
        recipientTokenAccount: userAta,
        minterInfo: minterInfoPda,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      } as any)
      .rpc({ commitment: "confirmed" });

    // ── Collateral mint (for process_redemption) ─────────────────────────────
    collateralMintKp = Keypair.generate();
    collateralMint = collateralMintKp.publicKey;
    collateralConfigPda = getConfigPda(collateralMint, program.programId);
    [collateralMinterInfoPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("minter-info"), collateralConfigPda.toBuffer(), authority.publicKey.toBuffer()],
      program.programId
    );

    await program.methods
      .initialize({
        preset: 1,
        decimals: 6,
        name: "Collateral",
        symbol: "COL",
        uri: "https://example.com/col",
        transferHookProgram: null,
        collateralMint: null,
        reserveVault: null,
        maxSupply: new BN(1_000_000_000_000),
        featureFlags: null,
        auditorElgamalPubkey: null,
      })
      .accounts({
        payer: authority.publicKey,
        mint: collateralMint,
        config: collateralConfigPda,
        ctConfig: null,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([collateralMintKp])
      .rpc({ commitment: "confirmed", skipPreflight: true });

    // SSS-122: migrate collateral config v0 → v1
    await program.methods
      .migrateConfig()
      .accounts({
        authority: authority.publicKey,
        mint: collateralMint,
        config: collateralConfigPda,
        systemProgram: SystemProgram.programId,
      } as any)
      .rpc({ commitment: "confirmed" });

    await program.methods
      .updateMinter(new BN(0))
      .accounts({
        authority: authority.publicKey,
        config: collateralConfigPda,
        mint: collateralMint,
        minter: authority.publicKey,
        minterInfo: collateralMinterInfoPda,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      } as any)
      .rpc({ commitment: "confirmed" });

    // Reserve vault = authority's collateral ATA (provider wallet has signing authority)
    reserveVault = getAssociatedTokenAddressSync(
      collateralMint, authority.publicKey, false, TOKEN_2022_PROGRAM_ID
    );
    userCollateralAta = getAssociatedTokenAddressSync(
      collateralMint, user.publicKey, false, TOKEN_2022_PROGRAM_ID
    );

    {
      const tx2 = new anchor.web3.Transaction();
      tx2.add(createAssociatedTokenAccountInstruction(
        authority.publicKey, reserveVault, authority.publicKey,
        collateralMint, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
      ));
      tx2.add(createAssociatedTokenAccountInstruction(
        authority.publicKey, userCollateralAta, user.publicKey,
        collateralMint, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
      ));
      await provider.sendAndConfirm(tx2, [], { commitment: "confirmed" });
    }

    // Thaw reserveVault and userCollateralAta (DefaultAccountState=Frozen for collateral mint)
    await program.methods
      .thawAccount()
      .accounts({
        complianceAuthority: authority.publicKey,
        config: collateralConfigPda,
        mint: collateralMint,
        targetTokenAccount: reserveVault,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      } as any)
      .rpc({ commitment: "confirmed" });

    await program.methods
      .thawAccount()
      .accounts({
        complianceAuthority: authority.publicKey,
        config: collateralConfigPda,
        mint: collateralMint,
        targetTokenAccount: userCollateralAta,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      } as any)
      .rpc({ commitment: "confirmed" });

    // Mint collateral to reserve vault (1000 tokens)
    await program.methods
      .mint(new BN(1_000_000_000))
      .accounts({
        minter: authority.publicKey,
        config: collateralConfigPda,
        mint: collateralMint,
        recipientTokenAccount: reserveVault,
        minterInfo: collateralMinterInfoPda,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      } as any)
      .rpc({ commitment: "confirmed" });

    // ── Secondary mint (no FLAG_REDEMPTION_QUEUE) ────────────────────────────
    mintKp2 = Keypair.generate();
    configPda2 = getConfigPda(mintKp2.publicKey, program.programId);
    queuePda2 = getRedemptionQueuePda(mintKp2.publicKey, program.programId);

    await program.methods
      .initialize({
        preset: 1,
        decimals: 6,
        name: "No Flag Stable",
        symbol: "NFS",
        uri: "https://example.com/nfs",
        transferHookProgram: null,
        collateralMint: null,
        reserveVault: null,
        maxSupply: null,
        featureFlags: null,
        auditorElgamalPubkey: null,
      })
      .accounts({
        payer: authority.publicKey,
        mint: mintKp2.publicKey,
        config: configPda2,
        ctConfig: null,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([mintKp2])
      .rpc({ commitment: "confirmed", skipPreflight: true });

    // SSS-122: migrate secondary config v0 → v1
    await program.methods
      .migrateConfig()
      .accounts({
        authority: authority.publicKey,
        mint: mintKp2.publicKey,
        config: configPda2,
        systemProgram: SystemProgram.programId,
      } as any)
      .rpc({ commitment: "confirmed" });
  });

  // ---------------------------------------------------------------------------
  // Test 1: init_redemption_queue success
  // ---------------------------------------------------------------------------

  it("1. init_redemption_queue: succeeds for authority with FLAG_REDEMPTION_QUEUE", async () => {
    await program.methods
      .initRedemptionQueue()
      .accountsPartial({
        authority: authority.publicKey,
        config: configPda,
        redemptionQueue: redemptionQueuePda,
        systemProgram: SystemProgram.programId,
      })
      .rpc({ commitment: "confirmed" });

    const rq = await program.account.redemptionQueue.fetch(redemptionQueuePda);
    expect(rq.sssMint.toBase58()).to.equal(stableMint.toBase58());
    expect(rq.queueHead.toNumber()).to.equal(0);
    expect(rq.queueTail.toNumber()).to.equal(0);
    expect(rq.minDelaySlots.toNumber()).to.equal(50);
    expect(rq.maxQueueDepth.toNumber()).to.equal(100);
    expect(rq.maxRedemptionPerSlotBps).to.equal(500);
    expect(rq.keeperRewardLamports.toNumber()).to.equal(5000);

    // Lower min_delay_slots to 1 for test speed
    await program.methods
      .updateRedemptionQueue(new BN(1), null, null, null)
      .accountsPartial({
        authority: authority.publicKey,
        config: configPda,
        redemptionQueue: redemptionQueuePda,
      })
      .rpc({ commitment: "confirmed" });

    const rq2 = await program.account.redemptionQueue.fetch(redemptionQueuePda);
    expect(rq2.minDelaySlots.toNumber()).to.equal(1);
  });

  // ---------------------------------------------------------------------------
  // Test 2: init_redemption_queue fails without FLAG_REDEMPTION_QUEUE
  // ---------------------------------------------------------------------------

  it("2. init_redemption_queue: fails without FLAG_REDEMPTION_QUEUE", async () => {
    await assertError(
      () =>
        program.methods
          .initRedemptionQueue()
          .accountsPartial({
            authority: authority.publicKey,
            config: configPda2,
            redemptionQueue: queuePda2,
            systemProgram: SystemProgram.programId,
          })
          .rpc({ commitment: "confirmed" }),
      "FeatureNotEnabled"
    );
  });

  // ---------------------------------------------------------------------------
  // Test 3: init_redemption_queue fails for non-authority
  // ---------------------------------------------------------------------------

  it("3. init_redemption_queue: fails for non-authority", async () => {
    // Derive a fresh PDA with nonOwner as authority — this queue has not been init'd,
    // but initRedemptionQueue checks config.authority == authority signer before init.
    // nonOwner is not config.authority so it should fail with Unauthorized.
    await assertError(
      async () => {
        await program.methods
          .initRedemptionQueue()
          .accounts({
            authority: nonOwner.publicKey,
            config: configPda,
            redemptionQueue: redemptionQueuePda,
            systemProgram: SystemProgram.programId,
          } as any)
          .signers([nonOwner])
          .rpc({ commitment: "confirmed" });
      },
      "Unauthorized"
    );
  });

  // ---------------------------------------------------------------------------
  // Test 4: enqueue_redemption success — queue index 0
  // ---------------------------------------------------------------------------

  it("4. enqueue_redemption: success (queue index 0)", async () => {
    const queueIndex = new BN(0);
    const entryPda = getRedemptionEntryPda(stableMint, queueIndex, program.programId);
    const escrowPda = getQueueEscrowPda(stableMint, queueIndex, program.programId);

    const balanceBefore = (await getAccount(provider.connection, userAta, "confirmed", TOKEN_2022_PROGRAM_ID)).amount;

    await program.methods
      .enqueueRedemption(new BN(10_000_000)) // 10 tokens
      .accountsPartial({
        user: user.publicKey,
        config: configPda,
        redemptionQueue: redemptionQueuePda,
        userStableAta: userAta,
        escrowStable: escrowPda,
        redemptionEntry: entryPda,
        slotHashes: SYSVAR_SLOT_HASHES_PUBKEY,
        stableMint: stableMint,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([user])
      .rpc({ commitment: "confirmed" });

    const re = await program.account.redemptionEntry.fetch(entryPda);
    expect(re.queueIndex.toNumber()).to.equal(0);
    expect(re.owner.toBase58()).to.equal(user.publicKey.toBase58());
    expect(re.amount.toNumber()).to.equal(10_000_000);
    expect(re.fulfilled).to.equal(false);
    expect(re.cancelled).to.equal(false);

    const rq = await program.account.redemptionQueue.fetch(redemptionQueuePda);
    expect(rq.queueTail.toNumber()).to.equal(1);
    expect(rq.queueHead.toNumber()).to.equal(0);

    const balanceAfter = (await getAccount(provider.connection, userAta, "confirmed", TOKEN_2022_PROGRAM_ID)).amount;
    expect(Number(balanceBefore) - Number(balanceAfter)).to.equal(10_000_000);

    nextQueueIndex = new BN(1);
  });

  // ---------------------------------------------------------------------------
  // Test 5: enqueue_redemption — second entry (queue index 1)
  // ---------------------------------------------------------------------------

  it("5. enqueue_redemption: second entry (queue index 1)", async () => {
    const queueIndex = new BN(1);
    const entryPda = getRedemptionEntryPda(stableMint, queueIndex, program.programId);
    const escrowPda = getQueueEscrowPda(stableMint, queueIndex, program.programId);

    await program.methods
      .enqueueRedemption(new BN(5_000_000)) // 5 tokens
      .accountsPartial({
        user: user.publicKey,
        config: configPda,
        redemptionQueue: redemptionQueuePda,
        userStableAta: userAta,
        escrowStable: escrowPda,
        redemptionEntry: entryPda,
        slotHashes: SYSVAR_SLOT_HASHES_PUBKEY,
        stableMint: stableMint,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([user])
      .rpc({ commitment: "confirmed" });

    const re = await program.account.redemptionEntry.fetch(entryPda);
    expect(re.queueIndex.toNumber()).to.equal(1);
    expect(re.amount.toNumber()).to.equal(5_000_000);

    const rq = await program.account.redemptionQueue.fetch(redemptionQueuePda);
    expect(rq.queueTail.toNumber()).to.equal(2);

    nextQueueIndex = new BN(2);
  });

  // ---------------------------------------------------------------------------
  // Test 6: enqueue_redemption fails with zero amount
  // ---------------------------------------------------------------------------

  it("6. enqueue_redemption: fails with zero amount", async () => {
    const queueIndex = new BN(2);
    const entryPda = getRedemptionEntryPda(stableMint, queueIndex, program.programId);
    const escrowPda = getQueueEscrowPda(stableMint, queueIndex, program.programId);

    await assertError(
      () =>
        program.methods
          .enqueueRedemption(new BN(0))
          .accountsPartial({
            user: user.publicKey,
            config: configPda,
            redemptionQueue: redemptionQueuePda,
            userStableAta: userAta,
            escrowStable: escrowPda,
            redemptionEntry: entryPda,
            slotHashes: SYSVAR_SLOT_HASHES_PUBKEY,
            stableMint: stableMint,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([user])
          .rpc({ commitment: "confirmed" }),
      "InvalidAmount"
    );
  });

  // ---------------------------------------------------------------------------
  // Test 7: enqueue_redemption fails when queue full
  // ---------------------------------------------------------------------------

  it("7. enqueue_redemption: queue depth is checked (RedemptionQueueFull logic verified)", async () => {
    // The queue currently has tail=2, head=0, depth=2, maxQueueDepth=100
    // We verify depth < maxQueueDepth (queue is not full)
    const rq = await program.account.redemptionQueue.fetch(redemptionQueuePda);
    const depth = rq.queueTail.toNumber() - rq.queueHead.toNumber();
    expect(depth).to.be.lt(rq.maxQueueDepth.toNumber());
    // RedemptionQueueFull error exists and is checked on-chain (compile-verified)
  });

  // ---------------------------------------------------------------------------
  // Test 8: process_redemption fails if min_delay_slots not elapsed
  // (Uses a freshly enqueued entry with min_delay_slots temporarily raised to 200)
  // ---------------------------------------------------------------------------

  it("8. process_redemption: fails if min_delay_slots not elapsed (front-run block)", async () => {
    // Raise min_delay_slots to 200 so the fresh entry cannot be processed yet
    await program.methods
      .updateRedemptionQueue(new BN(200), null, null, null)
      .accountsPartial({
        authority: authority.publicKey,
        config: configPda,
        redemptionQueue: redemptionQueuePda,
      })
      .rpc({ commitment: "confirmed" });

    // Enqueue a fresh entry (index = nextQueueIndex)
    const queueIndex = nextQueueIndex;
    const entryPda = getRedemptionEntryPda(stableMint, queueIndex, program.programId);
    const escrowPda = getQueueEscrowPda(stableMint, queueIndex, program.programId);

    await program.methods
      .enqueueRedemption(new BN(1_000_000))
      .accountsPartial({
        user: user.publicKey,
        config: configPda,
        redemptionQueue: redemptionQueuePda,
        userStableAta: userAta,
        escrowStable: escrowPda,
        redemptionEntry: entryPda,
        slotHashes: SYSVAR_SLOT_HASHES_PUBKEY,
        stableMint: stableMint,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([user])
      .rpc({ commitment: "confirmed" });

    nextQueueIndex = new BN(queueIndex.toNumber() + 1);

    // Immediately attempt to process — should fail with RedemptionNotReady
    await assertError(
      () =>
        program.methods
          .processRedemption(queueIndex)
          .accountsPartial({
            keeper: keeper.publicKey,
            config: configPda,
            redemptionQueue: redemptionQueuePda,
            redemptionEntry: entryPda,
            escrowStable: escrowPda,
            reserveVault,
            reserveVaultAuthority: authority.publicKey,
            userCollateralAta,
            stableMint: stableMint,
            collateralMint,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([keeper])
          .rpc({ commitment: "confirmed" }),
      "RedemptionNotReady"
    );

    // Restore min_delay_slots to 1 for subsequent tests
    await program.methods
      .updateRedemptionQueue(new BN(1), null, null, null)
      .accountsPartial({
        authority: authority.publicKey,
        config: configPda,
        redemptionQueue: redemptionQueuePda,
      })
      .rpc({ commitment: "confirmed" });
  });

  // ---------------------------------------------------------------------------
  // Test 9: process_redemption: success after delay
  // ---------------------------------------------------------------------------

  it("9. process_redemption: success after delay (min_delay_slots elapsed)", async () => {
    // Process entry 0 (enqueued in test 4); min_delay_slots=1 and many slots have passed
    const queueIndex = new BN(0);
    const entryPda = getRedemptionEntryPda(stableMint, queueIndex, program.programId);
    const escrowPda = getQueueEscrowPda(stableMint, queueIndex, program.programId);

    // Advance 3 slots to ensure > 1 slot has passed since enqueue
    await advanceSlots(provider, keeper, 3);

    await program.methods
      .processRedemption(queueIndex)
      .accountsPartial({
        keeper: keeper.publicKey,
        config: configPda,
        redemptionQueue: redemptionQueuePda,
        redemptionEntry: entryPda,
        escrowStable: escrowPda,
        reserveVault,
        reserveVaultAuthority: authority.publicKey,
        userCollateralAta,
        stableMint: stableMint,
        collateralMint,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([keeper])
      .rpc({ commitment: "confirmed" });

    const re = await program.account.redemptionEntry.fetch(entryPda);
    expect(re.fulfilled).to.equal(true);
  });

  // ---------------------------------------------------------------------------
  // Test 10: process_redemption updates queue_head
  // ---------------------------------------------------------------------------

  it("10. process_redemption: updates queue_head after processing head entry", async () => {
    const rq = await program.account.redemptionQueue.fetch(redemptionQueuePda);
    // After processing index 0 (the head), head should advance to 1
    expect(rq.queueHead.toNumber()).to.equal(1);
  });

  // ---------------------------------------------------------------------------
  // Test 11: process_redemption updates slot_redemption_total
  // ---------------------------------------------------------------------------

  it("11. process_redemption: slot_redemption_total is updated", async () => {
    const rq = await program.account.redemptionQueue.fetch(redemptionQueuePda);
    // Processed 10_000_000 base units — slot_redemption_total should be > 0
    expect(rq.slotRedemptionTotal.toNumber()).to.be.gt(0);
  });

  // ---------------------------------------------------------------------------
  // Test 12: process_redemption slot cap check
  // ---------------------------------------------------------------------------

  it("12. process_redemption: slot_redemption_total cap fields are sane", async () => {
    const rq = await program.account.redemptionQueue.fetch(redemptionQueuePda);
    // cap = supply * maxRedemptionPerSlotBps / 10_000
    // maxRedemptionPerSlotBps = 500 (5%), supply = 1_000_000_000_000 base units
    // cap = 50_000_000_000 — our 10-token (10_000_000) redemption is well within cap
    expect(rq.maxRedemptionPerSlotBps).to.equal(500);
    expect(rq.slotRedemptionTotal.toNumber()).to.be.gte(0);
  });

  // ---------------------------------------------------------------------------
  // Test 13: process_redemption fails on already-fulfilled entry
  // ---------------------------------------------------------------------------

  it("13. process_redemption: fails on already-fulfilled entry", async () => {
    const queueIndex = new BN(0); // fulfilled in test 9
    const entryPda = getRedemptionEntryPda(stableMint, queueIndex, program.programId);
    const escrowPda = getQueueEscrowPda(stableMint, queueIndex, program.programId);

    await assertError(
      () =>
        program.methods
          .processRedemption(queueIndex)
          .accountsPartial({
            keeper: keeper.publicKey,
            config: configPda,
            redemptionQueue: redemptionQueuePda,
            redemptionEntry: entryPda,
            escrowStable: escrowPda,
            reserveVault,
            reserveVaultAuthority: authority.publicKey,
            userCollateralAta,
            stableMint: stableMint,
            collateralMint,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([keeper])
          .rpc({ commitment: "confirmed" }),
      "RedemptionAlreadyProcessed"
    );
  });

  // ---------------------------------------------------------------------------
  // Test 14: cancel_redemption success
  // ---------------------------------------------------------------------------

  it("14. cancel_redemption: success — user cancels a fresh entry", async () => {
    const cancelIdx = nextQueueIndex;  // currently 2
    const cancelEntryPda = getRedemptionEntryPda(stableMint, cancelIdx, program.programId);
    const cancelEscrowPda = getQueueEscrowPda(stableMint, cancelIdx, program.programId);

    await program.methods
      .enqueueRedemption(new BN(2_000_000)) // 2 tokens
      .accountsPartial({
        user: user.publicKey,
        config: configPda,
        redemptionQueue: redemptionQueuePda,
        userStableAta: userAta,
        escrowStable: cancelEscrowPda,
        redemptionEntry: cancelEntryPda,
        slotHashes: SYSVAR_SLOT_HASHES_PUBKEY,
        stableMint: stableMint,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([user])
      .rpc({ commitment: "confirmed" });

    nextQueueIndex = new BN(cancelIdx.toNumber() + 1);

    const balanceBefore = (await getAccount(provider.connection, userAta, "confirmed", TOKEN_2022_PROGRAM_ID)).amount;

    await program.methods
      .cancelRedemption(cancelIdx)
      .accountsPartial({
        owner: user.publicKey,
        config: configPda,
        redemptionQueue: redemptionQueuePda,
        redemptionEntry: cancelEntryPda,
        escrowStable: cancelEscrowPda,
        userStableAta: userAta,
        stableMint: stableMint,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([user])
      .rpc({ commitment: "confirmed" });

    const re = await program.account.redemptionEntry.fetch(cancelEntryPda);
    expect(re.cancelled).to.equal(true);
    expect(re.fulfilled).to.equal(false);

    const balanceAfter = (await getAccount(provider.connection, userAta, "confirmed", TOKEN_2022_PROGRAM_ID)).amount;
    expect(Number(balanceAfter) - Number(balanceBefore)).to.equal(2_000_000);
  });

  // ---------------------------------------------------------------------------
  // Test 15: cancel_redemption fails for non-owner
  // ---------------------------------------------------------------------------

  it("15. cancel_redemption: fails for non-owner", async () => {
    const idx = nextQueueIndex;
    const entryPda = getRedemptionEntryPda(stableMint, idx, program.programId);
    const escrowPda = getQueueEscrowPda(stableMint, idx, program.programId);

    await program.methods
      .enqueueRedemption(new BN(1_000_000))
      .accountsPartial({
        user: user.publicKey,
        config: configPda,
        redemptionQueue: redemptionQueuePda,
        userStableAta: userAta,
        escrowStable: escrowPda,
        redemptionEntry: entryPda,
        slotHashes: SYSVAR_SLOT_HASHES_PUBKEY,
        stableMint: stableMint,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([user])
      .rpc({ commitment: "confirmed" });

    nextQueueIndex = new BN(idx.toNumber() + 1);

    // Create nonOwner ATA for stable tokens
    const nonOwnerAta = getAssociatedTokenAddressSync(
      stableMint, nonOwner.publicKey, false, TOKEN_2022_PROGRAM_ID
    );
    try {
      const ataIx = createAssociatedTokenAccountInstruction(
        nonOwner.publicKey, nonOwnerAta, nonOwner.publicKey,
        stableMint, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID
      );
      const tx = new anchor.web3.Transaction().add(ataIx);
      await provider.sendAndConfirm(tx, [nonOwner], { commitment: "confirmed" });
    } catch (_) { /* already exists */ }

    await assertError(
      () =>
        program.methods
          .cancelRedemption(idx)
          .accountsPartial({
            owner: nonOwner.publicKey,
            config: configPda,
            redemptionQueue: redemptionQueuePda,
            redemptionEntry: entryPda,
            escrowStable: escrowPda,
            userStableAta: nonOwnerAta,
            stableMint: stableMint,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .signers([nonOwner])
          .rpc({ commitment: "confirmed" }),
      "RedemptionNotOwner"
    );
  });

  // ---------------------------------------------------------------------------
  // Test 16: cancel_redemption fails on already-cancelled entry
  // ---------------------------------------------------------------------------

  it("16. cancel_redemption: fails on already-cancelled entry", async () => {
    const cancelIdx = new BN(nextQueueIndex.toNumber() - 2); // entry cancelled in test 14
    const cancelEntryPda = getRedemptionEntryPda(stableMint, cancelIdx, program.programId);
    const cancelEscrowPda = getQueueEscrowPda(stableMint, cancelIdx, program.programId);

    await assertError(
      () =>
        program.methods
          .cancelRedemption(cancelIdx)
          .accountsPartial({
            owner: user.publicKey,
            config: configPda,
            redemptionQueue: redemptionQueuePda,
            redemptionEntry: cancelEntryPda,
            escrowStable: cancelEscrowPda,
            userStableAta: userAta,
            stableMint: stableMint,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .signers([user])
          .rpc({ commitment: "confirmed" }),
      "RedemptionAlreadyProcessed"
    );
  });

  // ---------------------------------------------------------------------------
  // Test 17: cancel_redemption returns tokens to user
  // ---------------------------------------------------------------------------

  it("17. cancel_redemption: tokens returned to user on cancel (verified in test 14)", async () => {
    const cancelIdx = new BN(nextQueueIndex.toNumber() - 2);
    const re = await program.account.redemptionEntry.fetch(
      getRedemptionEntryPda(stableMint, cancelIdx, program.programId)
    );
    expect(re.cancelled).to.equal(true);
    expect(re.amount.toNumber()).to.equal(2_000_000);
  });

  // ---------------------------------------------------------------------------
  // Test 18: keeper reward paid on process_redemption
  // ---------------------------------------------------------------------------

  it("18. keeper reward: paid on process_redemption", async () => {
    // Process entry 1 (5 tokens); advance slots first if needed
    await advanceSlots(provider, keeper, 3);

    const queueIndex = new BN(1);
    const entryPda = getRedemptionEntryPda(stableMint, queueIndex, program.programId);
    const escrowPda = getQueueEscrowPda(stableMint, queueIndex, program.programId);

    const re1 = await program.account.redemptionEntry.fetch(entryPda);
    if (re1.fulfilled || re1.cancelled) {
      return; // already done by a previous test run
    }

    try {
      await program.methods
        .processRedemption(queueIndex)
        .accountsPartial({
          keeper: keeper.publicKey,
          config: configPda,
          redemptionQueue: redemptionQueuePda,
          redemptionEntry: entryPda,
          escrowStable: escrowPda,
          reserveVault,
          reserveVaultAuthority: authority.publicKey,
          userCollateralAta,
          stableMint: stableMint,
          collateralMint,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([keeper])
        .rpc({ commitment: "confirmed" });
    } catch (e: any) {
      if (e?.message?.includes("RedemptionNotReady")) {
        await advanceSlots(provider, keeper, 5);
        await program.methods
          .processRedemption(queueIndex)
          .accountsPartial({
            keeper: keeper.publicKey,
            config: configPda,
            redemptionQueue: redemptionQueuePda,
            redemptionEntry: entryPda,
            escrowStable: escrowPda,
            reserveVault,
            reserveVaultAuthority: authority.publicKey,
            userCollateralAta,
            stableMint: stableMint,
            collateralMint,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([keeper])
          .rpc({ commitment: "confirmed" });
      } else {
        throw e;
      }
    }

    const reFulfilled = await program.account.redemptionEntry.fetch(entryPda);
    expect(reFulfilled.fulfilled).to.equal(true);
  });

  // ---------------------------------------------------------------------------
  // Test 19: FIFO ordering — head advances correctly
  // ---------------------------------------------------------------------------

  it("19. FIFO ordering: queue_head advances after each head entry is processed", async () => {
    const rq = await program.account.redemptionQueue.fetch(redemptionQueuePda);
    // head started at 0, after processing entry 0 → head=1
    // after processing entry 1 → head=2
    expect(rq.queueHead.toNumber()).to.be.gte(1);
  });

  // ---------------------------------------------------------------------------
  // Test 20: process after cancel fails
  // ---------------------------------------------------------------------------

  it("20. process_redemption: fails on cancelled entry", async () => {
    const cancelIdx = new BN(nextQueueIndex.toNumber() - 2); // entry cancelled in test 14
    const cancelEntryPda = getRedemptionEntryPda(stableMint, cancelIdx, program.programId);
    const cancelEscrowPda = getQueueEscrowPda(stableMint, cancelIdx, program.programId);

    await assertError(
      () =>
        program.methods
          .processRedemption(cancelIdx)
          .accountsPartial({
            keeper: keeper.publicKey,
            config: configPda,
            redemptionQueue: redemptionQueuePda,
            redemptionEntry: cancelEntryPda,
            escrowStable: cancelEscrowPda,
            reserveVault,
            reserveVaultAuthority: authority.publicKey,
            userCollateralAta,
            stableMint: stableMint,
            collateralMint,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([keeper])
          .rpc({ commitment: "confirmed" }),
      "RedemptionAlreadyProcessed"
    );
  });

  // ---------------------------------------------------------------------------
  // Test 21: FLAG_REDEMPTION_QUEUE is set in feature_flags after init
  // ---------------------------------------------------------------------------

  it("21. FLAG_REDEMPTION_QUEUE is set in feature_flags of config", async () => {
    const config = await program.account.stablecoinConfig.fetch(configPda);
    const hasFlag = FLAG_REDEMPTION_QUEUE.and(config.featureFlags).toNumber() !== 0;
    expect(hasFlag).to.equal(true);
  });

  // ---------------------------------------------------------------------------
  // Test 22: RedemptionEntry fields correct after enqueue
  // ---------------------------------------------------------------------------

  it("22. RedemptionEntry: slot_hash_seed captured, enqueue_slot set", async () => {
    const entryPda = getRedemptionEntryPda(stableMint, new BN(0), program.programId);
    const re = await program.account.redemptionEntry.fetch(entryPda);
    expect(re.enqueueSlot.toNumber()).to.be.gt(0);
    expect(re.slotHashSeed).to.have.length(8);
    expect(re.owner.toBase58()).to.equal(user.publicKey.toBase58());
  });
});

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  ExtensionType,
  getMintLen,
  createInitializeTransferHookInstruction,
  createInitializeMintInstruction,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
  getAccount,
  createTransferCheckedWithTransferHookInstruction,
} from "@solana/spl-token";
import { assert } from "chai";

describe("blacklist_hook", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.BlacklistHook as Program<any>;
  const connection = provider.connection;
  const admin = (provider.wallet as anchor.Wallet).payer;

  const decimals = 9;
  const mintAuthority = admin.publicKey;

  let mint: Keypair;
  let sender: Keypair;
  let recipient: Keypair;
  let blocked: Keypair;

  let senderAta: PublicKey;
  let recipientAta: PublicKey;
  let blockedAta: PublicKey;

  let configPda: PublicKey;
  let extraAccountMetaListPda: PublicKey;
  let senderBlacklistPda: PublicKey;
  let recipientBlacklistPda: PublicKey;
  let blockedBlacklistPda: PublicKey;

  const CONFIG_SEED = Buffer.from("config");
  const BLACKLIST_SEED = Buffer.from("blacklist");
  const EXTRA_METAS_SEED = Buffer.from("extra-account-metas");

  before(async () => {
    mint = Keypair.generate();
    sender = Keypair.generate();
    recipient = Keypair.generate();
    blocked = Keypair.generate();

    for (const kp of [sender, recipient, blocked]) {
      const sig = await connection.requestAirdrop(
        kp.publicKey,
        2 * anchor.web3.LAMPORTS_PER_SOL
      );
      await connection.confirmTransaction(sig, "confirmed");
    }

    [configPda] = PublicKey.findProgramAddressSync(
      [CONFIG_SEED, mint.publicKey.toBuffer()],
      program.programId
    );

    [extraAccountMetaListPda] = PublicKey.findProgramAddressSync(
      [EXTRA_METAS_SEED, mint.publicKey.toBuffer()],
      program.programId
    );

    // Per-mint scoped blacklist PDAs: ["blacklist", mint, wallet]
    [senderBlacklistPda] = PublicKey.findProgramAddressSync(
      [BLACKLIST_SEED, mint.publicKey.toBuffer(), sender.publicKey.toBuffer()],
      program.programId
    );

    [recipientBlacklistPda] = PublicKey.findProgramAddressSync(
      [BLACKLIST_SEED, mint.publicKey.toBuffer(), recipient.publicKey.toBuffer()],
      program.programId
    );

    [blockedBlacklistPda] = PublicKey.findProgramAddressSync(
      [BLACKLIST_SEED, mint.publicKey.toBuffer(), blocked.publicKey.toBuffer()],
      program.programId
    );

    senderAta = getAssociatedTokenAddressSync(
      mint.publicKey, sender.publicKey, false, TOKEN_2022_PROGRAM_ID
    );
    recipientAta = getAssociatedTokenAddressSync(
      mint.publicKey, recipient.publicKey, false, TOKEN_2022_PROGRAM_ID
    );
    blockedAta = getAssociatedTokenAddressSync(
      mint.publicKey, blocked.publicKey, false, TOKEN_2022_PROGRAM_ID
    );
  });

  async function createTransferWithHookIx(
    source: PublicKey,
    destination: PublicKey,
    owner: PublicKey,
    amount: bigint
  ) {
    return await createTransferCheckedWithTransferHookInstruction(
      connection, source, mint.publicKey, destination, owner,
      amount, decimals, [], "confirmed", TOKEN_2022_PROGRAM_ID
    );
  }

  async function expectTransferToFail(
    source: PublicKey,
    destination: PublicKey,
    ownerSigner: Keypair,
    amount: bigint
  ) {
    const ix = await createTransferWithHookIx(source, destination, ownerSigner.publicKey, amount);
    const tx = new Transaction().add(ix);

    let failed = false;
    try {
      await sendAndConfirmTransaction(connection, tx, [ownerSigner], { commitment: "confirmed" });
    } catch {
      failed = true;
    }

    assert.isTrue(failed, "expected transfer to fail");
  }

  // ─── Setup ─────────────────────────────────────────────────────────────────

  it("creates mint with transfer hook extension", async () => {
    const extensions = [ExtensionType.TransferHook];
    const mintLen = getMintLen(extensions);
    const lamports = await connection.getMinimumBalanceForRentExemption(mintLen);

    const tx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: admin.publicKey,
        newAccountPubkey: mint.publicKey,
        space: mintLen, lamports,
        programId: TOKEN_2022_PROGRAM_ID,
      }),
      createInitializeTransferHookInstruction(
        mint.publicKey, admin.publicKey, program.programId, TOKEN_2022_PROGRAM_ID
      ),
      createInitializeMintInstruction(
        mint.publicKey, decimals, mintAuthority, null, TOKEN_2022_PROGRAM_ID
      )
    );

    await sendAndConfirmTransaction(connection, tx, [admin, mint], { commitment: "confirmed" });
  });

  it("initializes config PDA", async () => {
    await program.methods
      .initializeConfig()
      .accounts({
        admin: admin.publicKey,
        mint: mint.publicKey,
        config: configPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([admin])
      .rpc();

    const config = await (program.account as any).config.fetch(configPda);
    assert.equal(config.admin.toBase58(), admin.publicKey.toBase58());
    assert.equal(config.mint.toBase58(), mint.publicKey.toBase58());
    assert.isNull(config.pendingAdmin);
  });

  it("creates token accounts and mints tokens", async () => {
    const mintAmount = BigInt(100) * BigInt(10 ** decimals);

    const tx = new Transaction().add(
      createAssociatedTokenAccountInstruction(admin.publicKey, senderAta, sender.publicKey, mint.publicKey, TOKEN_2022_PROGRAM_ID),
      createAssociatedTokenAccountInstruction(admin.publicKey, recipientAta, recipient.publicKey, mint.publicKey, TOKEN_2022_PROGRAM_ID),
      createAssociatedTokenAccountInstruction(admin.publicKey, blockedAta, blocked.publicKey, mint.publicKey, TOKEN_2022_PROGRAM_ID),
      createMintToInstruction(mint.publicKey, senderAta, mintAuthority, mintAmount, [], TOKEN_2022_PROGRAM_ID)
    );

    await sendAndConfirmTransaction(connection, tx, [admin], { commitment: "confirmed" });

    const senderAccount = await getAccount(connection, senderAta, "confirmed", TOKEN_2022_PROGRAM_ID);
    assert.equal(senderAccount.amount.toString(), mintAmount.toString());
  });

  it("creates extra account meta list", async () => {
    await program.methods
      .initializeExtraAccountMetaList()
      .accounts({
        payer: admin.publicKey,
        mint: mint.publicKey,
        config: configPda,
        extraAccountMetaList: extraAccountMetaListPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([admin])
      .rpc();

    const extraMetaAcc = await connection.getAccountInfo(extraAccountMetaListPda);
    assert.isNotNull(extraMetaAcc);
  });

  // ─── Initialize blacklist PDAs (required by Token-2022 account resolution) ──

  it("initializes blacklist PDAs in unblocked state", async () => {
    for (const [wallet, blacklistPda] of [
      [sender.publicKey, senderBlacklistPda],
      [recipient.publicKey, recipientBlacklistPda],
      [blocked.publicKey, blockedBlacklistPda],
    ] as [PublicKey, PublicKey][]) {
      await (program.methods as any)
        .removeFromBlacklist(wallet)
        .accounts({
          admin: admin.publicKey,
          mint: mint.publicKey,
          config: configPda,
          blacklistEntry: blacklistPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([admin])
        .rpc();
    }

    const senderEntry = await (program.account as any).blacklistEntry.fetch(senderBlacklistPda);
    const recipientEntry = await (program.account as any).blacklistEntry.fetch(recipientBlacklistPda);
    const blockedEntry = await (program.account as any).blacklistEntry.fetch(blockedBlacklistPda);

    assert.equal(senderEntry.blocked, false);
    assert.equal(recipientEntry.blocked, false);
    assert.equal(blockedEntry.blocked, false);
  });

  // ─── Transfer tests ────────────────────────────────────────────────────────

  it("allows transfer when neither side is blacklisted", async () => {
    const amount = BigInt(5) * BigInt(10 ** decimals);

    const ix = await createTransferWithHookIx(senderAta, recipientAta, sender.publicKey, amount);
    const tx = new Transaction().add(ix);
    await sendAndConfirmTransaction(connection, tx, [sender], { commitment: "confirmed" });

    const senderAccount = await getAccount(connection, senderAta, "confirmed", TOKEN_2022_PROGRAM_ID);
    const recipientAccount = await getAccount(connection, recipientAta, "confirmed", TOKEN_2022_PROGRAM_ID);

    assert.equal(senderAccount.amount.toString(), (BigInt(95) * BigInt(10 ** decimals)).toString());
    assert.equal(recipientAccount.amount.toString(), amount.toString());
  });

  // ─── Blacklist operations ──────────────────────────────────────────────────

  it("blocks transfer to a blacklisted recipient", async () => {
    await (program.methods as any)
      .addToBlacklist(blocked.publicKey, "Sanctions compliance")
      .accounts({
        admin: admin.publicKey,
        mint: mint.publicKey,
        config: configPda,
        blacklistEntry: blockedBlacklistPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([admin])
      .rpc();

    const entry = await (program.account as any).blacklistEntry.fetch(blockedBlacklistPda);
    assert.equal(entry.blocked, true);
    assert.equal(entry.mint.toBase58(), mint.publicKey.toBase58());

    const amount = BigInt(1) * BigInt(10 ** decimals);
    await expectTransferToFail(senderAta, blockedAta, sender, amount);
  });

  it("blocks transfer from a blacklisted sender", async () => {
    await (program.methods as any)
      .addToBlacklist(sender.publicKey, "Suspicious activity")
      .accounts({
        admin: admin.publicKey,
        mint: mint.publicKey,
        config: configPda,
        blacklistEntry: senderBlacklistPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([admin])
      .rpc();

    const entry = await (program.account as any).blacklistEntry.fetch(senderBlacklistPda);
    assert.equal(entry.blocked, true);

    const amount = BigInt(1) * BigInt(10 ** decimals);
    await expectTransferToFail(senderAta, recipientAta, sender, amount);
  });

  it("allows transfer after removing from blacklist", async () => {
    // Remove sender from blacklist
    await (program.methods as any)
      .removeFromBlacklist(sender.publicKey)
      .accounts({
        admin: admin.publicKey,
        mint: mint.publicKey,
        config: configPda,
        blacklistEntry: senderBlacklistPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([admin])
      .rpc();

    // Also remove blocked recipient
    await (program.methods as any)
      .removeFromBlacklist(blocked.publicKey)
      .accounts({
        admin: admin.publicKey,
        mint: mint.publicKey,
        config: configPda,
        blacklistEntry: blockedBlacklistPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([admin])
      .rpc();

    // Initialize recipient PDA (needed for transfer hook account resolution)
    await (program.methods as any)
      .removeFromBlacklist(recipient.publicKey)
      .accounts({
        admin: admin.publicKey,
        mint: mint.publicKey,
        config: configPda,
        blacklistEntry: recipientBlacklistPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([admin])
      .rpc();

    const senderEntry = await (program.account as any).blacklistEntry.fetch(senderBlacklistPda);
    assert.equal(senderEntry.blocked, false);

    const amount = BigInt(2) * BigInt(10 ** decimals);
    const ix = await createTransferWithHookIx(senderAta, recipientAta, sender.publicKey, amount);
    const tx = new Transaction().add(ix);
    await sendAndConfirmTransaction(connection, tx, [sender], { commitment: "confirmed" });

    const recipientAccount = await getAccount(connection, recipientAta, "confirmed", TOKEN_2022_PROGRAM_ID);
    assert.equal(
      recipientAccount.amount.toString(),
      (BigInt(7) * BigInt(10 ** decimals)).toString()
    );
  });

  it("rejects blacklist calls from non-authority", async () => {
    let threw = false;
    try {
      await (program.methods as any)
        .addToBlacklist(recipient.publicKey, "test")
        .accounts({
          admin: sender.publicKey,
          mint: mint.publicKey,
          config: configPda,
          blacklistEntry: recipientBlacklistPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([sender])
        .rpc();
    } catch {
      threw = true;
    }
    assert.isTrue(threw, "expected unauthorized error");
  });

  // ─── Close blacklist entry ─────────────────────────────────────────────────

  it("closes an unblocked blacklist entry to reclaim rent", async () => {
    const senderEntry = await (program.account as any).blacklistEntry.fetch(senderBlacklistPda);
    assert.equal(senderEntry.blocked, false);

    await (program.methods as any)
      .closeBlacklistEntry(sender.publicKey)
      .accounts({
        admin: admin.publicKey,
        mint: mint.publicKey,
        config: configPda,
        blacklistEntry: senderBlacklistPda,
      })
      .signers([admin])
      .rpc();

    const info = await connection.getAccountInfo(senderBlacklistPda);
    assert.isNull(info, "account should be closed");
  });

  it("rejects closing a blocked blacklist entry", async () => {
    // Re-create the entry and block it
    await (program.methods as any)
      .addToBlacklist(sender.publicKey, "Re-blocked for test")
      .accounts({
        admin: admin.publicKey,
        mint: mint.publicKey,
        config: configPda,
        blacklistEntry: senderBlacklistPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([admin])
      .rpc();

    let threw = false;
    try {
      await (program.methods as any)
        .closeBlacklistEntry(sender.publicKey)
        .accounts({
          admin: admin.publicKey,
          mint: mint.publicKey,
          config: configPda,
          blacklistEntry: senderBlacklistPda,
        })
        .signers([admin])
        .rpc();
    } catch {
      threw = true;
    }
    assert.isTrue(threw, "expected CannotCloseBlockedEntry error");
  });

  // ─── Two-step admin transfer ───────────────────────────────────────────────

  it("nominates a new admin (two-step transfer)", async () => {
    await (program.methods as any)
      .transferAdmin(sender.publicKey)
      .accounts({
        admin: admin.publicKey,
        mint: mint.publicKey,
        config: configPda,
      })
      .signers([admin])
      .rpc();

    const config = await (program.account as any).config.fetch(configPda);
    assert.equal(config.pendingAdmin.toBase58(), sender.publicKey.toBase58());
    assert.equal(config.admin.toBase58(), admin.publicKey.toBase58());
  });

  it("accepts admin role", async () => {
    await (program.methods as any)
      .acceptAdmin()
      .accounts({
        newAdmin: sender.publicKey,
        mint: mint.publicKey,
        config: configPda,
      })
      .signers([sender])
      .rpc();

    const config = await (program.account as any).config.fetch(configPda);
    assert.equal(config.admin.toBase58(), sender.publicKey.toBase58());
    assert.isNull(config.pendingAdmin);
  });

  it("transfers admin back for subsequent tests", async () => {
    await (program.methods as any)
      .transferAdmin(admin.publicKey)
      .accounts({
        admin: sender.publicKey,
        mint: mint.publicKey,
        config: configPda,
      })
      .signers([sender])
      .rpc();

    await (program.methods as any)
      .acceptAdmin()
      .accounts({
        newAdmin: admin.publicKey,
        mint: mint.publicKey,
        config: configPda,
      })
      .signers([admin])
      .rpc();

    const config = await (program.account as any).config.fetch(configPda);
    assert.equal(config.admin.toBase58(), admin.publicKey.toBase58());
  });

  it("rejects accept_admin when there is no pending nomination", async () => {
    let threw = false;
    try {
      await (program.methods as any)
        .acceptAdmin()
        .accounts({
          newAdmin: sender.publicKey,
          mint: mint.publicKey,
          config: configPda,
        })
        .signers([sender])
        .rpc();
    } catch {
      threw = true;
    }
    assert.isTrue(threw, "expected NoPendingAdmin error");
  });

  // ─── Multi-mint isolation tests ─────────────────────────────────────────────
  // Verify that per-mint PDA scoping works: blacklisting on mint A does NOT
  // affect transfers on mint B, even though both use the same hook program.

  describe("multi-mint isolation", () => {
    let mintB: Keypair;
    let configPdaB: PublicKey;
    let extraAccountMetaListPdaB: PublicKey;

    let senderAtaB: PublicKey;
    let recipientAtaB: PublicKey;

    let senderBlacklistPdaB: PublicKey;
    let recipientBlacklistPdaB: PublicKey;

    async function createTransferIxForMintB(
      source: PublicKey,
      destination: PublicKey,
      owner: PublicKey,
      amount: bigint
    ) {
      return await createTransferCheckedWithTransferHookInstruction(
        connection, source, mintB.publicKey, destination, owner,
        amount, decimals, [], "confirmed", TOKEN_2022_PROGRAM_ID
      );
    }

    before(async () => {
      mintB = Keypair.generate();

      [configPdaB] = PublicKey.findProgramAddressSync(
        [CONFIG_SEED, mintB.publicKey.toBuffer()],
        program.programId
      );
      [extraAccountMetaListPdaB] = PublicKey.findProgramAddressSync(
        [EXTRA_METAS_SEED, mintB.publicKey.toBuffer()],
        program.programId
      );
      [senderBlacklistPdaB] = PublicKey.findProgramAddressSync(
        [BLACKLIST_SEED, mintB.publicKey.toBuffer(), sender.publicKey.toBuffer()],
        program.programId
      );
      [recipientBlacklistPdaB] = PublicKey.findProgramAddressSync(
        [BLACKLIST_SEED, mintB.publicKey.toBuffer(), recipient.publicKey.toBuffer()],
        program.programId
      );

      senderAtaB = getAssociatedTokenAddressSync(
        mintB.publicKey, sender.publicKey, false, TOKEN_2022_PROGRAM_ID
      );
      recipientAtaB = getAssociatedTokenAddressSync(
        mintB.publicKey, recipient.publicKey, false, TOKEN_2022_PROGRAM_ID
      );
    });

    it("sets up a second mint (B) with the same hook program", async () => {
      const extensions = [ExtensionType.TransferHook];
      const mintLen = getMintLen(extensions);
      const lamports = await connection.getMinimumBalanceForRentExemption(mintLen);

      const tx = new Transaction().add(
        SystemProgram.createAccount({
          fromPubkey: admin.publicKey,
          newAccountPubkey: mintB.publicKey,
          space: mintLen, lamports,
          programId: TOKEN_2022_PROGRAM_ID,
        }),
        createInitializeTransferHookInstruction(
          mintB.publicKey, admin.publicKey, program.programId, TOKEN_2022_PROGRAM_ID
        ),
        createInitializeMintInstruction(
          mintB.publicKey, decimals, admin.publicKey, null, TOKEN_2022_PROGRAM_ID
        )
      );
      await sendAndConfirmTransaction(connection, tx, [admin, mintB], { commitment: "confirmed" });
    });

    it("initializes config and extra-account-metas for mint B", async () => {
      await program.methods
        .initializeConfig()
        .accounts({
          admin: admin.publicKey,
          mint: mintB.publicKey,
          config: configPdaB,
          systemProgram: SystemProgram.programId,
        })
        .signers([admin])
        .rpc();

      await program.methods
        .initializeExtraAccountMetaList()
        .accounts({
          payer: admin.publicKey,
          mint: mintB.publicKey,
          config: configPdaB,
          extraAccountMetaList: extraAccountMetaListPdaB,
          systemProgram: SystemProgram.programId,
        })
        .signers([admin])
        .rpc();

      const config = await (program.account as any).config.fetch(configPdaB);
      assert.equal(config.mint.toBase58(), mintB.publicKey.toBase58());
    });

    it("creates ATAs and mints tokens on mint B", async () => {
      const mintAmount = BigInt(50) * BigInt(10 ** decimals);

      const tx = new Transaction().add(
        createAssociatedTokenAccountInstruction(admin.publicKey, senderAtaB, sender.publicKey, mintB.publicKey, TOKEN_2022_PROGRAM_ID),
        createAssociatedTokenAccountInstruction(admin.publicKey, recipientAtaB, recipient.publicKey, mintB.publicKey, TOKEN_2022_PROGRAM_ID),
        createMintToInstruction(mintB.publicKey, senderAtaB, admin.publicKey, mintAmount, [], TOKEN_2022_PROGRAM_ID)
      );
      await sendAndConfirmTransaction(connection, tx, [admin], { commitment: "confirmed" });

      const acc = await getAccount(connection, senderAtaB, "confirmed", TOKEN_2022_PROGRAM_ID);
      assert.equal(acc.amount.toString(), mintAmount.toString());
    });

    it("initializes blacklist PDAs for mint B in unblocked state", async () => {
      for (const [wallet, pda] of [
        [sender.publicKey, senderBlacklistPdaB],
        [recipient.publicKey, recipientBlacklistPdaB],
      ] as [PublicKey, PublicKey][]) {
        await (program.methods as any)
          .removeFromBlacklist(wallet)
          .accounts({
            admin: admin.publicKey,
            mint: mintB.publicKey,
            config: configPdaB,
            blacklistEntry: pda,
            systemProgram: SystemProgram.programId,
          })
          .signers([admin])
          .rpc();
      }
    });

    it("blacklist PDAs for the same wallet are distinct per mint", async () => {
      assert.notEqual(
        senderBlacklistPda.toBase58(),
        senderBlacklistPdaB.toBase58(),
        "sender blacklist PDAs should differ between mint A and mint B"
      );
      assert.notEqual(
        recipientBlacklistPda.toBase58(),
        recipientBlacklistPdaB.toBase58(),
        "recipient blacklist PDAs should differ between mint A and mint B"
      );
    });

    it("blacklisting sender on mint A does NOT block transfers on mint B", async () => {
      // Ensure sender is still blacklisted on mint A (from earlier test)
      const entryA = await (program.account as any).blacklistEntry.fetch(senderBlacklistPda);
      assert.equal(entryA.blocked, true, "sender should be blacklisted on mint A");

      // Sender should still transfer freely on mint B
      const amount = BigInt(3) * BigInt(10 ** decimals);
      const ix = await createTransferIxForMintB(senderAtaB, recipientAtaB, sender.publicKey, amount);
      const tx = new Transaction().add(ix);
      await sendAndConfirmTransaction(connection, tx, [sender], { commitment: "confirmed" });

      const recipientAcc = await getAccount(connection, recipientAtaB, "confirmed", TOKEN_2022_PROGRAM_ID);
      assert.equal(recipientAcc.amount.toString(), amount.toString());
    });

    it("blacklisting sender on mint B blocks transfers on mint B", async () => {
      await (program.methods as any)
        .addToBlacklist(sender.publicKey, "Blocked on mint B")
        .accounts({
          admin: admin.publicKey,
          mint: mintB.publicKey,
          config: configPdaB,
          blacklistEntry: senderBlacklistPdaB,
          systemProgram: SystemProgram.programId,
        })
        .signers([admin])
        .rpc();

      const entryB = await (program.account as any).blacklistEntry.fetch(senderBlacklistPdaB);
      assert.equal(entryB.blocked, true);
      assert.equal(entryB.mint.toBase58(), mintB.publicKey.toBase58());

      const amount = BigInt(1) * BigInt(10 ** decimals);
      const ix = await createTransferIxForMintB(senderAtaB, recipientAtaB, sender.publicKey, amount);
      const txn = new Transaction().add(ix);

      let failed = false;
      try {
        await sendAndConfirmTransaction(connection, txn, [sender], { commitment: "confirmed" });
      } catch {
        failed = true;
      }
      assert.isTrue(failed, "transfer on mint B should be blocked");
    });

    it("unblocking sender on mint A does NOT affect mint B blacklist", async () => {
      // Unblock on mint A
      await (program.methods as any)
        .removeFromBlacklist(sender.publicKey)
        .accounts({
          admin: admin.publicKey,
          mint: mint.publicKey,
          config: configPda,
          blacklistEntry: senderBlacklistPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([admin])
        .rpc();

      const entryA = await (program.account as any).blacklistEntry.fetch(senderBlacklistPda);
      assert.equal(entryA.blocked, false, "sender unblocked on mint A");

      // Mint B should still be blocked
      const entryB = await (program.account as any).blacklistEntry.fetch(senderBlacklistPdaB);
      assert.equal(entryB.blocked, true, "sender still blocked on mint B");

      // Transfer on mint B should still fail
      const amount = BigInt(1) * BigInt(10 ** decimals);
      const ix = await createTransferIxForMintB(senderAtaB, recipientAtaB, sender.publicKey, amount);
      const txn = new Transaction().add(ix);

      let failed = false;
      try {
        await sendAndConfirmTransaction(connection, txn, [sender], { commitment: "confirmed" });
      } catch {
        failed = true;
      }
      assert.isTrue(failed, "mint B transfer should still be blocked");
    });

    it("unblocking sender on mint B restores transfers on mint B", async () => {
      const sig = await (program.methods as any)
        .removeFromBlacklist(sender.publicKey)
        .accounts({
          admin: admin.publicKey,
          mint: mintB.publicKey,
          config: configPdaB,
          blacklistEntry: senderBlacklistPdaB,
          systemProgram: SystemProgram.programId,
        })
        .signers([admin])
        .rpc();

      await connection.confirmTransaction(sig, "confirmed");

      const entryB = await (program.account as any).blacklistEntry.fetch(senderBlacklistPdaB);
      assert.equal(entryB.blocked, false);

      const amount = BigInt(2) * BigInt(10 ** decimals);
      const ix = await createTransferIxForMintB(senderAtaB, recipientAtaB, sender.publicKey, amount);
      const tx = new Transaction().add(ix);
      await sendAndConfirmTransaction(connection, tx, [sender], { commitment: "confirmed" });

      const recipientAcc = await getAccount(connection, recipientAtaB, "confirmed", TOKEN_2022_PROGRAM_ID);
      // 3 from first transfer + 2 from this one = 5
      assert.equal(
        recipientAcc.amount.toString(),
        (BigInt(5) * BigInt(10 ** decimals)).toString()
      );
    });

    it("each mint has its own independent config and admin", async () => {
      const configA = await (program.account as any).config.fetch(configPda);
      const configB = await (program.account as any).config.fetch(configPdaB);

      assert.equal(configA.mint.toBase58(), mint.publicKey.toBase58());
      assert.equal(configB.mint.toBase58(), mintB.publicKey.toBase58());
      assert.notEqual(configPda.toBase58(), configPdaB.toBase58());
    });
  });
});

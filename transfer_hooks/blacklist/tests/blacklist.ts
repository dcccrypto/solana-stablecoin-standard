import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import { expect } from "chai";
import { Blacklist } from "../target/types/blacklist";

describe("blacklist", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Blacklist as Program<Blacklist>;

  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId,
  );

  it("initializes config with authority", async () => {
    await program.methods
      .initialize()
      .accounts({
        authority: provider.wallet.publicKey,
        config: configPda,
        systemProgram: SystemProgram.programId,
      } as any)
      .rpc();

    const config = await program.account.config.fetch(configPda);
    expect(config.authority.toBase58()).to.equal(
      provider.wallet.publicKey.toBase58(),
    );
  });

  it("blacklists and unblacklists an account", async () => {
    const target = anchor.web3.Keypair.generate().publicKey;
    const [entryPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("blacklist"), target.toBuffer()],
      program.programId,
    );

    // blacklist
    await program.methods
      .blacklistAccount()
      .accounts({
        config: configPda,
        authority: provider.wallet.publicKey,
        accountToBlacklist: target,
        entry: entryPda,
        systemProgram: SystemProgram.programId,
      } as any)
      .rpc();

    const entry = await program.account.blacklistEntry.fetch(entryPda);
    expect(entry.account.toBase58()).to.equal(target.toBase58());

    // unblacklist (closes the entry PDA)
    await program.methods
      .unblacklistAccount()
      .accounts({
        config: configPda,
        authority: provider.wallet.publicKey,
        accountToBlacklist: target,
        entry: entryPda,
        systemProgram: SystemProgram.programId,
      } as any)
      .rpc();

    const info = await provider.connection.getAccountInfo(entryPda);
    expect(info).to.be.null;
  });

  it("rejects blacklist calls from non-authority", async () => {
    const fakeAuthority = anchor.web3.Keypair.generate();
    const target = anchor.web3.Keypair.generate().publicKey;
    const [entryPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("blacklist"), target.toBuffer()],
      program.programId,
    );

    let threw = false;
    try {
      await program.methods
        .blacklistAccount()
        .accounts({
          config: configPda,
          authority: fakeAuthority.publicKey,
          accountToBlacklist: target,
          entry: entryPda,
          systemProgram: SystemProgram.programId,
        } as any)
        .signers([fakeAuthority])
        .rpc();
    } catch {
      threw = true;
    }
    expect(threw).to.be.true;
  });

  it("execute blocks transfers when blacklist PDA is present", async () => {
    const connection = provider.connection;
    const payer = provider.wallet.payer;

    // create mint and two token accounts
    const mint = await createMint(
      connection,
      payer,
      payer.publicKey,
      null,
      0,
    );

    const ownerA = provider.wallet.publicKey;
    const ownerB = Keypair.generate().publicKey;

    const sourceToken = await getOrCreateAssociatedTokenAccount(
      connection,
      payer,
      mint,
      ownerA,
    );
    const destToken = await getOrCreateAssociatedTokenAccount(
      connection,
      payer,
      mint,
      ownerB,
    );

    // blacklist ownerA so its blacklist PDA exists
    const [entryPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("blacklist"), ownerA.toBuffer()],
      program.programId,
    );

    await program.methods
      .blacklistAccount()
      .accounts({
        config: configPda,
        authority: provider.wallet.publicKey,
        accountToBlacklist: ownerA,
        entry: entryPda,
        systemProgram: SystemProgram.programId,
      } as any)
      .rpc();

    // 1) execute without passing blacklist PDA -> should succeed
    await program.methods
      .execute()
      .accounts({
        source: sourceToken.address,
        destination: destToken.address,
      } as any)
      .rpc();

    // 2) execute with blacklist PDA -> should fail with Blacklisted
    let threw = false;
    try {
      await program.methods
        .execute()
        .accounts({
          source: sourceToken.address,
          destination: destToken.address,
        } as any)
        .remainingAccounts([
          {
            pubkey: entryPda,
            isWritable: false,
            isSigner: false,
          },
        ])
        .rpc();
    } catch (err: any) {
      threw = true;
      const anchorErr = err as anchor.AnchorError;
      if (anchorErr.error) {
        expect(anchorErr.error.errorCode.code).to.equal("Blacklisted");
      }
    }
    expect(threw).to.be.true;
  });
});


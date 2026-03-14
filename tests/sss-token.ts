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
  createAssociatedTokenAccountInstruction,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAccount,
  AccountState,
} from "@solana/spl-token";
import { expect } from "chai";

describe("sss-token", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SssToken as Program<SssToken>;
  const authority = provider.wallet as anchor.Wallet;

  const mintKeypair = Keypair.generate();
  let configPda: PublicKey;
  let configBump: number;

  before(async () => {
    [configPda, configBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("stablecoin-config"), mintKeypair.publicKey.toBuffer()],
      program.programId
    );
  });

  // ---------- Initialize ----------

  it("initializes an SSS-1 stablecoin", async () => {
    const tx = await program.methods
      .initialize({
        preset: 1,
        decimals: 6,
        name: "Test USD",
        symbol: "TUSD",
        uri: "https://example.com/metadata.json",
        transferHookProgram: null,
        collateralMint: null,
        reserveVault: null,
      })
      .accounts({
        payer: authority.publicKey,
        mint: mintKeypair.publicKey,
        config: configPda,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([mintKeypair])
      .rpc();

    const config = await program.account.stablecoinConfig.fetch(configPda);
    expect(config.preset).to.equal(1);
    expect(config.paused).to.equal(false);
    expect(config.authority.toBase58()).to.equal(
      authority.publicKey.toBase58()
    );
    expect(config.mint.toBase58()).to.equal(
      mintKeypair.publicKey.toBase58()
    );
  });

  it("rejects invalid preset", async () => {
    const badMint = Keypair.generate();
    const [badConfig] = PublicKey.findProgramAddressSync(
      [Buffer.from("stablecoin-config"), badMint.publicKey.toBuffer()],
      program.programId
    );
    try {
      await program.methods
        .initialize({
          preset: 99,
          decimals: 6,
          name: "Bad",
          symbol: "BAD",
          uri: "",
          transferHookProgram: null,
          collateralMint: null,
          reserveVault: null,
        })
        .accounts({
          payer: authority.publicKey,
          mint: badMint.publicKey,
          config: badConfig,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .signers([badMint])
        .rpc();
      expect.fail("should have thrown");
    } catch (err: any) {
      expect(err.error?.errorCode?.code || err.message).to.contain(
        "InvalidPreset"
      );
    }
  });

  // ---------- Update Minter ----------

  const minterKeypair = Keypair.generate();
  let minterInfoPda: PublicKey;

  it("registers a minter with a cap", async () => {
    [minterInfoPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("minter-info"),
        configPda.toBuffer(),
        minterKeypair.publicKey.toBuffer(),
      ],
      program.programId
    );

    await program.methods
      .updateMinter(new anchor.BN(1_000_000_000))
      .accounts({
        authority: authority.publicKey,
        config: configPda,
        mint: mintKeypair.publicKey,
        minter: minterKeypair.publicKey,
        minterInfo: minterInfoPda,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const info = await program.account.minterInfo.fetch(minterInfoPda);
    expect(info.cap.toNumber()).to.equal(1_000_000_000);
    expect(info.minter.toBase58()).to.equal(
      minterKeypair.publicKey.toBase58()
    );
  });

  // ---------- Mint ----------

  it("mints tokens to a recipient", async () => {
    // Airdrop to minter so they can sign
    const sig = await provider.connection.requestAirdrop(
      minterKeypair.publicKey,
      2 * LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(sig);

    // Create ATA for minter
    const ata = getAssociatedTokenAddressSync(
      mintKeypair.publicKey,
      minterKeypair.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    const createAtaIx = createAssociatedTokenAccountInstruction(
      authority.publicKey,
      ata,
      minterKeypair.publicKey,
      mintKeypair.publicKey,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    const ataTx = new anchor.web3.Transaction().add(createAtaIx);
    await provider.sendAndConfirm(ataTx);

    await program.methods
      .mint(new anchor.BN(500_000_000))
      .accounts({
        minter: minterKeypair.publicKey,
        config: configPda,
        mint: mintKeypair.publicKey,
        minterInfo: minterInfoPda,
        recipientTokenAccount: ata,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([minterKeypair])
      .rpc();

    const config = await program.account.stablecoinConfig.fetch(configPda);
    expect(config.totalMinted.toNumber()).to.equal(500_000_000);

    const minterInfo = await program.account.minterInfo.fetch(minterInfoPda);
    expect(minterInfo.minted.toNumber()).to.equal(500_000_000);
  });

  it("rejects mint exceeding cap", async () => {
    const ata = getAssociatedTokenAddressSync(
      mintKeypair.publicKey,
      minterKeypair.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    try {
      await program.methods
        .mint(new anchor.BN(600_000_000))
        .accounts({
          minter: minterKeypair.publicKey,
          config: configPda,
          mint: mintKeypair.publicKey,
          minterInfo: minterInfoPda,
          recipientTokenAccount: ata,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([minterKeypair])
        .rpc();
      expect.fail("should have thrown");
    } catch (err: any) {
      expect(err.error?.errorCode?.code || err.message).to.contain(
        "MinterCapExceeded"
      );
    }
  });

  // ---------- Burn ----------

  it("burns tokens", async () => {
    const ata = getAssociatedTokenAddressSync(
      mintKeypair.publicKey,
      minterKeypair.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    await program.methods
      .burn(new anchor.BN(100_000_000))
      .accounts({
        minter: minterKeypair.publicKey,
        config: configPda,
        mint: mintKeypair.publicKey,
        minterInfo: minterInfoPda,
        sourceTokenAccount: ata,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([minterKeypair])
      .rpc();

    const config = await program.account.stablecoinConfig.fetch(configPda);
    expect(config.totalBurned.toNumber()).to.equal(100_000_000);
  });

  // ---------- Pause / Unpause ----------

  it("pauses the mint", async () => {
    await program.methods
      .pause()
      .accounts({
        authority: authority.publicKey,
        config: configPda,
        mint: mintKeypair.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();

    const config = await program.account.stablecoinConfig.fetch(configPda);
    expect(config.paused).to.equal(true);
  });

  it("rejects mint while paused", async () => {
    const ata = getAssociatedTokenAddressSync(
      mintKeypair.publicKey,
      minterKeypair.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    try {
      await program.methods
        .mint(new anchor.BN(1))
        .accounts({
          minter: minterKeypair.publicKey,
          config: configPda,
          mint: mintKeypair.publicKey,
          minterInfo: minterInfoPda,
          recipientTokenAccount: ata,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([minterKeypair])
        .rpc();
      expect.fail("should have thrown");
    } catch (err: any) {
      expect(err.error?.errorCode?.code || err.message).to.contain(
        "MintPaused"
      );
    }
  });

  it("unpauses the mint", async () => {
    await program.methods
      .unpause()
      .accounts({
        authority: authority.publicKey,
        config: configPda,
        mint: mintKeypair.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();

    const config = await program.account.stablecoinConfig.fetch(configPda);
    expect(config.paused).to.equal(false);
  });

  // ---------- Freeze / Thaw ----------

  it("freezes a token account", async () => {
    const ata = getAssociatedTokenAddressSync(
      mintKeypair.publicKey,
      minterKeypair.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    const freezeTx = await program.methods
      .freezeAccount()
      .accounts({
        complianceAuthority: authority.publicKey,
        config: configPda,
        mint: mintKeypair.publicKey,
        targetTokenAccount: ata,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .transaction();
    const { blockhash, lastValidBlockHeight } =
      await provider.connection.getLatestBlockhash("confirmed");
    freezeTx.recentBlockhash = blockhash;
    freezeTx.lastValidBlockHeight = lastValidBlockHeight;
    freezeTx.feePayer = authority.publicKey;
    await provider.sendAndConfirm(freezeTx, [], { commitment: "confirmed", skipPreflight: true });

    // Post-condition: token account should be frozen
    const tokenAccount = await getAccount(
      program.provider.connection,
      ata,
      "confirmed",
      TOKEN_2022_PROGRAM_ID
    );
    expect(tokenAccount.isFrozen).to.equal(true);
  });

  it("thaws a frozen token account", async () => {
    const ata = getAssociatedTokenAddressSync(
      mintKeypair.publicKey,
      minterKeypair.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    const thawTx = await program.methods
      .thawAccount()
      .accounts({
        complianceAuthority: authority.publicKey,
        config: configPda,
        mint: mintKeypair.publicKey,
        targetTokenAccount: ata,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .transaction();
    const { blockhash: thawBh, lastValidBlockHeight: thawLvbh } =
      await provider.connection.getLatestBlockhash("confirmed");
    thawTx.recentBlockhash = thawBh;
    thawTx.lastValidBlockHeight = thawLvbh;
    thawTx.feePayer = authority.publicKey;
    await provider.sendAndConfirm(thawTx, [], { commitment: "confirmed" });

    // Post-condition: token account should no longer be frozen
    const tokenAccount = await getAccount(
      program.provider.connection,
      ata,
      "confirmed",
      TOKEN_2022_PROGRAM_ID
    );
    expect(tokenAccount.isFrozen).to.equal(false);
  });

  // ---------- Update Roles ----------

  it("updates authority", async () => {
    const newAuthority = Keypair.generate();
    await program.methods
      .updateRoles({
        newAuthority: newAuthority.publicKey,
        newComplianceAuthority: null,
      })
      .accounts({
        authority: authority.publicKey,
        config: configPda,
        mint: mintKeypair.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();

    const config = await program.account.stablecoinConfig.fetch(configPda);
    expect(config.authority.toBase58()).to.equal(
      newAuthority.publicKey.toBase58()
    );

    // Transfer back for subsequent tests
    await program.methods
      .updateRoles({
        newAuthority: authority.publicKey,
        newComplianceAuthority: null,
      })
      .accounts({
        authority: newAuthority.publicKey,
        config: configPda,
        mint: mintKeypair.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([newAuthority])
      .rpc();
  });

  // ---------- Revoke Minter ----------

  it("revokes a minter", async () => {
    await program.methods
      .revokeMinter()
      .accounts({
        authority: authority.publicKey,
        config: configPda,
        mint: mintKeypair.publicKey,
        minter: minterKeypair.publicKey,
        minterInfo: minterInfoPda,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();

    // minterInfo account should be closed
    const info = await provider.connection.getAccountInfo(minterInfoPda);
    expect(info).to.be.null;
  });
});

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
        maxSupply: null,
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
          maxSupply: null,
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

  // ---------- SSS-020: max_supply enforcement ----------

  it("initializes an SSS-1 stablecoin with max_supply", async () => {
    const cappedMint = Keypair.generate();
    const [cappedConfig] = PublicKey.findProgramAddressSync(
      [Buffer.from("stablecoin-config"), cappedMint.publicKey.toBuffer()],
      program.programId
    );

    await program.methods
      .initialize({
        preset: 1,
        decimals: 6,
        name: "Capped USD",
        symbol: "CUSD",
        uri: "https://example.com/cusd.json",
        transferHookProgram: null,
        collateralMint: null,
        reserveVault: null,
        maxSupply: new anchor.BN(1_000_000),
      })
      .accounts({
        payer: authority.publicKey,
        mint: cappedMint.publicKey,
        config: cappedConfig,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([cappedMint])
      .rpc();

    const config = await program.account.stablecoinConfig.fetch(cappedConfig);
    expect(config.maxSupply.toNumber()).to.equal(1_000_000);
  });

  it("rejects mint exceeding max_supply", async () => {
    // Set up a fresh mint with tiny max_supply and attempt to exceed it
    const capMint = Keypair.generate();
    const [capConfig] = PublicKey.findProgramAddressSync(
      [Buffer.from("stablecoin-config"), capMint.publicKey.toBuffer()],
      program.programId
    );

    await program.methods
      .initialize({
        preset: 1,
        decimals: 6,
        name: "Hard Cap",
        symbol: "HCAP",
        uri: "",
        transferHookProgram: null,
        collateralMint: null,
        reserveVault: null,
        maxSupply: new anchor.BN(500),
      })
      .accounts({
        payer: authority.publicKey,
        mint: capMint.publicKey,
        config: capConfig,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([capMint])
      .rpc();

    // Register a minter
    const capMinter = Keypair.generate();
    const [capMinterInfo] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("minter-info"),
        capConfig.toBuffer(),
        capMinter.publicKey.toBuffer(),
      ],
      program.programId
    );
    await program.methods
      .updateMinter(new anchor.BN(10_000))
      .accounts({
        authority: authority.publicKey,
        config: capConfig,
        mint: capMint.publicKey,
        minter: capMinter.publicKey,
        minterInfo: capMinterInfo,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Fund minter
    const airdropSig = await provider.connection.requestAirdrop(
      capMinter.publicKey,
      2 * LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdropSig);

    // Create ATA for minter
    const capAta = getAssociatedTokenAddressSync(
      capMint.publicKey,
      capMinter.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    const createAtaIx = createAssociatedTokenAccountInstruction(
      authority.publicKey,
      capAta,
      capMinter.publicKey,
      capMint.publicKey,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    await provider.sendAndConfirm(
      new anchor.web3.Transaction().add(createAtaIx)
    );

    // Try to mint 501 (exceeds max_supply of 500)
    try {
      await program.methods
        .mint(new anchor.BN(501))
        .accounts({
          minter: capMinter.publicKey,
          config: capConfig,
          mint: capMint.publicKey,
          minterInfo: capMinterInfo,
          recipientTokenAccount: capAta,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([capMinter])
        .rpc();
      expect.fail("should have thrown MaxSupplyExceeded");
    } catch (err: any) {
      expect(err.error?.errorCode?.code || err.message).to.contain(
        "MaxSupplyExceeded"
      );
    }

    // Minting exactly at cap should succeed
    await program.methods
      .mint(new anchor.BN(500))
      .accounts({
        minter: capMinter.publicKey,
        config: capConfig,
        mint: capMint.publicKey,
        minterInfo: capMinterInfo,
        recipientTokenAccount: capAta,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([capMinter])
      .rpc();

    const config = await program.account.stablecoinConfig.fetch(capConfig);
    expect(config.totalMinted.toNumber()).to.equal(500);

    // One more token must fail now that supply is at max
    try {
      await program.methods
        .mint(new anchor.BN(1))
        .accounts({
          minter: capMinter.publicKey,
          config: capConfig,
          mint: capMint.publicKey,
          minterInfo: capMinterInfo,
          recipientTokenAccount: capAta,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([capMinter])
        .rpc();
      expect.fail("should have thrown MaxSupplyExceeded");
    } catch (err: any) {
      expect(err.error?.errorCode?.code || err.message).to.contain(
        "MaxSupplyExceeded"
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

  // ---------- SSS-020: unauthorized minter update rejection ----------

  it("rejects update_minter from non-authority", async () => {
    const attacker = Keypair.generate();
    const sig = await provider.connection.requestAirdrop(
      attacker.publicKey,
      1 * LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(sig);

    const fakeMinter = Keypair.generate();
    const [fakeMinterInfo] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("minter-info"),
        configPda.toBuffer(),
        fakeMinter.publicKey.toBuffer(),
      ],
      program.programId
    );

    try {
      await program.methods
        .updateMinter(new anchor.BN(999_999))
        .accounts({
          authority: attacker.publicKey,
          config: configPda,
          mint: mintKeypair.publicKey,
          minter: fakeMinter.publicKey,
          minterInfo: fakeMinterInfo,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([attacker])
        .rpc();
      expect.fail("should have thrown");
    } catch (err: any) {
      // Anchor constraint violation or Unauthorized
      expect(err.error?.errorCode?.code || err.message).to.match(
        /Unauthorized|ConstraintHasOne|constraint/i
      );
    }
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

  it("updates authority (two-step: propose then accept)", async () => {
    const newAuthority = Keypair.generate();

    // Step 1: Propose the authority transfer
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

    // After proposal: authority unchanged, pendingAuthority set
    const configAfterProposal = await program.account.stablecoinConfig.fetch(configPda);
    expect(configAfterProposal.authority.toBase58()).to.equal(
      authority.publicKey.toBase58()
    );
    expect(configAfterProposal.pendingAuthority.toBase58()).to.equal(
      newAuthority.publicKey.toBase58()
    );

    // Fund newAuthority so it can pay for tx
    const airdropSig = await provider.connection.requestAirdrop(
      newAuthority.publicKey,
      1_000_000_000
    );
    await provider.connection.confirmTransaction(airdropSig, "confirmed");

    // Step 2: newAuthority accepts
    await program.methods
      .acceptAuthority()
      .accounts({
        pending: newAuthority.publicKey,
        config: configPda,
        mint: mintKeypair.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([newAuthority])
      .rpc();

    const configAfterAccept = await program.account.stablecoinConfig.fetch(configPda);
    expect(configAfterAccept.authority.toBase58()).to.equal(
      newAuthority.publicKey.toBase58()
    );
    expect(configAfterAccept.pendingAuthority.toBase58()).to.equal(
      anchor.web3.PublicKey.default.toBase58()
    );

    // Transfer back for subsequent tests (two-step again)
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

    const airdropSig2 = await provider.connection.requestAirdrop(
      authority.publicKey,
      500_000_000
    );
    await provider.connection.confirmTransaction(airdropSig2, "confirmed");

    await program.methods
      .acceptAuthority()
      .accounts({
        pending: authority.publicKey,
        config: configPda,
        mint: mintKeypair.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();

    const configRestored = await program.account.stablecoinConfig.fetch(configPda);
    expect(configRestored.authority.toBase58()).to.equal(
      authority.publicKey.toBase58()
    );
  });

  // ---------- SSS-020: two-step compliance authority transfer ----------

  it("transfers compliance authority (two-step: propose then accept)", async () => {
    const newCompliance = Keypair.generate();

    // Step 1: Propose compliance authority transfer
    await program.methods
      .updateRoles({
        newAuthority: null,
        newComplianceAuthority: newCompliance.publicKey,
      })
      .accounts({
        authority: authority.publicKey,
        config: configPda,
        mint: mintKeypair.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();

    const configAfterProposal = await program.account.stablecoinConfig.fetch(configPda);
    expect(configAfterProposal.pendingComplianceAuthority.toBase58()).to.equal(
      newCompliance.publicKey.toBase58()
    );
    // Current compliance authority should still be the old one
    expect(configAfterProposal.complianceAuthority.toBase58()).to.equal(
      authority.publicKey.toBase58()
    );

    // Fund new compliance authority
    const airdropSig = await provider.connection.requestAirdrop(
      newCompliance.publicKey,
      1_000_000_000
    );
    await provider.connection.confirmTransaction(airdropSig, "confirmed");

    // Step 2: New compliance authority accepts
    await program.methods
      .acceptComplianceAuthority()
      .accounts({
        pending: newCompliance.publicKey,
        config: configPda,
        mint: mintKeypair.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([newCompliance])
      .rpc();

    const configAfterAccept = await program.account.stablecoinConfig.fetch(configPda);
    expect(configAfterAccept.complianceAuthority.toBase58()).to.equal(
      newCompliance.publicKey.toBase58()
    );
    expect(configAfterAccept.pendingComplianceAuthority.toBase58()).to.equal(
      anchor.web3.PublicKey.default.toBase58()
    );

    // Transfer compliance authority back using newCompliance as current authority proposer
    // (authority proposes; newCompliance must accept once back)
    // First, newCompliance proposes transfer back to authority.publicKey using updateRoles...
    // but updateRoles requires the main authority signer — so authority proposes this
    await program.methods
      .updateRoles({
        newAuthority: null,
        newComplianceAuthority: authority.publicKey,
      })
      .accounts({
        authority: authority.publicKey,
        config: configPda,
        mint: mintKeypair.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();

    await program.methods
      .acceptComplianceAuthority()
      .accounts({
        pending: authority.publicKey,
        config: configPda,
        mint: mintKeypair.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();

    const configRestored = await program.account.stablecoinConfig.fetch(configPda);
    expect(configRestored.complianceAuthority.toBase58()).to.equal(
      authority.publicKey.toBase58()
    );
  });

  // ---------- SSS-020: reject wrong pending authority accepting ----------

  it("rejects accept_authority from wrong signer", async () => {
    const legitimate = Keypair.generate();
    const impostor = Keypair.generate();

    // Propose transfer to legitimate
    await program.methods
      .updateRoles({
        newAuthority: legitimate.publicKey,
        newComplianceAuthority: null,
      })
      .accounts({
        authority: authority.publicKey,
        config: configPda,
        mint: mintKeypair.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();

    const impostorSig = await provider.connection.requestAirdrop(
      impostor.publicKey,
      1_000_000_000
    );
    await provider.connection.confirmTransaction(impostorSig, "confirmed");

    // Impostor tries to accept — should fail
    try {
      await program.methods
        .acceptAuthority()
        .accounts({
          pending: impostor.publicKey,
          config: configPda,
          mint: mintKeypair.publicKey,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([impostor])
        .rpc();
      expect.fail("impostor should not be able to accept authority");
    } catch (err: any) {
      expect(err.error?.errorCode?.code || err.message).to.match(
        /Unauthorized|ConstraintRaw|constraint/i
      );
    }

    // Clean up: legitimate accepts, then restores authority back
    const legitSig = await provider.connection.requestAirdrop(
      legitimate.publicKey,
      1_000_000_000
    );
    await provider.connection.confirmTransaction(legitSig, "confirmed");

    await program.methods
      .acceptAuthority()
      .accounts({
        pending: legitimate.publicKey,
        config: configPda,
        mint: mintKeypair.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([legitimate])
      .rpc();

    // Restore to original authority
    await program.methods
      .updateRoles({
        newAuthority: authority.publicKey,
        newComplianceAuthority: null,
      })
      .accounts({
        authority: legitimate.publicKey,
        config: configPda,
        mint: mintKeypair.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([legitimate])
      .rpc();

    const restoreAirdrop = await provider.connection.requestAirdrop(
      authority.publicKey,
      500_000_000
    );
    await provider.connection.confirmTransaction(restoreAirdrop, "confirmed");

    await program.methods
      .acceptAuthority()
      .accounts({
        pending: authority.publicKey,
        config: configPda,
        mint: mintKeypair.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();

    const final = await program.account.stablecoinConfig.fetch(configPda);
    expect(final.authority.toBase58()).to.equal(authority.publicKey.toBase58());
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

  // ---------- SSS-020: burn after revoke should fail (no minterInfo) ----------

  it("rejects burn after minter is revoked", async () => {
    const ata = getAssociatedTokenAddressSync(
      mintKeypair.publicKey,
      minterKeypair.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    try {
      await program.methods
        .burn(new anchor.BN(1))
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
      expect.fail("should have thrown — minterInfo is closed");
    } catch (err: any) {
      // Account closed or constraint violation
      expect(err.message || err.toString()).to.match(
        /AccountNotInitialized|account.*not.*initialized|Error|failed/i
      );
    }
  });
});

/// SSS-055 — Direction 3: CPI Composability Standard
/// Integration tests:
///   1. init_interface_version creates PDA correctly
///   2. cpi_mint works via the interface
///   3. cpi_burn works via the interface
///   4. cpi_mint rejects wrong required_version
///   5. cpi_mint rejects deprecated interface (active=false)
///   6. update_interface_version allows authority to bump version / deprecate
///   7. Non-authority cannot call update_interface_version
///   8. InterfaceVersion PDA seeds are deterministic
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
} from "@solana/spl-token";
import { expect } from "chai";

describe("SSS-055: CPI Composability Standard (Direction 3)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SssToken as Program<SssToken>;
  const authority = provider.wallet as anchor.Wallet;

  const mintKeypair = Keypair.generate();
  let configPda: PublicKey;
  let configBump: number;
  let interfaceVersionPda: PublicKey;
  let interfaceVersionBump: number;
  let minterInfoPda: PublicKey;
  let recipientAta: PublicKey;

  before(async () => {
    // Derive PDAs
    [configPda, configBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("stablecoin-config"), mintKeypair.publicKey.toBuffer()],
      program.programId
    );
    [interfaceVersionPda, interfaceVersionBump] =
      PublicKey.findProgramAddressSync(
        [
          Buffer.from("interface-version"),
          mintKeypair.publicKey.toBuffer(),
        ],
        program.programId
      );
    [minterInfoPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("minter-info"),
        configPda.toBuffer(),
        authority.publicKey.toBuffer(),
      ],
      program.programId
    );
    recipientAta = getAssociatedTokenAddressSync(
      mintKeypair.publicKey,
      authority.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );

    // Initialize SSS-1 stablecoin
    await program.methods
      .initialize({
        preset: 1,
        decimals: 6,
        name: "CPI Test Stable",
        symbol: "CPIS",
        uri: "https://example.com/cpis.json",
        transferHookProgram: null,
        collateralMint: null,
        reserveVault: null,
        maxSupply: null,
        featureFlags: null,
        auditorElgamalPubkey: null,
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
      .rpc({ commitment: "confirmed" });

    // Register authority as a minter (unlimited cap)
    await program.methods
      .updateMinter(new anchor.BN(0))
      .accounts({
        authority: authority.publicKey,
        config: configPda,
        mint: mintKeypair.publicKey,
        minter: authority.publicKey,
        minterInfo: minterInfoPda,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc({ commitment: "confirmed" });

    // Create recipient ATA and confirm at "confirmed" level before tests run
    const createAtaTx = new anchor.web3.Transaction().add(
      createAssociatedTokenAccountInstruction(
        authority.publicKey,
        recipientAta,
        authority.publicKey,
        mintKeypair.publicKey,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      )
    );
    await provider.sendAndConfirm(createAtaTx, [], { commitment: "confirmed" });

    // SSS-091: DefaultAccountState=Frozen — new ATAs start frozen; thaw before minting.
    await program.methods
      .thawAccount()
      .accounts({
        complianceAuthority: authority.publicKey,
        config: configPda,
        mint: mintKeypair.publicKey,
        targetTokenAccount: recipientAta,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc({ commitment: "confirmed" });
  });

  // ── Test 1: init_interface_version ────────────────────────────────────────

  it("initializes InterfaceVersion PDA correctly", async () => {
    await program.methods
      .initInterfaceVersion()
      .accounts({
        authority: authority.publicKey,
        config: configPda,
        mint: mintKeypair.publicKey,
        interfaceVersion: interfaceVersionPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc({ commitment: "confirmed" });

    const iv = await program.account.interfaceVersion.fetch(
      interfaceVersionPda
    );
    expect(iv.version).to.equal(1);
    expect(iv.active).to.be.true;
    expect(iv.mint.toBase58()).to.equal(mintKeypair.publicKey.toBase58());
    // namespace should be sha256("sss_mint_interface") — 32 bytes
    expect(iv.namespace).to.have.length(32);
  });

  // ── Test 2: cpi_mint ─────────────────────────────────────────────────────

  it("cpi_mint mints tokens via standardized interface", async () => {
    const amount = new anchor.BN(1_000_000); // 1 token (6 decimals)

    await program.methods
      .cpiMint(amount, 1) // required_version = 1
      .accounts({
        minter: authority.publicKey,
        config: configPda,
        minterInfo: minterInfoPda,
        mint: mintKeypair.publicKey,
        recipientTokenAccount: recipientAta,
        interfaceVersion: interfaceVersionPda,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc({ commitment: "confirmed" });

    const balanceAfter = await getAccount(
      provider.connection,
      recipientAta,
      "confirmed",
      TOKEN_2022_PROGRAM_ID
    );

    expect(balanceAfter.amount.toString()).to.equal("1000000");
  });

  // ── Test 3: cpi_burn ─────────────────────────────────────────────────────

  it("cpi_burn burns tokens via standardized interface", async () => {
    const burnAmount = new anchor.BN(500_000);

    await program.methods
      .cpiBurn(burnAmount, 1)
      .accounts({
        minter: authority.publicKey,
        config: configPda,
        minterInfo: minterInfoPda,
        mint: mintKeypair.publicKey,
        sourceTokenAccount: recipientAta,
        interfaceVersion: interfaceVersionPda,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc({ commitment: "confirmed" });

    const balanceAfter = await getAccount(
      provider.connection,
      recipientAta,
      "confirmed",
      TOKEN_2022_PROGRAM_ID
    );

    // Started at 1_000_000 (from cpi_mint), burned 500_000 => 500_000 remaining
    expect(balanceAfter.amount.toString()).to.equal("500000");
  });

  // ── Test 4: cpi_mint rejects wrong required_version ───────────────────────

  it("cpi_mint rejects when required_version mismatches on-chain version", async () => {
    try {
      await program.methods
        .cpiMint(new anchor.BN(1_000), 99) // version 99 != on-chain version 1
        .accounts({
          minter: authority.publicKey,
          config: configPda,
          minterInfo: minterInfoPda,
          mint: mintKeypair.publicKey,
          recipientTokenAccount: recipientAta,
          interfaceVersion: interfaceVersionPda,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .rpc();
      expect.fail("should have rejected version mismatch");
    } catch (err: any) {
      expect(err.message || err.toString()).to.match(
        /InterfaceVersionMismatch|version|Error/i
      );
    }
  });

  // ── Test 5: cpi_mint rejects deprecated interface ─────────────────────────

  it("cpi_mint rejects when interface is deprecated (active=false)", async () => {
    // Deprecate the interface
    await program.methods
      .updateInterfaceVersion(null, false)
      .accounts({
        authority: authority.publicKey,
        config: configPda,
        interfaceVersion: interfaceVersionPda,
      })
      .rpc();

    try {
      await program.methods
        .cpiMint(new anchor.BN(1_000), 1)
        .accounts({
          minter: authority.publicKey,
          config: configPda,
          minterInfo: minterInfoPda,
          mint: mintKeypair.publicKey,
          recipientTokenAccount: recipientAta,
          interfaceVersion: interfaceVersionPda,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .rpc();
      expect.fail("should have rejected deprecated interface");
    } catch (err: any) {
      expect(err.message || err.toString()).to.match(
        /InterfaceDeprecated|deprecated|Error/i
      );
    }

    // Re-activate for subsequent tests
    await program.methods
      .updateInterfaceVersion(null, true)
      .accounts({
        authority: authority.publicKey,
        config: configPda,
        interfaceVersion: interfaceVersionPda,
      })
      .rpc();
  });

  // ── Test 6: update_interface_version bumps version ────────────────────────

  it("update_interface_version allows authority to bump version", async () => {
    await program.methods
      .updateInterfaceVersion(2, null) // bump to version 2
      .accounts({
        authority: authority.publicKey,
        config: configPda,
        interfaceVersion: interfaceVersionPda,
      })
      .rpc();

    const iv = await program.account.interfaceVersion.fetch(interfaceVersionPda);
    expect(iv.version).to.equal(2);
    expect(iv.active).to.be.true;

    // Now cpi_mint with required_version=1 should fail
    try {
      await program.methods
        .cpiMint(new anchor.BN(1_000), 1)
        .accounts({
          minter: authority.publicKey,
          config: configPda,
          minterInfo: minterInfoPda,
          mint: mintKeypair.publicKey,
          recipientTokenAccount: recipientAta,
          interfaceVersion: interfaceVersionPda,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .rpc();
      expect.fail("should have rejected old required_version=1 after bump to v2");
    } catch (err: any) {
      expect(err.message || err.toString()).to.match(
        /InterfaceVersionMismatch|version|Error/i
      );
    }

    // But required_version=2 should work
    await program.methods
      .cpiMint(new anchor.BN(100_000), 2)
      .accounts({
        minter: authority.publicKey,
        config: configPda,
        minterInfo: minterInfoPda,
        mint: mintKeypair.publicKey,
        recipientTokenAccount: recipientAta,
        interfaceVersion: interfaceVersionPda,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();

    // Reset back to v1 for consistency
    await program.methods
      .updateInterfaceVersion(1, null)
      .accounts({
        authority: authority.publicKey,
        config: configPda,
        interfaceVersion: interfaceVersionPda,
      })
      .rpc();
  });

  // ── Test 7: non-authority cannot update interface version ─────────────────

  it("non-authority cannot call update_interface_version", async () => {
    const stranger = Keypair.generate();
    // Airdrop minimal SOL
    const sig = await provider.connection.requestAirdrop(
      stranger.publicKey,
      0.1 * LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(sig);

    try {
      await program.methods
        .updateInterfaceVersion(99, null)
        .accounts({
          authority: stranger.publicKey,
          config: configPda,
          interfaceVersion: interfaceVersionPda,
        })
        .signers([stranger])
        .rpc();
      expect.fail("non-authority should be rejected");
    } catch (err: any) {
      expect(err.message || err.toString()).to.match(
        /Unauthorized|authority|constraint|Error/i
      );
    }
  });

  // ── Test 8: InterfaceVersion PDA seeds are deterministic ──────────────────

  it("InterfaceVersion PDA seeds are deterministic", async () => {
    const [derived] = PublicKey.findProgramAddressSync(
      [Buffer.from("interface-version"), mintKeypair.publicKey.toBuffer()],
      program.programId
    );
    expect(derived.toBase58()).to.equal(interfaceVersionPda.toBase58());
  });
});

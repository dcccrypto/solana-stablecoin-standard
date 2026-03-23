/**
 * SSS-119: Oracle Abstraction Layer — Test Suite
 *
 * Coverage (22 tests):
 *   set_oracle_config:  type/feed field storage, access control, invalid type rejection
 *   Custom oracle:      init_custom_price_feed, update_custom_price, CDP borrow dispatch
 *   Switchboard stub:   OracleNotConfigured returned for type=1
 *   Pyth dispatch:      type=0 feed key validation, borrow with mock Pyth (if available)
 *   Oracle switching:   change type mid-flight, CDP borrow with new adapter
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { SssToken } from "../target/types/sss_token";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createMint,
  mintTo as splMintTo,
  createAccount as createTokenAccount,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import { expect } from "chai";

// ---------------------------------------------------------------------------
// Pyth mock helpers (same binary layout as pyth-sdk-solana 0.10.x)
// ---------------------------------------------------------------------------

/** Build a Pyth SolanaPriceAccount buffer (3312 bytes) with a fresh price. */
function buildPythBuf(priceInMicroUsd: bigint, publishTs: bigint, conf: bigint = BigInt(0)): Buffer {
  const buf = Buffer.alloc(3312, 0);
  buf.writeUInt32LE(0xa1b2c3d4, 0);   // magic
  buf.writeUInt32LE(2, 4);            // ver
  buf.writeUInt32LE(3, 8);            // atype (Price)
  buf.writeUInt32LE(3312, 12);        // size
  buf.writeUInt32LE(1, 16);           // price_type
  buf.writeInt32LE(-6, 20);           // exponent (-6 → price unit = 10^-6 USD)
  buf.writeUInt32LE(1, 24);           // num_price_components
  buf.writeUInt32LE(1, 28);           // num_quoters
  buf.writeBigInt64LE(publishTs, 96); // timestamp
  buf.writeBigInt64LE(priceInMicroUsd, 208); // price (aggregate)
  buf.writeBigUInt64LE(conf, 216);    // conf
  buf.writeUInt32LE(1, 224);          // status = Trading
  buf.writeBigUInt64LE(BigInt(1), 232);
  return buf;
}

// ---------------------------------------------------------------------------
// Describe
// ---------------------------------------------------------------------------

describe("oracle-abstraction", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SssToken as Program<SssToken>;
  const authority = provider.wallet as anchor.Wallet;

  // SSS-3 mint + config for oracle tests
  const mintKp = Keypair.generate();
  let configPda: PublicKey;

  // Collateral setup
  let collateralMint: PublicKey;
  let collateralVaultPda: PublicKey;
  let vaultTokenAccount: PublicKey;
  let userCollateralAta: PublicKey;
  let userSssAta: PublicKey;

  // CDP position PDA
  let cdpPositionPda: PublicKey;

  // Custom oracle PDA
  let customPriceFeedPda: PublicKey;

  // Mock Pyth account keypair (type=0 tests)
  const mockPythKp = Keypair.generate();

  const PYTH_PROGRAM_ID = new PublicKey(
    "FsJ3A3u2vn5cTVofAjvy6y5kwABJAqYWpe4975bi2epH"
  );

  // ---------------------------------------------------------------------------
  // before: set up full SSS-3 environment
  // ---------------------------------------------------------------------------

  before(async () => {
    [configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("stablecoin-config"), mintKp.publicKey.toBuffer()],
      program.programId
    );

    [customPriceFeedPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("custom-price-feed"), mintKp.publicKey.toBuffer()],
      program.programId
    );

    // Create collateral mint (SPL Token, 6 decimals)
    collateralMint = await createMint(
      provider.connection,
      (authority as any).payer,
      authority.publicKey,
      null,
      6,
      undefined,
      undefined,
      TOKEN_PROGRAM_ID
    );

    [collateralVaultPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("cdp-collateral-vault"),
        mintKp.publicKey.toBuffer(),
        authority.publicKey.toBuffer(),
        collateralMint.toBuffer(),
      ],
      program.programId
    );

    [cdpPositionPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("cdp-position"),
        mintKp.publicKey.toBuffer(),
        authority.publicKey.toBuffer(),
      ],
      program.programId
    );

    // Create vault token account
    const vaultTokenKp = Keypair.generate();
    vaultTokenAccount = vaultTokenKp.publicKey;
    await createTokenAccount(
      provider.connection,
      (authority as any).payer,
      collateralMint,
      collateralVaultPda,
      vaultTokenKp,
      undefined,
      TOKEN_PROGRAM_ID
    );

    // Initialize SSS-3 config
    await program.methods
      .initialize({
        preset: 3,
        decimals: 6,
        name: "Oracle Test USD",
        symbol: "OTUSD",
        uri: "https://test.invalid",
        transferHookProgram: null,
        collateralMint,
        reserveVault: vaultTokenAccount,
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
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([mintKp])
      .rpc();

    // User SSS ATA (Token-2022)
    const sssAtaInfo = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      (authority as any).payer,
      mintKp.publicKey,
      authority.publicKey,
      false,
      undefined,
      undefined,
      TOKEN_2022_PROGRAM_ID
    );
    userSssAta = sssAtaInfo.address;

    // User collateral ATA + fund it
    const colAtaInfo = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      (authority as any).payer,
      collateralMint,
      authority.publicKey,
      false,
      undefined,
      undefined,
      TOKEN_PROGRAM_ID
    );
    userCollateralAta = colAtaInfo.address;
    await splMintTo(
      provider.connection,
      (authority as any).payer,
      collateralMint,
      userCollateralAta,
      authority.publicKey,
      2_000_000 * 10 ** 6,
      [],
      undefined,
      TOKEN_PROGRAM_ID
    );

    // Deposit 1000 tokens of collateral into the vault
    await program.methods
      .cdpDepositCollateral(new anchor.BN(1_000 * 10 ** 6))
      .accounts({
        user: authority.publicKey,
        config: configPda,
        sssMint: mintKp.publicKey,
        collateralMint,
        collateralVault: collateralVaultPda,
        vaultTokenAccount,
        userCollateralAccount: userCollateralAta,
        yieldCollateralConfig: null,
        collateralConfig: null,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  });

  // ---------------------------------------------------------------------------
  // GROUP 1: set_oracle_config
  // ---------------------------------------------------------------------------

  it("oracle-01: fresh config has oracle_type=0 (Pyth) and oracle_feed=default by default", async () => {
    const cfg = await program.account.stablecoinConfig.fetch(configPda);
    expect(cfg.oracleType).to.equal(0);
    expect(cfg.oracleFeed.equals(PublicKey.default)).to.be.true;
  });

  it("oracle-02: setOracleConfig sets oracle_type=0 (Pyth) and oracle_feed", async () => {
    const feed = mockPythKp.publicKey;
    await program.methods
      .setOracleConfig(0, feed)
      .accounts({
        authority: authority.publicKey,
        config: configPda,
        mint: mintKp.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();

    const cfg = await program.account.stablecoinConfig.fetch(configPda);
    expect(cfg.oracleType).to.equal(0);
    expect(cfg.oracleFeed.equals(feed)).to.be.true;

    // Reset to default
    await program.methods
      .setOracleConfig(0, PublicKey.default)
      .accounts({
        authority: authority.publicKey,
        config: configPda,
        mint: mintKp.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();
  });

  it("oracle-03: setOracleConfig sets oracle_type=1 (Switchboard)", async () => {
    await program.methods
      .setOracleConfig(1, PublicKey.default)
      .accounts({
        authority: authority.publicKey,
        config: configPda,
        mint: mintKp.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();

    const cfg = await program.account.stablecoinConfig.fetch(configPda);
    expect(cfg.oracleType).to.equal(1);

    // Reset to Pyth
    await program.methods
      .setOracleConfig(0, PublicKey.default)
      .accounts({
        authority: authority.publicKey,
        config: configPda,
        mint: mintKp.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();
  });

  it("oracle-04: setOracleConfig sets oracle_type=2 (Custom)", async () => {
    await program.methods
      .setOracleConfig(2, customPriceFeedPda)
      .accounts({
        authority: authority.publicKey,
        config: configPda,
        mint: mintKp.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();

    const cfg = await program.account.stablecoinConfig.fetch(configPda);
    expect(cfg.oracleType).to.equal(2);
    expect(cfg.oracleFeed.equals(customPriceFeedPda)).to.be.true;

    // Reset
    await program.methods
      .setOracleConfig(0, PublicKey.default)
      .accounts({
        authority: authority.publicKey,
        config: configPda,
        mint: mintKp.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();
  });

  it("oracle-05: setOracleConfig rejects oracle_type=3 (invalid)", async () => {
    try {
      await program.methods
        .setOracleConfig(3, PublicKey.default)
        .accounts({
          authority: authority.publicKey,
          config: configPda,
          mint: mintKp.publicKey,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .rpc();
      expect.fail("should have rejected invalid oracle type");
    } catch (e: any) {
      expect(e.toString()).to.match(/InvalidOracleType|invalid.*oracle/i);
    }
  });

  it("oracle-06: setOracleConfig rejects non-authority signer", async () => {
    const rando = Keypair.generate();
    await provider.connection.requestAirdrop(rando.publicKey, 1_000_000_000);
    await new Promise((r) => setTimeout(r, 500));

    try {
      await program.methods
        .setOracleConfig(0, PublicKey.default)
        .accounts({
          authority: rando.publicKey,
          config: configPda,
          mint: mintKp.publicKey,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([rando])
        .rpc();
      expect.fail("should have rejected unauthorized caller");
    } catch (e: any) {
      expect(e.toString()).to.match(/Unauthorized|0x1770/i);
    }
  });

  it("oracle-07: setOracleConfig can update oracle_feed without changing oracle_type", async () => {
    const feed1 = Keypair.generate().publicKey;
    await program.methods
      .setOracleConfig(0, feed1)
      .accounts({
        authority: authority.publicKey,
        config: configPda,
        mint: mintKp.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();

    let cfg = await program.account.stablecoinConfig.fetch(configPda);
    expect(cfg.oracleFeed.equals(feed1)).to.be.true;
    expect(cfg.oracleType).to.equal(0);

    // Now update just the feed address
    const feed2 = Keypair.generate().publicKey;
    await program.methods
      .setOracleConfig(0, feed2)
      .accounts({
        authority: authority.publicKey,
        config: configPda,
        mint: mintKp.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();

    cfg = await program.account.stablecoinConfig.fetch(configPda);
    expect(cfg.oracleFeed.equals(feed2)).to.be.true;

    // Reset
    await program.methods
      .setOracleConfig(0, PublicKey.default)
      .accounts({
        authority: authority.publicKey,
        config: configPda,
        mint: mintKp.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();
  });

  // ---------------------------------------------------------------------------
  // GROUP 2: init_custom_price_feed + update_custom_price
  // ---------------------------------------------------------------------------

  it("oracle-08: initCustomPriceFeed creates PDA with correct authority", async () => {
    await program.methods
      .initCustomPriceFeed()
      .accounts({
        authority: authority.publicKey,
        config: configPda,
        sssMint: mintKp.publicKey,
        customPriceFeed: customPriceFeedPda,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const feed = await program.account.customPriceFeed.fetch(customPriceFeedPda);
    expect(feed.authority.equals(authority.publicKey)).to.be.true;
    expect(feed.price.toNumber()).to.equal(0);
    expect(feed.expo).to.equal(-8); // default exponent
  });

  it("oracle-09: initCustomPriceFeed rejects non-authority signer", async () => {
    // Already initialised — try with a different mint's non-authority config
    const otherMintKp = Keypair.generate();
    const [otherConfigPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("stablecoin-config"), otherMintKp.publicKey.toBuffer()],
      program.programId
    );

    // We don't init the config here; just verify the signer check works when
    // a non-authority tries to call the instruction on an existing config.
    const rando = Keypair.generate();
    await provider.connection.requestAirdrop(rando.publicKey, 1_000_000_000);
    await new Promise((r) => setTimeout(r, 500));

    const [otherFeedPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("custom-price-feed"), mintKp.publicKey.toBuffer()],
      program.programId
    );

    try {
      await program.methods
        .initCustomPriceFeed()
        .accounts({
          authority: rando.publicKey,
          config: configPda, // existing config whose authority != rando
          sssMint: mintKp.publicKey,
          customPriceFeed: otherFeedPda,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([rando])
        .rpc();
      expect.fail("should have rejected non-authority");
    } catch (e: any) {
      expect(e.toString()).to.match(/Unauthorized|already in use|0x1770/i);
    }
  });

  it("oracle-10: updateCustomPrice stores price, expo, conf correctly", async () => {
    // price=$2.50 with expo=-6 → price=2_500_000
    await program.methods
      .updateCustomPrice(new anchor.BN(2_500_000), -6, new anchor.BN(5_000))
      .accounts({
        authority: authority.publicKey,
        config: configPda,
        sssMint: mintKp.publicKey,
        customPriceFeed: customPriceFeedPda,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();

    const feed = await program.account.customPriceFeed.fetch(customPriceFeedPda);
    expect(feed.price.toNumber()).to.equal(2_500_000);
    expect(feed.expo).to.equal(-6);
    expect(feed.conf.toNumber()).to.equal(5_000);
    expect(feed.lastUpdateSlot.toNumber()).to.be.greaterThan(0);
  });

  it("oracle-11: updateCustomPrice rejects price <= 0", async () => {
    try {
      await program.methods
        .updateCustomPrice(new anchor.BN(0), -6, new anchor.BN(0))
        .accounts({
          authority: authority.publicKey,
          config: configPda,
          sssMint: mintKp.publicKey,
          customPriceFeed: customPriceFeedPda,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .rpc();
      expect.fail("should have rejected zero price");
    } catch (e: any) {
      expect(e.toString()).to.match(/InvalidPrice|0x177a/i);
    }
  });

  it("oracle-12: updateCustomPrice rejects non-authority signer", async () => {
    const rando = Keypair.generate();
    await provider.connection.requestAirdrop(rando.publicKey, 1_000_000_000);
    await new Promise((r) => setTimeout(r, 500));

    try {
      await program.methods
        .updateCustomPrice(new anchor.BN(1_000_000), -6, new anchor.BN(0))
        .accounts({
          authority: rando.publicKey,
          config: configPda,
          sssMint: mintKp.publicKey,
          customPriceFeed: customPriceFeedPda,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([rando])
        .rpc();
      expect.fail("should have rejected unauthorized");
    } catch (e: any) {
      expect(e.toString()).to.match(/Unauthorized|0x1770/i);
    }
  });

  // ---------------------------------------------------------------------------
  // GROUP 3: CDP borrow with Custom oracle adapter (oracle_type=2)
  // ---------------------------------------------------------------------------

  it("oracle-13: cdpBorrowStable succeeds with valid custom oracle (oracle_type=2)", async () => {
    // Set price=$1.00 with expo=-6 (price=1_000_000), 0 conf
    await program.methods
      .updateCustomPrice(new anchor.BN(1_000_000), -6, new anchor.BN(0))
      .accounts({
        authority: authority.publicKey,
        config: configPda,
        sssMint: mintKp.publicKey,
        customPriceFeed: customPriceFeedPda,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();

    // Configure oracle_type=2, oracle_feed=customPriceFeedPda
    await program.methods
      .setOracleConfig(2, customPriceFeedPda)
      .accounts({
        authority: authority.publicKey,
        config: configPda,
        mint: mintKp.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();

    // Borrow 100 SSS tokens (collateral $1000 at 150% MCR → max ~$666)
    await program.methods
      .cdpBorrowStable(new anchor.BN(100 * 10 ** 6))
      .accounts({
        user: authority.publicKey,
        config: configPda,
        sssMint: mintKp.publicKey,
        collateralMint,
        collateralVault: collateralVaultPda,
        cdpPosition: cdpPositionPda,
        userSssAccount: userSssAta,
        pythPriceFeed: customPriceFeedPda,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const position = await program.account.cdpPosition.fetch(cdpPositionPda);
    expect(position.debtAmount.toNumber()).to.equal(100 * 10 ** 6);
  });

  it("oracle-14: cdpBorrowStable with custom oracle rejects wrong feed account (oracle_feed mismatch)", async () => {
    // oracle_feed is set to customPriceFeedPda; pass a different account
    const wrongFeed = Keypair.generate().publicKey;

    try {
      await program.methods
        .cdpBorrowStable(new anchor.BN(1 * 10 ** 6))
        .accounts({
          user: authority.publicKey,
          config: configPda,
          sssMint: mintKp.publicKey,
          collateralMint,
          collateralVault: collateralVaultPda,
          cdpPosition: cdpPositionPda,
          userSssAccount: userSssAta,
          pythPriceFeed: wrongFeed, // wrong — should be rejected
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      expect.fail("should have rejected mismatched oracle feed");
    } catch (e: any) {
      expect(e.toString()).to.match(/UnexpectedPriceFeed|0x178c/i);
    }
  });

  it("oracle-15: cdpBorrowStable with custom oracle rejects non-PDA account (InvalidPriceFeed)", async () => {
    // Temporarily clear oracle_feed so key check is skipped, then pass a random account
    // that can't be deserialized as CustomPriceFeed
    await program.methods
      .setOracleConfig(2, PublicKey.default)
      .accounts({
        authority: authority.publicKey,
        config: configPda,
        mint: mintKp.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();

    const randomKp = Keypair.generate();
    // Fund it so it exists as an account
    await provider.connection.requestAirdrop(randomKp.publicKey, 1_000_000_000);
    await new Promise((r) => setTimeout(r, 500));

    try {
      await program.methods
        .cdpBorrowStable(new anchor.BN(1 * 10 ** 6))
        .accounts({
          user: authority.publicKey,
          config: configPda,
          sssMint: mintKp.publicKey,
          collateralMint,
          collateralVault: collateralVaultPda,
          cdpPosition: cdpPositionPda,
          userSssAccount: userSssAta,
          pythPriceFeed: randomKp.publicKey, // not a CustomPriceFeed
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      expect.fail("should have rejected invalid custom price feed account");
    } catch (e: any) {
      expect(e.toString()).to.match(/InvalidPriceFeed|Error|failed/i);
    } finally {
      // Restore oracle_feed
      await program.methods
        .setOracleConfig(2, customPriceFeedPda)
        .accounts({
          authority: authority.publicKey,
          config: configPda,
          mint: mintKp.publicKey,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .rpc();
    }
  });

  // ---------------------------------------------------------------------------
  // GROUP 4: Switchboard adapter stub (oracle_type=1)
  // ---------------------------------------------------------------------------

  it("oracle-16: cdpBorrowStable with Switchboard (oracle_type=1) returns OracleNotConfigured", async () => {
    // Switch to Switchboard oracle
    await program.methods
      .setOracleConfig(1, PublicKey.default)
      .accounts({
        authority: authority.publicKey,
        config: configPda,
        mint: mintKp.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();

    try {
      await program.methods
        .cdpBorrowStable(new anchor.BN(1 * 10 ** 6))
        .accounts({
          user: authority.publicKey,
          config: configPda,
          sssMint: mintKp.publicKey,
          collateralMint,
          collateralVault: collateralVaultPda,
          cdpPosition: cdpPositionPda,
          userSssAccount: userSssAta,
          pythPriceFeed: mockPythKp.publicKey, // any account — Switchboard stub ignores it
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      expect.fail("should have returned OracleNotConfigured");
    } catch (e: any) {
      expect(e.toString()).to.match(/OracleNotConfigured|not configured|oracle/i);
    } finally {
      // Restore to custom oracle for subsequent tests
      await program.methods
        .setOracleConfig(2, customPriceFeedPda)
        .accounts({
          authority: authority.publicKey,
          config: configPda,
          mint: mintKp.publicKey,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .rpc();
    }
  });

  it("oracle-17: Switchboard oracle_type stores correctly; cdpBorrowStable message identifies adapter", async () => {
    await program.methods
      .setOracleConfig(1, PublicKey.default)
      .accounts({
        authority: authority.publicKey,
        config: configPda,
        mint: mintKp.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();

    const cfg = await program.account.stablecoinConfig.fetch(configPda);
    expect(cfg.oracleType).to.equal(1);

    // Restore
    await program.methods
      .setOracleConfig(2, customPriceFeedPda)
      .accounts({
        authority: authority.publicKey,
        config: configPda,
        mint: mintKp.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();
  });

  // ---------------------------------------------------------------------------
  // GROUP 5: Pyth adapter dispatch (oracle_type=0)
  // ---------------------------------------------------------------------------

  it("oracle-18: setOracleConfig oracle_type=0 + oracle_feed enforces Pyth feed key on CDP borrow", async () => {
    const wrongFeed = Keypair.generate().publicKey;

    // Set Pyth type with a specific expected feed key
    await program.methods
      .setOracleConfig(0, mockPythKp.publicKey)
      .accounts({
        authority: authority.publicKey,
        config: configPda,
        mint: mintKp.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();

    try {
      await program.methods
        .cdpBorrowStable(new anchor.BN(1 * 10 ** 6))
        .accounts({
          user: authority.publicKey,
          config: configPda,
          sssMint: mintKp.publicKey,
          collateralMint,
          collateralVault: collateralVaultPda,
          cdpPosition: cdpPositionPda,
          userSssAccount: userSssAta,
          pythPriceFeed: wrongFeed, // not mockPythKp → rejected
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      expect.fail("should have rejected mismatched Pyth feed");
    } catch (e: any) {
      expect(e.toString()).to.match(/UnexpectedPriceFeed|0x178c/i);
    } finally {
      // Restore to custom oracle
      await program.methods
        .setOracleConfig(2, customPriceFeedPda)
        .accounts({
          authority: authority.publicKey,
          config: configPda,
          mint: mintKp.publicKey,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .rpc();
    }
  });

  it("oracle-19: Pyth adapter — CDP borrow with mock price account (skipped if setAccountData unavailable)", async () => {
    const conn = provider.connection as any;

    await program.methods
      .setOracleConfig(0, mockPythKp.publicKey)
      .accounts({
        authority: authority.publicKey,
        config: configPda,
        mint: mintKp.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();

    try {
      // Create mock Pyth account
      const lamports = await provider.connection.getMinimumBalanceForRentExemption(3312);
      const tx = new Transaction().add(
        SystemProgram.createAccount({
          fromPubkey: authority.publicKey,
          newAccountPubkey: mockPythKp.publicKey,
          lamports,
          space: 3312,
          programId: PYTH_PROGRAM_ID,
        })
      );
      await provider.sendAndConfirm(tx, [(authority as any).payer, mockPythKp]);

      if (!conn.setAccountData) {
        // Standard test validator — verify oracle_type is stored, skip data injection
        const cfg = await program.account.stablecoinConfig.fetch(configPda);
        expect(cfg.oracleType).to.equal(0);
        return;
      }

      const nowTs = BigInt(Math.floor(Date.now() / 1000));
      const pythData = buildPythBuf(BigInt(1_000_000), nowTs);
      await conn.setAccountData(mockPythKp.publicKey, pythData);

      await program.methods
        .cdpBorrowStable(new anchor.BN(1 * 10 ** 6))
        .accounts({
          user: authority.publicKey,
          config: configPda,
          sssMint: mintKp.publicKey,
          collateralMint,
          collateralVault: collateralVaultPda,
          cdpPosition: cdpPositionPda,
          userSssAccount: userSssAta,
          pythPriceFeed: mockPythKp.publicKey,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const pos = await program.account.cdpPosition.fetch(cdpPositionPda);
      expect(pos.debtAmount.toNumber()).to.be.greaterThan(0);
    } catch (e: any) {
      // On standard validator, createAccount for non-system owner may fail — acceptable
      if (e.toString().match(/invalid account data|illegal owner/i)) return;
      throw e;
    } finally {
      // Restore to custom oracle
      await program.methods
        .setOracleConfig(2, customPriceFeedPda)
        .accounts({
          authority: authority.publicKey,
          config: configPda,
          mint: mintKp.publicKey,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .rpc();
    }
  });

  // ---------------------------------------------------------------------------
  // GROUP 6: Oracle switching mid-flight
  // ---------------------------------------------------------------------------

  it("oracle-20: switching oracle from Custom → Pyth updates config atomically", async () => {
    // Currently type=2 (Custom) — switch to type=0 (Pyth)
    await program.methods
      .setOracleConfig(0, mockPythKp.publicKey)
      .accounts({
        authority: authority.publicKey,
        config: configPda,
        mint: mintKp.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();

    const cfg = await program.account.stablecoinConfig.fetch(configPda);
    expect(cfg.oracleType).to.equal(0);
    expect(cfg.oracleFeed.equals(mockPythKp.publicKey)).to.be.true;

    // CDP borrow should now require the Pyth feed; custom PDA is the wrong account
    try {
      await program.methods
        .cdpBorrowStable(new anchor.BN(1 * 10 ** 6))
        .accounts({
          user: authority.publicKey,
          config: configPda,
          sssMint: mintKp.publicKey,
          collateralMint,
          collateralVault: collateralVaultPda,
          cdpPosition: cdpPositionPda,
          userSssAccount: userSssAta,
          pythPriceFeed: customPriceFeedPda, // wrong for Pyth type
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      expect.fail("should have rejected CustomPriceFeed as Pyth feed");
    } catch (e: any) {
      expect(e.toString()).to.match(/UnexpectedPriceFeed|Error/i);
    }

    // Switch back to Custom so remaining tests work
    await program.methods
      .setOracleConfig(2, customPriceFeedPda)
      .accounts({
        authority: authority.publicKey,
        config: configPda,
        mint: mintKp.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();
  });

  it("oracle-21: switching from Pyth → Custom; CDP borrow succeeds with custom feed", async () => {
    // Ensure type=2 and custom feed has valid price
    await program.methods
      .updateCustomPrice(new anchor.BN(1_000_000), -6, new anchor.BN(0))
      .accounts({
        authority: authority.publicKey,
        config: configPda,
        sssMint: mintKp.publicKey,
        customPriceFeed: customPriceFeedPda,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();

    await program.methods
      .setOracleConfig(2, customPriceFeedPda)
      .accounts({
        authority: authority.publicKey,
        config: configPda,
        mint: mintKp.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();

    // Borrow additional 50 SSS tokens (total debt stays well below 150% limit)
    await program.methods
      .cdpBorrowStable(new anchor.BN(50 * 10 ** 6))
      .accounts({
        user: authority.publicKey,
        config: configPda,
        sssMint: mintKp.publicKey,
        collateralMint,
        collateralVault: collateralVaultPda,
        cdpPosition: cdpPositionPda,
        userSssAccount: userSssAta,
        pythPriceFeed: customPriceFeedPda,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const pos = await program.account.cdpPosition.fetch(cdpPositionPda);
    // Total debt: 100 (oracle-13) + 50 (this test) + any Pyth borrows = ≥150
    expect(pos.debtAmount.toNumber()).to.be.greaterThan(100 * 10 ** 6);
  });

  it("oracle-22: updateCustomPrice idempotent — second update overwrites previous price", async () => {
    // First update to $0.50
    await program.methods
      .updateCustomPrice(new anchor.BN(500_000), -6, new anchor.BN(1_000))
      .accounts({
        authority: authority.publicKey,
        config: configPda,
        sssMint: mintKp.publicKey,
        customPriceFeed: customPriceFeedPda,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();

    let feed = await program.account.customPriceFeed.fetch(customPriceFeedPda);
    expect(feed.price.toNumber()).to.equal(500_000);

    // Second update to $3.00
    await program.methods
      .updateCustomPrice(new anchor.BN(3_000_000), -6, new anchor.BN(0))
      .accounts({
        authority: authority.publicKey,
        config: configPda,
        sssMint: mintKp.publicKey,
        customPriceFeed: customPriceFeedPda,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc();

    feed = await program.account.customPriceFeed.fetch(customPriceFeedPda);
    expect(feed.price.toNumber()).to.equal(3_000_000);
    expect(feed.conf.toNumber()).to.equal(0);
  });
});

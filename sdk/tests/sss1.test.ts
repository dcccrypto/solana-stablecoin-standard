import { expect } from "chai";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import { SolanaStablecoin, Presets } from "../src";

const RPC = "http://127.0.0.1:8899";

async function airdrop(connection: Connection, pubkey: PublicKey, sol = 10) {
  const sig = await connection.requestAirdrop(pubkey, sol * LAMPORTS_PER_SOL);
  await connection.confirmTransaction(sig, "confirmed");
}

describe("SolanaStablecoin – SSS-1", function () {
  const connection = new Connection(RPC, "confirmed");

  const authority = Keypair.generate();
  const recipient = Keypair.generate();
  const newFreezeAuth = Keypair.generate();

  let stablecoin: SolanaStablecoin;

  // -------------------------------------------------------------------------
  // Setup
  // -------------------------------------------------------------------------

  before(async function () {
    // Skip the entire suite if no local validator is running
    try {
      await connection.getVersion();
    } catch {
      return this.skip();
    }

    await airdrop(connection, authority.publicKey);
    await airdrop(connection, recipient.publicKey);
    await airdrop(connection, newFreezeAuth.publicKey);
  });

  // -------------------------------------------------------------------------
  // Deploy
  // -------------------------------------------------------------------------

  it("creates an SSS-1 stablecoin", async function () {
    stablecoin = await SolanaStablecoin.create(connection, {
      preset: Presets.SSS_1,
      name: "Test Dollar",
      symbol: "TUSD",
      decimals: 6,
      uri: "https://example.com/metadata.json",
      authority,
    });

    expect(stablecoin.mint).to.be.instanceOf(PublicKey);
    expect(stablecoin.tokenProgramId.toBase58()).to.equal(
      TOKEN_2022_PROGRAM_ID.toBase58(),
    );
    expect(stablecoin.compliance).to.be.null;
  });

  // -------------------------------------------------------------------------
  // Load
  // -------------------------------------------------------------------------

  it("loads an existing stablecoin", function () {
    const loaded = SolanaStablecoin.load(connection, {
      mint: stablecoin.mint,
    });

    expect(loaded.mint.toBase58()).to.equal(stablecoin.mint.toBase58());
    expect(loaded.tokenProgramId.toBase58()).to.equal(
      TOKEN_2022_PROGRAM_ID.toBase58(),
    );
  });

  // -------------------------------------------------------------------------
  // Mint tokens
  // -------------------------------------------------------------------------

  it("mints 10 tokens to recipient", async function () {
    const sig = await stablecoin.mintTokens({
      recipient: recipient.publicKey,
      amount: 10_000_000n,
      minter: authority,
    });

    expect(sig).to.be.a("string").with.length.greaterThan(0);
  });

  // -------------------------------------------------------------------------
  // Supply
  // -------------------------------------------------------------------------

  it("reports correct supply after minting", async function () {
    const supply = await stablecoin.getSupply();

    expect(supply.raw).to.equal(10_000_000n);
    expect(supply.uiAmount).to.equal(10);
    expect(supply.decimals).to.equal(6);
  });

  // -------------------------------------------------------------------------
  // Balance
  // -------------------------------------------------------------------------

  it("reports correct balance for recipient", async function () {
    const balance = await stablecoin.getBalance(recipient.publicKey);

    expect(balance.raw).to.equal(10_000_000n);
    expect(balance.uiAmount).to.equal(10);
    expect(balance.exists).to.be.true;
    expect(balance.ata).to.be.instanceOf(PublicKey);
  });

  it("reports zero balance for unknown wallet", async function () {
    const random = Keypair.generate();
    const balance = await stablecoin.getBalance(random.publicKey);

    expect(balance.raw).to.equal(0n);
    expect(balance.uiAmount).to.equal(0);
    expect(balance.exists).to.be.false;
  });

  // -------------------------------------------------------------------------
  // Status
  // -------------------------------------------------------------------------

  it("returns status with supply and authorities", async function () {
    const status = await stablecoin.getStatus();

    expect(status.mint.toBase58()).to.equal(stablecoin.mint.toBase58());
    expect(status.supply.raw).to.equal(10_000_000n);
    expect(status.mintAuthority!.toBase58()).to.equal(
      authority.publicKey.toBase58(),
    );
    expect(status.freezeAuthority!.toBase58()).to.equal(
      authority.publicKey.toBase58(),
    );
  });

  // -------------------------------------------------------------------------
  // Burn
  // -------------------------------------------------------------------------

  it("mints to authority then burns 2 tokens", async function () {
    await stablecoin.mintTokens({
      recipient: authority.publicKey,
      amount: 5_000_000n,
      minter: authority,
    });

    const sig = await stablecoin.burn({
      amount: 2_000_000n,
      owner: authority,
    });

    expect(sig).to.be.a("string");

    const supply = await stablecoin.getSupply();
    expect(supply.raw).to.equal(13_000_000n);
  });

  // -------------------------------------------------------------------------
  // Freeze / Thaw
  // -------------------------------------------------------------------------

  it("freezes a token account", async function () {
    const ata = getAssociatedTokenAddressSync(
      stablecoin.mint,
      recipient.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID,
    );

    const sig = await stablecoin.freeze({
      tokenAccount: ata,
      freezeAuthority: authority,
    });

    expect(sig).to.be.a("string");
  });

  it("rejects mint to a frozen account", async function () {
    let threw = false;
    try {
      await stablecoin.mintTokens({
        recipient: recipient.publicKey,
        amount: 1n,
        minter: authority,
      });
    } catch {
      threw = true;
    }
    expect(threw).to.be.true;
  });

  it("thaws the frozen account", async function () {
    const ata = getAssociatedTokenAddressSync(
      stablecoin.mint,
      recipient.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID,
    );

    const sig = await stablecoin.thaw({
      tokenAccount: ata,
      freezeAuthority: authority,
    });

    expect(sig).to.be.a("string");
  });

  it("can mint after thaw", async function () {
    const sig = await stablecoin.mintTokens({
      recipient: recipient.publicKey,
      amount: 1_000_000n,
      minter: authority,
    });

    expect(sig).to.be.a("string");
  });

  // -------------------------------------------------------------------------
  // Set authority
  // -------------------------------------------------------------------------

  it("changes freeze authority", async function () {
    const sig = await stablecoin.setAuthority({
      type: "freeze",
      currentAuthority: authority,
      newAuthority: newFreezeAuth.publicKey,
    });

    expect(sig).to.be.a("string");

    const status = await stablecoin.getStatus();
    expect(status.freezeAuthority!.toBase58()).to.equal(
      newFreezeAuth.publicKey.toBase58(),
    );
  });

  it("freeze works with new authority", async function () {
    const ata = getAssociatedTokenAddressSync(
      stablecoin.mint,
      recipient.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID,
    );

    const sig = await stablecoin.freeze({
      tokenAccount: ata,
      freezeAuthority: newFreezeAuth,
    });
    expect(sig).to.be.a("string");

    // Thaw with new authority
    const sig2 = await stablecoin.thaw({
      tokenAccount: ata,
      freezeAuthority: newFreezeAuth,
    });
    expect(sig2).to.be.a("string");
  });

  it("rejects freeze with old authority", async function () {
    const ata = getAssociatedTokenAddressSync(
      stablecoin.mint,
      recipient.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID,
    );

    let threw = false;
    try {
      await stablecoin.freeze({
        tokenAccount: ata,
        freezeAuthority: authority,
      });
    } catch {
      threw = true;
    }
    expect(threw).to.be.true;
  });

  // -------------------------------------------------------------------------
  // Audit log
  // -------------------------------------------------------------------------

  it("returns audit log with recent transactions", async function () {
    const log = await stablecoin.getAuditLog(10);

    expect(log).to.be.an("array");
    expect(log.length).to.be.greaterThan(0);
    expect(log[0]).to.have.property("signature");
    expect(log[0]).to.have.property("slot");
    expect(log[0]).to.have.property("err");
    expect(log[0]).to.have.property("blockTime");
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------

  it("rejects create when transfer hook is true without config", async function () {
    let threw = false;
    try {
      await SolanaStablecoin.create(connection, {
        name: "Bad",
        symbol: "BAD",
        authority,
        extensions: { transferHook: true },
      });
    } catch (err) {
      threw = true;
      expect((err as Error).message).to.include("programId");
    }
    expect(threw).to.be.true;
  });

  it("rejects SSS-2 preset without transfer hook", async function () {
    let threw = false;
    try {
      await SolanaStablecoin.create(connection, {
        preset: Presets.SSS_2,
        name: "Bad",
        symbol: "BAD",
        authority,
      });
    } catch (err) {
      threw = true;
      expect((err as Error).message).to.include("transfer hook");
    }
    expect(threw).to.be.true;
  });
});

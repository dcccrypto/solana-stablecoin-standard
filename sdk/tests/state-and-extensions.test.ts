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
import { SolanaStablecoin, Presets, SssCoreClient, getSssConfigAddress } from "../src";

const RPC = "http://127.0.0.1:8899";

async function airdrop(connection: Connection, pubkey: PublicKey, sol = 10) {
  const sig = await connection.requestAirdrop(pubkey, sol * LAMPORTS_PER_SOL);
  await connection.confirmTransaction(sig, "confirmed");
}

describe("SolanaStablecoin — refresh / getState / extensions", function () {
  const connection = new Connection(RPC, "confirmed");
  const authority = Keypair.generate();
  const recipient = Keypair.generate();
  let stablecoin: SolanaStablecoin;

  before(async function () {
    try {
      await connection.getVersion();
    } catch {
      return this.skip();
    }

    await airdrop(connection, authority.publicKey);
    await airdrop(connection, recipient.publicKey);

    stablecoin = await SolanaStablecoin.create(connection, {
      preset: Presets.SSS_1,
      name: "Refresh Test",
      symbol: "RFSH",
      decimals: 6,
      authority,
    });
  });

  it("getState() returns null before refresh()", function () {
    expect(stablecoin.getState()).to.be.null;
  });

  it("refresh() populates cached state", async function () {
    await stablecoin.refresh();
    const state = stablecoin.getState();
    expect(state).to.not.be.null;
    expect(state!.mint.toBase58()).to.equal(stablecoin.mint.toBase58());
    expect(state!.supply.raw).to.equal(0n);
    expect(state!.supply.decimals).to.equal(6);
    expect(state!.mintAuthority!.toBase58()).to.equal(authority.publicKey.toBase58());
  });

  it("refresh() reflects supply changes after minting", async function () {
    await stablecoin.mintTokens({
      recipient: recipient.publicKey,
      amount: 5_000_000n,
      minter: authority,
    });

    await stablecoin.refresh();
    const state = stablecoin.getState();
    expect(state!.supply.raw).to.equal(5_000_000n);
    expect(state!.supply.uiAmountString).to.equal("5.000000");
  });

  it("uiAmountString is precise for large amounts", async function () {
    await stablecoin.mintTokens({
      recipient: recipient.publicKey,
      amount: 1_000_000_000_000n,
      minter: authority,
    });

    const supply = await stablecoin.getSupply();
    expect(supply.uiAmountString).to.equal("1000005.000000");
  });

  it("core is null when no ssCoreProgramId is set", function () {
    expect(stablecoin.core).to.be.null;
  });

  it("core is populated when ssCoreProgramId is provided", function () {
    const fakeProgramId = Keypair.generate().publicKey;
    const loaded = SolanaStablecoin.load(connection, {
      mint: stablecoin.mint,
      ssCoreProgramId: fakeProgramId,
    });
    expect(loaded.core).to.not.be.null;
    expect(loaded.core).to.be.instanceOf(SssCoreClient);
  });

  it("compliance is null for SSS-1", function () {
    expect(stablecoin.compliance).to.be.null;
  });
});

describe("SolanaStablecoin — Pausable + PermanentDelegate extensions", function () {
  const connection = new Connection(RPC, "confirmed");
  const authority = Keypair.generate();
  const recipient = Keypair.generate();
  let stablecoin: SolanaStablecoin;

  before(async function () {
    try {
      await connection.getVersion();
    } catch {
      return this.skip();
    }

    await airdrop(connection, authority.publicKey);
    await airdrop(connection, recipient.publicKey);

    stablecoin = await SolanaStablecoin.create(connection, {
      name: "Full Extensions",
      symbol: "FEXT",
      decimals: 6,
      authority,
      extensions: {
        metadata: true,
        pausable: true,
        permanentDelegate: true,
      },
    });
  });

  it("creates a mint with pausable + permanent delegate", async function () {
    expect(stablecoin.mint).to.be.instanceOf(PublicKey);
    const status = await stablecoin.getStatus();
    expect(status.mintAuthority!.toBase58()).to.equal(authority.publicKey.toBase58());
  });

  it("mints tokens", async function () {
    const sig = await stablecoin.mintTokens({
      recipient: recipient.publicKey,
      amount: 10_000_000n,
      minter: authority,
    });
    expect(sig).to.be.a("string");

    const supply = await stablecoin.getSupply();
    expect(supply.raw).to.equal(10_000_000n);
  });

  it("seize works (thaw→burn→mint→refreeze)", async function () {
    const ata = getAssociatedTokenAddressSync(
      stablecoin.mint,
      recipient.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID,
    );

    await stablecoin.freeze({ tokenAccount: ata, freezeAuthority: authority });

    const treasuryWallet = authority.publicKey;
    const sig = await stablecoin.seize({
      targetTokenAccount: ata,
      treasury: treasuryWallet,
      amount: 5_000_000n,
      authority,
    });
    expect(sig).to.be.a("string");

    const balance = await stablecoin.getBalance(recipient.publicKey);
    expect(balance.raw).to.equal(5_000_000n);
  });
});

describe("SolanaStablecoin — PDA helpers", function () {
  it("getSssConfigAddress returns deterministic PDA", function () {
    const mint = Keypair.generate().publicKey;
    const programId = Keypair.generate().publicKey;
    const [pda1] = getSssConfigAddress(mint, programId);
    const [pda2] = getSssConfigAddress(mint, programId);
    expect(pda1.toBase58()).to.equal(pda2.toBase58());
  });
});

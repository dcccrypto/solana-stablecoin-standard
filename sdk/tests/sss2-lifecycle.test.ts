/**
 * Full SSS-2 lifecycle test through the SDK.
 *
 * Prerequisites:
 *  - Local validator running with blacklist_hook + sss_core programs deployed.
 *    Use `solana-test-validator` with `--bpf-program` flags, or run inside
 *    an Anchor workspace that deploys both programs.
 *
 * Flow tested:
 *   create(SSS-2) → init core → grant roles → set quota → mint →
 *   blacklist recipient → mint to blacklisted fails (if compliance on) →
 *   transfer → seize from frozen → verify accounting
 */

import { expect } from "chai";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  getAccount,
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";
import {
  SolanaStablecoin,
  Presets,
  Compliance,
  SssCoreClient,
  ROLE_MINTER,
  ROLE_BURNER,
  ROLE_FREEZER,
  ROLE_SEIZER,
} from "../src";

const RPC = "http://127.0.0.1:8899";

const BLACKLIST_HOOK_PROGRAM_ID = new PublicKey(
  "84rPjkmmoP3oYZVxjtL2rdcT6hC5Rts6N5XzJTFcJEk6",
);
const SSS_CORE_PROGRAM_ID = new PublicKey(
  "4ZFzYcNVDSew79hSAVRdtDuMqe9g4vYh7CFvitPSy5DD",
);

async function airdrop(connection: Connection, pubkey: PublicKey, sol = 10) {
  const sig = await connection.requestAirdrop(pubkey, sol * LAMPORTS_PER_SOL);
  await connection.confirmTransaction(sig, "confirmed");
}

describe("SolanaStablecoin – SSS-2 full lifecycle", function () {
  this.timeout(120_000);

  const connection = new Connection(RPC, "confirmed");

  const admin = Keypair.generate();
  const minter = Keypair.generate();
  const recipient = Keypair.generate();
  const treasury = Keypair.generate();

  let stablecoin: SolanaStablecoin;
  let core: SssCoreClient;
  let compliance: Compliance;

  before(async function () {
    try {
      await connection.getVersion();
      // Check if the programs exist on the local validator
      const hookInfo = await connection.getAccountInfo(BLACKLIST_HOOK_PROGRAM_ID);
      const coreInfo = await connection.getAccountInfo(SSS_CORE_PROGRAM_ID);
      if (!hookInfo || !coreInfo) {
        console.log("Programs not deployed to local validator — skipping SSS-2 lifecycle test");
        return this.skip();
      }
    } catch {
      return this.skip();
    }

    for (const kp of [admin, minter, recipient, treasury]) {
      await airdrop(connection, kp.publicKey, 20);
    }
  });

  it("deploys an SSS-2 stablecoin with transfer hook + sss-core", async function () {
    stablecoin = await SolanaStablecoin.create(connection, {
      preset: Presets.SSS_2,
      name: "Compliance USD",
      symbol: "cUSD",
      decimals: 6,
      uri: "https://example.com/cusd.json",
      authority: admin,
      hookProgramId: BLACKLIST_HOOK_PROGRAM_ID,
      ssCoreProgramId: SSS_CORE_PROGRAM_ID,
    });

    expect(stablecoin.mint).to.be.instanceOf(PublicKey);
    expect(stablecoin.compliance).to.not.be.null;
    expect(stablecoin.core).to.not.be.null;

    core = stablecoin.core!;
    compliance = stablecoin.compliance!;
  });

  it("sss-core config is initialized with compliance enabled", async function () {
    const config = await core.getConfig();
    expect(config).to.not.be.null;
    expect(config!.complianceEnabled).to.be.true;
    expect(config!.preset).to.equal(2);
    expect(config!.transferHookProgram).to.not.be.null;
    expect(config!.transferHookProgram!.toBase58()).to.equal(
      BLACKLIST_HOOK_PROGRAM_ID.toBase58(),
    );
  });

  it("grants minter, burner, freezer, seizer roles via sss-core", async function () {
    for (const [wallet, role] of [
      [minter.publicKey, ROLE_MINTER],
      [admin.publicKey, ROLE_BURNER],
      [admin.publicKey, ROLE_FREEZER],
      [admin.publicKey, ROLE_SEIZER],
    ] as [PublicKey, number][]) {
      await core.grantRole(admin, wallet, role);
    }
  });

  it("sets minter quota", async function () {
    await core.setMinterQuota(admin, minter.publicKey, 1_000_000_000n);
    const info = await core.getMinterInfo(minter.publicKey);
    expect(info).to.not.be.null;
    expect(info!.quota).to.equal(1_000_000_000n);
    expect(info!.isActive).to.be.true;
  });

  it("mints tokens to recipient", async function () {
    const recipientAta = getAssociatedTokenAddressSync(
      stablecoin.mint,
      recipient.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID,
    );

    // Create recipient ATA
    const createAtaTx = new Transaction().add(
      createAssociatedTokenAccountInstruction(
        admin.publicKey,
        recipientAta,
        recipient.publicKey,
        stablecoin.mint,
        TOKEN_2022_PROGRAM_ID,
      ),
    );
    await sendAndConfirmTransaction(connection, createAtaTx, [admin], {
      commitment: "confirmed",
    });

    await core.mintTokens(minter, recipientAta, 100_000_000n);

    const acct = await getAccount(
      connection,
      recipientAta,
      "confirmed",
      TOKEN_2022_PROGRAM_ID,
    );
    expect(Number(acct.amount)).to.equal(100_000_000);
  });

  it("blacklists recipient with reason stored in PDA", async function () {
    await compliance.blacklistAdd(
      recipient.publicKey,
      admin,
      "Sanctions list match",
    );

    const status = await compliance.isBlacklisted(recipient.publicKey);
    expect(status.blocked).to.be.true;
    expect(status.reason).to.equal("Sanctions list match");
  });

  it("transfer to blacklisted recipient is blocked by hook", async function () {
    const minterAta = getAssociatedTokenAddressSync(
      stablecoin.mint,
      minter.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID,
    );

    // Create minter ATA and mint some tokens
    const createAtaTx = new Transaction().add(
      createAssociatedTokenAccountInstruction(
        admin.publicKey,
        minterAta,
        minter.publicKey,
        stablecoin.mint,
        TOKEN_2022_PROGRAM_ID,
      ),
    );
    await sendAndConfirmTransaction(connection, createAtaTx, [admin], {
      commitment: "confirmed",
    });
    await core.mintTokens(minter, minterAta, 50_000_000n);

    // Transfer to blacklisted recipient should fail via transfer hook
    let threw = false;
    try {
      await stablecoin.transfer({
        from: minter,
        to: recipient.publicKey,
        amount: 10_000_000n,
      });
    } catch (e: any) {
      threw = true;
      expect(e.toString()).to.include("blacklisted");
    }
    expect(threw).to.be.true;
  });

  it("removes from blacklist and transfer succeeds", async function () {
    await compliance.blacklistRemove(recipient.publicKey, admin);

    const status = await compliance.isBlacklisted(recipient.publicKey);
    expect(status.blocked).to.be.false;

    await stablecoin.transfer({
      from: minter,
      to: recipient.publicKey,
      amount: 10_000_000n,
    });

    const recipientAta = getAssociatedTokenAddressSync(
      stablecoin.mint,
      recipient.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID,
    );
    const acct = await getAccount(
      connection,
      recipientAta,
      "confirmed",
      TOKEN_2022_PROGRAM_ID,
    );
    expect(Number(acct.amount)).to.equal(110_000_000);
  });

  it("freeze → seize → verify accounting", async function () {
    const recipientAta = getAssociatedTokenAddressSync(
      stablecoin.mint,
      recipient.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID,
    );

    // Freeze recipient via sss-core
    await core.freezeAccount(admin, recipientAta);

    const frozen = await getAccount(
      connection,
      recipientAta,
      "confirmed",
      TOKEN_2022_PROGRAM_ID,
    );
    expect(frozen.isFrozen).to.be.true;

    // Seize via SDK
    await stablecoin.seize({
      authority: admin,
      targetTokenAccount: recipientAta,
      treasury: treasury.publicKey,
      amount: 50_000_000n,
    });

    const afterSeize = await getAccount(
      connection,
      recipientAta,
      "confirmed",
      TOKEN_2022_PROGRAM_ID,
    );
    expect(Number(afterSeize.amount)).to.equal(60_000_000);
    expect(afterSeize.isFrozen).to.be.true; // re-frozen by seize

    // Verify sss-core accounting
    const config = await core.getConfig();
    expect(config!.totalMinted > 0n).to.be.true;
  });

  it("supply and balance queries work correctly", async function () {
    const supply = await stablecoin.getSupply();
    expect(supply.raw > 0n).to.be.true;
    expect(supply.uiAmountString).to.not.be.empty;
    expect(supply.decimals).to.equal(6);

    const recipientAta = getAssociatedTokenAddressSync(
      stablecoin.mint,
      recipient.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID,
    );
    const balance = await stablecoin.getBalance(recipientAta);
    expect(balance.raw > 0n).to.be.true;
  });
});

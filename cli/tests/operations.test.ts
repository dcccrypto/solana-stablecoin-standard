import { expect } from "chai";
import fs from "fs";
import path from "path";
import os from "os";
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
import type { SssConfig } from "../src/config";
import {
  runMint,
  runBurn,
  runFreeze,
  runThaw,
  runSupply,
  runBalance,
  runStatus,
  runSetAuthority,
  runAuditLog,
} from "../src/stablecoin/operations";
import { deployStablecoinFromConfig } from "../src/stablecoin/deploy";
import { writeDefaultConfig, loadConfig } from "../src/config";

const RPC = "http://127.0.0.1:8899";

async function airdrop(connection: Connection, pubkey: PublicKey, sol = 10) {
  const sig = await connection.requestAirdrop(pubkey, sol * LAMPORTS_PER_SOL);
  await connection.confirmTransaction(sig, "confirmed");
}

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sss-cli-ops-"));
}

describe("CLI operations – SSS-1", function () {
  const connection = new Connection(RPC, "confirmed");
  const authority = Keypair.generate();
  const recipient = Keypair.generate();

  let cfg: SssConfig;
  let configPath: string;

  before(async function () {
    // Skip the entire suite if no local validator is running
    try {
      await connection.getVersion();
    } catch {
      return this.skip();
    }

    await airdrop(connection, authority.publicKey);
    await airdrop(connection, recipient.publicKey);

    // Write the keypair to a temp file so the CLI config can reference it
    const dir = tmpDir();
    const keypairPath = path.join(dir, "authority.json");
    fs.writeFileSync(keypairPath, JSON.stringify(Array.from(authority.secretKey)));

    configPath = path.join(dir, "config.toml");
    writeDefaultConfig("sss-1", configPath);

    // Patch the config to use local validator and our temp keypair
    let content = fs.readFileSync(configPath, "utf8");
    content = content.replace(/rpcUrl = ""/, `rpcUrl = "${RPC}"`);
    content = content.replace(
      /mint = "~\/.config\/solana\/id\.json"/,
      `mint = "${keypairPath}"`,
    );
    content = content.replace(
      /freeze = "~\/.config\/solana\/id\.json"/,
      `freeze = "${keypairPath}"`,
    );
    content = content.replace(
      /metadata = "~\/.config\/solana\/id\.json"/,
      `metadata = "${keypairPath}"`,
    );
    fs.writeFileSync(configPath, content, "utf8");

    // Deploy via CLI deploy function
    const origCwd = process.cwd();
    process.chdir(dir);
    try {
      cfg = await deployStablecoinFromConfig(configPath);
    } finally {
      process.chdir(origCwd);
    }

    expect(cfg.stablecoin.mint).to.be.a("string").with.length.greaterThan(0);
  });

  it("mints tokens to a recipient", async function () {
    await runMint(cfg, recipient.publicKey.toBase58(), 5_000_000n);

    const ata = getAssociatedTokenAddressSync(
      new PublicKey(cfg.stablecoin.mint),
      recipient.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID,
    );
    const account = await connection.getTokenAccountBalance(ata);
    expect(Number(account.value.amount)).to.equal(5_000_000);
  });

  it("reports supply correctly", async function () {
    // runSupply logs to console – we just verify it doesn't throw
    await runSupply(cfg);
  });

  it("reports balance correctly", async function () {
    await runBalance(cfg, recipient.publicKey.toBase58());
  });

  it("reports status correctly", async function () {
    await runStatus(cfg);
  });

  it("burns tokens from authority's ATA", async function () {
    // Mint some to authority first
    await runMint(cfg, authority.publicKey.toBase58(), 3_000_000n);
    await runBurn(cfg, 1_000_000n);

    const ata = getAssociatedTokenAddressSync(
      new PublicKey(cfg.stablecoin.mint),
      authority.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID,
    );
    const account = await connection.getTokenAccountBalance(ata);
    expect(Number(account.value.amount)).to.equal(2_000_000);
  });

  it("freezes a token account", async function () {
    const ata = getAssociatedTokenAddressSync(
      new PublicKey(cfg.stablecoin.mint),
      recipient.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID,
    );
    await runFreeze(cfg, ata.toBase58());

    // Verify mint to that account now fails
    let threw = false;
    try {
      await runMint(cfg, recipient.publicKey.toBase58(), 1n);
    } catch {
      threw = true;
    }
    expect(threw).to.be.true;
  });

  it("thaws a token account", async function () {
    const ata = getAssociatedTokenAddressSync(
      new PublicKey(cfg.stablecoin.mint),
      recipient.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID,
    );
    await runThaw(cfg, ata.toBase58());

    // Verify mint works again
    await runMint(cfg, recipient.publicKey.toBase58(), 1_000_000n);
  });

  it("sets a new freeze authority", async function () {
    const newAuth = Keypair.generate();
    await airdrop(connection, newAuth.publicKey);
    await runSetAuthority(cfg, "freeze", newAuth.publicKey.toBase58());
  });

  it("fetches audit log", async function () {
    await runAuditLog(cfg, 5);
  });
});

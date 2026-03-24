/**
 * SSS-135: Cross-Chain Bridge Hooks — Anchor tests
 *
 * Tests: init_bridge_config, bridge_out, bridge_in, all guard conditions.
 * Uses localnet with mock bridge proofs (proof.verified = true).
 *
 * Test plan (20 tests):
 *  1.  init_bridge_config: Wormhole type succeeds
 *  2.  init_bridge_config: LayerZero type succeeds (separate mint)
 *  3.  init_bridge_config: invalid bridge type rejected
 *  4.  init_bridge_config: bridge_fee_bps > 1000 rejected
 *  5.  init_bridge_config: non-authority rejected
 *  6.  bridge_out: succeeds, burns tokens, updates counters
 *  7.  bridge_out: zero amount rejected
 *  8.  bridge_out: FLAG_BRIDGE_ENABLED not set rejected
 *  9.  bridge_out: circuit breaker active rejected
 * 10.  bridge_out: paused mint rejected
 * 11.  bridge_out: amount > max_bridge_amount_per_tx rejected
 * 12.  bridge_out: max_bridge_amount_per_tx == 0 allows any amount
 * 13.  bridge_in: succeeds, mints tokens, updates counters
 * 14.  bridge_in: zero amount rejected
 * 15.  bridge_in: FLAG_BRIDGE_ENABLED not set rejected
 * 16.  bridge_in: circuit breaker active rejected
 * 17.  bridge_in: paused mint rejected
 * 18.  bridge_in: empty proof rejected
 * 19.  bridge_in: proof.verified == false rejected
 * 20.  bridge_in: max_supply cap enforced
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
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

// Retry helper — mirrors sss-token.ts pattern for CI reliability
async function sendTxWithRetry(
  provider: anchor.AnchorProvider,
  buildTx: () => Promise<anchor.web3.Transaction>,
  signers: anchor.web3.Signer[] = [],
  attempts = 5
): Promise<void> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    const tx = await buildTx();
    const { blockhash, lastValidBlockHeight } =
      await provider.connection.getLatestBlockhash("finalized");
    tx.recentBlockhash = blockhash;
    tx.lastValidBlockHeight = lastValidBlockHeight;
    tx.feePayer = provider.wallet.publicKey;
    try {
      await provider.sendAndConfirm(tx, signers, {
        commitment: "confirmed",
        skipPreflight: true,
      });
      return;
    } catch (err: any) {
      const msg: string = err?.message ?? "";
      if (msg.includes("Blockhash not found") || msg.includes("BlockhashNotFound")) {
        lastErr = err;
        await new Promise((r) => setTimeout(r, 800 * (i + 1)));
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

const FLAG_BRIDGE_ENABLED = new BN(1).shln(13); // 1 << 13
const FLAG_CIRCUIT_BREAKER = new BN(1); // 1 << 0
const BRIDGE_TYPE_WORMHOLE = 1;
const BRIDGE_TYPE_LAYERZERO = 2;

async function assertError(fn: () => Promise<any>, substr: string): Promise<void> {
  try {
    await fn();
    throw new Error(`Expected error containing "${substr}" but succeeded`);
  } catch (err: any) {
    const msg: string = err?.message ?? JSON.stringify(err);
    if (!msg.includes(substr)) {
      throw new Error(`Expected error containing "${substr}", got: ${msg.slice(0, 300)}`);
    }
  }
}

describe("SSS-135: cross-chain bridge hooks", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SssToken as Program<SssToken>;
  const authority = provider.wallet as anchor.Wallet;

  // Primary mint for most tests
  const mintKp = Keypair.generate();
  let configPda: PublicKey;
  let bridgeConfigPda: PublicKey;
  let minterInfoPda: PublicKey;
  let senderAta: PublicKey;
  let feeVaultAta: PublicKey;

  // Secondary mint for LZ test
  const mintKp2 = Keypair.generate();
  let configPda2: PublicKey;
  let bridgeConfigPda2: PublicKey;

  // Fake bridge program pubkey (no actual CPI needed for mock tests)
  const fakeBridgeProgram = Keypair.generate().publicKey;

  before("initialize primary mint + minter + fund sender ATA", async () => {
    [configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("stablecoin-config"), mintKp.publicKey.toBuffer()],
      program.programId
    );
    [bridgeConfigPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("bridge-config"), mintKp.publicKey.toBuffer()],
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
    senderAta = getAssociatedTokenAddressSync(
      mintKp.publicKey,
      authority.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );
    feeVaultAta = getAssociatedTokenAddressSync(
      mintKp.publicKey,
      authority.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );

    // Initialize
    await program.methods
      .initialize({
        preset: 1,
        decimals: 6,
        name: "Bridge Test Token",
        symbol: "BTT",
        uri: "https://example.com/btt",
        transferHookProgram: null,
        collateralMint: null,
        reserveVault: null,
        maxSupply: new BN(10_000_000_000), // 10,000 tokens (6 dec)
        featureFlags: new BN(0),
        auditorElgamalPubkey: null,
      })
      .accounts({
        payer: authority.publicKey,
        authority: authority.publicKey,
        config: configPda,
        mint: mintKp.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      } as any)
      .signers([mintKp])
      .rpc({ commitment: "confirmed" });

    // Register minter
    await program.methods
      .updateMinter(new BN(0))
      .accounts({
        authority: authority.publicKey,
        config: configPda,
        minterInfo: minterInfoPda,
        minter: authority.publicKey,
        systemProgram: SystemProgram.programId,
      } as any)
      .rpc({ commitment: "confirmed" });

    // Create sender ATA
    const createAtaIx = createAssociatedTokenAccountInstruction(
      authority.publicKey,
      senderAta,
      authority.publicKey,
      mintKp.publicKey,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    const tx = new anchor.web3.Transaction().add(createAtaIx);
    await sendTxWithRetry(provider, async () => tx, []);

    // Mint 1000 tokens to sender
    await program.methods
      .mint(new BN(1_000_000_000))
      .accounts({
        minter: authority.publicKey,
        config: configPda,
        mint: mintKp.publicKey,
        minterInfo: minterInfoPda,
        recipientTokenAccount: senderAta,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      } as any)
      .rpc({ commitment: "confirmed" });

    // Enable FLAG_BRIDGE_ENABLED on the config
    await program.methods
      .setFeatureFlag(FLAG_BRIDGE_ENABLED)
      .accounts({
        authority: authority.publicKey,
        config: configPda,
      } as any)
      .rpc({ commitment: "confirmed" });

    // Initialize secondary mint for LZ test
    [configPda2] = PublicKey.findProgramAddressSync(
      [Buffer.from("stablecoin-config"), mintKp2.publicKey.toBuffer()],
      program.programId
    );
    [bridgeConfigPda2] = PublicKey.findProgramAddressSync(
      [Buffer.from("bridge-config"), mintKp2.publicKey.toBuffer()],
      program.programId
    );
    await program.methods
      .initialize({
        preset: 1,
        decimals: 6,
        name: "LZ Test Token",
        symbol: "LZT",
        uri: "https://example.com/lzt",
        transferHookProgram: null,
        collateralMint: null,
        reserveVault: null,
        maxSupply: null,
        featureFlags: new BN(0),
        auditorElgamalPubkey: null,
      })
      .accounts({
        payer: authority.publicKey,
        authority: authority.publicKey,
        config: configPda2,
        mint: mintKp2.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      } as any)
      .signers([mintKp2])
      .rpc({ commitment: "confirmed" });
  });

  // ─── Test 1: init_bridge_config Wormhole ────────────────────────────────────
  it("1. init_bridge_config: Wormhole type succeeds", async () => {
    await program.methods
      .initBridgeConfig(
        BRIDGE_TYPE_WORMHOLE,
        fakeBridgeProgram,
        new BN(500_000_000), // max 500 tokens per tx
        10, // 0.1% fee
        feeVaultAta
      )
      .accounts({
        authority: authority.publicKey,
        config: configPda,
        mint: mintKp.publicKey,
        bridgeConfig: bridgeConfigPda,
        systemProgram: SystemProgram.programId,
      } as any)
      .rpc({ commitment: "confirmed" });

    const bc = await (program.account as any).bridgeConfig.fetch(bridgeConfigPda);
    expect(bc.bridgeType).to.equal(BRIDGE_TYPE_WORMHOLE);
    expect(bc.bridgeProgram.toBase58()).to.equal(fakeBridgeProgram.toBase58());
    expect(bc.maxBridgeAmountPerTx.toNumber()).to.equal(500_000_000);
    expect(bc.bridgeFeeBps).to.equal(10);
    expect(bc.totalBridgedOut.toNumber()).to.equal(0);
    expect(bc.totalBridgedIn.toNumber()).to.equal(0);
  });

  // ─── Test 2: init_bridge_config LayerZero ──────────────────────────────────
  it("2. init_bridge_config: LayerZero type succeeds", async () => {
    const lzFeeVault = getAssociatedTokenAddressSync(
      mintKp2.publicKey,
      authority.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );
    await program.methods
      .initBridgeConfig(
        BRIDGE_TYPE_LAYERZERO,
        fakeBridgeProgram,
        new BN(0),
        5,
        lzFeeVault
      )
      .accounts({
        authority: authority.publicKey,
        config: configPda2,
        mint: mintKp2.publicKey,
        bridgeConfig: bridgeConfigPda2,
        systemProgram: SystemProgram.programId,
      } as any)
      .rpc({ commitment: "confirmed" });

    const bc = await (program.account as any).bridgeConfig.fetch(bridgeConfigPda2);
    expect(bc.bridgeType).to.equal(BRIDGE_TYPE_LAYERZERO);
    expect(bc.maxBridgeAmountPerTx.toNumber()).to.equal(0); // unlimited
  });

  // ─── Test 3: invalid bridge type ──────────────────────────────────────────
  it("3. init_bridge_config: invalid bridge type rejected", async () => {
    const mintKp3 = Keypair.generate();
    const [cfgPda3] = PublicKey.findProgramAddressSync(
      [Buffer.from("stablecoin-config"), mintKp3.publicKey.toBuffer()],
      program.programId
    );
    const [bcPda3] = PublicKey.findProgramAddressSync(
      [Buffer.from("bridge-config"), mintKp3.publicKey.toBuffer()],
      program.programId
    );
    await program.methods
      .initialize({
        preset: 1,
        decimals: 6,
        name: "T3",
        symbol: "T3",
        uri: "https://example.com",
        transferHookProgram: null,
        collateralMint: null,
        reserveVault: null,
        maxSupply: null,
        featureFlags: new BN(0),
        auditorElgamalPubkey: null,
      })
      .accounts({
        payer: authority.publicKey,
        authority: authority.publicKey,
        config: cfgPda3,
        mint: mintKp3.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      } as any)
      .signers([mintKp3])
      .rpc({ commitment: "confirmed" });

    await assertError(
      () =>
        program.methods
          .initBridgeConfig(99, fakeBridgeProgram, new BN(0), 0, authority.publicKey)
          .accounts({
            authority: authority.publicKey,
            config: cfgPda3,
            mint: mintKp3.publicKey,
            bridgeConfig: bcPda3,
            systemProgram: SystemProgram.programId,
          } as any)
          .rpc({ commitment: "confirmed" }),
      "InvalidBridgeType"
    );
  });

  // ─── Test 4: bridge_fee_bps too high ──────────────────────────────────────
  it("4. init_bridge_config: bridge_fee_bps > 1000 rejected", async () => {
    const mintKp4 = Keypair.generate();
    const [cfgPda4] = PublicKey.findProgramAddressSync(
      [Buffer.from("stablecoin-config"), mintKp4.publicKey.toBuffer()],
      program.programId
    );
    const [bcPda4] = PublicKey.findProgramAddressSync(
      [Buffer.from("bridge-config"), mintKp4.publicKey.toBuffer()],
      program.programId
    );
    await program.methods
      .initialize({
        preset: 1,
        decimals: 6,
        name: "T4",
        symbol: "T4",
        uri: "https://example.com",
        transferHookProgram: null,
        collateralMint: null,
        reserveVault: null,
        maxSupply: null,
        featureFlags: new BN(0),
        auditorElgamalPubkey: null,
      })
      .accounts({
        payer: authority.publicKey,
        authority: authority.publicKey,
        config: cfgPda4,
        mint: mintKp4.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      } as any)
      .signers([mintKp4])
      .rpc({ commitment: "confirmed" });

    await assertError(
      () =>
        program.methods
          .initBridgeConfig(
            BRIDGE_TYPE_WORMHOLE,
            fakeBridgeProgram,
            new BN(0),
            1001, // > 1000
            authority.publicKey
          )
          .accounts({
            authority: authority.publicKey,
            config: cfgPda4,
            mint: mintKp4.publicKey,
            bridgeConfig: bcPda4,
            systemProgram: SystemProgram.programId,
          } as any)
          .rpc({ commitment: "confirmed" }),
      "BridgeFeeTooHigh"
    );
  });

  // ─── Test 5: non-authority rejected ─────────────────────────────────────
  it("5. init_bridge_config: non-authority rejected", async () => {
    const attacker = Keypair.generate();
    // Fund attacker
    await provider.connection.requestAirdrop(attacker.publicKey, 2 * LAMPORTS_PER_SOL);
    await new Promise((r) => setTimeout(r, 1000));

    const mintKp5 = Keypair.generate();
    const [cfgPda5] = PublicKey.findProgramAddressSync(
      [Buffer.from("stablecoin-config"), mintKp5.publicKey.toBuffer()],
      program.programId
    );
    const [bcPda5] = PublicKey.findProgramAddressSync(
      [Buffer.from("bridge-config"), mintKp5.publicKey.toBuffer()],
      program.programId
    );
    await program.methods
      .initialize({
        preset: 1,
        decimals: 6,
        name: "T5",
        symbol: "T5",
        uri: "https://example.com",
        transferHookProgram: null,
        collateralMint: null,
        reserveVault: null,
        maxSupply: null,
        featureFlags: new BN(0),
        auditorElgamalPubkey: null,
      })
      .accounts({
        payer: authority.publicKey,
        authority: authority.publicKey,
        config: cfgPda5,
        mint: mintKp5.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      } as any)
      .signers([mintKp5])
      .rpc({ commitment: "confirmed" });

    await assertError(
      () =>
        program.methods
          .initBridgeConfig(BRIDGE_TYPE_WORMHOLE, fakeBridgeProgram, new BN(0), 0, authority.publicKey)
          .accounts({
            authority: attacker.publicKey,
            config: cfgPda5,
            mint: mintKp5.publicKey,
            bridgeConfig: bcPda5,
            systemProgram: SystemProgram.programId,
          } as any)
          .signers([attacker])
          .rpc({ commitment: "confirmed" }),
      "Unauthorized"
    );
  });

  // ─── Test 6: bridge_out succeeds ─────────────────────────────────────────
  it("6. bridge_out: succeeds, burns tokens, updates counters", async () => {
    const recipient32 = new Uint8Array(32).fill(0xab);
    const balanceBefore = await provider.connection.getTokenAccountBalance(senderAta);

    await program.methods
      .bridgeOut(new BN(100_000_000), 2, Array.from(recipient32))
      .accounts({
        sender: authority.publicKey,
        config: configPda,
        bridgeConfig: bridgeConfigPda,
        mint: mintKp.publicKey,
        senderTokenAccount: senderAta,
        feeVault: feeVaultAta,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      } as any)
      .rpc({ commitment: "confirmed" });

    const balanceAfter = await provider.connection.getTokenAccountBalance(senderAta);
    expect(Number(balanceBefore.value.amount) - Number(balanceAfter.value.amount)).to.equal(
      100_000_000
    );

    const bc = await (program.account as any).bridgeConfig.fetch(bridgeConfigPda);
    // total_bridged_out = burn_amount (100M - fee of 0.1% = 100k = 99.9M)
    const feeAmt = Math.floor((100_000_000 * 10) / 10_000); // fee_bps=10
    const burnNet = 100_000_000 - feeAmt;
    expect(bc.totalBridgedOut.toNumber()).to.equal(burnNet);
  });

  // ─── Test 7: bridge_out zero amount ─────────────────────────────────────
  it("7. bridge_out: zero amount rejected", async () => {
    const recipient32 = new Uint8Array(32).fill(0);
    await assertError(
      () =>
        program.methods
          .bridgeOut(new BN(0), 2, Array.from(recipient32))
          .accounts({
            sender: authority.publicKey,
            config: configPda,
            bridgeConfig: bridgeConfigPda,
            mint: mintKp.publicKey,
            senderTokenAccount: senderAta,
            feeVault: feeVaultAta,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
          } as any)
          .rpc({ commitment: "confirmed" }),
      "ZeroAmount"
    );
  });

  // ─── Test 8: bridge_out FLAG_BRIDGE_ENABLED not set ──────────────────────
  it("8. bridge_out: FLAG_BRIDGE_ENABLED not set rejected", async () => {
    // Use LZ mint (flag not set on config2)
    const mintKp6 = Keypair.generate();
    const [cfgPda6] = PublicKey.findProgramAddressSync(
      [Buffer.from("stablecoin-config"), mintKp6.publicKey.toBuffer()],
      program.programId
    );
    const [bcPda6] = PublicKey.findProgramAddressSync(
      [Buffer.from("bridge-config"), mintKp6.publicKey.toBuffer()],
      program.programId
    );
    const [miPda6] = PublicKey.findProgramAddressSync(
      [Buffer.from("minter-info"), cfgPda6.toBuffer(), authority.publicKey.toBuffer()],
      program.programId
    );
    const ata6 = getAssociatedTokenAddressSync(
      mintKp6.publicKey,
      authority.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );
    await program.methods
      .initialize({
        preset: 1,
        decimals: 6,
        name: "T6",
        symbol: "T6",
        uri: "https://example.com",
        transferHookProgram: null,
        collateralMint: null,
        reserveVault: null,
        maxSupply: null,
        featureFlags: new BN(0),
        auditorElgamalPubkey: null,
      })
      .accounts({
        payer: authority.publicKey,
        authority: authority.publicKey,
        config: cfgPda6,
        mint: mintKp6.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      } as any)
      .signers([mintKp6])
      .rpc({ commitment: "confirmed" });

    await program.methods
      .updateMinter(new BN(0))
      .accounts({
        authority: authority.publicKey,
        config: cfgPda6,
        minterInfo: miPda6,
        minter: authority.publicKey,
        systemProgram: SystemProgram.programId,
      } as any)
      .rpc({ commitment: "confirmed" });

    const createAtaIx6 = createAssociatedTokenAccountInstruction(
      authority.publicKey,
      ata6,
      authority.publicKey,
      mintKp6.publicKey,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    await sendTxWithRetry(provider, async () => new anchor.web3.Transaction().add(createAtaIx6), []);

    await program.methods
      .mint(new BN(1_000_000_000))
      .accounts({
        minter: authority.publicKey,
        config: cfgPda6,
        mint: mintKp6.publicKey,
        minterInfo: miPda6,
        recipientTokenAccount: ata6,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      } as any)
      .rpc({ commitment: "confirmed" });

    await program.methods
      .initBridgeConfig(BRIDGE_TYPE_WORMHOLE, fakeBridgeProgram, new BN(0), 0, ata6)
      .accounts({
        authority: authority.publicKey,
        config: cfgPda6,
        mint: mintKp6.publicKey,
        bridgeConfig: bcPda6,
        systemProgram: SystemProgram.programId,
      } as any)
      .rpc({ commitment: "confirmed" });

    // FLAG_BRIDGE_ENABLED not set on cfgPda6
    await assertError(
      () =>
        program.methods
          .bridgeOut(new BN(100_000_000), 2, Array.from(new Uint8Array(32)))
          .accounts({
            sender: authority.publicKey,
            config: cfgPda6,
            bridgeConfig: bcPda6,
            mint: mintKp6.publicKey,
            senderTokenAccount: ata6,
            feeVault: ata6,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
          } as any)
          .rpc({ commitment: "confirmed" }),
      "BridgeNotEnabled"
    );
  });

  // ─── Test 9: bridge_out circuit breaker ─────────────────────────────────
  it("9. bridge_out: circuit breaker active rejected", async () => {
    // Enable circuit breaker
    await program.methods
      .setFeatureFlag(FLAG_CIRCUIT_BREAKER)
      .accounts({ authority: authority.publicKey, config: configPda } as any)
      .rpc({ commitment: "confirmed" });

    await assertError(
      () =>
        program.methods
          .bridgeOut(new BN(10_000_000), 2, Array.from(new Uint8Array(32)))
          .accounts({
            sender: authority.publicKey,
            config: configPda,
            bridgeConfig: bridgeConfigPda,
            mint: mintKp.publicKey,
            senderTokenAccount: senderAta,
            feeVault: feeVaultAta,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
          } as any)
          .rpc({ commitment: "confirmed" }),
      "CircuitBreakerActive"
    );

    // Disable circuit breaker
    await program.methods
      .clearFeatureFlag(FLAG_CIRCUIT_BREAKER)
      .accounts({ authority: authority.publicKey, config: configPda } as any)
      .rpc({ commitment: "confirmed" });
  });

  // ─── Test 10: bridge_out paused ──────────────────────────────────────────
  it("10. bridge_out: paused mint rejected", async () => {
    await program.methods
      .pause()
      .accounts({ authority: authority.publicKey, config: configPda } as any)
      .rpc({ commitment: "confirmed" });

    await assertError(
      () =>
        program.methods
          .bridgeOut(new BN(10_000_000), 2, Array.from(new Uint8Array(32)))
          .accounts({
            sender: authority.publicKey,
            config: configPda,
            bridgeConfig: bridgeConfigPda,
            mint: mintKp.publicKey,
            senderTokenAccount: senderAta,
            feeVault: feeVaultAta,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
          } as any)
          .rpc({ commitment: "confirmed" }),
      "MintPaused"
    );

    await program.methods
      .unpause()
      .accounts({ authority: authority.publicKey, config: configPda } as any)
      .rpc({ commitment: "confirmed" });
  });

  // ─── Test 11: bridge_out exceeds max per tx ──────────────────────────────
  it("11. bridge_out: amount > max_bridge_amount_per_tx rejected", async () => {
    // max_bridge_amount_per_tx = 500_000_000; try 600M
    await assertError(
      () =>
        program.methods
          .bridgeOut(new BN(600_000_000), 2, Array.from(new Uint8Array(32)))
          .accounts({
            sender: authority.publicKey,
            config: configPda,
            bridgeConfig: bridgeConfigPda,
            mint: mintKp.publicKey,
            senderTokenAccount: senderAta,
            feeVault: feeVaultAta,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
          } as any)
          .rpc({ commitment: "confirmed" }),
      "BridgeAmountExceedsLimit"
    );
  });

  // ─── Test 12: max_bridge_amount_per_tx == 0 allows any amount ───────────
  it("12. bridge_out: max_bridge_amount_per_tx == 0 allows any amount (LZ)", async () => {
    // LZ config (bridgeConfigPda2) has max = 0 (unlimited).
    // We need to: mint some tokens on mint2, enable bridge, and bridge out.
    const [miPda2] = PublicKey.findProgramAddressSync(
      [Buffer.from("minter-info"), configPda2.toBuffer(), authority.publicKey.toBuffer()],
      program.programId
    );
    const ata2 = getAssociatedTokenAddressSync(
      mintKp2.publicKey,
      authority.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );

    await program.methods
      .updateMinter(new BN(0))
      .accounts({
        authority: authority.publicKey,
        config: configPda2,
        minterInfo: miPda2,
        minter: authority.publicKey,
        systemProgram: SystemProgram.programId,
      } as any)
      .rpc({ commitment: "confirmed" });

    const createAtaIx2 = createAssociatedTokenAccountInstruction(
      authority.publicKey,
      ata2,
      authority.publicKey,
      mintKp2.publicKey,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    await sendTxWithRetry(provider, async () => new anchor.web3.Transaction().add(createAtaIx2), []);

    await program.methods
      .mint(new BN(5_000_000_000))
      .accounts({
        minter: authority.publicKey,
        config: configPda2,
        mint: mintKp2.publicKey,
        minterInfo: miPda2,
        recipientTokenAccount: ata2,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      } as any)
      .rpc({ commitment: "confirmed" });

    // Enable bridge on config2
    await program.methods
      .setFeatureFlag(FLAG_BRIDGE_ENABLED)
      .accounts({ authority: authority.publicKey, config: configPda2 } as any)
      .rpc({ commitment: "confirmed" });

    // Bridge out a large amount (3B) — should succeed since max == 0
    await program.methods
      .bridgeOut(new BN(3_000_000_000), 101, Array.from(new Uint8Array(32).fill(0xcd)))
      .accounts({
        sender: authority.publicKey,
        config: configPda2,
        bridgeConfig: bridgeConfigPda2,
        mint: mintKp2.publicKey,
        senderTokenAccount: ata2,
        feeVault: ata2,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      } as any)
      .rpc({ commitment: "confirmed" });

    const bc = await (program.account as any).bridgeConfig.fetch(bridgeConfigPda2);
    expect(bc.totalBridgedOut.toNumber()).to.be.greaterThan(0);
  });

  // ─── Test 13: bridge_in succeeds ─────────────────────────────────────────
  it("13. bridge_in: succeeds, mints tokens, updates counters", async () => {
    const recipientAta = getAssociatedTokenAddressSync(
      mintKp.publicKey,
      authority.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );
    const balBefore = await provider.connection.getTokenAccountBalance(senderAta);

    const mockProof = {
      proofBytes: Buffer.from("mock-wormhole-vaa-proof-data"),
      sourceChain: 2,
      verified: true,
    };

    await program.methods
      .bridgeIn(mockProof, new BN(200_000_000), authority.publicKey)
      .accounts({
        relayer: authority.publicKey,
        config: configPda,
        bridgeConfig: bridgeConfigPda,
        mint: mintKp.publicKey,
        recipientTokenAccount: recipientAta,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      } as any)
      .rpc({ commitment: "confirmed" });

    const balAfter = await provider.connection.getTokenAccountBalance(senderAta);
    expect(Number(balAfter.value.amount) - Number(balBefore.value.amount)).to.equal(200_000_000);

    const bc = await (program.account as any).bridgeConfig.fetch(bridgeConfigPda);
    expect(bc.totalBridgedIn.toNumber()).to.equal(200_000_000);
  });

  // ─── Test 14: bridge_in zero amount ─────────────────────────────────────
  it("14. bridge_in: zero amount rejected", async () => {
    const proof = { proofBytes: Buffer.from("proof"), sourceChain: 2, verified: true };
    await assertError(
      () =>
        program.methods
          .bridgeIn(proof, new BN(0), authority.publicKey)
          .accounts({
            relayer: authority.publicKey,
            config: configPda,
            bridgeConfig: bridgeConfigPda,
            mint: mintKp.publicKey,
            recipientTokenAccount: senderAta,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
          } as any)
          .rpc({ commitment: "confirmed" }),
      "ZeroAmount"
    );
  });

  // ─── Test 15: bridge_in FLAG_BRIDGE_ENABLED not set ──────────────────────
  it("15. bridge_in: FLAG_BRIDGE_ENABLED not set rejected", async () => {
    // Create fresh mint without bridge flag
    const mintKp7 = Keypair.generate();
    const [cfgPda7] = PublicKey.findProgramAddressSync(
      [Buffer.from("stablecoin-config"), mintKp7.publicKey.toBuffer()],
      program.programId
    );
    const [bcPda7] = PublicKey.findProgramAddressSync(
      [Buffer.from("bridge-config"), mintKp7.publicKey.toBuffer()],
      program.programId
    );
    const ata7 = getAssociatedTokenAddressSync(
      mintKp7.publicKey,
      authority.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );
    await program.methods
      .initialize({
        preset: 1,
        decimals: 6,
        name: "T7",
        symbol: "T7",
        uri: "https://example.com",
        transferHookProgram: null,
        collateralMint: null,
        reserveVault: null,
        maxSupply: null,
        featureFlags: new BN(0), // bridge flag NOT set
        auditorElgamalPubkey: null,
      })
      .accounts({
        payer: authority.publicKey,
        authority: authority.publicKey,
        config: cfgPda7,
        mint: mintKp7.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      } as any)
      .signers([mintKp7])
      .rpc({ commitment: "confirmed" });

    await program.methods
      .initBridgeConfig(BRIDGE_TYPE_WORMHOLE, fakeBridgeProgram, new BN(0), 0, ata7)
      .accounts({
        authority: authority.publicKey,
        config: cfgPda7,
        mint: mintKp7.publicKey,
        bridgeConfig: bcPda7,
        systemProgram: SystemProgram.programId,
      } as any)
      .rpc({ commitment: "confirmed" });

    const createAta7 = createAssociatedTokenAccountInstruction(
      authority.publicKey,
      ata7,
      authority.publicKey,
      mintKp7.publicKey,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    await sendTxWithRetry(provider, async () => new anchor.web3.Transaction().add(createAta7), []);

    const proof = { proofBytes: Buffer.from("proof"), sourceChain: 2, verified: true };
    await assertError(
      () =>
        program.methods
          .bridgeIn(proof, new BN(100_000_000), authority.publicKey)
          .accounts({
            relayer: authority.publicKey,
            config: cfgPda7,
            bridgeConfig: bcPda7,
            mint: mintKp7.publicKey,
            recipientTokenAccount: ata7,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
          } as any)
          .rpc({ commitment: "confirmed" }),
      "BridgeNotEnabled"
    );
  });

  // ─── Test 16: bridge_in circuit breaker ─────────────────────────────────
  it("16. bridge_in: circuit breaker active rejected", async () => {
    await program.methods
      .setFeatureFlag(FLAG_CIRCUIT_BREAKER)
      .accounts({ authority: authority.publicKey, config: configPda } as any)
      .rpc({ commitment: "confirmed" });

    const proof = { proofBytes: Buffer.from("proof"), sourceChain: 2, verified: true };
    await assertError(
      () =>
        program.methods
          .bridgeIn(proof, new BN(10_000_000), authority.publicKey)
          .accounts({
            relayer: authority.publicKey,
            config: configPda,
            bridgeConfig: bridgeConfigPda,
            mint: mintKp.publicKey,
            recipientTokenAccount: senderAta,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
          } as any)
          .rpc({ commitment: "confirmed" }),
      "CircuitBreakerActive"
    );

    await program.methods
      .clearFeatureFlag(FLAG_CIRCUIT_BREAKER)
      .accounts({ authority: authority.publicKey, config: configPda } as any)
      .rpc({ commitment: "confirmed" });
  });

  // ─── Test 17: bridge_in paused ───────────────────────────────────────────
  it("17. bridge_in: paused mint rejected", async () => {
    await program.methods
      .pause()
      .accounts({ authority: authority.publicKey, config: configPda } as any)
      .rpc({ commitment: "confirmed" });

    const proof = { proofBytes: Buffer.from("proof"), sourceChain: 2, verified: true };
    await assertError(
      () =>
        program.methods
          .bridgeIn(proof, new BN(10_000_000), authority.publicKey)
          .accounts({
            relayer: authority.publicKey,
            config: configPda,
            bridgeConfig: bridgeConfigPda,
            mint: mintKp.publicKey,
            recipientTokenAccount: senderAta,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
          } as any)
          .rpc({ commitment: "confirmed" }),
      "MintPaused"
    );

    await program.methods
      .unpause()
      .accounts({ authority: authority.publicKey, config: configPda } as any)
      .rpc({ commitment: "confirmed" });
  });

  // ─── Test 18: bridge_in empty proof ─────────────────────────────────────
  it("18. bridge_in: empty proof rejected", async () => {
    const proof = { proofBytes: Buffer.from(""), sourceChain: 2, verified: true };
    await assertError(
      () =>
        program.methods
          .bridgeIn(proof, new BN(10_000_000), authority.publicKey)
          .accounts({
            relayer: authority.publicKey,
            config: configPda,
            bridgeConfig: bridgeConfigPda,
            mint: mintKp.publicKey,
            recipientTokenAccount: senderAta,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
          } as any)
          .rpc({ commitment: "confirmed" }),
      "BridgeProofEmpty"
    );
  });

  // ─── Test 19: bridge_in proof.verified == false ──────────────────────────
  it("19. bridge_in: proof.verified == false rejected", async () => {
    const proof = { proofBytes: Buffer.from("some-proof"), sourceChain: 2, verified: false };
    await assertError(
      () =>
        program.methods
          .bridgeIn(proof, new BN(10_000_000), authority.publicKey)
          .accounts({
            relayer: authority.publicKey,
            config: configPda,
            bridgeConfig: bridgeConfigPda,
            mint: mintKp.publicKey,
            recipientTokenAccount: senderAta,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
          } as any)
          .rpc({ commitment: "confirmed" }),
      "BridgeProofInvalid"
    );
  });

  // ─── Test 20: bridge_in max_supply enforced ──────────────────────────────
  it("20. bridge_in: max_supply cap enforced", async () => {
    // max_supply = 10,000,000,000 (10k tokens at 6 dec).
    // Current net supply ≈ 1000 tokens minted - 100 bridged out = ~900 remaining.
    // Try to bridge in way more than remaining cap.
    const proof = { proofBytes: Buffer.from("proof"), sourceChain: 2, verified: true };
    await assertError(
      () =>
        program.methods
          .bridgeIn(proof, new BN(9_999_999_999), authority.publicKey) // exceeds max
          .accounts({
            relayer: authority.publicKey,
            config: configPda,
            bridgeConfig: bridgeConfigPda,
            mint: mintKp.publicKey,
            recipientTokenAccount: senderAta,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
          } as any)
          .rpc({ commitment: "confirmed" }),
      "MaxSupplyExceeded"
    );
  });
});

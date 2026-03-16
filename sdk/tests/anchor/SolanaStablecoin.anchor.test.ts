/**
 * SSS-017 — SDK Anchor Integration Tests
 *
 * Exercises the SolanaStablecoin SDK class end-to-end against a real localnet
 * Anchor program. Starts solana-test-validator automatically with the pre-built
 * sss_token.so and sss_transfer_hook.so loaded.
 *
 * Run:   npm run test:anchor
 *
 * Note on burnFrom(): the on-chain constraint requires source_token_account.owner
 * == minter.key(), so we mint to the payer's own ATA and burn from it.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Keypair, PublicKey } from "@solana/web3.js";
import { AnchorProvider } from "@coral-xyz/anchor";
import {
  TOKEN_2022_PROGRAM_ID,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import { SolanaStablecoin } from "../../src/SolanaStablecoin";
import { startValidator, stopValidator } from "./setup";

// Shared state across sequential tests
let provider: AnchorProvider;
let payer: Keypair;
let stablecoin: SolanaStablecoin;
// payerAta: the payer's own token account — satisfies burnFrom's owner constraint
let payerAta: PublicKey;

describe("SSS-017: SolanaStablecoin SDK ↔ Anchor localnet", () => {
  beforeAll(async () => {
    ({ provider, payer } = await startValidator());
  }, 90_000);

  afterAll(async () => {
    await stopValidator();
  });

  it("create() initializes a new SSS-1 stablecoin on-chain", async () => {
    stablecoin = await SolanaStablecoin.create(provider, {
      preset: "SSS-1",
      name: "Test USD",
      symbol: "TUSD",
      decimals: 6,
    });

    expect(stablecoin.mint).toBeDefined();
    expect(stablecoin.mint.toBase58().length).toBeGreaterThanOrEqual(43);
    expect(stablecoin.configPda).toBeDefined();
  }, 30_000);

  it("getTotalSupply() returns zeros immediately after creation", async () => {
    const supply = await stablecoin.getTotalSupply();
    expect(supply.totalMinted).toBe(0n);
    expect(supply.totalBurned).toBe(0n);
    expect(supply.circulatingSupply).toBe(0n);
  }, 30_000);

  it("updateMinter() registers the authority as an unlimited minter", async () => {
    const sig = await stablecoin.updateMinter({
      minter: provider.wallet.publicKey,
      cap: 0n, // unlimited
    });
    expect(sig).toBeDefined();
    expect(sig.length).toBeGreaterThan(40);
  }, 30_000);

  it("mintTo() mints 1_000_000 tokens to the payer's own ATA", async () => {
    // Create the payer's ATA — owner is payer.publicKey so burnFrom will succeed
    const ataInfo = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      payer,
      stablecoin.mint,
      payer.publicKey,
      false,
      "confirmed",
      { commitment: "confirmed" },
      TOKEN_2022_PROGRAM_ID
    );
    payerAta = ataInfo.address;

    const sig = await stablecoin.mintTo({
      mint: stablecoin.mint,
      amount: 1_000_000n,
      recipient: payer.publicKey,
    });

    expect(sig).toBeDefined();
    expect(sig.length).toBeGreaterThan(40);
  }, 30_000);

  it("getTotalSupply() reflects 1_000_000 minted, 0 burned", async () => {
    const supply = await stablecoin.getTotalSupply();
    expect(supply.totalMinted).toBe(1_000_000n);
    expect(supply.totalBurned).toBe(0n);
    expect(supply.circulatingSupply).toBe(1_000_000n);
  }, 30_000);

  it("burnFrom() burns 200_000 tokens from the payer's own ATA", async () => {
    // SSS-091: Mint uses DefaultAccountState=Frozen — thaw payerAta before burn.
    // The config PDA holds the freeze authority; compliance authority is the payer.
    await stablecoin.thaw({ mint: stablecoin.mint, targetTokenAccount: payerAta });

    // On-chain constraint: source_token_account.owner == minter.key()
    // The payer is both the minter and the ATA owner — constraint satisfied.
    const sig = await stablecoin.burnFrom({
      mint: stablecoin.mint,
      amount: 200_000n,
      source: payerAta,
    });

    expect(sig).toBeDefined();
    expect(sig.length).toBeGreaterThan(40);
  }, 30_000);

  it("getTotalSupply() reflects 1_000_000 minted, 200_000 burned", async () => {
    const supply = await stablecoin.getTotalSupply();
    expect(supply.totalMinted).toBe(1_000_000n);
    expect(supply.totalBurned).toBe(200_000n);
    expect(supply.circulatingSupply).toBe(800_000n);
  }, 30_000);

  it("pause() succeeds without throwing", async () => {
    const sig = await stablecoin.pause();
    expect(sig).toBeDefined();
    expect(sig.length).toBeGreaterThan(40);
  }, 30_000);

  it("unpause() succeeds without throwing", async () => {
    const sig = await stablecoin.unpause();
    expect(sig).toBeDefined();
    expect(sig.length).toBeGreaterThan(40);
  }, 30_000);
});

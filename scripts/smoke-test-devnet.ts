#!/usr/bin/env ts-node
/**
 * smoke-test-devnet.ts — SSS-013 devnet smoke test
 *
 * Exercises the full SSS-1 lifecycle on devnet:
 *   1. Create a throwaway funded wallet
 *   2. Initialize an SSS-1 stablecoin
 *   3. Mint 1,000 tokens to a recipient wallet
 *   4. Assert circulating supply matches
 *
 * Usage:
 *   npx ts-node scripts/smoke-test-devnet.ts
 *
 * Reads program IDs from deploy/devnet-latest.json (or falls back to Anchor.toml defaults).
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
} from '@solana/web3.js';
import { AnchorProvider, Wallet } from '@coral-xyz/anchor';
import { SolanaStablecoin, SSS_TOKEN_PROGRAM_ID, sss1Config } from '../sdk/src';

const DEVNET_RPC = 'https://api.devnet.solana.com';
const DEPLOY_MANIFEST = path.join(__dirname, '..', 'deploy', 'devnet-latest.json');
const MINT_AMOUNT = 1_000n;
const DECIMALS = 6;

function explorerLink(sig: string): string {
  return `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  console.log('');
  console.log('┌──────────────────────────────────────────────────────────────┐');
  console.log('│      SSS-013 Devnet Smoke Test — Solana Stablecoin Standard   │');
  console.log('└──────────────────────────────────────────────────────────────┘');
  console.log('');

  // ── Program IDs ──────────────────────────────────────────────────────────

  let programId: PublicKey = SSS_TOKEN_PROGRAM_ID;
  if (fs.existsSync(DEPLOY_MANIFEST)) {
    const manifest = JSON.parse(fs.readFileSync(DEPLOY_MANIFEST, 'utf8'));
    if (manifest.programs?.sssToken) {
      programId = new PublicKey(manifest.programs.sssToken);
      console.log(`📋  Using deployed program ID from manifest: ${programId.toBase58()}`);
    }
  } else {
    console.log(`📋  No manifest found — using default program ID: ${programId.toBase58()}`);
  }

  // ── Connection & funded payer ────────────────────────────────────────────

  const connection = new Connection(DEVNET_RPC, 'confirmed');
  const payer = Keypair.generate();
  const recipient = Keypair.generate();

  console.log(`🔑  Payer:     ${payer.publicKey.toBase58()}`);
  console.log(`🔑  Recipient: ${recipient.publicKey.toBase58()}`);

  console.log('');
  console.log('💸  Requesting airdrop for payer (1 SOL)...');
  const sig1 = await connection.requestAirdrop(payer.publicKey, LAMPORTS_PER_SOL);
  await connection.confirmTransaction(sig1, 'confirmed');
  console.log(`    ✅  ${explorerLink(sig1)}`);

  await sleep(2000); // let devnet settle

  // ── Create AnchorProvider ────────────────────────────────────────────────

  const wallet = new Wallet(payer);
  const provider = new AnchorProvider(connection, wallet, {
    commitment: 'confirmed',
    preflightCommitment: 'confirmed',
  });

  // ── Create SSS-1 stablecoin ──────────────────────────────────────────────

  console.log('');
  console.log('🪙  Initializing SSS-1 stablecoin...');
  const stablecoin = await SolanaStablecoin.create(
    provider,
    sss1Config({ name: 'Smoke USD', symbol: 'SUSD', decimals: DECIMALS }),
    { programId }
  );
  console.log(`    ✅  Mint: ${stablecoin.mint.toBase58()}`);
  console.log(`    ✅  Config PDA: ${stablecoin.configPda.toBase58()}`);

  await sleep(2000);

  // ── Mint 1,000 tokens ───────────────────────────────────────────────────

  const rawAmount = MINT_AMOUNT * 10n ** BigInt(DECIMALS);
  console.log('');
  console.log(`🔨  Minting ${MINT_AMOUNT} SUSD to recipient...`);
  const mintSig = await stablecoin.mintTo({
    mint: stablecoin.mint,
    amount: rawAmount,
    recipient: recipient.publicKey,
  });
  console.log(`    ✅  ${explorerLink(mintSig)}`);

  await sleep(3000);

  // ── Assert supply ────────────────────────────────────────────────────────

  console.log('');
  console.log('📊  Checking circulating supply...');
  const supply = await stablecoin.getTotalSupply();
  console.log(`    circulatingSupply: ${supply.circulatingSupply}`);
  console.log(`    expected:          ${rawAmount}`);

  if (supply.circulatingSupply !== rawAmount) {
    console.error(`\n❌  Supply mismatch! Got ${supply.circulatingSupply}, expected ${rawAmount}`);
    process.exit(1);
  }

  // ── Summary ──────────────────────────────────────────────────────────────

  console.log('');
  console.log('┌──────────────────────────────────────────────────────────────┐');
  console.log('│                   ✅  Smoke Test PASSED                       │');
  console.log('└──────────────────────────────────────────────────────────────┘');
  console.log('');
  console.log(`  Mint:       ${stablecoin.mint.toBase58()}`);
  console.log(`  Supply:     ${MINT_AMOUNT} SUSD (${rawAmount} raw)`);
  console.log(`  Explorer:   https://explorer.solana.com/address/${stablecoin.mint.toBase58()}?cluster=devnet`);
  console.log('');
}

main().catch((err) => {
  console.error('\n❌  Smoke test FAILED:', err);
  process.exit(1);
});

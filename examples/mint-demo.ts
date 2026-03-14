#!/usr/bin/env ts-node
/**
 * examples/mint-demo.ts — SSS-030 Example App
 *
 * Demonstrates a complete SSS-1 stablecoin lifecycle using the @stbr/sss-token SDK:
 *   1. Connect to a local validator (or devnet via --devnet flag)
 *   2. Initialize an SSS-1 stablecoin (Token-2022 mint)
 *   3. Register a minter with a 1,000,000 token cap
 *   4. Mint 500,000 tokens to a recipient wallet
 *   5. Query and print total supply
 *   6. Burn 100,000 tokens
 *   7. Query final supply
 *
 * Usage (localnet):
 *   npx ts-node examples/mint-demo.ts
 *
 * Usage (devnet — requires funded keypair at ~/.config/solana/id.json):
 *   npx ts-node examples/mint-demo.ts --devnet
 *
 * The script is intentionally verbose so it can serve as a learning reference.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
} from '@solana/web3.js';
import { AnchorProvider, Wallet } from '@coral-xyz/anchor';

// ── SDK imports ────────────────────────────────────────────────────────────────
// In a real project: import from '@stbr/sss-token'
import { SolanaStablecoin, sss1Config } from '../sdk/src';

// ── Config ─────────────────────────────────────────────────────────────────────

const USE_DEVNET = process.argv.includes('--devnet');
const RPC_URL = USE_DEVNET
  ? 'https://api.devnet.solana.com'
  : 'http://127.0.0.1:8899';

const MINT_CAP = 1_000_000n;          // minter cap: 1,000,000 tokens (6 decimals)
const MINT_AMOUNT = 500_000n;         // initial mint: 500,000 tokens
const BURN_AMOUNT = 100_000n;         // burn: 100,000 tokens
const DECIMALS = 6;

// ── Helpers ────────────────────────────────────────────────────────────────────

function loadOrCreateKeypair(filePath: string): Keypair {
  if (fs.existsSync(filePath)) {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as number[];
    return Keypair.fromSecretKey(Uint8Array.from(raw));
  }
  const kp = Keypair.generate();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(Array.from(kp.secretKey)));
  return kp;
}

function formatAmount(amount: bigint, decimals: number): string {
  const str = amount.toString().padStart(decimals + 1, '0');
  const intPart = str.slice(0, str.length - decimals) || '0';
  const fracPart = str.slice(-decimals);
  return `${intPart}.${fracPart}`;
}

function log(label: string, value: string): void {
  console.log(`  ${label.padEnd(28)} ${value}`);
}

function section(title: string): void {
  console.log('');
  console.log(`── ${title} ${'─'.repeat(Math.max(0, 56 - title.length))}`);
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('');
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║   SSS-030 — Solana Stablecoin Standard: Mint Demo          ║');
  console.log(`║   Network: ${(USE_DEVNET ? 'devnet' : 'localnet').padEnd(48)}║`);
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');

  // ── 1. Connect ─────────────────────────────────────────────────────────────

  section('1. Connect');

  const connection = new Connection(RPC_URL, 'confirmed');
  const slot = await connection.getSlot();
  log('RPC:', RPC_URL);
  log('Slot:', slot.toString());

  // Authority keypair (payer)
  const authorityKp = USE_DEVNET
    ? loadOrCreateKeypair(path.join(os.homedir(), '.config/solana/id.json'))
    : Keypair.generate();

  // Recipient keypair
  const recipientKp = Keypair.generate();

  // Fund accounts on localnet
  if (!USE_DEVNET) {
    const airdropAuth = await connection.requestAirdrop(authorityKp.publicKey, 10 * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(airdropAuth, 'confirmed');
    const airdropRecip = await connection.requestAirdrop(recipientKp.publicKey, 1 * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(airdropRecip, 'confirmed');
    log('Airdrop:', '10 SOL → authority, 1 SOL → recipient');
  }

  const authBalance = await connection.getBalance(authorityKp.publicKey);
  log('Authority:', authorityKp.publicKey.toBase58());
  log('Authority balance:', `${(authBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  log('Recipient:', recipientKp.publicKey.toBase58());

  // ── 2. Build provider & SDK ────────────────────────────────────────────────

  section('2. Build SDK');

  const provider = new AnchorProvider(
    connection,
    new Wallet(authorityKp),
    { commitment: 'confirmed', preflightCommitment: 'confirmed' },
  );

  log('SDK:', '@stbr/sss-token');
  log('Preset:', 'SSS-1 (Minimal)');

  // ── 3. Initialize SSS-1 stablecoin ─────────────────────────────────────────

  section('3. Initialize SSS-1 stablecoin');

  console.log('  Creating "Demo USD" (DUSD) — Token-2022 mint with freeze + metadata…');

  const stablecoin = await SolanaStablecoin.create(
    provider,
    sss1Config({
      name: 'Demo USD',
      symbol: 'DUSD',
      uri: 'https://example.com/dusd-metadata.json',
      decimals: DECIMALS,
    }),
  );

  const mintAddress = stablecoin.mint.toBase58();
  log('Mint address:', mintAddress);
  log('Config PDA:', stablecoin.configPda.toBase58());

  let supply = await stablecoin.getTotalSupply();
  log('Initial supply:', formatAmount(supply, DECIMALS) + ' DUSD');

  // ── 4. Register minter ─────────────────────────────────────────────────────

  section('4. Register minter (authority)');

  await stablecoin.updateMinter(authorityKp.publicKey, MINT_CAP);
  log('Minter:', authorityKp.publicKey.toBase58());
  log('Cap:', formatAmount(MINT_CAP, DECIMALS) + ' DUSD');

  // ── 5. Mint tokens ─────────────────────────────────────────────────────────

  section('5. Mint tokens');

  const mintSig = await stablecoin.mintTo({
    recipient: recipientKp.publicKey,
    amount: MINT_AMOUNT,
  });

  supply = await stablecoin.getTotalSupply();
  log('Mint amount:', formatAmount(MINT_AMOUNT, DECIMALS) + ' DUSD');
  log('Recipient:', recipientKp.publicKey.toBase58());
  log('Supply after mint:', formatAmount(supply, DECIMALS) + ' DUSD');
  log('Tx signature:', mintSig.slice(0, 32) + '…');

  // ── 6. Burn tokens ─────────────────────────────────────────────────────────

  section('6. Burn tokens');

  const burnSig = await stablecoin.burn({
    source: recipientKp.publicKey,
    amount: BURN_AMOUNT,
    signers: [recipientKp],
  });

  supply = await stablecoin.getTotalSupply();
  log('Burn amount:', formatAmount(BURN_AMOUNT, DECIMALS) + ' DUSD');
  log('Supply after burn:', formatAmount(supply, DECIMALS) + ' DUSD');
  log('Tx signature:', burnSig.slice(0, 32) + '…');

  // ── 7. Summary ─────────────────────────────────────────────────────────────

  section('7. Summary');

  console.log('');
  console.log('  ✅  SSS-1 lifecycle complete!');
  console.log('');
  console.log(`  Mint:     ${mintAddress}`);
  console.log(`  Minted:   ${formatAmount(MINT_AMOUNT, DECIMALS)} DUSD`);
  console.log(`  Burned:   ${formatAmount(BURN_AMOUNT, DECIMALS)} DUSD`);
  console.log(`  Supply:   ${formatAmount(supply, DECIMALS)} DUSD`);
  console.log('');

  if (USE_DEVNET) {
    console.log(`  Explorer: https://explorer.solana.com/address/${mintAddress}?cluster=devnet`);
    console.log('');
  }
}

main().catch((err) => {
  console.error('\n❌  Error:', err.message ?? err);
  process.exit(1);
});

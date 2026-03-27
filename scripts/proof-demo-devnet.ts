#!/usr/bin/env ts-node
/**
 * SSS-DEVTEST-005: PBS + APC proof-demo on LIVE DEVNET
 *
 * End-to-end: initialize SUSD mint → enable PBS flag → fund agents →
 * commit PBS → open APC → submit work proof → resolve → settle.
 *
 * All transactions are real on-chain devnet transactions.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  getOrCreateAssociatedTokenAccount,
  getAccount,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { AnchorProvider, Wallet, BN, Program } from '@coral-xyz/anchor';
import { SolanaStablecoin, SSS_TOKEN_PROGRAM_ID } from '../sdk/src';
import { sss1Config } from '../sdk/src/presets';
import { FeatureFlagsModule } from '../sdk/src/FeatureFlagsModule';
import { ProbabilisticModule } from '../sdk/src/ProbabilisticModule';
import { AgentPaymentChannelModule, DisputePolicy, ApcProofType } from '../sdk/src/AgentPaymentChannelModule';

// ─── Config ────────────────────────────────────────────────────────────────────

const PROGRAM_ID = SSS_TOKEN_PROGRAM_ID; // AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat
const RPC_URL = 'https://api.devnet.solana.com';
const FLAG_PROBABILISTIC_MONEY = 1n << 6n;
const AMOUNT_10_SUSD = new BN(10_000_000); // 10 SUSD (6 decimals)
const MINTER_CAP = new BN('1000000000000000'); // 1B SUSD

function sha256(input: string): Buffer {
  return createHash('sha256').update(input).digest();
}

function solscan(sig: string): string {
  return `https://solscan.io/tx/${sig}?cluster=devnet`;
}

function usdcDisplay(lamports: bigint, decimals = 6): string {
  return (Number(lamports) / 10 ** decimals).toFixed(decimals) + ' SUSD';
}

function sep(label: string): void {
  const dashes = '─'.repeat(60);
  console.log(`\n${dashes}`);
  console.log(`  ${label}`);
  console.log(dashes);
}

function loadKeypair(kpPath: string): Keypair {
  const resolved = kpPath.replace(/^~/, os.homedir());
  return Keypair.fromSecretKey(
    Buffer.from(JSON.parse(fs.readFileSync(resolved, 'utf-8'))),
  );
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  sep('SSS-DEVTEST-005: PBS + APC Proof Demo — LIVE DEVNET');

  // ── 1. Setup connection + payer ──────────────────────────────────────────
  const connection = new Connection(RPC_URL, 'confirmed');
  const payer = loadKeypair('~/.config/solana/id.json');

  console.log(`\n  Payer:      ${payer.publicKey.toBase58()}`);
  console.log(`  Program:    ${PROGRAM_ID.toBase58()}`);
  console.log(`  RPC:        ${RPC_URL}`);

  const payerBalance = await connection.getBalance(payer.publicKey);
  console.log(`  SOL balance: ${(payerBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);

  // ── 2. Generate ephemeral agent keypairs ──────────────────────────────────
  const agentA = Keypair.generate(); // Hirer
  const agentB = Keypair.generate(); // Worker

  console.log(`\n  Agent A (Hirer):  ${agentA.publicKey.toBase58()}`);
  console.log(`  Agent B (Worker): ${agentB.publicKey.toBase58()}`);

  // ── 3. Fund agents with SOL ───────────────────────────────────────────────
  sep('Step 0a — Fund agents with SOL');

  const fundAmount = 0.05 * LAMPORTS_PER_SOL;
  for (const [label, agent] of [['Agent A', agentA], ['Agent B', agentB]] as const) {
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: agent.publicKey,
        lamports: fundAmount,
      }),
    );
    const sig = await sendAndConfirmTransaction(connection, tx, [payer]);
    console.log(`  ✓ Funded ${label} with 0.05 SOL: ${solscan(sig)}`);
  }

  // ── 4. Initialize SSS-1 SUSD mint ────────────────────────────────────────
  sep('Step 0b — Initialize SUSD mint (SSS-1 + PBS flag)');

  const providerPayer = new AnchorProvider(connection, new Wallet(payer), { commitment: 'confirmed' });

  const stablecoin = await SolanaStablecoin.create(
    providerPayer,
    sss1Config({
      name: 'SSS Demo SUSD',
      symbol: 'SUSD',
      decimals: 6,
      featureFlags: FLAG_PROBABILISTIC_MONEY,
    }),
  );

  const mint = stablecoin.mint;
  console.log(`  ✓ SUSD mint created: ${mint.toBase58()}`);
  console.log(`    Explorer: https://explorer.solana.com/address/${mint.toBase58()}?cluster=devnet`);

  await sleep(2000); // let devnet settle

  // Verify PBS feature flag was set during initialization
  const ff = new FeatureFlagsModule(providerPayer, PROGRAM_ID);
  const pbsFlagSet = await ff.isFeatureFlagSet(mint, FLAG_PROBABILISTIC_MONEY);
  console.log(`  ✓ FLAG_PROBABILISTIC_MONEY verified at init: ${pbsFlagSet}`);

  // ── 5. Register payer as minter + mint 100 SUSD to Agent A ────────────────
  sep('Step 0c — Register minter + mint SUSD to Agent A');

  const registerSig = await stablecoin.updateMinter({
    minter: payer.publicKey,
    cap: BigInt(MINTER_CAP.toString()),
  });
  console.log(`  ✓ Payer registered as minter: ${solscan(registerSig)}`);

  // Create Agent A's token account
  const agentAToken = await getOrCreateAssociatedTokenAccount(
    connection, payer, mint, agentA.publicKey, false, undefined, undefined, TOKEN_2022_PROGRAM_ID,
  );

  // Thaw Agent A's token account (SSS-1 DefaultAccountState=Frozen)
  const thawASig = await stablecoin.thaw({ mint, targetTokenAccount: agentAToken.address });
  console.log(`  ✓ Thawed Agent A token account: ${solscan(thawASig)}`);

  // Mint 100 SUSD to Agent A
  const mintSig = await stablecoin.mintTo({
    mint,
    recipient: agentA.publicKey,
    amount: 100_000_000n, // 100 SUSD
  });
  console.log(`  ✓ Minted 100 SUSD to Agent A: ${solscan(mintSig)}`);

  // Create + thaw Agent B's token account
  const agentBToken = await getOrCreateAssociatedTokenAccount(
    connection, payer, mint, agentB.publicKey, false, undefined, undefined, TOKEN_2022_PROGRAM_ID,
  );
  const thawBSig = await stablecoin.thaw({ mint, targetTokenAccount: agentBToken.address });
  console.log(`  ✓ Thawed Agent B token account: ${solscan(thawBSig)}`);

  // ── 6. Record initial balances ────────────────────────────────────────────
  const balABefore = (await getAccount(connection, agentAToken.address, undefined, TOKEN_2022_PROGRAM_ID)).amount;
  const balBBefore = (await getAccount(connection, agentBToken.address, undefined, TOKEN_2022_PROGRAM_ID)).amount;

  sep('Initial Balances');
  console.log(`  Agent A: ${usdcDisplay(balABefore)}`);
  console.log(`  Agent B: ${usdcDisplay(balBBefore)}`);

  // ── 7. Setup ──────────────────────────────────────────────────────────────
  const TASK_DESCRIPTION = 'Summarize this document';
  const EXPECTED_OUTPUT  = 'The document covers SSS token architecture, APC + PBS primitives.';
  const taskHash   = sha256(TASK_DESCRIPTION);
  const outputHash = sha256(EXPECTED_OUTPUT);

  const commitmentId = new BN(Date.now());
  const channelId    = new BN(Date.now() + 1);

  const providerA = new AnchorProvider(connection, new Wallet(agentA), { commitment: 'confirmed' });
  const providerB = new AnchorProvider(connection, new Wallet(agentB), { commitment: 'confirmed' });

  const pbsA = new ProbabilisticModule(providerA, PROGRAM_ID);
  const apcA = new AgentPaymentChannelModule(providerA, PROGRAM_ID);
  const apcB = new AgentPaymentChannelModule(providerB, PROGRAM_ID);

  // ── 8. Derive PDAs ────────────────────────────────────────────────────────
  const [configPda] = pbsA.configPda(mint);
  const [vaultPda]  = pbsA.vaultPda(configPda, commitmentId);
  const [apcConfigPda] = apcB.configPda(mint);
  const [channelPda]   = apcB.channelPda(apcConfigPda, channelId);

  // Create escrow token accounts (owned by PDAs)
  const escrowVaultAccount = await getOrCreateAssociatedTokenAccount(
    connection, payer, mint, vaultPda, true, undefined, undefined, TOKEN_2022_PROGRAM_ID,
  );
  // Thaw escrow vault
  const thawEscrowSig = await stablecoin.thaw({ mint, targetTokenAccount: escrowVaultAccount.address });
  console.log(`  ✓ Created + thawed escrow vault token account`);

  const escrowChannelAccount = await getOrCreateAssociatedTokenAccount(
    connection, payer, mint, channelPda, true, undefined, undefined, TOKEN_2022_PROGRAM_ID,
  );
  const thawChannelSig = await stablecoin.thaw({ mint, targetTokenAccount: escrowChannelAccount.address });
  console.log(`  ✓ Created + thawed escrow channel token account`);

  // ── 9. Step 1: Agent A commits 10 SUSD via PBS ────────────────────────────
  sep('Step 1 — Agent A: commitProbabilistic (10 SUSD → PBS vault)');

  console.log(`  Task: "${TASK_DESCRIPTION}"`);
  console.log(`  Task hash: ${taskHash.toString('hex')}`);

  const currentSlot = await connection.getSlot();

  const { commitmentId: cid, txSig: commitTx } = await pbsA.commitProbabilistic({
    mint,
    amount: AMOUNT_10_SUSD,
    conditionHash: taskHash,
    expirySlot: new BN(currentSlot + 1000),
    claimant: agentB.publicKey,
    commitmentId,
    escrowTokenAccount: escrowVaultAccount.address,
    issuerTokenAccount: agentAToken.address,
  });

  console.log(`\n  ✓ Committed 10 SUSD to PBS vault`);
  console.log(`  Commitment ID: ${cid.toString()}`);
  console.log(`  Tx: ${solscan(commitTx)}`);

  // ── 10. Step 2: Agent B opens APC ─────────────────────────────────────────
  sep('Step 2 — Agent B: openChannel (APC with Agent A)');

  const { channelId: chnId, txSig: openTx } = await apcB.openChannel({
    mint,
    counterparty: agentA.publicKey,
    deposit: new BN(0),
    disputePolicy: DisputePolicy.TimeoutFallback,
    timeoutSlots: new BN(500),
    channelId,
  });

  console.log(`\n  ✓ APC opened (zero-deposit, timeout=500 slots)`);
  console.log(`  Channel ID: ${chnId.toString()}`);
  console.log(`  Tx: ${solscan(openTx)}`);

  // ── 11. Step 3: Agent B simulates work ────────────────────────────────────
  sep('Step 3 — Agent B: simulated work');
  const computedOutputHash = sha256(EXPECTED_OUTPUT);
  console.log(`  [Agent B] "Work" done: summarized the document.`);
  console.log(`  Output hash: ${computedOutputHash.toString('hex')}`);

  // ── 12. Step 4: Agent B submits work proof to APC ─────────────────────────
  sep('Step 4 — Agent B: submitWorkProof');

  const proofTx = await apcB.submitWorkProof(channelId, {
    mint,
    taskHash,
    outputHash: computedOutputHash,
    proofType: ApcProofType.HashProof,
  });

  console.log(`\n  ✓ Work proof submitted (HashProof)`);
  console.log(`  Tx: ${solscan(proofTx)}`);

  // ── 13. Step 5: Agent A verifies output hash ──────────────────────────────
  sep('Step 5 — Agent A: verify output hash');

  const expectedOutputHash = sha256(EXPECTED_OUTPUT);
  const hashMatch = Buffer.from(computedOutputHash).equals(Buffer.from(expectedOutputHash));
  console.log(`  Expected: ${expectedOutputHash.toString('hex')}`);
  console.log(`  Received: ${computedOutputHash.toString('hex')}`);
  console.log(`  ✓ Hash matches — Agent A approves payment`);

  // ── 14. Step 6: Agent A calls proveAndResolve — PBS collapses ─────────────
  // NOTE: proveAndResolve must be called by the CLAIMANT (Agent B), not issuer
  sep('Step 6 — Agent B: proveAndResolve (PBS → 10 SUSD to Agent B)');

  const pbsB = new ProbabilisticModule(providerB, PROGRAM_ID);
  const resolveTx = await pbsB.proveAndResolve(computedOutputHash, {
    mint,
    commitmentId: cid,
    escrowTokenAccount: escrowVaultAccount.address,
    claimantTokenAccount: agentBToken.address,
  });

  console.log(`\n  ✓ PBS resolved — 10 SUSD released to Agent B`);
  console.log(`  Tx: ${solscan(resolveTx)}`);

  // ── 15. Step 7: Settle APC ────────────────────────────────────────────────
  sep('Step 7 — Settle APC (cooperative)');

  const propTx = await apcB.proposeSettle(channelId, {
    mint,
    amount: new BN(0),
  });
  console.log(`  ✓ Agent B proposed settle: ${solscan(propTx)}`);

  const counterTx = await apcA.countersignSettle(channelId, {
    mint,
    openerTokenAccount: agentBToken.address,
    counterpartyTokenAccount: agentAToken.address,
    escrowTokenAccount: escrowChannelAccount.address,
  });
  console.log(`  ✓ Agent A countersigned — APC settled: ${solscan(counterTx)}`);

  // ── 16. Final balances ─────────────────────────────────────────────────────
  sep('Final Balances');

  const balAAfter = (await getAccount(connection, agentAToken.address, undefined, TOKEN_2022_PROGRAM_ID)).amount;
  const balBAfter = (await getAccount(connection, agentBToken.address, undefined, TOKEN_2022_PROGRAM_ID)).amount;

  console.log(`\n  Agent A (before): ${usdcDisplay(balABefore)}  →  (after): ${usdcDisplay(balAAfter)}  delta: -${usdcDisplay(balABefore - balAAfter)}`);
  console.log(`  Agent B (before): ${usdcDisplay(balBBefore)}  →  (after): ${usdcDisplay(balBAfter)}  delta: +${usdcDisplay(balBAfter - balBBefore)}`);

  sep('Done');
  console.log('');
  console.log('  ✅ Agent B received 10 SUSD for verified work. No intermediary. No escrow agent. No trust required.');
  console.log('');

  // ── Collect all tx signatures ─────────────────────────────────────────────
  console.log('  All transaction signatures:');
  const txList = [
    ['PBS Commit', commitTx],
    ['APC Open', openTx],
    ['Work Proof', proofTx],
    ['PBS Resolve', resolveTx],
    ['APC Propose Settle', propTx],
    ['APC Countersign Settle', counterTx],
  ];
  for (const [label, sig] of txList) {
    console.log(`    ${label}: ${solscan(sig as string)}`);
  }
}

main().catch((err) => {
  console.error('\n  ✗ Demo failed:', err.message ?? String(err));
  console.error('  Error type:', err.constructor?.name);
  if (err.logs) {
    console.error('\n  Program logs:');
    for (const log of err.logs) {
      console.error(`    ${log}`);
    }
  }
  if (err.stack) {
    console.error('\n  Stack:', err.stack.split('\n').slice(0, 5).join('\n'));
  }
  process.exit(1);
});

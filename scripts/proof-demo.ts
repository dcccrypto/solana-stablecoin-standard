/**
 * SSS-112: Proof — Agent-to-Agent Task Payment Reference Demo
 *
 * Demonstrates the complete APC + PBS flow on devnet:
 * - Agent A (Hirer) posts a task "Summarize this document" with 10 USDC PBS commitment
 * - Agent B (Worker) accepts task, opens APC, does simulated work, submits proof
 * - Agent A verifies output, triggers PBS resolution (10 USDC → Agent B)
 * - Both agents settle the APC
 *
 * Run:
 *   npx ts-node --project sdk/tsconfig.json scripts/proof-demo.ts
 *
 * Requirements:
 *   - AGENT_A_KEYPAIR env var: path to Agent A keypair JSON (or set in .env)
 *   - AGENT_B_KEYPAIR env var: path to Agent B keypair JSON (or set in .env)
 *   - DEVNET_RPC env var: Solana devnet RPC URL (defaults to public devnet)
 *   - USDC_MINT env var: SSS stablecoin (USDC-equivalent) mint on devnet
 *   - SSS_PROGRAM_ID env var: deployed SSS on-chain program ID on devnet
 */

import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import {
  Connection,
  Keypair,
  PublicKey,
  clusterApiUrl,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  getOrCreateAssociatedTokenAccount,
  getAccount,
  TOKEN_2022_PROGRAM_ID,
  createMint,
  mintTo,
} from '@solana/spl-token';
import { AnchorProvider, Wallet, BN } from '@coral-xyz/anchor';
import {
  ProbabilisticModule,
  AgentPaymentChannelModule,
  DisputePolicy,
  ApcProofType,
} from '../sdk/src/index';

// ─── Config ────────────────────────────────────────────────────────────────────

const RPC_URL = process.env.DEVNET_RPC ?? clusterApiUrl('devnet');

function loadKeypair(envVar: string, fallbackPath: string): Keypair {
  const kpPath = process.env[envVar] ?? fallbackPath;
  const resolved = path.resolve(kpPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Keypair not found at ${resolved}. Set ${envVar} env var.`);
  }
  return Keypair.fromSecretKey(
    Buffer.from(JSON.parse(fs.readFileSync(resolved, 'utf-8'))),
  );
}

function sha256(input: string): Buffer {
  return createHash('sha256').update(input).digest();
}

function solscan(sig: string): string {
  return `https://solscan.io/tx/${sig}?cluster=devnet`;
}

function usdcDisplay(lamports: bigint, decimals = 6): string {
  return (Number(lamports) / 10 ** decimals).toFixed(decimals) + ' USDC';
}

function sep(label: string): void {
  const dashes = '─'.repeat(60);
  console.log(`\n${dashes}`);
  console.log(`  ${label}`);
  console.log(dashes);
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  sep('SSS Proof Demo — Agent-to-Agent Task Payment');

  // ── 1. Load agents and connection ─────────────────────────────────────────
  const connection = new Connection(RPC_URL, 'confirmed');

  let agentA: Keypair;
  let agentB: Keypair;

  try {
    agentA = loadKeypair('AGENT_A_KEYPAIR', '~/.config/solana/agent-a.json');
  } catch {
    console.log('  [demo] No AGENT_A_KEYPAIR found — generating ephemeral Agent A for demo');
    agentA = Keypair.generate();
  }

  try {
    agentB = loadKeypair('AGENT_B_KEYPAIR', '~/.config/solana/agent-b.json');
  } catch {
    console.log('  [demo] No AGENT_B_KEYPAIR found — generating ephemeral Agent B for demo');
    agentB = Keypair.generate();
  }

  console.log(`\n  Agent A (Hirer):  ${agentA.publicKey.toBase58()}`);
  console.log(`  Agent B (Worker): ${agentB.publicKey.toBase58()}`);
  console.log(`  RPC:              ${RPC_URL}`);

  // ── 2. Build providers ─────────────────────────────────────────────────────
  const providerA = new AnchorProvider(
    connection,
    new Wallet(agentA),
    { commitment: 'confirmed' },
  );
  const providerB = new AnchorProvider(
    connection,
    new Wallet(agentB),
    { commitment: 'confirmed' },
  );

  // ── 3. Resolve program ID and mint ─────────────────────────────────────────
  // In a real devnet run, pass SSS_PROGRAM_ID and USDC_MINT env vars.
  // For the local demo/test mode, we simulate with a mock program id and
  // a fresh Token-2022 mint funded by the demo runner's keypair.

  const demoMode = !process.env.SSS_PROGRAM_ID || !process.env.USDC_MINT;
  if (demoMode) {
    console.log('\n  [demo] Running in SIMULATION mode — no live transactions.');
    console.log('  [demo] Set SSS_PROGRAM_ID + USDC_MINT + funded keypairs for devnet run.');
    return runSimulation(agentA, agentB);
  }

  const programId = new PublicKey(process.env.SSS_PROGRAM_ID!);
  const mint = new PublicKey(process.env.USDC_MINT!);

  // ── 4. Create SDK module instances ─────────────────────────────────────────
  const pbsA = new ProbabilisticModule(providerA, programId);
  const apcB = new AgentPaymentChannelModule(providerB, programId);
  const apcA = new AgentPaymentChannelModule(providerA, programId);

  // ── 5. Prepare token accounts ──────────────────────────────────────────────
  sep('Step 0 — Prepare Token Accounts');

  const agentATokenAccount = await getOrCreateAssociatedTokenAccount(
    connection, agentA, mint, agentA.publicKey, false, undefined, undefined, TOKEN_2022_PROGRAM_ID,
  );
  const agentBTokenAccount = await getOrCreateAssociatedTokenAccount(
    connection, agentB, mint, agentB.publicKey, false, undefined, undefined, TOKEN_2022_PROGRAM_ID,
  );

  const balABefore = (await getAccount(connection, agentATokenAccount.address, undefined, TOKEN_2022_PROGRAM_ID)).amount;
  const balBBefore = (await getAccount(connection, agentBTokenAccount.address, undefined, TOKEN_2022_PROGRAM_ID)).amount;

  console.log(`\n  Agent A balance (before): ${usdcDisplay(balABefore)}`);
  console.log(`  Agent B balance (before): ${usdcDisplay(balBBefore)}`);

  // ── 6. Hashes ──────────────────────────────────────────────────────────────
  const TASK_DESCRIPTION = 'Summarize this document';
  const EXPECTED_OUTPUT  = 'The document covers SSS token architecture, APC + PBS primitives.';

  const taskHash   = sha256(TASK_DESCRIPTION);
  const outputHash = sha256(EXPECTED_OUTPUT);

  console.log(`\n  Task:        "${TASK_DESCRIPTION}"`);
  console.log(`  Task hash:   ${taskHash.toString('hex')}`);
  console.log(`  Output hash: ${outputHash.toString('hex')}`);

  // ── 7. PBS Commitment IDs ─────────────────────────────────────────────────
  const AMOUNT_10_USDC = new BN(10_000_000); // 10 USDC (6 decimals)
  const commitmentId   = new BN(Date.now());
  const channelId      = new BN(Date.now() + 1);

  // ── 8. Create escrow accounts ──────────────────────────────────────────────
  const [pbsConfigPda] = pbsA.configPda(mint);
  const [vaultPda]     = pbsA.vaultPda(pbsConfigPda, commitmentId);
  const [apcConfigPda] = apcB.configPda(mint);
  const [channelPda]   = apcB.channelPda(apcConfigPda, channelId);

  const escrowVaultAccount = await getOrCreateAssociatedTokenAccount(
    connection, agentA, mint, vaultPda, true, undefined, undefined, TOKEN_2022_PROGRAM_ID,
  );
  const escrowChannelAccount = await getOrCreateAssociatedTokenAccount(
    connection, agentB, mint, channelPda, true, undefined, undefined, TOKEN_2022_PROGRAM_ID,
  );

  // ── 9. Step 1: Agent A commits 10 USDC via PBS ────────────────────────────
  sep('Step 1 — Agent A: commitProbabilistic (10 USDC → PBS vault)');

  const currentSlot = await connection.getSlot();
  const { commitmentId: cid, txSig: commitTx } = await pbsA.commitProbabilistic({
    mint,
    amount: AMOUNT_10_USDC,
    conditionHash: taskHash,
    expirySlot: new BN(currentSlot + 1000),
    claimant: agentB.publicKey,
    commitmentId,
    escrowTokenAccount: escrowVaultAccount.address,
    issuerTokenAccount: agentATokenAccount.address,
  });

  console.log(`\n  ✓ Committed ${usdcDisplay(BigInt(10_000_000))} to PBS vault`);
  console.log(`  Commitment ID: ${cid.toString()}`);
  console.log(`  Tx: ${solscan(commitTx)}`);

  // ── 10. Step 2: Agent B opens APC ─────────────────────────────────────────
  sep('Step 2 — Agent B: openChannel (APC with Agent A)');

  const { channelId: chnId, txSig: openTx } = await apcB.openChannel({
    mint,
    counterparty: agentA.publicKey,
    deposit: new BN(0), // zero-deposit; PBS handles payment
    disputePolicy: DisputePolicy.TimeoutFallback,
    timeoutSlots: new BN(500),
    channelId,
  });

  console.log(`\n  ✓ APC opened (zero-deposit, timeout=500 slots)`);
  console.log(`  Channel ID: ${chnId.toString()}`);
  console.log(`  Tx: ${solscan(openTx)}`);

  // ── 11. Step 3: Agent B simulates work ────────────────────────────────────
  sep('Step 3 — Agent B: simulated work');
  const simulatedOutput = EXPECTED_OUTPUT;
  const computedOutputHash = sha256(simulatedOutput);
  console.log(`\n  [Agent B] "Work" done: summarized the document.`);
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

  if (!hashMatch) {
    throw new Error('Output hash MISMATCH — Agent A rejects payment!');
  }

  console.log(`\n  ✓ Output hash matches expectation — Agent A approves payment`);

  // ── 14. Step 6: Agent A calls proveAndResolve — PBS collapses ─────────────
  sep('Step 6 — Agent A: proveAndResolve (PBS → 10 USDC to Agent B)');

  const resolveTx = await pbsA.proveAndResolve(computedOutputHash, {
    mint,
    commitmentId: cid,
    escrowTokenAccount: escrowVaultAccount.address,
    claimantTokenAccount: agentBTokenAccount.address,
  });

  console.log(`\n  ✓ PBS resolved — 10 USDC released to Agent B`);
  console.log(`  Tx: ${solscan(resolveTx)}`);

  // ── 15. Step 7: Settle APC (Agent B proposes, Agent A countersigns) ───────
  sep('Step 7 — Settle APC (cooperative)');

  const propTx = await apcB.proposeSettle(channelId, {
    mint,
    amount: new BN(0), // no APC deposit, settlement is symbolic
  });
  console.log(`\n  ✓ Agent B proposed settle`);
  console.log(`  Tx: ${solscan(propTx)}`);

  const counterTx = await apcA.countersignSettle(channelId, {
    mint,
    openerTokenAccount: agentBTokenAccount.address, // roles inverted since A is opener
    counterpartyTokenAccount: agentATokenAccount.address,
    escrowTokenAccount: escrowChannelAccount.address,
  });
  console.log(`\n  ✓ Agent A countersigned — APC settled`);
  console.log(`  Tx: ${solscan(counterTx)}`);

  // ── 16. Final balances ─────────────────────────────────────────────────────
  sep('Final Balances');

  const balAAfter = (await getAccount(connection, agentATokenAccount.address, undefined, TOKEN_2022_PROGRAM_ID)).amount;
  const balBAfter = (await getAccount(connection, agentBTokenAccount.address, undefined, TOKEN_2022_PROGRAM_ID)).amount;

  console.log(`\n  Agent A balance (before): ${usdcDisplay(balABefore)}`);
  console.log(`  Agent A balance (after):  ${usdcDisplay(balAAfter)}`);
  console.log(`  Agent A delta:            -${usdcDisplay(balABefore - balAAfter)}`);
  console.log('');
  console.log(`  Agent B balance (before): ${usdcDisplay(balBBefore)}`);
  console.log(`  Agent B balance (after):  ${usdcDisplay(balBAfter)}`);
  console.log(`  Agent B delta:            +${usdcDisplay(balBAfter - balBBefore)}`);

  sep('Done');
  console.log('');
  console.log('  ✅ Agent B received 10 USDC for verified work.');
  console.log('     No intermediary. No escrow agent. No trust required.');
  console.log('');
}

// ─── Simulation (no devnet keypairs) ─────────────────────────────────────────

function runSimulation(agentA: Keypair, agentB: Keypair): void {
  const TASK_DESCRIPTION = 'Summarize this document';
  const EXPECTED_OUTPUT  = 'The document covers SSS token architecture, APC + PBS primitives.';

  const taskHash   = sha256(TASK_DESCRIPTION);
  const outputHash = sha256(EXPECTED_OUTPUT);

  const AMOUNT_10_USDC = BigInt(10_000_000); // 10 USDC (6 decimals)
  const AGENT_A_START  = BigInt(100_000_000);
  const AGENT_B_START  = BigInt(5_000_000);

  function line(label: string): void {
    console.log(`\n  [sim] ${label}`);
  }

  sep('Step 0 — Initial Balances (simulated)');
  console.log(`\n  Agent A (Hirer):  ${usdcDisplay(AGENT_A_START)}`);
  console.log(`  Agent B (Worker): ${usdcDisplay(AGENT_B_START)}`);

  sep('Step 1 — Agent A: commitProbabilistic (10 USDC → PBS vault)');
  line(`Task:         "${TASK_DESCRIPTION}"`);
  line(`Task hash:    ${taskHash.toString('hex')}`);
  line(`Expiry slot:  current + 1000`);
  line(`Claimant:     ${agentB.publicKey.toBase58()}`);
  line('→ PBS vault created. 10 USDC locked. [simulated tx: PBS_COMMIT_SIG...]');
  console.log('  Tx: https://solscan.io/tx/PBS_COMMIT_SIG?cluster=devnet');

  sep('Step 2 — Agent B: openChannel (zero-deposit APC)');
  line(`Counterparty:   ${agentA.publicKey.toBase58()}`);
  line('Dispute policy: TimeoutFallback');
  line('Timeout:        500 slots');
  line('→ APC opened. [simulated tx: APC_OPEN_SIG...]');
  console.log('  Tx: https://solscan.io/tx/APC_OPEN_SIG?cluster=devnet');

  sep('Step 3 — Agent B: simulated work');
  line(`Input:         "${TASK_DESCRIPTION}"`);
  line(`Output:        "${EXPECTED_OUTPUT}"`);
  line(`Output hash:   ${outputHash.toString('hex')}`);

  sep('Step 4 — Agent B: submitWorkProof (HashProof)');
  line('→ Work proof submitted to APC. [simulated tx: PROOF_SIG...]');
  console.log('  Tx: https://solscan.io/tx/PROOF_SIG?cluster=devnet');

  sep('Step 5 — Agent A: verify output hash');
  const expected = sha256(EXPECTED_OUTPUT);
  const match = Buffer.from(outputHash).equals(Buffer.from(expected));
  line(`Expected hash: ${expected.toString('hex')}`);
  line(`Received hash: ${outputHash.toString('hex')}`);
  line(match ? '✓ Hash matches — Agent A approves payment' : '✗ MISMATCH — payment rejected');

  sep('Step 6 — Agent A: proveAndResolve (PBS → Agent B)');
  line(`Proof hash:    ${outputHash.toString('hex')}`);
  line('→ PBS vault resolved. 10 USDC → Agent B. [simulated tx: PBS_RESOLVE_SIG...]');
  console.log('  Tx: https://solscan.io/tx/PBS_RESOLVE_SIG?cluster=devnet');

  sep('Step 7 — Settle APC (cooperative)');
  line('Agent B proposeSettle → [simulated tx: SETTLE_PROPOSE_SIG...]');
  console.log('  Tx: https://solscan.io/tx/SETTLE_PROPOSE_SIG?cluster=devnet');
  line('Agent A countersignSettle → [simulated tx: SETTLE_COUNTER_SIG...]');
  console.log('  Tx: https://solscan.io/tx/SETTLE_COUNTER_SIG?cluster=devnet');

  sep('Final Balances (simulated)');
  const balAAfter = AGENT_A_START - AMOUNT_10_USDC;
  const balBAfter = AGENT_B_START + AMOUNT_10_USDC;
  console.log(`\n  Agent A (before): ${usdcDisplay(AGENT_A_START)}   →   (after): ${usdcDisplay(balAAfter)}   delta: -${usdcDisplay(AMOUNT_10_USDC)}`);
  console.log(`  Agent B (before): ${usdcDisplay(AGENT_B_START)}    →   (after): ${usdcDisplay(balBAfter)}   delta: +${usdcDisplay(AMOUNT_10_USDC)}`);

  sep('Done');
  console.log('');
  console.log('  ✅ Agent B received 10 USDC for verified work.');
  console.log('     No intermediary. No escrow agent. No trust required.');
  console.log('');
}

// ─── Entry point ─────────────────────────────────────────────────────────────
main().catch((err) => {
  console.error('\n  ✗ Demo failed:', err.message ?? err);
  process.exit(1);
});

/**
 * SSS-017: Anchor localnet integration test setup.
 *
 * Starts `solana-test-validator` with the pre-built sss_token.so and
 * sss_transfer_hook.so loaded at their canonical program IDs, funds a
 * throwaway test wallet, and returns an AnchorProvider ready for use.
 *
 * The validator is kept alive for the duration of the test suite and killed
 * in afterAll().
 */

import { execSync, spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { AnchorProvider, Wallet } from '@coral-xyz/anchor';

// ─── Paths ────────────────────────────────────────────────────────────────────

const SOLANA_BIN = path.join(
  os.homedir(),
  '.local/share/solana/install/active_release/bin'
);
const SOLANA = path.join(SOLANA_BIN, 'solana');
const SOLANA_KEYGEN = path.join(SOLANA_BIN, 'solana-keygen');
const VALIDATOR = path.join(SOLANA_BIN, 'solana-test-validator');

// Repo root is three levels up from sdk/tests/anchor/
const REPO_ROOT = path.resolve(__dirname, '../../..');
const DEPLOY_DIR = path.join(REPO_ROOT, 'target/deploy');

export const SSS_TOKEN_PROGRAM_ID = new PublicKey(
  'AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat'
);
export const SSS_TRANSFER_HOOK_PROGRAM_ID = new PublicKey(
  'phAtzRyRUJGpMC3ftAtWzoaX7UkghRe9x5KTig8jPQp'
);

export const RPC_URL = 'http://127.0.0.1:8899';

// ─── State ────────────────────────────────────────────────────────────────────

let validatorProcess: ChildProcess | null = null;
let _provider: AnchorProvider | null = null;
let _payer: Keypair | null = null;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Generate a temporary keypair JSON file and return the Keypair + file path. */
function generateTempKeypair(): { keypair: Keypair; keyPath: string } {
  const tmpDir = os.tmpdir();
  const keyPath = path.join(tmpDir, `sss-test-wallet-${Date.now()}.json`);
  execSync(`${SOLANA_KEYGEN} new --no-bip39-passphrase --outfile ${keyPath} --force`, {
    stdio: 'ignore',
  });
  const raw = JSON.parse(fs.readFileSync(keyPath, 'utf8')) as number[];
  const keypair = Keypair.fromSecretKey(Uint8Array.from(raw));
  return { keypair, keyPath };
}

/** Wait until the validator's JSON-RPC is responsive. */
async function waitForValidator(url: string, maxWaitMs = 45_000): Promise<void> {
  const deadline = Date.now() + maxWaitMs;
  // Give the process a moment to bind to the port before polling
  await sleep(2_000);
  while (Date.now() < deadline) {
    try {
      const conn = new Connection(url, 'confirmed');
      await conn.getVersion();
      return;
    } catch {
      await sleep(1_000);
    }
  }
  throw new Error(`solana-test-validator did not start within ${maxWaitMs}ms`);
}

// ─── Exported setup / teardown ────────────────────────────────────────────────

/**
 * Start the test validator. Call this in `beforeAll()`.
 * Returns { provider, payer } for use in tests.
 */
export async function startValidator(): Promise<{
  provider: AnchorProvider;
  payer: Keypair;
}> {
  if (_provider) return { provider: _provider, payer: _payer! };

  const { keypair: payer, keyPath } = generateTempKeypair();

  // Use a dedicated ledger dir in /tmp to avoid conflicts with the repo's test-ledger
  const ledgerDir = path.join(os.tmpdir(), `sss-test-ledger-${Date.now()}`);

  // Build validator args — load both programs at their canonical IDs.
  const args = [
    '--reset',
    '--quiet',
    '--ledger', ledgerDir,
    '--bpf-program',
    SSS_TOKEN_PROGRAM_ID.toBase58(),
    path.join(DEPLOY_DIR, 'sss_token.so'),
    '--bpf-program',
    SSS_TRANSFER_HOOK_PROGRAM_ID.toBase58(),
    path.join(DEPLOY_DIR, 'sss_transfer_hook.so'),
  ];

  validatorProcess = spawn(VALIDATOR, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });

  // Log validator stderr for debugging (won't pollute test output much)
  validatorProcess.stderr?.on('data', (chunk: Buffer) => {
    // Only log errors, not routine validator output
    const msg = chunk.toString();
    if (msg.includes('Error') || msg.includes('error')) {
      process.stderr.write(`[validator] ${msg}`);
    }
  });

  validatorProcess.on('error', (err) => {
    console.error('[validator] spawn error:', err.message);
  });

  // Wait for it to be ready
  await waitForValidator(RPC_URL);

  // Fund the payer with 100 SOL via airdrop
  const conn = new Connection(RPC_URL, 'confirmed');
  const sig = await conn.requestAirdrop(payer.publicKey, 100 * LAMPORTS_PER_SOL);
  await conn.confirmTransaction(sig, 'confirmed');

  const wallet = new Wallet(payer);
  _provider = new AnchorProvider(conn, wallet, {
    commitment: 'confirmed',
    preflightCommitment: 'confirmed',
  });
  _payer = payer;

  // Clean up temp key file
  try { fs.unlinkSync(keyPath); } catch {}

  return { provider: _provider, payer: _payer };
}

/** Kill the test validator. Call this in `afterAll()`. */
export async function stopValidator(): Promise<void> {
  if (validatorProcess) {
    validatorProcess.kill('SIGTERM');
    validatorProcess = null;
  }
  _provider = null;
  _payer = null;
}

/** Convenience: get an already-started provider (throws if not started). */
export function getProvider(): AnchorProvider {
  if (!_provider) throw new Error('Validator not started. Call startValidator() first.');
  return _provider;
}

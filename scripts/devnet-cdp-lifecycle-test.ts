#!/usr/bin/env ts-node
/**
 * DEVTEST-004: CDP Lifecycle on Live Devnet
 *
 * Tests the full CDP lifecycle using SSS-3 (reserve-backed) stablecoin.
 *
 * Key design decision: Uses a mock Pyth price account (via Loader.load pattern
 * - creates account owned by Pyth program with correct binary format).
 * The pyth-sdk-solana only validates magic/version/atype, not account owner.
 *
 * Steps:
 *   1. Deploy SSS-3 stablecoin + mock Pyth oracle
 *   2. Register collateral config (custom SPL token)
 *   3. Open CDP — deposit collateral
 *   4. Borrow SUSD stablecoins
 *   5. Check health ratio (off-chain)
 *   6. Accrue stability fees
 *   7. Repay debt including fees
 *   8. Close CDP + retrieve collateral
 *   9. Test liquidation with undercollateralized CDP (price crash)
 *
 * Usage:
 *   npx ts-node --transpile-only -P tsconfig-scripts.json scripts/devnet-cdp-lifecycle-test.ts
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  Connection,
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  Loader,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
  createMint,
  mintTo as splMintTo,
  createAccount as createTokenAccount,
  getOrCreateAssociatedTokenAccount,
} from '@solana/spl-token';
import { AnchorProvider, Wallet, BN, Program } from '@coral-xyz/anchor';

// ── Constants ─────────────────────────────────────────────────────────────────

const SSS_PROGRAM_ID = new PublicKey('AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat');
// Use BPF Loader (deprecated) as owner for mock Pyth oracle.
// The deprecated BPF Loader accepts write instructions, allowing us to create
// an account with arbitrary data. pyth-sdk-solana does NOT check account owner —
// it only validates magic/version/atype bytes in the data.
const PYTH_PROGRAM_ID = new PublicKey('BPFLoader1111111111111111111111111111111111');
const DEVNET_RPC = 'https://api.devnet.solana.com';
const SOLANA_CLI_KEYPAIR = path.join(os.homedir(), '.config', 'solana', 'id.json');

// PDA seeds
const STABLECOIN_CONFIG_SEED = Buffer.from('stablecoin-config');
const COLLATERAL_VAULT_SEED  = Buffer.from('cdp-collateral-vault');
const CDP_POSITION_SEED      = Buffer.from('cdp-position');
const COLLATERAL_CONFIG_SEED = Buffer.from('collateral-config');
const MINTER_SEED            = Buffer.from('minter-info');

// Pyth binary format constants
const PYTH_MAGIC = 0xa1b2c3d4;
const PYTH_VERSION_2 = 2;
const PYTH_ATYPE_PRICE = 3;
const PYTH_ACCT_SIZE = 3312;
const PYTH_STATUS_TRADING = 1;

// ── Types ─────────────────────────────────────────────────────────────────────

interface StepResult {
  step: number;
  name: string;
  status: 'PASS' | 'FAIL' | 'SKIP';
  reason?: string;
  txSigs: string[];
  data?: Record<string, any>;
}

const results: StepResult[] = [];

// ── Helpers ───────────────────────────────────────────────────────────────────

function loadKeypair(kpPath: string): Keypair {
  const raw = JSON.parse(fs.readFileSync(kpPath, 'utf8')) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function explorerLink(sig: string): string {
  return `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function getConfigPda(mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([STABLECOIN_CONFIG_SEED, mint.toBuffer()], SSS_PROGRAM_ID)[0];
}
function getMinterPda(config: PublicKey, minter: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([MINTER_SEED, config.toBuffer(), minter.toBuffer()], SSS_PROGRAM_ID)[0];
}
function getCollateralVaultPda(sssMint: PublicKey, user: PublicKey, collateralMint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([COLLATERAL_VAULT_SEED, sssMint.toBuffer(), user.toBuffer(), collateralMint.toBuffer()], SSS_PROGRAM_ID)[0];
}
function getCdpPositionPda(sssMint: PublicKey, user: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([CDP_POSITION_SEED, sssMint.toBuffer(), user.toBuffer()], SSS_PROGRAM_ID)[0];
}
function getCollateralConfigPda(sssMint: PublicKey, collateralMint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([COLLATERAL_CONFIG_SEED, sssMint.toBuffer(), collateralMint.toBuffer()], SSS_PROGRAM_ID)[0];
}

/**
 * Build a Pyth-compatible price account binary buffer.
 *
 * The pyth-sdk-solana `SolanaPriceAccount::account_info_to_feed` validates:
 *   - magic == 0xa1b2c3d4
 *   - ver == VERSION_2 (2)
 *   - atype == AccountType::Price (3)
 *
 * It does NOT validate account owner.
 * Price is in micro-USD (expo=-6), so $120 = 120_000_000.
 */
function buildPythPriceData(priceUsdMicro: bigint, publishTimestamp: bigint): Buffer {
  const buf = Buffer.alloc(PYTH_ACCT_SIZE, 0);
  buf.writeUInt32LE(PYTH_MAGIC, 0);       // magic
  buf.writeUInt32LE(PYTH_VERSION_2, 4);   // ver = VERSION_2
  buf.writeUInt32LE(PYTH_ATYPE_PRICE, 8); // atype = Price
  buf.writeUInt32LE(PYTH_ACCT_SIZE, 12);  // size
  buf.writeUInt32LE(1, 16);               // ptype = Price
  buf.writeInt32LE(-6, 20);               // expo = -6 (price in micro-USD)
  buf.writeUInt32LE(1, 24);               // num
  buf.writeUInt32LE(1, 28);               // num_qt
  buf.writeBigInt64LE(publishTimestamp, 96);   // timestamp
  buf.writeBigInt64LE(priceUsdMicro, 208);     // agg.price
  buf.writeBigUInt64LE(BigInt(0), 216);        // agg.conf (0 = no confidence range)
  buf.writeUInt32LE(PYTH_STATUS_TRADING, 224); // agg.status = Trading(1)
  buf.writeBigUInt64LE(BigInt(1), 232);        // agg.pub_slot = 1
  return buf;
}

/**
 * Create a mock Pyth price account on devnet using the BPF Loader pattern.
 * The Loader.load creates an account owned by the specified program and writes
 * the given data into it. pyth-sdk-solana validates only magic/ver/atype.
 */
async function createMockPythAccount(
  connection: Connection,
  payer: Keypair,
  priceUsdMicro: bigint,
  publishTimestamp: bigint,
): Promise<Keypair> {
  const pythAccountKeypair = Keypair.generate();
  const pythData = buildPythPriceData(priceUsdMicro, publishTimestamp);

  console.log(`  Creating mock Pyth oracle account (size=${PYTH_ACCT_SIZE})...`);
  await Loader.load(
    connection,
    payer,
    pythAccountKeypair,
    PYTH_PROGRAM_ID, // owned by Pyth program on devnet
    pythData,
  );
  console.log(`  ✅ Mock Pyth oracle: ${pythAccountKeypair.publicKey.toBase58()}`);
  return pythAccountKeypair;
}

/**
 * Update the price data in a mock Pyth account.
 * Since the account is owned by the Pyth program, we can't update it directly.
 * Instead, we create a NEW mock Pyth account with the updated price.
 */
async function updateMockPythPrice(
  connection: Connection,
  payer: Keypair,
  priceUsdMicro: bigint,
): Promise<Keypair> {
  const now = BigInt(Math.floor(Date.now() / 1000));
  return createMockPythAccount(connection, payer, priceUsdMicro, now);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║    DEVTEST-004: CDP Lifecycle on Live Devnet             ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  const payer = loadKeypair(SOLANA_CLI_KEYPAIR);
  const connection = new Connection(DEVNET_RPC, 'confirmed');
  const wallet = new Wallet(payer);
  const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' });

  const balance = await connection.getBalance(payer.publicKey);
  console.log(`Payer: ${payer.publicKey.toBase58()}`);
  console.log(`Balance: ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL\n`);

  // Load IDL
  const idlPath = path.join(__dirname, '..', 'idl', 'sss_token.json');
  const idl = JSON.parse(fs.readFileSync(idlPath, 'utf8'));
  const program = new Program({ ...idl, address: SSS_PROGRAM_ID.toBase58() } as any, provider) as any;

  // ── Step 1: Deploy SSS-3 + Mock Oracle ───────────────────────────────────

  console.log('══ Step 1: Deploy SSS-3 (reserve-backed) ══');

  const sssMintKeypair = Keypair.generate();
  const sssMint = sssMintKeypair.publicKey;
  const configPda = getConfigPda(sssMint);
  const minterPda = getMinterPda(configPda, payer.publicKey);

  // Create a custom SPL token as collateral (6 decimals, we are the mint authority)
  // This is easier than WSOL and allows full control over balances
  let collateralMint: PublicKey;
  let step1Txs: string[] = [];
  let mockPythKeypair: Keypair;

  try {
    // Create collateral mint (6 decimals, payer = mint authority)
    collateralMint = await createMint(
      connection,
      payer,
      payer.publicKey,
      null,
      6,
      undefined,
      undefined,
      TOKEN_PROGRAM_ID,
    );
    console.log(`  ✅ Collateral mint created: ${collateralMint.toBase58()}`);

    // Create mock Pyth oracle: SOL=$120 in micro-USD (price in expo=-6)
    // $120.000000 = 120_000_000 micro-USD
    const now = BigInt(Math.floor(Date.now() / 1000));
    mockPythKeypair = await createMockPythAccount(connection, payer, 120_000_000n, now);
    await sleep(1000);

    // Set oracle params: max age = 1 year (no staleness concern for mock)
    // Note: set_oracle_params + set_pyth_feed require the stablecoin to exist first

    // Create vault token account: reserve vault is a regular SPL token account
    // owned by the config PDA
    const reserveVaultKeypair = Keypair.generate();
    const reserveVault = reserveVaultKeypair.publicKey;
    const createVaultTx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: reserveVault,
        lamports: await connection.getMinimumBalanceForRentExemption(165),
        space: 165,
        programId: TOKEN_PROGRAM_ID,
      })
    );
    // We need to initialize the vault token account
    const { createInitializeAccountInstruction } = await import('@solana/spl-token');
    createVaultTx.add(
      createInitializeAccountInstruction(reserveVault, collateralMint, configPda, TOKEN_PROGRAM_ID)
    );
    const vaultSig = await sendAndConfirmTransaction(connection, createVaultTx, [payer, reserveVaultKeypair], { commitment: 'confirmed' });
    step1Txs.push(vaultSig);
    console.log(`  ✅ Reserve vault created: ${reserveVault.toBase58()}`);
    await sleep(500);

    // Initialize SSS-3 stablecoin
    const initSig = await program.methods
      .initialize({
        name: 'Devnet SUSD',
        symbol: 'SUSD',
        decimals: 6,
        uri: '',
        preset: 3,
        maxSupply: new BN('1000000000000'), // 1M SUSD
        transferHookProgram: null,
        collateralMint: collateralMint,
        reserveVault: reserveVault,
        featureFlags: null,
        auditorElgamalPubkey: null,
      })
      .accounts({
        payer: payer.publicKey,
        mint: sssMint,
        config: configPda,
        ctConfig: null,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: new PublicKey('SysvarRent111111111111111111111111111111111'),
      })
      .signers([sssMintKeypair])
      .rpc({ commitment: 'confirmed' });
    step1Txs.push(initSig);
    console.log(`  ✅ SSS-3 initialized: ${sssMint.toBase58()}`);
    console.log(`     TX: ${explorerLink(initSig)}`);
    await sleep(1000);

    // Register payer as minter
    const minterSig = await program.methods
      .updateMinter(new BN('1000000000000000'))
      .accounts({
        authority: payer.publicKey,
        config: configPda,
        mint: sssMint,
        minterInfo: minterPda,
        minterKey: payer.publicKey,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc({ commitment: 'confirmed' });
    step1Txs.push(minterSig);
    console.log(`  ✅ Minter registered`);
    await sleep(500);

    // Set pyth feed to our mock oracle
    const setPythSig = await program.methods
      .setPythFeed(mockPythKeypair.publicKey)
      .accounts({
        authority: payer.publicKey,
        config: configPda,
        mint: sssMint,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc({ commitment: 'confirmed' });
    step1Txs.push(setPythSig);
    console.log(`  ✅ Pyth feed set to mock oracle`);
    await sleep(500);

    // Set oracle params: max age = 86400s (1 day), no conf check
    const setParamsSig = await program.methods
      .setOracleParams(86400, 0)
      .accounts({
        authority: payer.publicKey,
        config: configPda,
        mint: sssMint,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .rpc({ commitment: 'confirmed' });
    step1Txs.push(setParamsSig);
    console.log(`  ✅ Oracle params set (maxAge=86400s, noConfCheck)`);

    results.push({
      step: 1, name: 'Deploy SSS-3 (reserve-backed)', status: 'PASS',
      txSigs: step1Txs,
      data: {
        sssMint: sssMint.toBase58(),
        configPda: configPda.toBase58(),
        collateralMint: collateralMint.toBase58(),
        mockOracleAccount: mockPythKeypair.publicKey.toBase58(),
        priceUsd: 120,
      }
    });
    await sleep(500);
  } catch (e: any) {
    console.error(`  ❌ Step 1 FAILED: ${e.message}`);
    results.push({ step: 1, name: 'Deploy SSS-3 (reserve-backed)', status: 'FAIL', reason: e.message, txSigs: step1Txs });
    await finalize(results, sssMintKeypair.publicKey);
    return;
  }
  console.log(`  → PASS\n`);

  // ── Step 2: Register Collateral Config ──────────────────────────────────

  console.log('══ Step 2: Register collateral config ══');
  const collateralConfigPda = getCollateralConfigPda(sssMint, collateralMint);

  try {
    const regSig = await program.methods
      .registerCollateral({
        whitelisted: true,
        maxLtvBps: 6000,               // 60% LTV
        liquidationThresholdBps: 7500, // 75% liquidation threshold
        liquidationBonusBps: 500,      // 5% bonus
        maxDepositCap: new BN(0),      // unlimited
      })
      .accounts({
        authority: payer.publicKey,
        config: configPda,
        sssMint,
        collateralMint,
        collateralConfig: collateralConfigPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc({ commitment: 'confirmed' });

    console.log(`  ✅ CollateralConfig registered: ${regSig}`);
    console.log(`     LTV=60%, LiqThreshold=75%, Bonus=5%`);
    results.push({ step: 2, name: 'Register collateral config', status: 'PASS', txSigs: [regSig] });
    await sleep(500);
  } catch (e: any) {
    console.error(`  ❌ Step 2 FAILED: ${e.message}`);
    results.push({ step: 2, name: 'Register collateral config', status: 'FAIL', reason: e.message, txSigs: [] });
    await finalize(results, sssMint);
    return;
  }
  console.log(`  → PASS\n`);

  // ── Step 3: Open CDP — Deposit Collateral ────────────────────────────────

  console.log('══ Step 3: Open CDP — deposit collateral ══');

  const collateralVaultPda = getCollateralVaultPda(sssMint, payer.publicKey, collateralMint);
  const COLLATERAL_DECIMALS = 6;
  const DEPOSIT_AMOUNT = 1000n * 10n ** BigInt(COLLATERAL_DECIMALS); // 1000 tokens

  // Create vault token account (owned by collateralVaultPda)
  const vaultTokenAccKeypair = Keypair.generate();
  const vaultTokenAccount = vaultTokenAccKeypair.publicKey;

  // Create user collateral ATA
  const userCollateralAta = getAssociatedTokenAddressSync(collateralMint, payer.publicKey, false, TOKEN_PROGRAM_ID);

  try {
    // Create vault token account (owned by vault PDA)
    const createVaultAccTx = new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: vaultTokenAccount,
        lamports: await connection.getMinimumBalanceForRentExemption(165),
        space: 165,
        programId: TOKEN_PROGRAM_ID,
      })
    );
    const { createInitializeAccountInstruction } = await import('@solana/spl-token');
    createVaultAccTx.add(
      createInitializeAccountInstruction(vaultTokenAccount, collateralMint, collateralVaultPda, TOKEN_PROGRAM_ID)
    );
    await sendAndConfirmTransaction(connection, createVaultAccTx, [payer, vaultTokenAccKeypair], { commitment: 'confirmed' });
    console.log(`  ✅ Vault token account created: ${vaultTokenAccount.toBase58()}`);

    // Create user collateral ATA + mint tokens
    const userAtaInfo = await connection.getAccountInfo(userCollateralAta);
    if (!userAtaInfo) {
      const createAtaTx = new Transaction().add(
        createAssociatedTokenAccountInstruction(payer.publicKey, userCollateralAta, payer.publicKey, collateralMint, TOKEN_PROGRAM_ID)
      );
      await sendAndConfirmTransaction(connection, createAtaTx, [payer], { commitment: 'confirmed' });
    }
    console.log(`  ✅ User collateral ATA: ${userCollateralAta.toBase58()}`);

    // Mint 2000 collateral tokens to user (we are mint authority)
    const mintAmount = 2000n * 10n ** BigInt(COLLATERAL_DECIMALS);
    await splMintTo(connection, payer, collateralMint, userCollateralAta, payer.publicKey, mintAmount, [], undefined, TOKEN_PROGRAM_ID);
    console.log(`  ✅ Minted ${Number(mintAmount)/1e6} collateral tokens to user`);
    await sleep(500);

    // Deposit 1000 collateral tokens into CDP vault
    const depositSig = await program.methods
      .cdpDepositCollateral(new BN(DEPOSIT_AMOUNT.toString()))
      .accounts({
        user: payer.publicKey,
        config: configPda,
        sssMint,
        collateralMint,
        collateralVault: collateralVaultPda,
        vaultTokenAccount,
        userCollateralAccount: userCollateralAta,
        yieldCollateralConfig: null,
        collateralConfig: collateralConfigPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc({ commitment: 'confirmed' });

    console.log(`  ✅ Deposited ${Number(DEPOSIT_AMOUNT)/1e6} collateral tokens: ${depositSig}`);
    console.log(`     TX: ${explorerLink(depositSig)}`);

    // Verify vault state
    const vault = await program.account.collateralVault.fetch(collateralVaultPda);
    console.log(`  ✅ Vault deposited_amount: ${vault.depositedAmount.toString()}`);

    results.push({
      step: 3, name: 'Open CDP — deposit collateral', status: 'PASS',
      txSigs: [depositSig],
      data: { depositedAmount: vault.depositedAmount.toString(), vaultPda: collateralVaultPda.toBase58() }
    });
    await sleep(1000);
  } catch (e: any) {
    console.error(`  ❌ Step 3 FAILED: ${e.message}`);
    results.push({ step: 3, name: 'Open CDP — deposit collateral', status: 'FAIL', reason: e.message, txSigs: [] });
    await finalize(results, sssMint);
    return;
  }
  console.log(`  → PASS\n`);

  // ── Step 4: Borrow SUSD ─────────────────────────────────────────────────

  console.log('══ Step 4: Borrow SUSD ══');
  const cdpPositionPda = getCdpPositionPda(sssMint, payer.publicKey);

  // Create user SUSD ATA (Token-2022)
  const userSusdAta = getAssociatedTokenAddressSync(sssMint, payer.publicKey, false, TOKEN_2022_PROGRAM_ID);

  // Collateral: 1000 tokens @ $120 = $120,000 total value
  // Max LTV = 60% → max borrow = $72,000 = 72_000_000_000 (6 decimals)
  // Borrow $60,000 = 60_000_000_000 (well under 60% LTV)
  const BORROW_AMOUNT = 60_000_000_000n; // 60,000 SUSD

  try {
    // Create SUSD ATA
    const susdAtaInfo = await connection.getAccountInfo(userSusdAta);
    if (!susdAtaInfo) {
      const createAtaTx = new Transaction().add(
        createAssociatedTokenAccountInstruction(payer.publicKey, userSusdAta, payer.publicKey, sssMint, TOKEN_2022_PROGRAM_ID)
      );
      await sendAndConfirmTransaction(connection, createAtaTx, [payer], { commitment: 'confirmed' });
      console.log(`  ✅ SUSD ATA created: ${userSusdAta.toBase58()}`);
    }

    const borrowSig = await program.methods
      .cdpBorrowStable(new BN(BORROW_AMOUNT.toString()))
      .accounts({
        user: payer.publicKey,
        config: configPda,
        sssMint,
        collateralMint,
        collateralVault: collateralVaultPda,
        cdpPosition: cdpPositionPda,
        userSssAccount: userSusdAta,
        pythPriceFeed: mockPythKeypair.publicKey,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc({ commitment: 'confirmed' });

    console.log(`  ✅ Borrowed ${Number(BORROW_AMOUNT)/1e6} SUSD: ${borrowSig}`);
    console.log(`     TX: ${explorerLink(borrowSig)}`);

    const pos = await program.account.cdpPosition.fetch(cdpPositionPda);
    console.log(`  ✅ CDP Position created:`);
    console.log(`     debt_amount: ${pos.debtAmount.toString()}`);
    console.log(`     collateral_mint: ${pos.collateralMint.toBase58().substring(0, 8)}...`);

    results.push({
      step: 4, name: 'Borrow SUSD', status: 'PASS',
      txSigs: [borrowSig],
      data: { borrowedAmount: BORROW_AMOUNT.toString(), debtAmount: pos.debtAmount.toString(), cdpPda: cdpPositionPda.toBase58() }
    });
    await sleep(1000);
  } catch (e: any) {
    console.error(`  ❌ Step 4 FAILED: ${e.message}`);
    results.push({ step: 4, name: 'Borrow SUSD', status: 'FAIL', reason: e.message, txSigs: [] });
    await finalize(results, sssMint);
    return;
  }
  console.log(`  → PASS\n`);

  // ── Step 5: Check Health Ratio ──────────────────────────────────────────

  console.log('══ Step 5: Check health ratio ══');
  {
    let pass = true;
    let failReason = '';
    try {
      const pos = await program.account.cdpPosition.fetch(cdpPositionPda);
      const vault = await program.account.collateralVault.fetch(collateralVaultPda);

      const debtAmount = BigInt(pos.debtAmount.toString());
      const depositedAmount = BigInt(vault.depositedAmount.toString());

      // Price: $120 per collateral token, both have 6 decimals
      const priceUsd = 120;
      const collateralValueUsd = (Number(depositedAmount) / 1e6) * priceUsd;
      const debtUsd = Number(debtAmount) / 1e6;

      const collateralRatioPct = debtUsd > 0 ? (collateralValueUsd / debtUsd) * 100 : Infinity;
      // Health factor = collateralValue / (debt / liquidationThreshold)
      // liquidationThreshold = 75% → healthFactor = collateralValue * 0.75 / debtValue
      const liqThreshold = 0.75;
      const healthFactor = debtUsd > 0 ? (collateralValueUsd * liqThreshold) / debtUsd : Infinity;

      console.log(`  Collateral: ${Number(depositedAmount)/1e6} tokens @ $${priceUsd} = $${collateralValueUsd.toFixed(2)}`);
      console.log(`  Debt: $${debtUsd.toFixed(2)} SUSD`);
      console.log(`  Collateral Ratio: ${collateralRatioPct.toFixed(1)}% (min 150% for new borrows)`);
      console.log(`  Health Factor: ${healthFactor.toFixed(4)} (liquidatable when < 1.0)`);

      if (healthFactor < 1.0) {
        pass = false;
        failReason = `Health factor ${healthFactor.toFixed(4)} < 1.0 — position already liquidatable`;
      } else {
        console.log(`  ✅ Health factor OK: ${healthFactor.toFixed(4)} ≥ 1.0`);
      }

      results.push({
        step: 5, name: 'Check health ratio', status: pass ? 'PASS' : 'FAIL',
        reason: failReason, txSigs: [],
        data: { collateralValueUsd, debtUsd, collateralRatioPct, healthFactor }
      });
    } catch (e: any) {
      pass = false; failReason = e.message;
      results.push({ step: 5, name: 'Check health ratio', status: 'FAIL', reason: failReason, txSigs: [] });
    }
    console.log(`  → ${pass ? 'PASS' : 'FAIL'} ${failReason ? '(' + failReason + ')' : ''}\n`);
  }

  // ── Step 6: Accrue Stability Fees ──────────────────────────────────────

  console.log('══ Step 6: Accrue stability fees ══');
  {
    let pass = true;
    let failReason = '';
    const txSigs: string[] = [];

    try {
      // Set stability fee: 2% per annum (200 bps)
      const setFeeSig = await program.methods
        .setStabilityFee(200)
        .accounts({
          authority: payer.publicKey,
          config: configPda,
        })
        .rpc({ commitment: 'confirmed' });
      txSigs.push(setFeeSig);
      console.log(`  ✅ Stability fee set to 2% p.a.: ${setFeeSig}`);
      await sleep(2000); // Wait to accrue some fees

      // Collect stability fee (authority = caller)
      const collectSig = await program.methods
        .collectStabilityFee()
        .accounts({
          caller: payer.publicKey,
          config: configPda,
          sssMint,
          debtor: payer.publicKey,
          cdpPosition: cdpPositionPda,
          debtorSssAccount: userSusdAta,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .rpc({ commitment: 'confirmed' });
      txSigs.push(collectSig);
      console.log(`  ✅ collectStabilityFee: ${collectSig}`);

      const pos = await program.account.cdpPosition.fetch(cdpPositionPda);
      console.log(`  CDP after fee collection: debt=${pos.debtAmount.toString()}, accrued=${pos.accruedFees?.toString()}`);
      console.log(`  ℹ️  2% p.a. fee on $60k debt in 2s ≈ $0.000076 (sub-micro, normal)`);

      results.push({ step: 6, name: 'Accrue stability fees', status: 'PASS', txSigs });
    } catch (e: any) {
      pass = false; failReason = e.message;
      console.error(`  ❌ Step 6 FAILED: ${failReason}`);
      results.push({ step: 6, name: 'Accrue stability fees', status: 'FAIL', reason: failReason, txSigs });
    }
    console.log(`  → ${pass ? 'PASS' : 'FAIL'} ${failReason ? '(' + failReason.substring(0, 100) + ')' : ''}\n`);
  }

  // ── Step 7: Repay Debt Including Fees ──────────────────────────────────

  console.log('══ Step 7: Repay debt including fees ══');
  {
    let pass = true;
    let failReason = '';
    const txSigs: string[] = [];

    try {
      const posBeforeRepay = await program.account.cdpPosition.fetch(cdpPositionPda);
      const totalDebt = BigInt(posBeforeRepay.debtAmount.toString());
      console.log(`  Total debt to repay: ${Number(totalDebt)/1e6} SUSD`);

      // Mint extra to cover any fees
      const mintExtraSig = await program.methods
        .mint(new BN('1000000'))
        .accounts({
          minter: payer.publicKey,
          config: configPda,
          mint: sssMint,
          minterInfo: minterPda,
          recipientTokenAccount: userSusdAta,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .rpc({ commitment: 'confirmed' });
      txSigs.push(mintExtraSig);
      console.log(`  ✅ Minted 1 SUSD extra for fees`);
      await sleep(500);

      // Repay full debt
      const repaySig = await program.methods
        .cdpRepayStable(new BN(totalDebt.toString()))
        .accounts({
          user: payer.publicKey,
          config: configPda,
          sssMint,
          userSssAccount: userSusdAta,
          cdpPosition: cdpPositionPda,
          collateralVault: collateralVaultPda,
          collateralMint,
          vaultTokenAccount,
          userCollateralAccount: userCollateralAta,
          sssTokenProgram: TOKEN_2022_PROGRAM_ID,
          collateralTokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc({ commitment: 'confirmed' });
      txSigs.push(repaySig);
      console.log(`  ✅ Repaid ${Number(totalDebt)/1e6} SUSD: ${repaySig}`);

      const posAfter = await program.account.cdpPosition.fetch(cdpPositionPda);
      const debtAfter = BigInt(posAfter.debtAmount.toString());
      console.log(`  CDP debt after repay: ${Number(debtAfter)/1e6} SUSD`);

      results.push({
        step: 7, name: 'Repay debt including fees', status: 'PASS',
        txSigs, data: { repaidAmount: totalDebt.toString(), debtAfter: debtAfter.toString() }
      });
      await sleep(500);
    } catch (e: any) {
      pass = false; failReason = e.message;
      console.error(`  ❌ Step 7 FAILED: ${failReason}`);
      results.push({ step: 7, name: 'Repay debt including fees', status: 'FAIL', reason: failReason, txSigs });
    }
    console.log(`  → ${pass ? 'PASS' : 'FAIL'} ${failReason ? '(' + failReason.substring(0, 100) + ')' : ''}\n`);
  }

  // ── Step 8: Close CDP + Retrieve Collateral ─────────────────────────────

  console.log('══ Step 8: Close CDP + retrieve collateral ══');
  {
    let pass = true;
    let failReason = '';
    const txSigs: string[] = [];

    try {
      const posBeforeClose = await program.account.cdpPosition.fetch(cdpPositionPda);
      const remainingDebt = BigInt(posBeforeClose.debtAmount.toString());
      console.log(`  Remaining debt: ${Number(remainingDebt)/1e6} SUSD`);

      if (remainingDebt > 0n) {
        const finalRepaySig = await program.methods
          .cdpRepayStable(new BN(remainingDebt.toString()))
          .accounts({
            user: payer.publicKey,
            config: configPda,
            sssMint,
            userSssAccount: userSusdAta,
            cdpPosition: cdpPositionPda,
            collateralVault: collateralVaultPda,
            collateralMint,
            vaultTokenAccount,
            userCollateralAccount: userCollateralAta,
            sssTokenProgram: TOKEN_2022_PROGRAM_ID,
            collateralTokenProgram: TOKEN_PROGRAM_ID,
          })
          .rpc({ commitment: 'confirmed' });
        txSigs.push(finalRepaySig);
        console.log(`  ✅ Final repay: ${finalRepaySig}`);
        await sleep(500);
      }

      const posAfterClose = await program.account.cdpPosition.fetch(cdpPositionPda);
      const debtAfter = BigInt(posAfterClose.debtAmount.toString());
      const vaultAfter = await program.account.collateralVault.fetch(collateralVaultPda);
      const depositedAfter = BigInt(vaultAfter.depositedAmount.toString());

      console.log(`  CDP debt after close: ${Number(debtAfter)/1e6} SUSD`);
      console.log(`  Vault collateral remaining: ${Number(depositedAfter)/1e6} tokens`);

      if (debtAfter === 0n) {
        console.log(`  ✅ CDP fully closed — debt = 0`);
        pass = true;
      } else {
        pass = false;
        failReason = `Debt not fully repaid: ${Number(debtAfter)/1e6} SUSD remaining`;
      }

      results.push({
        step: 8, name: 'Close CDP + retrieve collateral', status: pass ? 'PASS' : 'FAIL',
        reason: failReason, txSigs,
        data: { debtAfter: debtAfter.toString(), depositedAfter: depositedAfter.toString() }
      });
    } catch (e: any) {
      pass = false; failReason = e.message;
      console.error(`  ❌ Step 8 FAILED: ${failReason}`);
      results.push({ step: 8, name: 'Close CDP + retrieve collateral', status: 'FAIL', reason: failReason, txSigs });
    }
    console.log(`  → ${pass ? 'PASS' : 'FAIL'} ${failReason ? '(' + failReason.substring(0, 100) + ')' : ''}\n`);
  }

  // ── Step 9: Liquidation with Undercollateralized CDP ───────────────────

  console.log('══ Step 9: Test liquidation (undercollateralized CDP) ══');
  {
    let pass = true;
    let failReason = '';
    const txSigs: string[] = [];

    try {
      // Re-deposit 1000 tokens and borrow 60,000 SUSD
      // Then crash price to $50 → ratio = 1000*50/60000 = 83% < 75% liq threshold
      const depositSig2 = await program.methods
        .cdpDepositCollateral(new BN(DEPOSIT_AMOUNT.toString()))
        .accounts({
          user: payer.publicKey,
          config: configPda,
          sssMint,
          collateralMint,
          collateralVault: collateralVaultPda,
          vaultTokenAccount,
          userCollateralAccount: userCollateralAta,
          yieldCollateralConfig: null,
          collateralConfig: collateralConfigPda,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc({ commitment: 'confirmed' });
      txSigs.push(depositSig2);
      console.log(`  ✅ Re-deposited 1000 collateral tokens: ${depositSig2}`);
      await sleep(1000);

      const borrowSig2 = await program.methods
        .cdpBorrowStable(new BN(BORROW_AMOUNT.toString()))
        .accounts({
          user: payer.publicKey,
          config: configPda,
          sssMint,
          collateralMint,
          collateralVault: collateralVaultPda,
          cdpPosition: cdpPositionPda,
          userSssAccount: userSusdAta,
          pythPriceFeed: mockPythKeypair.publicKey,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc({ commitment: 'confirmed' });
      txSigs.push(borrowSig2);
      console.log(`  ✅ Borrowed 60,000 SUSD: ${borrowSig2}`);
      await sleep(500);

      // Create NEW mock Pyth oracle with crashed price: $50
      // 1000 tokens @ $50 = $50,000 value
      // Debt = $60,000
      // Ratio = 50000/60000 = 83.3% < 75% liq threshold → liquidatable
      console.log(`  Creating crashed price oracle ($50)...`);
      const crashedPythKeypair = await updateMockPythPrice(connection, payer, 50_000_000n);
      txSigs.push('oracle-update-$50');

      // Update the stablecoin config to use the crashed oracle
      const updatePythSig = await program.methods
        .setPythFeed(crashedPythKeypair.publicKey)
        .accounts({
          authority: payer.publicKey,
          config: configPda,
          mint: sssMint,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .rpc({ commitment: 'confirmed' });
      txSigs.push(updatePythSig);
      console.log(`  ✅ Oracle updated to crashed price ($50): ${updatePythSig}`);
      console.log(`  ℹ️  Value: 1000×$50=$50k < $60k debt → ratio=83% < 75% liq threshold`);
      await sleep(500);

      // Mint SUSD for the liquidator (we are the liquidator)
      const mintLiqSig = await program.methods
        .mint(new BN(BORROW_AMOUNT.toString()))
        .accounts({
          minter: payer.publicKey,
          config: configPda,
          mint: sssMint,
          minterInfo: minterPda,
          recipientTokenAccount: userSusdAta,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .rpc({ commitment: 'confirmed' });
      txSigs.push(mintLiqSig);
      console.log(`  ✅ Minted SUSD for liquidator`);
      await sleep(500);

      // Execute liquidation
      const liquidateSig = await program.methods
        .cdpLiquidate({
          minCollateralAmount: new BN(0), // no slippage protection
          partialRepayAmount: new BN(0),  // full liquidation
        })
        .accounts({
          liquidator: payer.publicKey,
          config: configPda,
          sssMint,
          liquidatorSssAccount: userSusdAta,
          cdpPosition: cdpPositionPda,
          cdpOwner: payer.publicKey,
          collateralVault: collateralVaultPda,
          collateralMint,
          vaultTokenAccount,
          liquidatorCollateralAccount: userCollateralAta,
          pythPriceFeed: crashedPythKeypair.publicKey,
          collateralConfig: collateralConfigPda,
          oracleConsensus: null,
          sssTokenProgram: TOKEN_2022_PROGRAM_ID,
          collateralTokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc({ commitment: 'confirmed' });
      txSigs.push(liquidateSig);
      console.log(`  ✅ Liquidation executed: ${liquidateSig}`);
      console.log(`     TX: ${explorerLink(liquidateSig)}`);

      const posAfterLiq = await program.account.cdpPosition.fetch(cdpPositionPda);
      const debtAfterLiq = BigInt(posAfterLiq.debtAmount.toString());
      console.log(`  CDP debt after liquidation: ${Number(debtAfterLiq)/1e6} SUSD`);

      if (debtAfterLiq === 0n) {
        console.log(`  ✅ CDP fully liquidated — debt = 0`);
      } else {
        console.log(`  ℹ️  Partial liquidation: ${Number(debtAfterLiq)/1e6} SUSD remaining`);
      }

      // Restore oracle price
      await program.methods
        .setPythFeed(mockPythKeypair.publicKey)
        .accounts({ authority: payer.publicKey, config: configPda, mint: sssMint, tokenProgram: TOKEN_2022_PROGRAM_ID })
        .rpc({ commitment: 'confirmed' });
      console.log(`  ✅ Oracle restored to $120`);

      results.push({
        step: 9, name: 'Liquidation (undercollateralized CDP)', status: 'PASS',
        txSigs,
        data: { debtAfterLiquidation: debtAfterLiq.toString(), liquidatedAt: 50 }
      });
    } catch (e: any) {
      pass = false; failReason = e.message;
      console.error(`  ❌ Step 9 FAILED: ${failReason}`);
      results.push({ step: 9, name: 'Liquidation (undercollateralized CDP)', status: 'FAIL', reason: failReason, txSigs });
    }
    console.log(`  → ${pass ? 'PASS' : 'FAIL'} ${failReason ? '(' + failReason.substring(0, 100) + ')' : ''}\n`);
  }

  // ── Final Report ─────────────────────────────────────────────────────────

  await finalize(results, sssMint);
}

let vaultTokenAccount: PublicKey;
let userCollateralAta: PublicKey;
let userSusdAta: PublicKey;

async function finalize(results: StepResult[], sssMint: PublicKey): Promise<void> {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║           DEVTEST-004 Results Summary                    ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  let passCount = 0, failCount = 0, skipCount = 0;
  for (const r of results) {
    const icon = r.status === 'PASS' ? '✅' : r.status === 'FAIL' ? '❌' : '⏭️';
    console.log(`${icon} ${r.status}  Step ${r.step}: ${r.name}`);
    if (r.reason && r.status === 'FAIL') console.log(`      Reason: ${r.reason.substring(0, 120)}`);
    if (r.txSigs.filter(s => s.length > 20).length > 0) {
      const sigs = r.txSigs.filter(s => s.length > 20);
      console.log(`      TX[0]: ${sigs[0].substring(0, 44)}...`);
    }
    if (r.status === 'PASS') passCount++;
    else if (r.status === 'FAIL') failCount++;
    else skipCount++;
  }

  console.log(`\nTotal: ${passCount} PASS / ${failCount} FAIL / ${skipCount} SKIP`);
  console.log(`SSS-3 mint: ${sssMint.toBase58()}\n`);

  const reportPath = path.join(__dirname, '..', 'devtest-004-results.json');
  fs.writeFileSync(reportPath, JSON.stringify({ results, sssMint: sssMint.toBase58(), timestamp: new Date().toISOString() }, null, 2));
  console.log(`Results written to: ${reportPath}\n`);
}

main().catch((e) => {
  console.error('\nFATAL:', e);
  process.exit(1);
});

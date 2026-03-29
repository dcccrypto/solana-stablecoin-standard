import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PublicKey } from '@solana/web3.js';
import {
  SpendPolicyModule,
  FLAG_SPEND_POLICY,
  type SpendPolicyParams,
  type ClearSpendLimitParams,
} from './SpendPolicyModule';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const PROGRAM_ID = new PublicKey('2haUR6bUPcWXkCG9bZCPvVJYvtkGRDHnLtX1X1j9zbUY');
const ADMIN      = new PublicKey('J8yr2kdmy9FLLJqtar3msUW214GRdvJymJ6uFdJtjkQS');
const MINT       = new PublicKey('8SDDdSsYRrHRZknJ9Ep358R4zDWMLpwQzmtDwNvrpkge');
const MINT_B     = new PublicKey('95yogXJdMH6TtZwD4WazNjXB3rFe9MsN4X7V2hLsUG3p');

// ─── Mock helpers ─────────────────────────────────────────────────────────────

function makeMockProvider(accountData: Buffer | null = null) {
  return {
    wallet: { publicKey: ADMIN },
    connection: {
      getAccountInfo: vi.fn().mockResolvedValue(
        accountData ? { data: accountData } : null
      ),
    },
  } as any;
}

function makeMockProgram(txSig = 'tx-sig-mock') {
  const rpc = vi.fn().mockResolvedValue(txSig);
  const accounts = vi.fn().mockReturnThis();
  const methodsChain = { accounts, rpc } as any;

  return {
    methods: new Proxy(
      {},
      { get: () => () => methodsChain }
    ),
  } as any;
}

/**
 * Build a StablecoinConfig buffer with feature_flags + max_transfer_amount.
 *
 * Layout:
 * [0..8]    discriminator
 * [8..168]  5 × Pubkey (zero-filled)
 * [168..169] preset (u8)
 * [169..177] feature_flags (u64 LE)
 * [177..185] max_transfer_amount (u64 LE)
 */
function buildConfigData(featureFlags: bigint, maxTransferAmount: bigint = 0n): Buffer {
  const buf = Buffer.alloc(200, 0);
  buf.writeBigUInt64LE(featureFlags, 169);
  buf.writeBigUInt64LE(maxTransferAmount, 177);
  return buf;
}

// ─── FLAG_SPEND_POLICY constant ───────────────────────────────────────────────

describe('FLAG_SPEND_POLICY', () => {
  it('equals 2n (bit 1)', () => {
    expect(FLAG_SPEND_POLICY).toBe(2n);
  });

  it('equals 1n << 1n', () => {
    expect(FLAG_SPEND_POLICY).toBe(1n << 1n);
  });

  it('does not overlap with FLAG_CIRCUIT_BREAKER_V2 (bit 0)', () => {
    expect(FLAG_SPEND_POLICY & (1n << 0n)).toBe(0n);
  });

  it('does not overlap with FLAG_DAO_COMMITTEE (bit 2)', () => {
    expect(FLAG_SPEND_POLICY & (1n << 2n)).toBe(0n);
  });

  it('does not overlap with FLAG_YIELD_COLLATERAL (bit 3)', () => {
    expect(FLAG_SPEND_POLICY & (1n << 3n)).toBe(0n);
  });

  it('does not overlap with FLAG_ZK_COMPLIANCE (bit 4)', () => {
    expect(FLAG_SPEND_POLICY & (1n << 4n)).toBe(0n);
  });
});

// ─── getConfigPda ──────────────────────────────────────────────────────────────

describe('SpendPolicyModule.getConfigPda', () => {
  let sp: SpendPolicyModule;

  beforeEach(() => {
    sp = new SpendPolicyModule(makeMockProvider(), PROGRAM_ID);
  });

  it('returns a tuple of [PublicKey, number]', () => {
    const [pda, bump] = sp.getConfigPda(MINT);
    expect(pda).toBeInstanceOf(PublicKey);
    expect(typeof bump).toBe('number');
  });

  it('is deterministic — same mint yields same PDA', () => {
    const [pda1] = sp.getConfigPda(MINT);
    const [pda2] = sp.getConfigPda(MINT);
    expect(pda1.equals(pda2)).toBe(true);
  });

  it('produces different PDAs for different mints', () => {
    const [pda1] = sp.getConfigPda(MINT);
    const [pda2] = sp.getConfigPda(MINT_B);
    expect(pda1.equals(pda2)).toBe(false);
  });

  it('uses the provided programId for derivation', () => {
    const OTHER_PROG = new PublicKey('C6wNtHat7AzUSxTkKhqz9CsvJ5sK9PnwKKbwsgjhHRHd');
    const [pda1] = sp.getConfigPda(MINT);
    const sp2 = new SpendPolicyModule(makeMockProvider(), OTHER_PROG);
    const [pda2] = sp2.getConfigPda(MINT);
    expect(pda1.equals(pda2)).toBe(false);
  });
});

// ─── setSpendLimit ────────────────────────────────────────────────────────────

describe('SpendPolicyModule.setSpendLimit', () => {
  let sp: SpendPolicyModule;
  let mockProgram: any;

  beforeEach(() => {
    sp = new SpendPolicyModule(makeMockProvider(), PROGRAM_ID);
    mockProgram = makeMockProgram('set-limit-sig');
    (sp as any)._program = mockProgram;
  });

  it('returns a transaction signature string', async () => {
    const sig = await sp.setSpendLimit({ mint: MINT, maxAmount: 1_000_000n });
    expect(sig).toBe('set-limit-sig');
  });

  it('calls rpc with confirmed commitment', async () => {
    await sp.setSpendLimit({ mint: MINT, maxAmount: 500_000n });
    expect(mockProgram.methods.setSpendLimit().accounts().rpc).toHaveBeenCalledWith(
      { commitment: 'confirmed' }
    );
  });

  it('calls accounts() with authority, config, mint', async () => {
    await sp.setSpendLimit({ mint: MINT, maxAmount: 500_000n });
    const [configPda] = sp.getConfigPda(MINT);
    expect(mockProgram.methods.setSpendLimit().accounts).toHaveBeenCalledWith({
      authority: ADMIN,
      config: configPda,
      mint: MINT,
    });
  });
});

// ─── clearSpendLimit ──────────────────────────────────────────────────────────

describe('SpendPolicyModule.clearSpendLimit', () => {
  let sp: SpendPolicyModule;
  let mockProgram: any;

  beforeEach(() => {
    sp = new SpendPolicyModule(makeMockProvider(), PROGRAM_ID);
    mockProgram = makeMockProgram('clear-limit-sig');
    (sp as any)._program = mockProgram;
  });

  it('returns a transaction signature string', async () => {
    const sig = await sp.clearSpendLimit({ mint: MINT });
    expect(sig).toBe('clear-limit-sig');
  });

  it('calls rpc with confirmed commitment', async () => {
    await sp.clearSpendLimit({ mint: MINT });
    expect(mockProgram.methods.clearSpendLimit().accounts().rpc).toHaveBeenCalledWith(
      { commitment: 'confirmed' }
    );
  });

  it('calls accounts() with authority, config, mint', async () => {
    await sp.clearSpendLimit({ mint: MINT });
    const [configPda] = sp.getConfigPda(MINT);
    expect(mockProgram.methods.clearSpendLimit().accounts).toHaveBeenCalledWith({
      authority: ADMIN,
      config: configPda,
      mint: MINT,
    });
  });
});

// ─── isActive ─────────────────────────────────────────────────────────────────

describe('SpendPolicyModule.isActive', () => {
  it('returns false when account does not exist', async () => {
    const sp = new SpendPolicyModule(makeMockProvider(null), PROGRAM_ID);
    expect(await sp.isActive(MINT)).toBe(false);
  });

  it('returns true when FLAG_SPEND_POLICY (bit 1) is set', async () => {
    const data = buildConfigData(FLAG_SPEND_POLICY);
    const sp = new SpendPolicyModule(makeMockProvider(data), PROGRAM_ID);
    expect(await sp.isActive(MINT)).toBe(true);
  });

  it('returns false when FLAG_SPEND_POLICY is not set', async () => {
    const data = buildConfigData(1n << 0n); // only circuit breaker
    const sp = new SpendPolicyModule(makeMockProvider(data), PROGRAM_ID);
    expect(await sp.isActive(MINT)).toBe(false);
  });

  it('returns true when multiple flags are set including bit 1', async () => {
    const flags = (1n << 1n) | (1n << 3n); // spend policy + yield collateral
    const data = buildConfigData(flags);
    const sp = new SpendPolicyModule(makeMockProvider(data), PROGRAM_ID);
    expect(await sp.isActive(MINT)).toBe(true);
  });

  it('returns false when account data is too short', async () => {
    const shortData = Buffer.alloc(10, 0);
    const sp = new SpendPolicyModule(makeMockProvider(shortData), PROGRAM_ID);
    expect(await sp.isActive(MINT)).toBe(false);
  });
});

// ─── getMaxTransferAmount ─────────────────────────────────────────────────────

describe('SpendPolicyModule.getMaxTransferAmount', () => {
  it('returns 0n when account does not exist', async () => {
    const sp = new SpendPolicyModule(makeMockProvider(null), PROGRAM_ID);
    expect(await sp.getMaxTransferAmount(MINT)).toBe(0n);
  });

  it('returns 0n when max_transfer_amount is 0', async () => {
    const data = buildConfigData(FLAG_SPEND_POLICY, 0n);
    const sp = new SpendPolicyModule(makeMockProvider(data), PROGRAM_ID);
    expect(await sp.getMaxTransferAmount(MINT)).toBe(0n);
  });

  it('returns the correct max_transfer_amount', async () => {
    const data = buildConfigData(FLAG_SPEND_POLICY, 1_000_000n);
    const sp = new SpendPolicyModule(makeMockProvider(data), PROGRAM_ID);
    expect(await sp.getMaxTransferAmount(MINT)).toBe(1_000_000n);
  });

  it('returns large values correctly (u64 max)', async () => {
    const maxU64 = 18_446_744_073_709_551_615n;
    const data = buildConfigData(FLAG_SPEND_POLICY, maxU64);
    const sp = new SpendPolicyModule(makeMockProvider(data), PROGRAM_ID);
    expect(await sp.getMaxTransferAmount(MINT)).toBe(maxU64);
  });

  it('returns 0n when account data is too short to include max_transfer_amount', async () => {
    const shortData = Buffer.alloc(180, 0); // only up to offset 180, needs 185
    const sp = new SpendPolicyModule(makeMockProvider(shortData), PROGRAM_ID);
    // offset 177 + 8 = 185 > 180 → returns 0n
    expect(await sp.getMaxTransferAmount(MINT)).toBe(0n);
  });
});

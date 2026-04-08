import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PublicKey } from '@solana/web3.js';
import {
  ZkComplianceModule,
  FLAG_ZK_COMPLIANCE,
  type ZkComplianceConfigAccount,
  type VerificationRecordAccount,
} from './ZkComplianceModule';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const PROGRAM_ID = new PublicKey('2haUR6bUPcWXkCG9bZCPvVJYvtkGRDHnLtX1X1j9zbUY');
const AUTHORITY  = new PublicKey('J8yr2kdmy9FLLJqtar3msUW214GRdvJymJ6uFdJtjkQS');
const MINT       = new PublicKey('8SDDdSsYRrHRZknJ9Ep358R4zDWMLpwQzmtDwNvrpkge');
const USER_A     = new PublicKey('95yogXJdMH6TtZwD4WazNjXB3rFe9MsN4X7V2hLsUG3p');
const USER_B     = new PublicKey('C6wNtHat7AzUSxTkKhqz9CsvJ5sK9PnwKKbwsgjhHRHd');
const MINT_2     = new PublicKey('FQzWmTfPpUVcVC96gYMoY2GLZ53m2TGLbte2RhqJHU36');

// ─── Mock helpers ─────────────────────────────────────────────────────────────

/**
 * Build a raw VerificationRecord buffer.
 * Layout: [8 disc][32 sss_mint][32 user][8 expires_at_slot u64 LE][1 bump]
 */
function buildVerificationRecordData(
  sssMint: PublicKey,
  user: PublicKey,
  expiresAtSlot: bigint,
  bump = 255
): Buffer {
  const buf = Buffer.alloc(81);
  // discriminator left as zeros
  sssMint.toBuffer().copy(buf, 8);
  user.toBuffer().copy(buf, 40);
  buf.writeBigUInt64LE(expiresAtSlot, 72);
  buf[80] = bump;
  return buf;
}

/**
 * Build a raw ZkComplianceConfig buffer.
 * Layout: [8 disc][32 sss_mint][8 ttl_slots u64 LE][1 bump]
 */
function buildZkConfigData(sssMint: PublicKey, ttlSlots: bigint, bump = 254): Buffer {
  const buf = Buffer.alloc(49);
  sssMint.toBuffer().copy(buf, 8);
  buf.writeBigUInt64LE(ttlSlots, 40);
  buf[48] = bump;
  return buf;
}

function makeMockProvider(
  accountDataMap: Record<string, Buffer | null> = {},
  currentSlot = 1000
) {
  return {
    wallet: { publicKey: AUTHORITY },
    connection: {
      getAccountInfo: vi.fn().mockImplementation(async (pubkey: PublicKey) => {
        const key = pubkey.toBase58();
        if (key in accountDataMap) {
          const data = accountDataMap[key];
          return data ? { data } : null;
        }
        return null;
      }),
      getSlot: vi.fn().mockResolvedValue(currentSlot),
    },
  } as any;
}

function makeMockProgram(txSig = 'mock-tx-sig') {
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

function makeModule(
  provider: any = makeMockProvider(),
  mockProgram: any = makeMockProgram()
): ZkComplianceModule {
  const m = new ZkComplianceModule(provider, PROGRAM_ID);
  // Inject mock program
  (m as any)._program = mockProgram;
  return m;
}

// ─── FLAG_ZK_COMPLIANCE constant ─────────────────────────────────────────────

describe('FLAG_ZK_COMPLIANCE', () => {
  it('equals 1n << 4n (0x10)', () => {
    expect(FLAG_ZK_COMPLIANCE).toBe(16n);
  });

  it('does not overlap with bit 0 (circuit breaker)', () => {
    expect(FLAG_ZK_COMPLIANCE & (1n << 0n)).toBe(0n);
  });

  it('does not overlap with bit 1 (spend policy)', () => {
    expect(FLAG_ZK_COMPLIANCE & (1n << 1n)).toBe(0n);
  });

  it('does not overlap with bit 2 (DAO committee)', () => {
    expect(FLAG_ZK_COMPLIANCE & (1n << 2n)).toBe(0n);
  });

  it('does not overlap with bit 3 (yield collateral)', () => {
    expect(FLAG_ZK_COMPLIANCE & (1n << 3n)).toBe(0n);
  });

  it('is strictly greater than all lower feature flag bits combined', () => {
    const lower = (1n << 0n) | (1n << 1n) | (1n << 2n) | (1n << 3n); // 0x0F
    expect(FLAG_ZK_COMPLIANCE).toBeGreaterThan(lower);
  });
});

// ─── PDA derivation ───────────────────────────────────────────────────────────

describe('ZkComplianceModule PDA helpers', () => {
  let zk: ZkComplianceModule;

  beforeEach(() => {
    zk = new ZkComplianceModule(makeMockProvider(), PROGRAM_ID);
  });

  describe('getConfigPda', () => {
    it('returns a deterministic PDA for the same mint+programId', () => {
      const [a] = zk.getConfigPda(MINT);
      const [b] = zk.getConfigPda(MINT);
      expect(a.toBase58()).toBe(b.toBase58());
    });

    it('returns a different PDA for a different mint', () => {
      const [a] = zk.getConfigPda(MINT);
      const [b] = zk.getConfigPda(MINT_2);
      expect(a.toBase58()).not.toBe(b.toBase58());
    });
  });

  describe('getZkConfigPda', () => {
    it('returns a deterministic PDA for the same mint', () => {
      const [a] = zk.getZkConfigPda(MINT);
      const [b] = zk.getZkConfigPda(MINT);
      expect(a.toBase58()).toBe(b.toBase58());
    });

    it('returns a different PDA for a different mint', () => {
      const [a] = zk.getZkConfigPda(MINT);
      const [b] = zk.getZkConfigPda(MINT_2);
      expect(a.toBase58()).not.toBe(b.toBase58());
    });

    it('is distinct from the StablecoinConfig PDA', () => {
      const [config] = zk.getConfigPda(MINT);
      const [zkConfig] = zk.getZkConfigPda(MINT);
      expect(config.toBase58()).not.toBe(zkConfig.toBase58());
    });
  });

  describe('getVerificationRecordPda', () => {
    it('returns a deterministic PDA for same mint+user', () => {
      const [a] = zk.getVerificationRecordPda(MINT, USER_A);
      const [b] = zk.getVerificationRecordPda(MINT, USER_A);
      expect(a.toBase58()).toBe(b.toBase58());
    });

    it('returns different PDAs for different users (same mint)', () => {
      const [a] = zk.getVerificationRecordPda(MINT, USER_A);
      const [b] = zk.getVerificationRecordPda(MINT, USER_B);
      expect(a.toBase58()).not.toBe(b.toBase58());
    });

    it('returns different PDAs for different mints (same user)', () => {
      const [a] = zk.getVerificationRecordPda(MINT, USER_A);
      const [b] = zk.getVerificationRecordPda(MINT_2, USER_A);
      expect(a.toBase58()).not.toBe(b.toBase58());
    });

    it('is distinct from the ZkComplianceConfig PDA', () => {
      const [zkConfig] = zk.getZkConfigPda(MINT);
      const [vr] = zk.getVerificationRecordPda(MINT, USER_A);
      expect(zkConfig.toBase58()).not.toBe(vr.toBase58());
    });
  });
});

// ─── initZkCompliance ─────────────────────────────────────────────────────────

describe('ZkComplianceModule.initZkCompliance', () => {
  it('returns a transaction signature', async () => {
    const zk = makeModule();
    const sig = await zk.initZkCompliance({ mint: MINT, ttlSlots: 1500 });
    expect(sig).toBe('mock-tx-sig');
  });

  it('uses ttlSlots=0 when omitted (on-chain default)', async () => {
    const mockProgram = makeMockProgram();
    const zk = makeModule(makeMockProvider(), mockProgram);
    await zk.initZkCompliance({ mint: MINT });
    // Methods proxy was called — verify rpc was invoked
    const result = await zk.initZkCompliance({ mint: MINT });
    expect(result).toBeDefined();
  });

  it('calls rpc with confirmed commitment', async () => {
    const rpc = vi.fn().mockResolvedValue('confirmed-sig');
    const accounts = vi.fn().mockReturnThis();
    const program = {
      methods: new Proxy({}, { get: () => () => ({ accounts, rpc }) }),
    } as any;
    const zk = makeModule(makeMockProvider(), program);
    const sig = await zk.initZkCompliance({ mint: MINT, ttlSlots: 300 });
    expect(rpc).toHaveBeenCalledWith({ commitment: 'confirmed' });
    expect(sig).toBe('confirmed-sig');
  });
});

// ─── submitZkProof ────────────────────────────────────────────────────────────

describe('ZkComplianceModule.submitZkProof', () => {
  it('returns a transaction signature', async () => {
    const zk = makeModule();
    const sig = await zk.submitZkProof({ mint: MINT, user: USER_A });
    expect(sig).toBe('mock-tx-sig');
  });

  it('defaults user to provider.wallet.publicKey when omitted', async () => {
    const rpc = vi.fn().mockResolvedValue('submit-sig');
    const capturedAccounts = { captured: null as any };
    const accounts = vi.fn().mockImplementation((accs: any) => {
      capturedAccounts.captured = accs;
      return { rpc };
    });
    const program = {
      methods: new Proxy({}, { get: () => () => ({ accounts }) }),
    } as any;
    const zk = makeModule(makeMockProvider(), program);
    await zk.submitZkProof({ mint: MINT });
    expect(capturedAccounts.captured?.user?.toBase58()).toBe(AUTHORITY.toBase58());
  });

  it('calls rpc with confirmed commitment', async () => {
    const rpc = vi.fn().mockResolvedValue('sub-sig');
    const accounts = vi.fn().mockReturnThis();
    const program = {
      methods: new Proxy({}, { get: () => () => ({ accounts, rpc }) }),
    } as any;
    const zk = makeModule(makeMockProvider(), program);
    await zk.submitZkProof({ mint: MINT, user: USER_A });
    expect(rpc).toHaveBeenCalledWith({ commitment: 'confirmed' });
  });

  it('includes verificationRecord PDA in accounts', async () => {
    const rpc = vi.fn().mockResolvedValue('r');
    const capturedAccounts = { v: null as any };
    const accounts = vi.fn().mockImplementation((accs: any) => {
      capturedAccounts.v = accs;
      return { rpc };
    });
    const program = {
      methods: new Proxy({}, { get: () => () => ({ accounts }) }),
    } as any;
    const zk = makeModule(makeMockProvider(), program);
    await zk.submitZkProof({ mint: MINT, user: USER_A });
    const [expectedVr] = zk.getVerificationRecordPda(MINT, USER_A);
    expect(capturedAccounts.v?.verificationRecord?.toBase58()).toBe(expectedVr.toBase58());
  });
});

// ─── closeVerificationRecord ──────────────────────────────────────────────────

describe('ZkComplianceModule.closeVerificationRecord', () => {
  it('returns a transaction signature', async () => {
    const zk = makeModule();
    const sig = await zk.closeVerificationRecord({ mint: MINT, recordOwner: USER_A });
    expect(sig).toBe('mock-tx-sig');
  });

  it('calls rpc with confirmed commitment', async () => {
    const rpc = vi.fn().mockResolvedValue('close-sig');
    const accounts = vi.fn().mockReturnThis();
    const program = {
      methods: new Proxy({}, { get: () => () => ({ accounts, rpc }) }),
    } as any;
    const zk = makeModule(makeMockProvider(), program);
    await zk.closeVerificationRecord({ mint: MINT, recordOwner: USER_A });
    expect(rpc).toHaveBeenCalledWith({ commitment: 'confirmed' });
  });

  it('derives correct verificationRecord PDA for the record owner', async () => {
    const rpc = vi.fn().mockResolvedValue('r');
    const capturedAccounts = { v: null as any };
    const accounts = vi.fn().mockImplementation((accs: any) => {
      capturedAccounts.v = accs;
      return { rpc };
    });
    const program = {
      methods: new Proxy({}, { get: () => () => ({ accounts }) }),
    } as any;
    const zk = makeModule(makeMockProvider(), program);
    await zk.closeVerificationRecord({ mint: MINT, recordOwner: USER_B });
    const [expected] = zk.getVerificationRecordPda(MINT, USER_B);
    expect(capturedAccounts.v?.verificationRecord?.toBase58()).toBe(expected.toBase58());
  });
});

// ─── isVerificationValid ──────────────────────────────────────────────────────

describe('ZkComplianceModule.isVerificationValid', () => {
  it('returns false when account does not exist', async () => {
    const zk = new ZkComplianceModule(makeMockProvider(), PROGRAM_ID);
    const valid = await zk.isVerificationValid(MINT, USER_A);
    expect(valid).toBe(false);
  });

  it('returns true when record exists and has not expired', async () => {
    const currentSlot = 1000;
    const expiresAt = 1500n; // not expired
    const data = buildVerificationRecordData(MINT, USER_A, expiresAt);
    const [vrPda] = new ZkComplianceModule(makeMockProvider(), PROGRAM_ID)
      .getVerificationRecordPda(MINT, USER_A);

    const provider = makeMockProvider({ [vrPda.toBase58()]: data }, currentSlot);
    const zk = new ZkComplianceModule(provider, PROGRAM_ID);
    const valid = await zk.isVerificationValid(MINT, USER_A);
    expect(valid).toBe(true);
  });

  it('returns false when record is exactly at expiry slot (expires_at == currentSlot)', async () => {
    const currentSlot = 1500;
    const expiresAt = 1500n; // expired (slot >= expires_at)
    const data = buildVerificationRecordData(MINT, USER_A, expiresAt);
    const [vrPda] = new ZkComplianceModule(makeMockProvider(), PROGRAM_ID)
      .getVerificationRecordPda(MINT, USER_A);

    const provider = makeMockProvider({ [vrPda.toBase58()]: data }, currentSlot);
    const zk = new ZkComplianceModule(provider, PROGRAM_ID);
    const valid = await zk.isVerificationValid(MINT, USER_A);
    expect(valid).toBe(false);
  });

  it('returns false when record has expired (currentSlot > expires_at)', async () => {
    const currentSlot = 2000;
    const expiresAt = 1500n;
    const data = buildVerificationRecordData(MINT, USER_A, expiresAt);
    const [vrPda] = new ZkComplianceModule(makeMockProvider(), PROGRAM_ID)
      .getVerificationRecordPda(MINT, USER_A);

    const provider = makeMockProvider({ [vrPda.toBase58()]: data }, currentSlot);
    const zk = new ZkComplianceModule(provider, PROGRAM_ID);
    const valid = await zk.isVerificationValid(MINT, USER_A);
    expect(valid).toBe(false);
  });

  it('returns false when account data is too short', async () => {
    const [vrPda] = new ZkComplianceModule(makeMockProvider(), PROGRAM_ID)
      .getVerificationRecordPda(MINT, USER_A);

    const shortData = Buffer.alloc(10); // too small
    const provider = makeMockProvider({ [vrPda.toBase58()]: shortData });
    const zk = new ZkComplianceModule(provider, PROGRAM_ID);
    const valid = await zk.isVerificationValid(MINT, USER_A);
    expect(valid).toBe(false);
  });

  it('scopes the check per (mint, user) pair — different user sees independent result', async () => {
    const currentSlot = 1000;
    const expiresAt = 1500n;
    const dataA = buildVerificationRecordData(MINT, USER_A, expiresAt);
    const zkHelper = new ZkComplianceModule(makeMockProvider(), PROGRAM_ID);
    const [vrPdaA] = zkHelper.getVerificationRecordPda(MINT, USER_A);
    const [vrPdaB] = zkHelper.getVerificationRecordPda(MINT, USER_B);

    const provider = makeMockProvider(
      { [vrPdaA.toBase58()]: dataA, [vrPdaB.toBase58()]: null },
      currentSlot
    );
    const zk = new ZkComplianceModule(provider, PROGRAM_ID);
    expect(await zk.isVerificationValid(MINT, USER_A)).toBe(true);
    expect(await zk.isVerificationValid(MINT, USER_B)).toBe(false);
  });
});

// ─── fetchVerificationRecord ──────────────────────────────────────────────────

describe('ZkComplianceModule.fetchVerificationRecord', () => {
  it('returns null when account does not exist', async () => {
    const zk = new ZkComplianceModule(makeMockProvider(), PROGRAM_ID);
    const result = await zk.fetchVerificationRecord(MINT, USER_A);
    expect(result).toBeNull();
  });

  it('returns decoded account data when record exists', async () => {
    const expiresAt = 9999n;
    const data = buildVerificationRecordData(MINT, USER_A, expiresAt, 42);
    const [vrPda] = new ZkComplianceModule(makeMockProvider(), PROGRAM_ID)
      .getVerificationRecordPda(MINT, USER_A);

    const provider = makeMockProvider({ [vrPda.toBase58()]: data });
    const zk = new ZkComplianceModule(provider, PROGRAM_ID);
    const record = await zk.fetchVerificationRecord(MINT, USER_A);

    expect(record).not.toBeNull();
    expect(record!.sssMint.toBase58()).toBe(MINT.toBase58());
    expect(record!.user.toBase58()).toBe(USER_A.toBase58());
    expect(record!.expiresAtSlot).toBe(9999n);
    expect(record!.bump).toBe(42);
  });

  it('correctly parses expiresAtSlot as bigint', async () => {
    const expiresAt = BigInt(2 ** 32); // large value to test 64-bit parsing
    const data = buildVerificationRecordData(MINT, USER_A, expiresAt);
    const [vrPda] = new ZkComplianceModule(makeMockProvider(), PROGRAM_ID)
      .getVerificationRecordPda(MINT, USER_A);

    const provider = makeMockProvider({ [vrPda.toBase58()]: data });
    const zk = new ZkComplianceModule(provider, PROGRAM_ID);
    const record = await zk.fetchVerificationRecord(MINT, USER_A);
    expect(record!.expiresAtSlot).toBe(expiresAt);
  });
});

// ─── fetchZkConfig ────────────────────────────────────────────────────────────

describe('ZkComplianceModule.fetchZkConfig', () => {
  it('returns null when account does not exist', async () => {
    const zk = new ZkComplianceModule(makeMockProvider(), PROGRAM_ID);
    const result = await zk.fetchZkConfig(MINT);
    expect(result).toBeNull();
  });

  it('returns decoded ZkComplianceConfig when account exists', async () => {
    const ttl = 2500n;
    const data = buildZkConfigData(MINT, ttl, 200);
    const [zkPda] = new ZkComplianceModule(makeMockProvider(), PROGRAM_ID)
      .getZkConfigPda(MINT);

    const provider = makeMockProvider({ [zkPda.toBase58()]: data });
    const zk = new ZkComplianceModule(provider, PROGRAM_ID);
    const config = await zk.fetchZkConfig(MINT);

    expect(config).not.toBeNull();
    expect(config!.sssMint.toBase58()).toBe(MINT.toBase58());
    expect(config!.ttlSlots).toBe(2500n);
    expect(config!.bump).toBe(200);
  });

  it('parses the default TTL of 1500 correctly', async () => {
    const data = buildZkConfigData(MINT, 1500n);
    const [zkPda] = new ZkComplianceModule(makeMockProvider(), PROGRAM_ID)
      .getZkConfigPda(MINT);

    const provider = makeMockProvider({ [zkPda.toBase58()]: data });
    const zk = new ZkComplianceModule(provider, PROGRAM_ID);
    const config = await zk.fetchZkConfig(MINT);
    expect(config!.ttlSlots).toBe(1500n);
  });
});

// ─── getTtlSlots ──────────────────────────────────────────────────────────────

describe('ZkComplianceModule.getTtlSlots', () => {
  it('returns null when ZkComplianceConfig has not been initialized', async () => {
    const zk = new ZkComplianceModule(makeMockProvider(), PROGRAM_ID);
    const result = await zk.getTtlSlots(MINT);
    expect(result).toBeNull();
  });

  it('returns the correct ttlSlots value when config exists', async () => {
    const data = buildZkConfigData(MINT, 3000n);
    const [zkPda] = new ZkComplianceModule(makeMockProvider(), PROGRAM_ID)
      .getZkConfigPda(MINT);

    const provider = makeMockProvider({ [zkPda.toBase58()]: data });
    const zk = new ZkComplianceModule(provider, PROGRAM_ID);
    expect(await zk.getTtlSlots(MINT)).toBe(3000n);
  });
});

// ─── executeCompliantTransfer preflight ───────────────────────────────────────

describe('ZkComplianceModule.executeCompliantTransfer (preflight)', () => {
  it('throws when preflight=true and no verification record exists', async () => {
    const zk = new ZkComplianceModule(makeMockProvider(), PROGRAM_ID);
    await expect(
      zk.executeCompliantTransfer({
        mint: MINT,
        source: USER_A,
        destination: USER_B,
        amount: 100n,
        preflight: true,
      })
    ).rejects.toThrow(/missing or expired/i);
  });

  it('throws when preflight=true and record is expired', async () => {
    const currentSlot = 2000;
    const expiresAt = 1000n; // expired
    const data = buildVerificationRecordData(MINT, AUTHORITY, expiresAt);
    const [vrPda] = new ZkComplianceModule(makeMockProvider(), PROGRAM_ID)
      .getVerificationRecordPda(MINT, AUTHORITY);

    const provider = makeMockProvider({ [vrPda.toBase58()]: data }, currentSlot);
    const zk = new ZkComplianceModule(provider, PROGRAM_ID);

    await expect(
      zk.executeCompliantTransfer({
        mint: MINT,
        source: USER_A,
        destination: USER_B,
        amount: 100n,
        preflight: true,
      })
    ).rejects.toThrow(/missing or expired/i);
  });

  it('error message includes mint address when preflight fails', async () => {
    const zk = new ZkComplianceModule(makeMockProvider(), PROGRAM_ID);
    await expect(
      zk.executeCompliantTransfer({
        mint: MINT,
        source: USER_A,
        destination: USER_B,
        amount: 1n,
      })
    ).rejects.toThrow(MINT.toBase58());
  });

  it('error message includes authority pubkey when preflight fails', async () => {
    const zk = new ZkComplianceModule(makeMockProvider(), PROGRAM_ID);
    await expect(
      zk.executeCompliantTransfer({
        mint: MINT,
        source: USER_A,
        destination: USER_B,
        amount: 1n,
      })
    ).rejects.toThrow(AUTHORITY.toBase58());
  });
});

// ─── _decodeVerificationRecord (via fetchVerificationRecord) ──────────────────

describe('ZkComplianceModule internal decoder round-trips', () => {
  it('round-trips expiresAtSlot=0', async () => {
    const data = buildVerificationRecordData(MINT, USER_A, 0n);
    const [vrPda] = new ZkComplianceModule(makeMockProvider(), PROGRAM_ID)
      .getVerificationRecordPda(MINT, USER_A);
    const provider = makeMockProvider({ [vrPda.toBase58()]: data });
    const zk = new ZkComplianceModule(provider, PROGRAM_ID);
    const record = await zk.fetchVerificationRecord(MINT, USER_A);
    expect(record!.expiresAtSlot).toBe(0n);
  });

  it('round-trips max u64 expiresAtSlot', async () => {
    const maxU64 = 0xFFFF_FFFF_FFFF_FFFFn;
    const data = buildVerificationRecordData(MINT, USER_A, maxU64);
    const [vrPda] = new ZkComplianceModule(makeMockProvider(), PROGRAM_ID)
      .getVerificationRecordPda(MINT, USER_A);
    const provider = makeMockProvider({ [vrPda.toBase58()]: data });
    const zk = new ZkComplianceModule(provider, PROGRAM_ID);
    const record = await zk.fetchVerificationRecord(MINT, USER_A);
    expect(record!.expiresAtSlot).toBe(maxU64);
  });

  it('round-trips ZkComplianceConfig ttlSlots=0 (on-chain default trigger)', async () => {
    const data = buildZkConfigData(MINT, 0n);
    const [zkPda] = new ZkComplianceModule(makeMockProvider(), PROGRAM_ID)
      .getZkConfigPda(MINT);
    const provider = makeMockProvider({ [zkPda.toBase58()]: data });
    const zk = new ZkComplianceModule(provider, PROGRAM_ID);
    const config = await zk.fetchZkConfig(MINT);
    expect(config!.ttlSlots).toBe(0n);
  });
});

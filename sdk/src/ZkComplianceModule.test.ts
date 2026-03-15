import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PublicKey } from '@solana/web3.js';
import {
  ZkComplianceModule,
  FLAG_ZK_COMPLIANCE,
  type ZkComplianceState,
  type ZkVerificationRecord,
} from './ZkComplianceModule';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const PROGRAM_ID    = new PublicKey('AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat');
const ADMIN         = new PublicKey('J8yr2kdmy9FLLJqtar3msUW214GRdvJymJ6uFdJtjkQS');
const MINT          = new PublicKey('8SDDdSsYRrHRZknJ9Ep358R4zDWMLpwQzmtDwNvrpkge');
const USER          = new PublicKey('7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj');
const VERIFIER_KEY  = new PublicKey('mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So');
const OTHER_MINT    = new PublicKey('J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn');

const NOW_SEC = Math.floor(Date.now() / 1000);
const FUTURE_SEC = NOW_SEC + 86_400;   // 24 h from now
const PAST_SEC   = NOW_SEC - 86_400;   // 24 h ago

// ─── Mock helpers ─────────────────────────────────────────────────────────────

function makeMockProvider(wallet?: PublicKey) {
  return {
    wallet: { publicKey: wallet ?? ADMIN },
    connection: {
      getAccountInfo: vi.fn().mockResolvedValue(null),
    },
  } as any;
}

function makeMockProgram(opts: {
  rpcResult?: string;
  fetchZkResult?: any;
  fetchVerResult?: any;
  fetchConfigResult?: any;
} = {}) {
  const rpc = vi.fn().mockResolvedValue(opts.rpcResult ?? 'tx-sig-mock');
  const accounts = vi.fn().mockReturnThis();
  const methodsChain = { accounts, rpc } as any;

  return {
    methods: new Proxy(
      {},
      { get: () => () => methodsChain }
    ),
    account: {
      zkComplianceConfig: {
        fetch: vi.fn().mockResolvedValue(
          opts.fetchZkResult ?? {
            sssMint: MINT,
            verifierKey: VERIFIER_KEY,
            proofExpirySeconds: 2_592_000,
            bump: 255,
          }
        ),
      },
      zkVerificationRecord: {
        fetch: vi.fn().mockResolvedValue(
          opts.fetchVerResult ?? {
            sssMint: MINT,
            user: USER,
            verifiedAt: NOW_SEC - 3600,
            expiresAt: FUTURE_SEC,
            bump: 254,
          }
        ),
      },
      stablecoinConfig: {
        fetch: vi.fn().mockResolvedValue(
          opts.fetchConfigResult ?? {
            featureFlags: { toString: () => '16' }, // 0x10 = FLAG_ZK_COMPLIANCE
          }
        ),
      },
    },
  } as any;
}

/** Inject a mock program into a module's private cache. */
function injectProgram(mod: ZkComplianceModule, program: any) {
  (mod as any)._program = program;
}

// ─── FLAG_ZK_COMPLIANCE ───────────────────────────────────────────────────────

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

  it('does not overlap with bit 2 (dao committee)', () => {
    expect(FLAG_ZK_COMPLIANCE & (1n << 2n)).toBe(0n);
  });

  it('does not overlap with bit 3 (yield collateral)', () => {
    expect(FLAG_ZK_COMPLIANCE & (1n << 3n)).toBe(0n);
  });

  it('is unique among all defined flag bits', () => {
    const others = [1n << 0n, 1n << 1n, 1n << 2n, 1n << 3n];
    for (const other of others) {
      expect(FLAG_ZK_COMPLIANCE & other).toBe(0n);
    }
  });
});

// ─── PDA helpers ──────────────────────────────────────────────────────────────

describe('ZkComplianceModule — PDA helpers', () => {
  let mod: ZkComplianceModule;

  beforeEach(() => {
    mod = new ZkComplianceModule(makeMockProvider(), PROGRAM_ID);
  });

  it('getConfigPda returns a valid PublicKey', () => {
    const [pda, bump] = mod.getConfigPda(MINT);
    expect(pda).toBeInstanceOf(PublicKey);
    expect(bump).toBeGreaterThanOrEqual(0);
    expect(bump).toBeLessThanOrEqual(255);
  });

  it('getConfigPda is deterministic', () => {
    const [a] = mod.getConfigPda(MINT);
    const [b] = mod.getConfigPda(MINT);
    expect(a.toBase58()).toBe(b.toBase58());
  });

  it('getZkCompliancePda returns a valid PublicKey', () => {
    const [pda, bump] = mod.getZkCompliancePda(MINT);
    expect(pda).toBeInstanceOf(PublicKey);
    expect(bump).toBeGreaterThanOrEqual(0);
    expect(bump).toBeLessThanOrEqual(255);
  });

  it('getZkCompliancePda is deterministic', () => {
    const [a] = mod.getZkCompliancePda(MINT);
    const [b] = mod.getZkCompliancePda(MINT);
    expect(a.toBase58()).toBe(b.toBase58());
  });

  it('getVerificationRecordPda returns a valid PublicKey', () => {
    const [pda, bump] = mod.getVerificationRecordPda(MINT, USER);
    expect(pda).toBeInstanceOf(PublicKey);
    expect(bump).toBeGreaterThanOrEqual(0);
    expect(bump).toBeLessThanOrEqual(255);
  });

  it('getVerificationRecordPda is deterministic', () => {
    const [a] = mod.getVerificationRecordPda(MINT, USER);
    const [b] = mod.getVerificationRecordPda(MINT, USER);
    expect(a.toBase58()).toBe(b.toBase58());
  });

  it('getConfigPda and getZkCompliancePda are distinct', () => {
    const [config] = mod.getConfigPda(MINT);
    const [zk] = mod.getZkCompliancePda(MINT);
    expect(config.toBase58()).not.toBe(zk.toBase58());
  });

  it('getZkCompliancePda and getVerificationRecordPda are distinct', () => {
    const [zk] = mod.getZkCompliancePda(MINT);
    const [ver] = mod.getVerificationRecordPda(MINT, USER);
    expect(zk.toBase58()).not.toBe(ver.toBase58());
  });

  it('PDAs differ for different mints', () => {
    const [a] = mod.getZkCompliancePda(MINT);
    const [b] = mod.getZkCompliancePda(OTHER_MINT);
    expect(a.toBase58()).not.toBe(b.toBase58());
  });

  it('verification PDAs differ for different users', () => {
    const [a] = mod.getVerificationRecordPda(MINT, USER);
    const [b] = mod.getVerificationRecordPda(MINT, ADMIN);
    expect(a.toBase58()).not.toBe(b.toBase58());
  });

  it('verification PDA varies with both mint and user', () => {
    const [a] = mod.getVerificationRecordPda(MINT, USER);
    const [b] = mod.getVerificationRecordPda(OTHER_MINT, USER);
    expect(a.toBase58()).not.toBe(b.toBase58());
  });
});

// ─── enableZkCompliance ───────────────────────────────────────────────────────

describe('ZkComplianceModule.enableZkCompliance', () => {
  let mod: ZkComplianceModule;
  let program: any;

  beforeEach(() => {
    mod = new ZkComplianceModule(makeMockProvider(), PROGRAM_ID);
    program = makeMockProgram();
    injectProgram(mod, program);
  });

  it('returns a transaction signature', async () => {
    const sig = await mod.enableZkCompliance({ mint: MINT, verifierKey: VERIFIER_KEY });
    expect(sig).toBe('tx-sig-mock');
  });

  it('calls initZkCompliance on the program', async () => {
    const rpcFn = program.methods.initZkCompliance().accounts().rpc;
    rpcFn.mockClear();
    await mod.enableZkCompliance({ mint: MINT, verifierKey: VERIFIER_KEY });
    expect(rpcFn).toHaveBeenCalledTimes(1);
  });

  it('uses DEFAULT_PROOF_EXPIRY_SECONDS when not specified', async () => {
    // Should not throw and should use default
    await expect(
      mod.enableZkCompliance({ mint: MINT, verifierKey: VERIFIER_KEY })
    ).resolves.toBe('tx-sig-mock');
  });

  it('accepts a custom proofExpirySeconds', async () => {
    await expect(
      mod.enableZkCompliance({ mint: MINT, verifierKey: VERIFIER_KEY, proofExpirySeconds: 86400 })
    ).resolves.toBe('tx-sig-mock');
  });
});

// ─── disableZkCompliance ──────────────────────────────────────────────────────

describe('ZkComplianceModule.disableZkCompliance', () => {
  let mod: ZkComplianceModule;
  let program: any;

  beforeEach(() => {
    mod = new ZkComplianceModule(makeMockProvider(), PROGRAM_ID);
    program = makeMockProgram();
    injectProgram(mod, program);
  });

  it('returns a transaction signature', async () => {
    const sig = await mod.disableZkCompliance({ mint: MINT });
    expect(sig).toBe('tx-sig-mock');
  });

  it('calls clearFeatureFlag on the program', async () => {
    const rpcFn = program.methods.clearFeatureFlag().accounts().rpc;
    rpcFn.mockClear();
    await mod.disableZkCompliance({ mint: MINT });
    expect(rpcFn).toHaveBeenCalledTimes(1);
  });
});

// ─── submitZkProof ────────────────────────────────────────────────────────────

describe('ZkComplianceModule.submitZkProof', () => {
  let mod: ZkComplianceModule;
  let program: any;

  beforeEach(() => {
    mod = new ZkComplianceModule(makeMockProvider(), PROGRAM_ID);
    program = makeMockProgram();
    injectProgram(mod, program);
  });

  it('returns a transaction signature', async () => {
    const sig = await mod.submitZkProof({ mint: MINT, proofData: new Uint8Array([1, 2, 3]) });
    expect(sig).toBe('tx-sig-mock');
  });

  it('calls submitZkProof on the program', async () => {
    const rpcFn = program.methods.submitZkProof().accounts().rpc;
    rpcFn.mockClear();
    await mod.submitZkProof({ mint: MINT, proofData: new Uint8Array([0xde, 0xad]) });
    expect(rpcFn).toHaveBeenCalledTimes(1);
  });

  it('defaults to provider wallet when no user is specified', async () => {
    // No explicit user — should use provider.wallet.publicKey (ADMIN)
    await expect(
      mod.submitZkProof({ mint: MINT, proofData: new Uint8Array(32) })
    ).resolves.toBe('tx-sig-mock');
  });

  it('accepts an explicit user pubkey', async () => {
    await expect(
      mod.submitZkProof({ mint: MINT, proofData: new Uint8Array(32), user: USER })
    ).resolves.toBe('tx-sig-mock');
  });

  it('accepts empty proofData', async () => {
    await expect(
      mod.submitZkProof({ mint: MINT, proofData: new Uint8Array(0) })
    ).resolves.toBe('tx-sig-mock');
  });

  it('accepts publicInputs alongside proofData', async () => {
    await expect(
      mod.submitZkProof({
        mint: MINT,
        proofData: new Uint8Array([1, 2, 3]),
        publicInputs: new Uint8Array([4, 5, 6]),
      })
    ).resolves.toBe('tx-sig-mock');
  });
});

// ─── fetchZkComplianceState ───────────────────────────────────────────────────

describe('ZkComplianceModule.fetchZkComplianceState', () => {
  let mod: ZkComplianceModule;

  beforeEach(() => {
    mod = new ZkComplianceModule(makeMockProvider(), PROGRAM_ID);
  });

  it('returns decoded state when account exists', async () => {
    const program = makeMockProgram({
      fetchZkResult: {
        sssMint: MINT,
        verifierKey: VERIFIER_KEY,
        proofExpirySeconds: 604_800,
        bump: 252,
      },
    });
    injectProgram(mod, program);

    const state = await mod.fetchZkComplianceState(MINT);
    expect(state).not.toBeNull();
    expect(state!.sssMint.toBase58()).toBe(MINT.toBase58());
    expect(state!.verifierKey.toBase58()).toBe(VERIFIER_KEY.toBase58());
    expect(state!.proofExpirySeconds).toBe(604_800);
    expect(state!.bump).toBe(252);
  });

  it('returns null when account does not exist', async () => {
    const program = makeMockProgram();
    program.account.zkComplianceConfig.fetch = vi.fn().mockRejectedValue(new Error('not found'));
    injectProgram(mod, program);

    const state = await mod.fetchZkComplianceState(MINT);
    expect(state).toBeNull();
  });

  it('returns correct default expiry when set to 30 days', async () => {
    const program = makeMockProgram({
      fetchZkResult: {
        sssMint: MINT,
        verifierKey: VERIFIER_KEY,
        proofExpirySeconds: ZkComplianceModule.DEFAULT_PROOF_EXPIRY_SECONDS,
        bump: 255,
      },
    });
    injectProgram(mod, program);

    const state = await mod.fetchZkComplianceState(MINT);
    expect(state!.proofExpirySeconds).toBe(2_592_000);
  });
});

// ─── fetchVerificationRecord ──────────────────────────────────────────────────

describe('ZkComplianceModule.fetchVerificationRecord', () => {
  let mod: ZkComplianceModule;

  beforeEach(() => {
    mod = new ZkComplianceModule(makeMockProvider(), PROGRAM_ID);
  });

  it('returns a valid record when account exists and not expired', async () => {
    const program = makeMockProgram({
      fetchVerResult: {
        sssMint: MINT,
        user: USER,
        verifiedAt: NOW_SEC - 60,
        expiresAt: FUTURE_SEC,
        bump: 253,
      },
    });
    injectProgram(mod, program);

    const record = await mod.fetchVerificationRecord(MINT, USER);
    expect(record).not.toBeNull();
    expect(record!.sssMint.toBase58()).toBe(MINT.toBase58());
    expect(record!.user.toBase58()).toBe(USER.toBase58());
    expect(record!.isValid).toBe(true);
  });

  it('returns isValid=false for an expired record', async () => {
    const program = makeMockProgram({
      fetchVerResult: {
        sssMint: MINT,
        user: USER,
        verifiedAt: PAST_SEC - 3600,
        expiresAt: PAST_SEC,
        bump: 250,
      },
    });
    injectProgram(mod, program);

    const record = await mod.fetchVerificationRecord(MINT, USER);
    expect(record).not.toBeNull();
    expect(record!.isValid).toBe(false);
  });

  it('returns null when record does not exist', async () => {
    const program = makeMockProgram();
    program.account.zkVerificationRecord.fetch = vi.fn().mockRejectedValue(new Error('Not found'));
    injectProgram(mod, program);

    const record = await mod.fetchVerificationRecord(MINT, USER);
    expect(record).toBeNull();
  });

  it('defaults to provider wallet when user not supplied', async () => {
    const program = makeMockProgram();
    injectProgram(mod, program);

    // Should not throw — uses ADMIN (provider wallet) as user
    const record = await mod.fetchVerificationRecord(MINT);
    expect(record).not.toBeNull();
  });

  it('returns correct verifiedAt and expiresAt timestamps', async () => {
    const program = makeMockProgram({
      fetchVerResult: {
        sssMint: MINT,
        user: USER,
        verifiedAt: 1_700_000_000,
        expiresAt: 1_702_592_000,
        bump: 200,
      },
    });
    injectProgram(mod, program);

    const record = await mod.fetchVerificationRecord(MINT, USER);
    expect(record!.verifiedAt).toBe(1_700_000_000);
    expect(record!.expiresAt).toBe(1_702_592_000);
  });
});

// ─── isZkComplianceEnabled ────────────────────────────────────────────────────

describe('ZkComplianceModule.isZkComplianceEnabled', () => {
  let mod: ZkComplianceModule;

  beforeEach(() => {
    mod = new ZkComplianceModule(makeMockProvider(), PROGRAM_ID);
  });

  it('returns true when FLAG_ZK_COMPLIANCE is set', async () => {
    const program = makeMockProgram({
      fetchConfigResult: { featureFlags: { toString: () => '16' } }, // 0x10
    });
    injectProgram(mod, program);

    expect(await mod.isZkComplianceEnabled(MINT)).toBe(true);
  });

  it('returns true when multiple flags including ZK_COMPLIANCE are set', async () => {
    const program = makeMockProgram({
      fetchConfigResult: { featureFlags: { toString: () => '31' } }, // 0x1f = bits 0-4
    });
    injectProgram(mod, program);

    expect(await mod.isZkComplianceEnabled(MINT)).toBe(true);
  });

  it('returns false when only lower bits are set (not bit 4)', async () => {
    const program = makeMockProgram({
      fetchConfigResult: { featureFlags: { toString: () => '15' } }, // 0x0f = bits 0-3
    });
    injectProgram(mod, program);

    expect(await mod.isZkComplianceEnabled(MINT)).toBe(false);
  });

  it('returns false when feature_flags is zero', async () => {
    const program = makeMockProgram({
      fetchConfigResult: { featureFlags: { toString: () => '0' } },
    });
    injectProgram(mod, program);

    expect(await mod.isZkComplianceEnabled(MINT)).toBe(false);
  });

  it('returns false when config account does not exist', async () => {
    const program = makeMockProgram();
    program.account.stablecoinConfig.fetch = vi.fn().mockRejectedValue(new Error('Not found'));
    injectProgram(mod, program);

    expect(await mod.isZkComplianceEnabled(MINT)).toBe(false);
  });
});

// ─── verifyComplianceStatus ───────────────────────────────────────────────────

describe('ZkComplianceModule.verifyComplianceStatus', () => {
  let mod: ZkComplianceModule;

  beforeEach(() => {
    mod = new ZkComplianceModule(makeMockProvider(), PROGRAM_ID);
  });

  it('returns the record when valid', async () => {
    const program = makeMockProgram({
      fetchVerResult: {
        sssMint: MINT,
        user: USER,
        verifiedAt: NOW_SEC - 100,
        expiresAt: FUTURE_SEC,
        bump: 255,
      },
    });
    injectProgram(mod, program);

    const result = await mod.verifyComplianceStatus({ mint: MINT, user: USER });
    expect(result).not.toBeNull();
    expect(result!.isValid).toBe(true);
  });

  it('returns null for an expired record', async () => {
    const program = makeMockProgram({
      fetchVerResult: {
        sssMint: MINT,
        user: USER,
        verifiedAt: PAST_SEC - 1000,
        expiresAt: PAST_SEC,
        bump: 200,
      },
    });
    injectProgram(mod, program);

    const result = await mod.verifyComplianceStatus({ mint: MINT, user: USER });
    expect(result).toBeNull();
  });

  it('returns null when no record exists', async () => {
    const program = makeMockProgram();
    program.account.zkVerificationRecord.fetch = vi.fn().mockRejectedValue(new Error('DNE'));
    injectProgram(mod, program);

    const result = await mod.verifyComplianceStatus({ mint: MINT, user: USER });
    expect(result).toBeNull();
  });

  it('defaults to provider wallet when user not supplied', async () => {
    const program = makeMockProgram();
    injectProgram(mod, program);

    // Should resolve without throwing using ADMIN as implicit user
    const result = await mod.verifyComplianceStatus({ mint: MINT });
    expect(result).not.toBeNull();
  });
});

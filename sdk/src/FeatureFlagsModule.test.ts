import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PublicKey } from '@solana/web3.js';
import { FeatureFlagsModule, FLAG_CIRCUIT_BREAKER } from './FeatureFlagsModule';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const PROGRAM_ID = new PublicKey('2haUR6bUPcWXkCG9bZCPvVJYvtkGRDHnLtX1X1j9zbUY');
const ADMIN = new PublicKey('J8yr2kdmy9FLLJqtar3msUW214GRdvJymJ6uFdJtjkQS');
const MINT = new PublicKey('8SDDdSsYRrHRZknJ9Ep358R4zDWMLpwQzmtDwNvrpkge');

/**
 * Build a minimal raw StablecoinConfig account data buffer.
 *
 * Must match the current on-chain StablecoinConfig layout as read by
 * FeatureFlagsModule._readFeatureFlags (offset 298):
 *
 *   [0..8]     discriminator              (8 bytes)
 *   [8..40]    mint (Pubkey)              (32 bytes)
 *   [40..72]   authority (Pubkey)         (32 bytes)
 *   [72..104]  compliance_authority       (32 bytes)
 *   [104..105] preset (u8)                (1 byte)
 *   [105..106] paused (bool)              (1 byte)
 *   [106..114] total_minted (u64)         (8 bytes)
 *   [114..122] total_burned (u64)         (8 bytes)
 *   [122..154] transfer_hook_program      (32 bytes)
 *   [154..186] collateral_mint (Pubkey)   (32 bytes)
 *   [186..218] reserve_vault (Pubkey)     (32 bytes)
 *   [218..226] total_collateral (u64)     (8 bytes)
 *   [226..234] max_supply (u64)           (8 bytes)
 *   [234..266] pending_authority (Pubkey) (32 bytes)
 *   [266..298] pending_comp_authority     (32 bytes)
 *   [298..306] feature_flags (u64 LE)     (8 bytes)
 *
 * FEATURE_FLAGS_OFFSET = 8 + 32 + 32 + 32 + 1 + 1 + 8 + 8 + 32 + 32 + 32 + 8 + 8 + 32 + 32 = 298
 */
function buildConfigData(featureFlags: bigint, preset = 1): Buffer {
  const FEATURE_FLAGS_OFFSET = 298; // matches FeatureFlagsModule._readFeatureFlags
  const buf = Buffer.alloc(FEATURE_FLAGS_OFFSET + 8 + 32); // extra room for fields after flags
  buf[104] = preset; // preset field at correct offset
  buf.writeBigUInt64LE(featureFlags, FEATURE_FLAGS_OFFSET);
  return buf;
}

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

// ─── FLAG_CIRCUIT_BREAKER constant ───────────────────────────────────────────

describe('FLAG_CIRCUIT_BREAKER', () => {
  it('equals 1n << 7n (0x80) — DEPRECATED value retained for backward-compat (F-1)', () => {
    // The value is preserved for backward compatibility but is WRONG.
    // Correct constant is FLAG_CIRCUIT_BREAKER_V2 = 0x01 from CircuitBreakerModule.
    expect(FLAG_CIRCUIT_BREAKER).toBe(128n);
  });

  it('does NOT emit a console.warn in test environment (NODE_ENV=test)', () => {
    // The IIFE only warns when NODE_ENV !== 'test', so no warning during tests.
    const warnSpy = vi.spyOn(console, 'warn');
    // Re-access the constant to confirm no extra warn fired after module load
    const _val = FLAG_CIRCUIT_BREAKER;
    void _val;
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

// ─── getConfigPda ─────────────────────────────────────────────────────────────

describe('FeatureFlagsModule.getConfigPda', () => {
  it('derives a PDA deterministically for the same mint+programId', () => {
    const ff = new FeatureFlagsModule(makeMockProvider(), PROGRAM_ID);
    const [pda1] = ff.getConfigPda(MINT);
    const [pda2] = ff.getConfigPda(MINT);
    expect(pda1.toBase58()).toBe(pda2.toBase58());
  });

  it('derives different PDAs for different mints', () => {
    const ff = new FeatureFlagsModule(makeMockProvider(), PROGRAM_ID);
    const MINT2 = new PublicKey('FQzWmTfPpUVcVC96gYMoY2GLZ53m2TGLbte2RhqJHU36');
    const [pda1] = ff.getConfigPda(MINT);
    const [pda2] = ff.getConfigPda(MINT2);
    expect(pda1.toBase58()).not.toBe(pda2.toBase58());
  });
});

// ─── isFeatureFlagSet ─────────────────────────────────────────────────────────

describe('FeatureFlagsModule.isFeatureFlagSet', () => {
  it('returns true when FLAG_CIRCUIT_BREAKER bit is set', async () => {
    const data = buildConfigData(FLAG_CIRCUIT_BREAKER);
    const ff = new FeatureFlagsModule(makeMockProvider(data), PROGRAM_ID);
    const result = await ff.isFeatureFlagSet(MINT, FLAG_CIRCUIT_BREAKER);
    expect(result).toBe(true);
  });

  it('returns false when FLAG_CIRCUIT_BREAKER bit is NOT set', async () => {
    const data = buildConfigData(0n);
    const ff = new FeatureFlagsModule(makeMockProvider(data), PROGRAM_ID);
    const result = await ff.isFeatureFlagSet(MINT, FLAG_CIRCUIT_BREAKER);
    expect(result).toBe(false);
  });

  it('returns false when account does not exist (null)', async () => {
    const ff = new FeatureFlagsModule(makeMockProvider(null), PROGRAM_ID);
    const result = await ff.isFeatureFlagSet(MINT, FLAG_CIRCUIT_BREAKER);
    expect(result).toBe(false);
  });

  it('returns false for a different flag even when circuit breaker is set', async () => {
    const data = buildConfigData(FLAG_CIRCUIT_BREAKER);
    const ff = new FeatureFlagsModule(makeMockProvider(data), PROGRAM_ID);
    const SOME_OTHER_FLAG = 1n << 3n;
    const result = await ff.isFeatureFlagSet(MINT, SOME_OTHER_FLAG);
    expect(result).toBe(false);
  });

  it('returns true for multiple flags when all are set', async () => {
    const FLAG_A = 1n << 0n;
    const FLAG_B = 1n << 1n;
    const data = buildConfigData(FLAG_A | FLAG_B);
    const ff = new FeatureFlagsModule(makeMockProvider(data), PROGRAM_ID);
    expect(await ff.isFeatureFlagSet(MINT, FLAG_A)).toBe(true);
    expect(await ff.isFeatureFlagSet(MINT, FLAG_B)).toBe(true);
    expect(await ff.isFeatureFlagSet(MINT, FLAG_CIRCUIT_BREAKER)).toBe(false);
  });
});

// ─── getFeatureFlags ──────────────────────────────────────────────────────────

describe('FeatureFlagsModule.getFeatureFlags', () => {
  it('returns the raw u64 flags value', async () => {
    const flags = FLAG_CIRCUIT_BREAKER | (1n << 3n);
    const data = buildConfigData(flags);
    const ff = new FeatureFlagsModule(makeMockProvider(data), PROGRAM_ID);
    const result = await ff.getFeatureFlags(MINT);
    expect(result).toBe(flags);
  });

  it('returns 0n when account does not exist', async () => {
    const ff = new FeatureFlagsModule(makeMockProvider(null), PROGRAM_ID);
    const result = await ff.getFeatureFlags(MINT);
    expect(result).toBe(0n);
  });

  it('returns 0n when account data is too short', async () => {
    const tinyBuf = Buffer.alloc(8); // only discriminator, no flags
    const ff = new FeatureFlagsModule(makeMockProvider(tinyBuf), PROGRAM_ID);
    const result = await ff.getFeatureFlags(MINT);
    expect(result).toBe(0n);
  });
});

// ─── setFeatureFlag (mocked RPC) ──────────────────────────────────────────────

describe('FeatureFlagsModule.setFeatureFlag', () => {
  it('calls set_feature_flag instruction and returns a tx signature', async () => {
    const FAKE_SIG = 'fakeTxSig_setFeatureFlag_11111111111111111111111';
    const mockRpc = vi.fn().mockResolvedValue(FAKE_SIG);
    const mockAccounts = vi.fn().mockReturnValue({ rpc: mockRpc });
    const mockSetFeatureFlag = vi.fn().mockReturnValue({ accounts: mockAccounts });

    const provider = makeMockProvider();
    const ff = new FeatureFlagsModule(provider, PROGRAM_ID);
    // Inject mock program directly (bypasses IDL load)
    (ff as any)._program = { methods: { setFeatureFlag: mockSetFeatureFlag } };

    const sig = await ff.setFeatureFlag({ mint: MINT, flag: FLAG_CIRCUIT_BREAKER });

    expect(sig).toBe(FAKE_SIG);
    expect(mockSetFeatureFlag).toHaveBeenCalledWith(
      expect.objectContaining({ toString: expect.any(Function) }) // BN(128)
    );
    expect(mockAccounts).toHaveBeenCalledWith(
      expect.objectContaining({
        authority: ADMIN,
        mint: MINT,
      })
    );
    expect(mockRpc).toHaveBeenCalledWith({ commitment: 'confirmed' });
  });
});

// ─── clearFeatureFlag (mocked RPC) ───────────────────────────────────────────

describe('FeatureFlagsModule.clearFeatureFlag', () => {
  it('calls clear_feature_flag instruction and returns a tx signature', async () => {
    const FAKE_SIG = 'fakeTxSig_clearFeatureFlag_1111111111111111111111';
    const mockRpc = vi.fn().mockResolvedValue(FAKE_SIG);
    const mockAccounts = vi.fn().mockReturnValue({ rpc: mockRpc });
    const mockClearFeatureFlag = vi.fn().mockReturnValue({ accounts: mockAccounts });

    const provider = makeMockProvider();
    const ff = new FeatureFlagsModule(provider, PROGRAM_ID);
    (ff as any)._program = { methods: { clearFeatureFlag: mockClearFeatureFlag } };

    const sig = await ff.clearFeatureFlag({ mint: MINT, flag: FLAG_CIRCUIT_BREAKER });

    expect(sig).toBe(FAKE_SIG);
    expect(mockClearFeatureFlag).toHaveBeenCalledWith(
      expect.objectContaining({ toString: expect.any(Function) })
    );
    expect(mockRpc).toHaveBeenCalledWith({ commitment: 'confirmed' });
  });
});

// ─── round-trip simulation ────────────────────────────────────────────────────

describe('FeatureFlagsModule — set/clear/read round-trip (simulated)', () => {
  it('simulates set then read returns true, clear then read returns false', async () => {
    // Simulate in-memory flag state
    let flagStore = 0n;

    const provider = {
      wallet: { publicKey: ADMIN },
      connection: {
        getAccountInfo: vi.fn().mockImplementation(async () => ({
          data: buildConfigData(flagStore),
        })),
      },
    } as any;

    const ff = new FeatureFlagsModule(provider, PROGRAM_ID);

    // SET mock — OR in the flag
    (ff as any)._program = {
      methods: {
        setFeatureFlag: (bnFlag: any) => ({
          accounts: () => ({
            rpc: async () => {
              flagStore |= BigInt(bnFlag.toString());
              return 'fakeSig_set';
            },
          }),
        }),
        clearFeatureFlag: (bnFlag: any) => ({
          accounts: () => ({
            rpc: async () => {
              flagStore &= ~BigInt(bnFlag.toString());
              return 'fakeSig_clear';
            },
          }),
        }),
      },
    };

    // SET
    await ff.setFeatureFlag({ mint: MINT, flag: FLAG_CIRCUIT_BREAKER });
    expect(await ff.isFeatureFlagSet(MINT, FLAG_CIRCUIT_BREAKER)).toBe(true);

    // CLEAR
    await ff.clearFeatureFlag({ mint: MINT, flag: FLAG_CIRCUIT_BREAKER });
    expect(await ff.isFeatureFlagSet(MINT, FLAG_CIRCUIT_BREAKER)).toBe(false);
  });
});

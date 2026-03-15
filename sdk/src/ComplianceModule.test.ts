/**
 * Unit tests for ComplianceModule — SSS-017 / SSS-018
 *
 * Tests that addToBlacklist / removeFromBlacklist / initializeBlacklist
 * dispatch the correct Anchor instructions via the transfer-hook program IDL,
 * that getBlacklist() fetches the full BlacklistState via Anchor account fetch,
 * and that isBlacklisted correctly parses on-chain account data.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PublicKey } from '@solana/web3.js';
import { ComplianceModule } from './ComplianceModule';

// ── helpers ────────────────────────────────────────────────────────────────

const HOOK_PROGRAM_ID = new PublicKey('phAtzRyRUJGpMC3ftAtWzoaX7UkghRe9x5KTig8jPQp');
const MINT = new PublicKey('So11111111111111111111111111111111111111112');
const AUTHORITY = new PublicKey('11111111111111111111111111111112');
const TARGET_ADDR = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const TOKEN_ACCOUNT = new PublicKey('3zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');

/** Build a minimal AnchorProvider mock */
function makeProvider() {
  return {
    wallet: { publicKey: AUTHORITY },
    connection: { getAccountInfo: vi.fn() },
  } as any;
}

/** Build a spy-able Anchor Program mock that captures method+accounts calls */
function makeAnchorMock(rpcResult: string = 'tx-sig') {
  const rpc = vi.fn().mockResolvedValue(rpcResult);
  const accounts = vi.fn().mockReturnValue({ rpc });
  const methods: Record<string, any> = {};

  const methodProxy = (name: string) =>
    vi.fn().mockReturnValue({ accounts });

  return {
    methods: new Proxy({}, {
      get(_target, prop: string) {
        if (!methods[prop]) methods[prop] = methodProxy(prop);
        return methods[prop];
      },
    }),
    _rpc: rpc,
    _accounts: accounts,
    _methods: methods,
  };
}

// Intercept `import('@coral-xyz/anchor')` and `import('./idl/...')` in the module
vi.mock('@coral-xyz/anchor', () => ({
  AnchorProvider: class {},
  Program: class {
    methods: any;
    constructor(_idl: any, _provider: any) {
      const mock = makeAnchorMock();
      this.methods = mock.methods;
      // expose so tests can reach it
      (this as any).__mock = mock;
    }
  },
}));

vi.mock('./idl/sss_transfer_hook.json', () => ({ default: {} }));

// ── PDA derivation ──────────────────────────────────────────────────────────

describe('ComplianceModule.getBlacklistPda', () => {
  it('derives a stable PDA from BLACKLIST_SEED + mint', () => {
    const provider = makeProvider();
    const cm = new ComplianceModule(provider, MINT, HOOK_PROGRAM_ID);

    const [pda1] = cm.getBlacklistPda();
    const [pda2] = cm.getBlacklistPda();

    expect(pda1.toBase58()).toBe(pda2.toBase58());
    expect(pda1.toBase58()).not.toBe(MINT.toBase58());
  });

  it('changes when mint changes', () => {
    const provider = makeProvider();
    const mint2 = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

    const [pda1] = new ComplianceModule(provider, MINT, HOOK_PROGRAM_ID).getBlacklistPda();
    const [pda2] = new ComplianceModule(provider, mint2, HOOK_PROGRAM_ID).getBlacklistPda();

    expect(pda1.toBase58()).not.toBe(pda2.toBase58());
  });
});

// ── Anchor dispatch ─────────────────────────────────────────────────────────

describe('ComplianceModule.addToBlacklist', () => {
  it('calls blacklistAdd with correct address and accounts, returns tx sig', async () => {
    const provider = makeProvider();
    const cm = new ComplianceModule(provider, MINT, HOOK_PROGRAM_ID);

    const sig = await cm.addToBlacklist(TARGET_ADDR);

    expect(sig).toBe('tx-sig');

    // The program is lazily loaded; retrieve it via internal cache
    const prog = (cm as any)._program;
    expect(prog).not.toBeNull();
    // methods.blacklistAdd should have been called with TARGET_ADDR
    const blacklistAdd = prog.methods.blacklistAdd;
    expect(blacklistAdd).toHaveBeenCalledWith(TARGET_ADDR);
    // accounts() should receive correct keys
    const [blacklistState] = cm.getBlacklistPda();
    expect(prog.methods.blacklistAdd().accounts).toHaveBeenCalledWith({
      authority: AUTHORITY,
      mint: MINT,
      blacklistState,
    });
  });
});

describe('ComplianceModule.removeFromBlacklist', () => {
  it('calls blacklistRemove with correct address and accounts, returns tx sig', async () => {
    const provider = makeProvider();
    const cm = new ComplianceModule(provider, MINT, HOOK_PROGRAM_ID);

    const sig = await cm.removeFromBlacklist(TARGET_ADDR);

    expect(sig).toBe('tx-sig');
    const prog = (cm as any)._program;
    expect(prog.methods.blacklistRemove).toHaveBeenCalledWith(TARGET_ADDR);
    const [blacklistState] = cm.getBlacklistPda();
    expect(prog.methods.blacklistRemove().accounts).toHaveBeenCalledWith({
      authority: AUTHORITY,
      mint: MINT,
      blacklistState,
    });
  });
});

describe('ComplianceModule.initializeBlacklist', () => {
  it('calls initializeExtraAccountMetaList with no args and correct accounts', async () => {
    const provider = makeProvider();
    const cm = new ComplianceModule(provider, MINT, HOOK_PROGRAM_ID);

    const sig = await cm.initializeBlacklist();

    expect(sig).toBe('tx-sig');
    const prog = (cm as any)._program;
    expect(prog.methods.initializeExtraAccountMetaList).toHaveBeenCalledWith();
    const [blacklistState] = cm.getBlacklistPda();
    expect(prog.methods.initializeExtraAccountMetaList().accounts).toHaveBeenCalledWith({
      authority: AUTHORITY,
      mint: MINT,
      blacklistState,
    });
  });
});

// ── isBlacklisted ───────────────────────────────────────────────────────────

describe('ComplianceModule.isBlacklisted', () => {
  it('returns false when account does not exist', async () => {
    const provider = makeProvider();
    provider.connection.getAccountInfo.mockResolvedValue(null);
    const cm = new ComplianceModule(provider, MINT, HOOK_PROGRAM_ID);

    expect(await cm.isBlacklisted(TARGET_ADDR)).toBe(false);
  });

  it('returns false when account data is too short', async () => {
    const provider = makeProvider();
    provider.connection.getAccountInfo.mockResolvedValue({ data: Buffer.alloc(10) });
    const cm = new ComplianceModule(provider, MINT, HOOK_PROGRAM_ID);

    expect(await cm.isBlacklisted(TARGET_ADDR)).toBe(false);
  });

  it('returns false when address is not in list', async () => {
    const provider = makeProvider();
    // Build account data with vecLen=1, one entry = AUTHORITY (not TARGET_ADDR)
    const data = Buffer.alloc(8 + 32 + 32 + 4 + 32);
    data.writeUInt32LE(1, 72); // vecLen = 1
    AUTHORITY.toBuffer().copy(data, 76); // entry[0] = AUTHORITY
    provider.connection.getAccountInfo.mockResolvedValue({ data });
    const cm = new ComplianceModule(provider, MINT, HOOK_PROGRAM_ID);

    expect(await cm.isBlacklisted(TARGET_ADDR)).toBe(false);
  });

  it('returns true when address is present in the list', async () => {
    const provider = makeProvider();
    // vecLen=2: AUTHORITY, TARGET_ADDR
    const data = Buffer.alloc(8 + 32 + 32 + 4 + 2 * 32);
    data.writeUInt32LE(2, 72);
    AUTHORITY.toBuffer().copy(data, 76);
    TARGET_ADDR.toBuffer().copy(data, 76 + 32);
    provider.connection.getAccountInfo.mockResolvedValue({ data });
    const cm = new ComplianceModule(provider, MINT, HOOK_PROGRAM_ID);

    expect(await cm.isBlacklisted(TARGET_ADDR)).toBe(true);
  });

  it('returns true for the first entry in the list', async () => {
    const provider = makeProvider();
    const data = Buffer.alloc(8 + 32 + 32 + 4 + 32);
    data.writeUInt32LE(1, 72);
    TARGET_ADDR.toBuffer().copy(data, 76);
    provider.connection.getAccountInfo.mockResolvedValue({ data });
    const cm = new ComplianceModule(provider, MINT, HOOK_PROGRAM_ID);

    expect(await cm.isBlacklisted(TARGET_ADDR)).toBe(true);
  });
});

// ── getBlacklist ─────────────────────────────────────────────────────────────

describe('ComplianceModule.getBlacklist', () => {
  it('returns empty array when account does not exist (not initialized)', async () => {
    const provider = makeProvider();
    const cm = new ComplianceModule(provider, MINT, HOOK_PROGRAM_ID);
    // Make account.blacklistState.fetch throw (account not found)
    const program = (cm as any)._program = {
      account: {
        blacklistState: {
          fetch: vi.fn().mockRejectedValue(new Error('Account does not exist')),
        },
      },
    };
    (cm as any)._program = program;

    const result = await cm.getBlacklist();
    expect(result).toEqual([]);
  });

  it('returns the blacklisted array from the fetched account', async () => {
    const provider = makeProvider();
    const cm = new ComplianceModule(provider, MINT, HOOK_PROGRAM_ID);
    const blacklisted = [TARGET_ADDR, AUTHORITY];
    (cm as any)._program = {
      account: {
        blacklistState: {
          fetch: vi.fn().mockResolvedValue({ blacklisted }),
        },
      },
    };

    const result = await cm.getBlacklist();
    expect(result).toEqual(blacklisted);
    expect(result).toHaveLength(2);
  });

  it('returns empty array when blacklisted field is empty', async () => {
    const provider = makeProvider();
    const cm = new ComplianceModule(provider, MINT, HOOK_PROGRAM_ID);
    (cm as any)._program = {
      account: {
        blacklistState: {
          fetch: vi.fn().mockResolvedValue({ blacklisted: [] }),
        },
      },
    };

    const result = await cm.getBlacklist();
    expect(result).toEqual([]);
  });
});

// ── program lazy-load + caching ─────────────────────────────────────────────

describe('ComplianceModule program caching', () => {
  it('reuses the same program instance across multiple calls', async () => {
    const provider = makeProvider();
    const cm = new ComplianceModule(provider, MINT, HOOK_PROGRAM_ID);

    await cm.addToBlacklist(TARGET_ADDR);
    const prog1 = (cm as any)._program;
    await cm.removeFromBlacklist(TARGET_ADDR);
    const prog2 = (cm as any)._program;

    expect(prog1).toBe(prog2);
  });
});

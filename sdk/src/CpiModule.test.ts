/**
 * SSS-056 — CpiModule unit tests
 *
 * Tests cover:
 *  - PDA derivation (interfaceVersion, config, minterInfo)
 *  - fetchInterfaceVersion: returns decoded data or null when PDA missing
 *  - isSssProgramCompatible: active + version match → true; mismatches → false
 *  - initInterfaceVersion: calls correct instruction + accounts
 *  - updateInterfaceVersion: passes newVersion and active correctly
 *  - cpiMint: correct accounts wired, default requiredVersion = 1
 *  - cpiBurn: correct accounts wired, default requiredVersion = 1
 *  - requiredVersion override: custom version forwarded to program.methods
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PublicKey, Connection } from '@solana/web3.js';
import { AnchorProvider } from '@coral-xyz/anchor';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('./idl/sss_token.json', () => ({
  default: {
    version: '0.1.0',
    name: 'sss_token',
    address: '2haUR6bUPcWXkCG9bZCPvVJYvtkGRDHnLtX1X1j9zbUY',
    instructions: [],
    accounts: [],
    errors: [],
    types: [],
    metadata: {},
  },
}));

// Track last captured args from mock calls
const capturedCpiMintArgs: { amount?: any; requiredVersion?: any; accounts?: any }[] = [];
const capturedCpiBurnArgs: { amount?: any; requiredVersion?: any; accounts?: any }[] = [];
const capturedInitArgs: { accounts?: any }[] = [];
const capturedUpdateArgs: { newVersion?: any; active?: any; accounts?: any }[] = [];

const mockInterfaceVersionFetch = vi.fn();

vi.mock('@coral-xyz/anchor', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    Program: vi.fn().mockImplementation(() => ({
      methods: {
        cpiMint: vi.fn().mockImplementation((amount: any, requiredVersion: any) => ({
          accounts: vi.fn().mockImplementation((accs: any) => {
            capturedCpiMintArgs.push({ amount, requiredVersion, accounts: accs });
            return { rpc: vi.fn().mockResolvedValue('mock-cpi-mint-sig') };
          }),
        })),
        cpiBurn: vi.fn().mockImplementation((amount: any, requiredVersion: any) => ({
          accounts: vi.fn().mockImplementation((accs: any) => {
            capturedCpiBurnArgs.push({ amount, requiredVersion, accounts: accs });
            return { rpc: vi.fn().mockResolvedValue('mock-cpi-burn-sig') };
          }),
        })),
        initInterfaceVersion: vi.fn().mockImplementation(() => ({
          accounts: vi.fn().mockImplementation((accs: any) => {
            capturedInitArgs.push({ accounts: accs });
            return { rpc: vi.fn().mockResolvedValue('mock-init-sig') };
          }),
        })),
        updateInterfaceVersion: vi.fn().mockImplementation((newVersion: any, active: any) => ({
          accounts: vi.fn().mockImplementation((accs: any) => {
            capturedUpdateArgs.push({ newVersion, active, accounts: accs });
            return { rpc: vi.fn().mockResolvedValue('mock-update-sig') };
          }),
        })),
      },
      account: {
        interfaceVersion: {
          fetch: mockInterfaceVersionFetch,
        },
      },
    })),
    BN: actual.BN,
  };
});

import {
  CpiModule,
  CURRENT_INTERFACE_VERSION,
  getInterfaceVersionPda,
  InterfaceVersionInfo,
} from './CpiModule';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const PROGRAM_ID = new PublicKey('2haUR6bUPcWXkCG9bZCPvVJYvtkGRDHnLtX1X1j9zbUY');
const MINT = new PublicKey('iMQMstNzoHq8Hmc5SA8fdBcDFBoE3uDiENoSr9JQChS');
const MINTER = new PublicKey('3hrYcjWLwUXXPDM3F7fGCksDneLeMtucwrsFPqJy4h2S');
const RECIPIENT_TA = new PublicKey('HTBxWfLzuFgm7WHWZ5Z1FefuQX1eKF84428KJgBZDzrs');
const SOURCE_TA = new PublicKey('iVwMHJXppJk2m7kq36qGg5uLZpxDo3zNCDyGaosJ33C');

function makeProvider(publicKey: PublicKey = MINTER): AnchorProvider {
  return {
    wallet: { publicKey },
    connection: {} as Connection,
    opts: {},
    send: vi.fn(),
    sendAndConfirm: vi.fn(),
    sendAll: vi.fn(),
    simulate: vi.fn(),
    publicKey,
  } as unknown as AnchorProvider;
}

function makeIvInfo(overrides: Partial<InterfaceVersionInfo> = {}): InterfaceVersionInfo {
  return {
    mint: MINT,
    version: 1,
    active: true,
    namespace: new Uint8Array(32),
    bump: 255,
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('CpiModule', () => {
  let provider: AnchorProvider;
  let cpi: CpiModule;

  beforeEach(() => {
    vi.clearAllMocks();
    capturedCpiMintArgs.length = 0;
    capturedCpiBurnArgs.length = 0;
    capturedInitArgs.length = 0;
    capturedUpdateArgs.length = 0;
    provider = makeProvider();
    cpi = new CpiModule(provider, MINT, PROGRAM_ID);
  });

  // ─── CURRENT_INTERFACE_VERSION ─────────────────────────────────────────────

  it('exports CURRENT_INTERFACE_VERSION = 1', () => {
    expect(CURRENT_INTERFACE_VERSION).toBe(1);
  });

  // ─── PDA Derivation ───────────────────────────────────────────────────────

  describe('getInterfaceVersionPda', () => {
    it('derives a valid PDA (off-chain helper)', () => {
      const [pda, bump] = getInterfaceVersionPda(MINT, PROGRAM_ID);
      expect(pda).toBeInstanceOf(PublicKey);
      expect(typeof bump).toBe('number');
      expect(bump).toBeGreaterThanOrEqual(0);
      expect(bump).toBeLessThanOrEqual(255);
    });

    it('matches the instance method', () => {
      const [offChain] = getInterfaceVersionPda(MINT, PROGRAM_ID);
      const [fromInstance] = cpi.getInterfaceVersionPda();
      expect(fromInstance.toBase58()).toBe(offChain.toBase58());
    });

    it('produces different PDAs for different mints', () => {
      const mintA = new PublicKey('iMQMstNzoHq8Hmc5SA8fdBcDFBoE3uDiENoSr9JQChS');
      const mintB = new PublicKey('6SFMDn17duLgC1BQCK2e3miwg2aftkQjjR13B3N984gd');
      const [pdaA] = getInterfaceVersionPda(mintA, PROGRAM_ID);
      const [pdaB] = getInterfaceVersionPda(mintB, PROGRAM_ID);
      expect(pdaA.toBase58()).not.toBe(pdaB.toBase58());
    });
  });

  describe('getConfigPda', () => {
    it('returns a valid public key', () => {
      expect(cpi.getConfigPda()).toBeInstanceOf(PublicKey);
    });
  });

  describe('getMinterInfoPda', () => {
    it('returns a valid public key for provider wallet', () => {
      expect(cpi.getMinterInfoPda()).toBeInstanceOf(PublicKey);
    });

    it('returns a valid public key for an explicit minter', () => {
      const other = new PublicKey('6SFMDn17duLgC1BQCK2e3miwg2aftkQjjR13B3N984gd');
      expect(cpi.getMinterInfoPda(other)).toBeInstanceOf(PublicKey);
    });

    it('differs between two minters', () => {
      const a = cpi.getMinterInfoPda(MINTER);
      const b = cpi.getMinterInfoPda(new PublicKey('6SFMDn17duLgC1BQCK2e3miwg2aftkQjjR13B3N984gd'));
      expect(a.toBase58()).not.toBe(b.toBase58());
    });
  });

  // ─── fetchInterfaceVersion ─────────────────────────────────────────────────

  describe('fetchInterfaceVersion', () => {
    it('returns decoded InterfaceVersionInfo when PDA exists', async () => {
      const raw = {
        mint: MINT,
        version: 1,
        active: true,
        namespace: new Uint8Array(32),
        bump: 255,
      };
      mockInterfaceVersionFetch.mockResolvedValueOnce(raw);

      const result = await cpi.fetchInterfaceVersion({} as Connection);
      expect(result).not.toBeNull();
      expect(result!.version).toBe(1);
      expect(result!.active).toBe(true);
      expect(result!.mint.toBase58()).toBe(MINT.toBase58());
    });

    it('returns null when PDA does not exist (fetch throws)', async () => {
      mockInterfaceVersionFetch.mockRejectedValueOnce(new Error('Account not found'));

      const result = await cpi.fetchInterfaceVersion({} as Connection);
      expect(result).toBeNull();
    });
  });

  // ─── isSssProgramCompatible ────────────────────────────────────────────────

  describe('isSssProgramCompatible', () => {
    it('returns true when active=true and version matches expected', async () => {
      mockInterfaceVersionFetch.mockResolvedValueOnce(makeIvInfo({ version: 1, active: true }));
      expect(await cpi.isSssProgramCompatible({} as Connection)).toBe(true);
    });

    it('returns false when active=false', async () => {
      mockInterfaceVersionFetch.mockResolvedValueOnce(makeIvInfo({ active: false }));
      expect(await cpi.isSssProgramCompatible({} as Connection)).toBe(false);
    });

    it('returns false when version mismatches', async () => {
      mockInterfaceVersionFetch.mockResolvedValueOnce(makeIvInfo({ version: 2 }));
      expect(await cpi.isSssProgramCompatible({} as Connection, 1)).toBe(false);
    });

    it('returns false when PDA does not exist', async () => {
      mockInterfaceVersionFetch.mockRejectedValueOnce(new Error('not found'));
      expect(await cpi.isSssProgramCompatible({} as Connection)).toBe(false);
    });

    it('accepts a custom expectedVersion', async () => {
      mockInterfaceVersionFetch.mockResolvedValueOnce(makeIvInfo({ version: 2, active: true }));
      expect(await cpi.isSssProgramCompatible({} as Connection, 2)).toBe(true);
    });
  });

  // ─── initInterfaceVersion ─────────────────────────────────────────────────

  describe('initInterfaceVersion', () => {
    it('returns a transaction signature', async () => {
      const sig = await cpi.initInterfaceVersion();
      expect(sig).toBe('mock-init-sig');
    });

    it('wires authority, config, mint, interfaceVersion, systemProgram', async () => {
      await cpi.initInterfaceVersion();
      expect(capturedInitArgs).toHaveLength(1);
      const accs = capturedInitArgs[0].accounts;
      expect(accs.authority.toBase58()).toBe(MINTER.toBase58());
      expect(accs.mint.toBase58()).toBe(MINT.toBase58());
      expect(accs.config).toBeInstanceOf(PublicKey);
      expect(accs.interfaceVersion).toBeInstanceOf(PublicKey);
      expect(accs.systemProgram).toBeInstanceOf(PublicKey);
    });

    it('derives interfaceVersion PDA consistently with getInterfaceVersionPda()', async () => {
      await cpi.initInterfaceVersion();
      const [expected] = getInterfaceVersionPda(MINT, PROGRAM_ID);
      expect(capturedInitArgs[0].accounts.interfaceVersion.toBase58()).toBe(expected.toBase58());
    });
  });

  // ─── updateInterfaceVersion ───────────────────────────────────────────────

  describe('updateInterfaceVersion', () => {
    it('passes newVersion when provided', async () => {
      await cpi.updateInterfaceVersion({ newVersion: 2 });
      expect(capturedUpdateArgs[0].newVersion).toBe(2);
      expect(capturedUpdateArgs[0].active).toBeNull();
    });

    it('passes active when provided', async () => {
      await cpi.updateInterfaceVersion({ active: false });
      expect(capturedUpdateArgs[0].newVersion).toBeNull();
      expect(capturedUpdateArgs[0].active).toBe(false);
    });

    it('passes both newVersion and active', async () => {
      await cpi.updateInterfaceVersion({ newVersion: 3, active: false });
      expect(capturedUpdateArgs[0].newVersion).toBe(3);
      expect(capturedUpdateArgs[0].active).toBe(false);
    });

    it('passes null for both when params are empty', async () => {
      await cpi.updateInterfaceVersion({});
      expect(capturedUpdateArgs[0].newVersion).toBeNull();
      expect(capturedUpdateArgs[0].active).toBeNull();
    });

    it('returns a transaction signature', async () => {
      const sig = await cpi.updateInterfaceVersion({ active: true });
      expect(sig).toBe('mock-update-sig');
    });

    it('wires authority, config, interfaceVersion accounts', async () => {
      await cpi.updateInterfaceVersion({ newVersion: 2 });
      const accs = capturedUpdateArgs[0].accounts;
      expect(accs.authority.toBase58()).toBe(MINTER.toBase58());
      expect(accs.config).toBeInstanceOf(PublicKey);
      expect(accs.interfaceVersion).toBeInstanceOf(PublicKey);
    });
  });

  // ─── cpiMint ──────────────────────────────────────────────────────────────

  describe('cpiMint', () => {
    it('returns a transaction signature', async () => {
      const sig = await cpi.cpiMint({ amount: 1_000_000n, recipient: RECIPIENT_TA });
      expect(sig).toBe('mock-cpi-mint-sig');
    });

    it('defaults requiredVersion to CURRENT_INTERFACE_VERSION (1)', async () => {
      await cpi.cpiMint({ amount: 500_000n, recipient: RECIPIENT_TA });
      expect(capturedCpiMintArgs[0].requiredVersion).toBe(CURRENT_INTERFACE_VERSION);
    });

    it('forwards custom requiredVersion', async () => {
      await cpi.cpiMint({ amount: 100n, recipient: RECIPIENT_TA, requiredVersion: 2 });
      expect(capturedCpiMintArgs[0].requiredVersion).toBe(2);
    });

    it('passes correct amount as BN', async () => {
      await cpi.cpiMint({ amount: 2_500_000n, recipient: RECIPIENT_TA });
      const { BN } = await import('@coral-xyz/anchor');
      expect(capturedCpiMintArgs[0].amount.toString()).toBe('2500000');
    });

    it('wires all required accounts', async () => {
      await cpi.cpiMint({ amount: 1_000_000n, recipient: RECIPIENT_TA });
      const accs = capturedCpiMintArgs[0].accounts;
      expect(accs.minter.toBase58()).toBe(MINTER.toBase58());
      expect(accs.config).toBeInstanceOf(PublicKey);
      expect(accs.minterInfo).toBeInstanceOf(PublicKey);
      expect(accs.mint.toBase58()).toBe(MINT.toBase58());
      expect(accs.recipientTokenAccount.toBase58()).toBe(RECIPIENT_TA.toBase58());
      expect(accs.interfaceVersion).toBeInstanceOf(PublicKey);
      expect(accs.tokenProgram).toBeInstanceOf(PublicKey);
    });

    it('uses TOKEN_2022_PROGRAM_ID by default for tokenProgram', async () => {
      const { TOKEN_2022_PROGRAM_ID } = await import('@solana/spl-token');
      await cpi.cpiMint({ amount: 1n, recipient: RECIPIENT_TA });
      expect(capturedCpiMintArgs[0].accounts.tokenProgram.toBase58()).toBe(
        TOKEN_2022_PROGRAM_ID.toBase58(),
      );
    });

    it('accepts a custom tokenProgram', async () => {
      const customTp = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
      await cpi.cpiMint({ amount: 1n, recipient: RECIPIENT_TA, tokenProgram: customTp });
      expect(capturedCpiMintArgs[0].accounts.tokenProgram.toBase58()).toBe(customTp.toBase58());
    });

    it('uses interfaceVersion PDA consistent with getInterfaceVersionPda()', async () => {
      await cpi.cpiMint({ amount: 1n, recipient: RECIPIENT_TA });
      const [expected] = getInterfaceVersionPda(MINT, PROGRAM_ID);
      expect(capturedCpiMintArgs[0].accounts.interfaceVersion.toBase58()).toBe(
        expected.toBase58(),
      );
    });
  });

  // ─── cpiBurn ──────────────────────────────────────────────────────────────

  describe('cpiBurn', () => {
    it('returns a transaction signature', async () => {
      const sig = await cpi.cpiBurn({ amount: 500_000n, source: SOURCE_TA });
      expect(sig).toBe('mock-cpi-burn-sig');
    });

    it('defaults requiredVersion to CURRENT_INTERFACE_VERSION (1)', async () => {
      await cpi.cpiBurn({ amount: 100n, source: SOURCE_TA });
      expect(capturedCpiBurnArgs[0].requiredVersion).toBe(CURRENT_INTERFACE_VERSION);
    });

    it('forwards custom requiredVersion', async () => {
      await cpi.cpiBurn({ amount: 100n, source: SOURCE_TA, requiredVersion: 3 });
      expect(capturedCpiBurnArgs[0].requiredVersion).toBe(3);
    });

    it('passes correct amount as BN', async () => {
      await cpi.cpiBurn({ amount: 750_000n, source: SOURCE_TA });
      expect(capturedCpiBurnArgs[0].amount.toString()).toBe('750000');
    });

    it('wires all required accounts', async () => {
      await cpi.cpiBurn({ amount: 1_000_000n, source: SOURCE_TA });
      const accs = capturedCpiBurnArgs[0].accounts;
      expect(accs.minter.toBase58()).toBe(MINTER.toBase58());
      expect(accs.config).toBeInstanceOf(PublicKey);
      expect(accs.minterInfo).toBeInstanceOf(PublicKey);
      expect(accs.mint.toBase58()).toBe(MINT.toBase58());
      expect(accs.sourceTokenAccount.toBase58()).toBe(SOURCE_TA.toBase58());
      expect(accs.interfaceVersion).toBeInstanceOf(PublicKey);
      expect(accs.tokenProgram).toBeInstanceOf(PublicKey);
    });

    it('uses TOKEN_2022_PROGRAM_ID by default for tokenProgram', async () => {
      const { TOKEN_2022_PROGRAM_ID } = await import('@solana/spl-token');
      await cpi.cpiBurn({ amount: 1n, source: SOURCE_TA });
      expect(capturedCpiBurnArgs[0].accounts.tokenProgram.toBase58()).toBe(
        TOKEN_2022_PROGRAM_ID.toBase58(),
      );
    });

    it('accepts a custom tokenProgram', async () => {
      const customTp = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
      await cpi.cpiBurn({ amount: 1n, source: SOURCE_TA, tokenProgram: customTp });
      expect(capturedCpiBurnArgs[0].accounts.tokenProgram.toBase58()).toBe(customTp.toBase58());
    });

    it('uses interfaceVersion PDA consistent with getInterfaceVersionPda()', async () => {
      await cpi.cpiBurn({ amount: 1n, source: SOURCE_TA });
      const [expected] = getInterfaceVersionPda(MINT, PROGRAM_ID);
      expect(capturedCpiBurnArgs[0].accounts.interfaceVersion.toBase58()).toBe(
        expected.toBase58(),
      );
    });
  });
});

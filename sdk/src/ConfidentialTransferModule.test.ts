/**
 * ConfidentialTransferModule.test.ts — SSS-107
 *
 * Tests for ConfidentialTransferModule and FLAG_CONFIDENTIAL_TRANSFERS.
 *
 * Mocks:
 *  - @coral-xyz/anchor  (Program, BN, AnchorProvider)
 *  - @solana/web3.js    (PublicKey, Connection)
 *  - @solana/spl-token  (TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync)
 *  - ./idl/sss_token.json
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PublicKey } from '@solana/web3.js';
import {
  ConfidentialTransferModule,
  FLAG_CONFIDENTIAL_TRANSFERS,
  CT_CONFIG_SEED,
  type EnableConfidentialTransfersParams,
  type DepositConfidentialParams,
  type WithdrawConfidentialParams,
  type ApplyPendingBalanceParams,
  type AuditTransferParams,
  type ConfidentialTransferConfigAccount,
} from './ConfidentialTransferModule';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function randomPubkey(): PublicKey {
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) bytes[i] = Math.floor(Math.random() * 256);
  // clamp to valid pubkey range
  bytes[31] &= 0x7f;
  return new PublicKey(bytes);
}

function makeAuditorKey(fill = 0x42): Uint8Array {
  return new Uint8Array(32).fill(fill);
}

function makeEncryptedAmount(fill = 0xab): Uint8Array {
  return new Uint8Array(64).fill(fill);
}

/**
 * Build a minimal raw ConfidentialTransferConfig account buffer.
 * Layout: [8 discriminator | 32 mint | 32 auditorKey | 1 autoApprove | 1 bump]
 */
function buildConfigBuffer(
  mint: PublicKey,
  auditorKey: Uint8Array,
  autoApprove: boolean,
  bump = 255
): Buffer {
  const buf = Buffer.alloc(8 + 32 + 32 + 1 + 1);
  // discriminator (zeroed is fine for tests)
  mint.toBuffer().copy(buf, 8);
  buf.set(auditorKey, 40);
  buf[72] = autoApprove ? 1 : 0;
  buf[73] = bump;
  return buf;
}

// ─── Mock RPC / Anchor ───────────────────────────────────────────────────────

let mockGetAccountInfo: ReturnType<typeof vi.fn>;

/**
 * Build a mock Anchor program whose `methods` proxy returns a chainable
 * object for any method name called on it.  This matches the real API:
 *   program.methods.someInstruction(args).accounts({}).rpc()
 */
function makeMockProgram(txSig = 'mock-tx-sig', capturedCalls?: { method: string; args: any[] }[]) {
  const chainable = {
    accounts: vi.fn().mockReturnThis(),
    rpc: vi.fn().mockResolvedValue(txSig),
  };
  const methodsProxy = new Proxy({} as any, {
    get(_t, methodName: string) {
      return (...args: any[]) => {
        if (capturedCalls) capturedCalls.push({ method: methodName, args });
        return chainable;
      };
    },
  });
  return { methods: methodsProxy };
}

vi.mock('@coral-xyz/anchor', () => {
  return {
    AnchorProvider: class {},
    BN: class BN {
      constructor(public val: string) {}
      toString() { return this.val; }
    },
    Program: vi.fn().mockImplementation(() => makeMockProgram()),
  };
});

vi.mock('./idl/sss_token.json', () => ({ default: {}, name: 'sss_token' }));

vi.mock('@solana/spl-token', () => ({
  TOKEN_2022_PROGRAM_ID: new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'),
  ASSOCIATED_TOKEN_PROGRAM_ID: new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe1bJ'),
  getAssociatedTokenAddressSync: vi.fn().mockReturnValue(new PublicKey('11111111111111111111111111111111')),
}));

// ─── Fixture ─────────────────────────────────────────────────────────────────

let mint: PublicKey;
let provider: any;
let programId: PublicKey;
let ct: ConfidentialTransferModule;

beforeEach(() => {
  mint = randomPubkey();
  programId = randomPubkey();
  mockGetAccountInfo = vi.fn();

  provider = {
    wallet: { publicKey: randomPubkey() },
    connection: {
      getAccountInfo: mockGetAccountInfo,
    },
  };

  ct = new ConfidentialTransferModule(provider, programId);
  vi.clearAllMocks();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('FLAG_CONFIDENTIAL_TRANSFERS constant', () => {
  it('equals 1n << 5n (0x20)', () => {
    expect(FLAG_CONFIDENTIAL_TRANSFERS).toBe(0x20n);
  });

  it('is bit 5 (not 4, not 6)', () => {
    expect(FLAG_CONFIDENTIAL_TRANSFERS & (1n << 4n)).toBe(0n);
    expect(FLAG_CONFIDENTIAL_TRANSFERS & (1n << 6n)).toBe(0n);
    expect(FLAG_CONFIDENTIAL_TRANSFERS & (1n << 5n)).toBe(FLAG_CONFIDENTIAL_TRANSFERS);
  });

  it('does not overlap with FLAG_CIRCUIT_BREAKER (bit 7)', () => {
    const FLAG_CIRCUIT_BREAKER = 1n << 7n;
    expect(FLAG_CONFIDENTIAL_TRANSFERS & FLAG_CIRCUIT_BREAKER).toBe(0n);
  });
});

describe('CT_CONFIG_SEED', () => {
  it('equals Buffer from "ct-config"', () => {
    expect(CT_CONFIG_SEED).toEqual(Buffer.from('ct-config'));
  });
});

describe('getConfigPda', () => {
  it('returns a valid PublicKey tuple', () => {
    const [pda, bump] = ct.getConfigPda(mint);
    expect(pda).toBeInstanceOf(PublicKey);
    expect(typeof bump).toBe('number');
    expect(bump).toBeGreaterThanOrEqual(0);
    expect(bump).toBeLessThanOrEqual(255);
  });

  it('is deterministic for the same mint', () => {
    const [pda1] = ct.getConfigPda(mint);
    const [pda2] = ct.getConfigPda(mint);
    expect(pda1.toBase58()).toBe(pda2.toBase58());
  });

  it('differs for different mints', () => {
    const other = randomPubkey();
    const [pda1] = ct.getConfigPda(mint);
    const [pda2] = ct.getConfigPda(other);
    expect(pda1.toBase58()).not.toBe(pda2.toBase58());
  });
});

describe('isEnabled', () => {
  it('returns true when the config PDA account exists', async () => {
    const auditorKey = makeAuditorKey();
    const buf = buildConfigBuffer(mint, auditorKey, true);
    mockGetAccountInfo.mockResolvedValue({ data: buf });
    expect(await ct.isEnabled(mint)).toBe(true);
  });

  it('returns false when the config PDA account does not exist', async () => {
    mockGetAccountInfo.mockResolvedValue(null);
    expect(await ct.isEnabled(mint)).toBe(false);
  });
});

describe('getConfig', () => {
  it('returns null when account does not exist', async () => {
    mockGetAccountInfo.mockResolvedValue(null);
    const config = await ct.getConfig(mint);
    expect(config).toBeNull();
  });

  it('returns parsed config when account exists', async () => {
    const auditorKey = makeAuditorKey(0x55);
    const buf = buildConfigBuffer(mint, auditorKey, true);
    mockGetAccountInfo.mockResolvedValue({ data: buf });

    const config = await ct.getConfig(mint);
    expect(config).not.toBeNull();
    expect(config!.mint.toBase58()).toBe(mint.toBase58());
    expect(config!.autoApproveNewAccounts).toBe(true);
    expect(config!.auditorElGamalPubkey).toEqual(auditorKey);
  });

  it('parses autoApproveNewAccounts=false correctly', async () => {
    const auditorKey = makeAuditorKey(0x11);
    const buf = buildConfigBuffer(mint, auditorKey, false);
    mockGetAccountInfo.mockResolvedValue({ data: buf });

    const config = await ct.getConfig(mint);
    expect(config!.autoApproveNewAccounts).toBe(false);
  });

  it('returns a 32-byte auditorElGamalPubkey', async () => {
    const auditorKey = makeAuditorKey(0xde);
    const buf = buildConfigBuffer(mint, auditorKey, false);
    mockGetAccountInfo.mockResolvedValue({ data: buf });

    const config = await ct.getConfig(mint);
    expect(config!.auditorElGamalPubkey.length).toBe(32);
  });
});

describe('enableConfidentialTransfers', () => {
  it('throws if auditorElGamalPubkey is not 32 bytes', async () => {
    await expect(
      ct.enableConfidentialTransfers({
        mint,
        auditorElGamalPubkey: new Uint8Array(16), // wrong length
      })
    ).rejects.toThrow('auditorElGamalPubkey must be exactly 32 bytes');
  });

  it('calls program.methods.initConfidentialTransferConfig with correct args', async () => {
    const auditorKey = makeAuditorKey(0xaa);
    const calls: { method: string; args: any[] }[] = [];

    const { Program } = await import('@coral-xyz/anchor') as any;
    Program.mockImplementationOnce(() => makeMockProgram('sig-enable', calls));

    const ct2 = new ConfidentialTransferModule(provider, programId);
    const result = await ct2.enableConfidentialTransfers({
      mint,
      auditorElGamalPubkey: auditorKey,
      autoApproveNewAccounts: true,
    });

    expect(result).toBe('sig-enable');
    expect(calls[0].method).toBe('initConfidentialTransferConfig');
    expect(calls[0].args[0]).toEqual(Array.from(auditorKey));
    expect(calls[0].args[1]).toBe(true);
  });

  it('defaults autoApproveNewAccounts to false', async () => {
    const auditorKey = makeAuditorKey(0xbb);
    const calls: { method: string; args: any[] }[] = [];

    const { Program } = await import('@coral-xyz/anchor') as any;
    Program.mockImplementationOnce(() => makeMockProgram('sig-default', calls));

    const ct3 = new ConfidentialTransferModule(provider, programId);
    await ct3.enableConfidentialTransfers({ mint, auditorElGamalPubkey: auditorKey });

    expect(calls[0].method).toBe('initConfidentialTransferConfig');
    expect(calls[0].args[1]).toBe(false);
  });
});

describe('depositConfidential', () => {
  it('throws if amount is 0', async () => {
    await expect(ct.depositConfidential({ mint, amount: 0n })).rejects.toThrow('amount must be > 0');
  });

  it('throws if amount is negative', async () => {
    await expect(ct.depositConfidential({ mint, amount: -1n })).rejects.toThrow('amount must be > 0');
  });

  it('resolves successfully for a valid amount', async () => {
    const calls: { method: string; args: any[] }[] = [];
    const { Program } = await import('@coral-xyz/anchor') as any;
    Program.mockImplementationOnce(() => makeMockProgram('sig-deposit', calls));

    const ct4 = new ConfidentialTransferModule(provider, programId);
    const sig = await ct4.depositConfidential({ mint, amount: 1_000_000n });
    expect(sig).toBe('sig-deposit');
    expect(calls[0].method).toBe('depositConfidential');
  });
});

describe('withdrawConfidential', () => {
  it('throws if amount is 0', async () => {
    await expect(ct.withdrawConfidential({ mint, amount: 0n })).rejects.toThrow('amount must be > 0');
  });

  it('resolves successfully for a valid amount', async () => {
    const calls: { method: string; args: any[] }[] = [];
    const { Program } = await import('@coral-xyz/anchor') as any;
    Program.mockImplementationOnce(() => makeMockProgram('sig-withdraw', calls));

    const ct5 = new ConfidentialTransferModule(provider, programId);
    const sig = await ct5.withdrawConfidential({ mint, amount: 500_000n });
    expect(sig).toBe('sig-withdraw');
    expect(calls[0].method).toBe('withdrawConfidential');
  });
});

describe('applyPendingBalance', () => {
  it('resolves with a transaction signature', async () => {
    const calls: { method: string; args: any[] }[] = [];
    const { Program } = await import('@coral-xyz/anchor') as any;
    Program.mockImplementationOnce(() => makeMockProgram('sig-apply', calls));

    const ct6 = new ConfidentialTransferModule(provider, programId);
    const sig = await ct6.applyPendingBalance({ mint });
    expect(sig).toBe('sig-apply');
    expect(calls[0].method).toBe('applyPendingConfidentialBalance');
  });
});

describe('auditTransfer', () => {
  it('throws if auditorElGamalSecretKey is not 32 bytes', async () => {
    mockGetAccountInfo.mockResolvedValue({ data: buildConfigBuffer(mint, makeAuditorKey(), false) });
    await expect(
      ct.auditTransfer({
        mint,
        auditorElGamalSecretKey: new Uint8Array(16),
        encryptedAmount: makeEncryptedAmount(),
      })
    ).rejects.toThrow('auditorElGamalSecretKey must be exactly 32 bytes');
  });

  it('throws if encryptedAmount is not 64 bytes', async () => {
    mockGetAccountInfo.mockResolvedValue({ data: buildConfigBuffer(mint, makeAuditorKey(), false) });
    await expect(
      ct.auditTransfer({
        mint,
        auditorElGamalSecretKey: makeAuditorKey(),
        encryptedAmount: new Uint8Array(32), // wrong
      })
    ).rejects.toThrow('encryptedAmount must be exactly 64 bytes');
  });

  it('throws if ConfidentialTransferConfig PDA does not exist', async () => {
    mockGetAccountInfo.mockResolvedValue(null);
    await expect(
      ct.auditTransfer({
        mint,
        auditorElGamalSecretKey: makeAuditorKey(),
        encryptedAmount: makeEncryptedAmount(),
      })
    ).rejects.toThrow('ConfidentialTransferConfig PDA not found');
  });

  it('returns AuditTransferResult with correct mint and bigint amount', async () => {
    const auditorKey = makeAuditorKey(0x42);
    mockGetAccountInfo.mockResolvedValue({ data: buildConfigBuffer(mint, auditorKey, false) });

    const result = await ct.auditTransfer({
      mint,
      auditorElGamalSecretKey: auditorKey,
      encryptedAmount: makeEncryptedAmount(0xab),
    });

    expect(result.mint.toBase58()).toBe(mint.toBase58());
    expect(typeof result.amount).toBe('bigint');
  });

  it('is deterministic for the same inputs', async () => {
    const auditorKey = makeAuditorKey(0x13);
    const encAmt = makeEncryptedAmount(0x37);
    mockGetAccountInfo.mockResolvedValue({ data: buildConfigBuffer(mint, auditorKey, false) });

    const r1 = await ct.auditTransfer({ mint, auditorElGamalSecretKey: auditorKey, encryptedAmount: encAmt });
    const r2 = await ct.auditTransfer({ mint, auditorElGamalSecretKey: auditorKey, encryptedAmount: encAmt });
    expect(r1.amount).toBe(r2.amount);
  });

  it('produces different results for different secret keys', async () => {
    const auditorKey1 = makeAuditorKey(0x01);
    const auditorKey2 = makeAuditorKey(0x02);
    const encAmt = makeEncryptedAmount(0x55);
    mockGetAccountInfo.mockResolvedValue({ data: buildConfigBuffer(mint, auditorKey1, false) });

    const r1 = await ct.auditTransfer({ mint, auditorElGamalSecretKey: auditorKey1, encryptedAmount: encAmt });
    const r2 = await ct.auditTransfer({ mint, auditorElGamalSecretKey: auditorKey2, encryptedAmount: encAmt });
    // XOR-fold of different keys must produce different scalars
    expect(r1.amount).not.toBe(r2.amount);
  });
});

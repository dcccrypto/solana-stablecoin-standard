import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PublicKey } from '@solana/web3.js';
import {
  AdminTimelockModule,
  ADMIN_OP_NONE,
  ADMIN_OP_TRANSFER_AUTHORITY,
  ADMIN_OP_SET_FEATURE_FLAG,
  ADMIN_OP_CLEAR_FEATURE_FLAG,
  DEFAULT_ADMIN_TIMELOCK_DELAY,
} from './AdminTimelockModule';
import { SSSError } from './error';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const AUTHORITY = new PublicKey('J8yr2kdmy9FLLJqtar3msUW214GRdvJymJ6uFdJtjkQS');
const MINT = new PublicKey('8SDDdSsYRrHRZknJ9Ep358R4zDWMLpwQzmtDwNvrpkge');
const NEW_AUTH = new PublicKey('FQzWmTfPpUVcVC96gYMoY2GLZ53m2TGLbte2RhqJHU36');
const PYTH_FEED = new PublicKey('GVXRSBjFk6e6J3NbVPXohDJetcTjaeeuykUpbQF8UoMU');
const TX_SIG = 'fakeTxSig1111111111111111111111111111111111111111';

function makeMockProvider() {
  return { wallet: { publicKey: AUTHORITY } } as any;
}

function makeMockProgram(txSig = TX_SIG) {
  const rpc = vi.fn().mockResolvedValue(txSig);
  const accounts = vi.fn().mockReturnValue({ rpc });
  const methods: Record<string, () => { accounts: typeof accounts }> = {};
  const methodProxy = vi.fn().mockReturnValue({ accounts });
  return {
    programId: new PublicKey('ApQTVMKdtUUrGXgL6Hhzt9W2JFyLt6vGnHuimcdXe811'),
    methods: new Proxy({} as any, { get: () => methodProxy }),
    _methodProxy: methodProxy,
    _accounts: accounts,
    _rpc: rpc,
  };
}

// ─── Constants ────────────────────────────────────────────────────────────────

describe('AdminTimelockModule constants', () => {
  it('ADMIN_OP_NONE is 0', () => {
    expect(ADMIN_OP_NONE).toBe(0);
  });

  it('ADMIN_OP_TRANSFER_AUTHORITY is 1', () => {
    expect(ADMIN_OP_TRANSFER_AUTHORITY).toBe(1);
  });

  it('ADMIN_OP_SET_FEATURE_FLAG is 2', () => {
    expect(ADMIN_OP_SET_FEATURE_FLAG).toBe(2);
  });

  it('ADMIN_OP_CLEAR_FEATURE_FLAG is 3', () => {
    expect(ADMIN_OP_CLEAR_FEATURE_FLAG).toBe(3);
  });

  it('DEFAULT_ADMIN_TIMELOCK_DELAY is 432_000n', () => {
    expect(DEFAULT_ADMIN_TIMELOCK_DELAY).toBe(432_000n);
  });
});

// ─── proposeTimelockOp ────────────────────────────────────────────────────────

describe('AdminTimelockModule.proposeTimelockOp', () => {
  it('calls program.methods.proposeTimelockOp with correct args and returns tx sig', async () => {
    const mock = makeMockProgram();
    const mod = new AdminTimelockModule(makeMockProvider(), mock);
    const sig = await mod.proposeTimelockOp({
      mint: MINT,
      opKind: ADMIN_OP_TRANSFER_AUTHORITY,
      param: 0n,
      target: NEW_AUTH,
    });
    expect(sig).toBe(TX_SIG);
    expect(mock._methodProxy).toHaveBeenCalledWith(
      ADMIN_OP_TRANSFER_AUTHORITY,
      expect.anything(), // BN(0)
      NEW_AUTH,
    );
    expect(mock._accounts).toHaveBeenCalledWith(
      expect.objectContaining({ authority: AUTHORITY, mint: MINT }),
    );
  });

  it('encodes SET_FEATURE_FLAG opKind with flag param', async () => {
    const mock = makeMockProgram();
    const mod = new AdminTimelockModule(makeMockProvider(), mock);
    await mod.proposeTimelockOp({
      mint: MINT,
      opKind: ADMIN_OP_SET_FEATURE_FLAG,
      param: 0x80n,
      target: PublicKey.default,
    });
    expect(mock._methodProxy).toHaveBeenCalledWith(
      ADMIN_OP_SET_FEATURE_FLAG,
      expect.anything(), // BN(0x80)
      PublicKey.default,
    );
  });

  it('encodes CLEAR_FEATURE_FLAG opKind with flag param', async () => {
    const mock = makeMockProgram();
    const mod = new AdminTimelockModule(makeMockProvider(), mock);
    await mod.proposeTimelockOp({
      mint: MINT,
      opKind: ADMIN_OP_CLEAR_FEATURE_FLAG,
      param: 0x04n,
      target: PublicKey.default,
    });
    expect(mock._methodProxy).toHaveBeenCalledWith(
      ADMIN_OP_CLEAR_FEATURE_FLAG,
      expect.anything(), // BN(0x04)
      PublicKey.default,
    );
  });

  // ─── F-2 guard: ADMIN_OP_NONE must be rejected ────────────────────────────
  it('throws SSSError when opKind is ADMIN_OP_NONE (0) — F-2 guard', async () => {
    const mock = makeMockProgram();
    const mod = new AdminTimelockModule(makeMockProvider(), mock);
    await expect(
      mod.proposeTimelockOp({
        mint: MINT,
        opKind: ADMIN_OP_NONE,
        param: 0n,
        target: PublicKey.default,
      }),
    ).rejects.toThrow(SSSError);
  });

  it('throws with descriptive message when opKind is ADMIN_OP_NONE', async () => {
    const mock = makeMockProgram();
    const mod = new AdminTimelockModule(makeMockProvider(), mock);
    await expect(
      mod.proposeTimelockOp({
        mint: MINT,
        opKind: ADMIN_OP_NONE,
        param: 0n,
        target: PublicKey.default,
      }),
    ).rejects.toThrow(/ADMIN_OP_NONE/);
  });

  it('does not call program.methods when opKind is ADMIN_OP_NONE', async () => {
    const mock = makeMockProgram();
    const mod = new AdminTimelockModule(makeMockProvider(), mock);
    try {
      await mod.proposeTimelockOp({
        mint: MINT,
        opKind: ADMIN_OP_NONE,
        param: 0n,
        target: PublicKey.default,
      });
    } catch (_) {
      // expected
    }
    expect(mock._methodProxy).not.toHaveBeenCalled();
  });
});

// ─── executeTimelockOp ────────────────────────────────────────────────────────

describe('AdminTimelockModule.executeTimelockOp', () => {
  it('calls program.methods.executeTimelockOp with mint and returns tx sig', async () => {
    const mock = makeMockProgram();
    const mod = new AdminTimelockModule(makeMockProvider(), mock);
    const sig = await mod.executeTimelockOp({ mint: MINT });
    expect(sig).toBe(TX_SIG);
    expect(mock._methodProxy).toHaveBeenCalledWith();
    expect(mock._accounts).toHaveBeenCalledWith(
      expect.objectContaining({ authority: AUTHORITY, mint: MINT }),
    );
  });
});

// ─── cancelTimelockOp ────────────────────────────────────────────────────────

describe('AdminTimelockModule.cancelTimelockOp', () => {
  it('calls program.methods.cancelTimelockOp with mint and returns tx sig', async () => {
    const mock = makeMockProgram();
    const mod = new AdminTimelockModule(makeMockProvider(), mock);
    const sig = await mod.cancelTimelockOp({ mint: MINT });
    expect(sig).toBe(TX_SIG);
    expect(mock._accounts).toHaveBeenCalledWith(
      expect.objectContaining({ authority: AUTHORITY, mint: MINT }),
    );
  });
});

// ─── setPythFeed ──────────────────────────────────────────────────────────────

describe('AdminTimelockModule.setPythFeed', () => {
  it('calls program.methods.setPythFeed with feed pubkey and returns tx sig', async () => {
    const mock = makeMockProgram();
    const mod = new AdminTimelockModule(makeMockProvider(), mock);
    const sig = await mod.setPythFeed({ mint: MINT, feed: PYTH_FEED });
    expect(sig).toBe(TX_SIG);
    expect(mock._methodProxy).toHaveBeenCalledWith(PYTH_FEED);
    expect(mock._accounts).toHaveBeenCalledWith(
      expect.objectContaining({ authority: AUTHORITY, mint: MINT }),
    );
  });
});

// ─── decodePendingOp ──────────────────────────────────────────────────────────

describe('AdminTimelockModule.decodePendingOp', () => {
  it('returns isPending=false and opKind=NONE when no pending op', () => {
    const mod = new AdminTimelockModule(makeMockProvider(), {});
    const result = mod.decodePendingOp({
      adminOpKind: ADMIN_OP_NONE,
      adminOpParam: { toString: () => '0' },
      adminOpTarget: PublicKey.default,
      adminOpMatureSlot: { toString: () => '0' },
    });
    expect(result.isPending).toBe(false);
    expect(result.opKind).toBe(ADMIN_OP_NONE);
    expect(result.param).toBe(0n);
    expect(result.matureSlot).toBe(0n);
  });

  it('returns isPending=true and correct fields for TRANSFER_AUTHORITY', () => {
    const mod = new AdminTimelockModule(makeMockProvider(), {});
    const result = mod.decodePendingOp({
      adminOpKind: ADMIN_OP_TRANSFER_AUTHORITY,
      adminOpParam: { toString: () => '0' },
      adminOpTarget: NEW_AUTH,
      adminOpMatureSlot: { toString: () => '999000' },
    });
    expect(result.isPending).toBe(true);
    expect(result.opKind).toBe(ADMIN_OP_TRANSFER_AUTHORITY);
    expect(result.target.toBase58()).toBe(NEW_AUTH.toBase58());
    expect(result.matureSlot).toBe(999_000n);
  });

  it('returns correct param for SET_FEATURE_FLAG', () => {
    const mod = new AdminTimelockModule(makeMockProvider(), {});
    const result = mod.decodePendingOp({
      adminOpKind: ADMIN_OP_SET_FEATURE_FLAG,
      adminOpParam: { toString: () => '128' },
      adminOpTarget: PublicKey.default,
      adminOpMatureSlot: { toString: () => '500000' },
    });
    expect(result.isPending).toBe(true);
    expect(result.opKind).toBe(ADMIN_OP_SET_FEATURE_FLAG);
    expect(result.param).toBe(128n);
  });

  it('returns correct param for CLEAR_FEATURE_FLAG', () => {
    const mod = new AdminTimelockModule(makeMockProvider(), {});
    const result = mod.decodePendingOp({
      adminOpKind: ADMIN_OP_CLEAR_FEATURE_FLAG,
      adminOpParam: { toString: () => '4' },
      adminOpTarget: PublicKey.default,
      adminOpMatureSlot: { toString: () => '700000' },
    });
    expect(result.isPending).toBe(true);
    expect(result.opKind).toBe(ADMIN_OP_CLEAR_FEATURE_FLAG);
    expect(result.param).toBe(4n);
  });
});

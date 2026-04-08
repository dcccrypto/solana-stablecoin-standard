/**
 * Unit tests for SolanaStablecoin SDK — IDL wiring.
 *
 * These tests mock the Anchor program and SPL Token helpers so they can run
 * without a live Solana cluster.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PublicKey, Keypair } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import {
  SolanaStablecoin,
  SSS_TOKEN_PROGRAM_ID,
} from './SolanaStablecoin';

// ─── Module mocks (hoisted by vitest) ────────────────────────────────────────

vi.mock('@coral-xyz/anchor', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@coral-xyz/anchor')>();
  return { ...actual, Program: vi.fn() };
});

vi.mock('@solana/spl-token', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@solana/spl-token')>();
  return {
    ...actual,
    getOrCreateAssociatedTokenAccount: vi.fn().mockResolvedValue({
      address: new PublicKey('So11111111111111111111111111111111111111112'),
    }),
    freezeAccount: vi.fn().mockResolvedValue('freezeTx'),
    thawAccount: vi.fn().mockResolvedValue('thawTx'),
  };
});

// Wrap Keypair.generate so we can capture what keypair was "generated" and
// assert on it later. We do NOT replace the actual Keypair class — just wrap
// the static .generate method using the original implementation.
vi.mock('@solana/web3.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@solana/web3.js')>();
  return {
    ...actual,
    Keypair: {
      ...actual.Keypair,
      generate: vi.fn(() => actual.Keypair.generate()),
    },
  };
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a minimal mock Anchor program that captures method calls. */
function makeMockProgram() {
  const rpc = vi.fn().mockResolvedValue('mockTxSig');

  // builder: every step returns itself so chains like .accounts().signers().rpc() work.
  const builder: Record<string, ReturnType<typeof vi.fn>> = {};
  builder.rpc = rpc;
  builder.accounts = vi.fn().mockReturnValue(builder);
  builder.signers = vi.fn().mockReturnValue(builder);

  const methodCalls: Record<string, ReturnType<typeof vi.fn>> = {};
  const methods = new Proxy(methodCalls, {
    get(_target, name: string) {
      if (!methodCalls[name]) {
        methodCalls[name] = vi.fn().mockReturnValue(builder);
      }
      return methodCalls[name];
    },
  });

  return {
    methods,
    account: {
      stablecoinConfig: {
        fetch: vi.fn().mockResolvedValue({
          totalMinted: new BN(1_000_000),
          totalBurned: new BN(100_000),
        }),
      },
    },
    _builder: builder,
    _methodCalls: methodCalls,
    _rpc: rpc,
  };
}

function makeMockProvider() {
  // Use a fresh random keypair for the wallet (doesn't use the mocked generate)
  const walletPk = PublicKey.unique ? PublicKey.unique() : new PublicKey(
    Uint8Array.from({ length: 32 }, (_, i) => (i + 1) % 256)
  );
  return {
    wallet: {
      publicKey: walletPk,
      signTransaction: vi.fn(),
      signAllTransactions: vi.fn(),
    },
    connection: {
      getParsedAccountInfo: vi.fn().mockResolvedValue({
        value: { data: { parsed: { info: { supply: '5000000' } } } },
      }),
    },
  } as any;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('SolanaStablecoin — Anchor IDL wiring', () => {
  let mockProgram: ReturnType<typeof makeMockProgram>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockProgram = makeMockProgram();

    const anchor = await import('@coral-xyz/anchor');
    (anchor.Program as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      () => mockProgram
    );
  });

  // ── create() ──────────────────────────────────────────────────────────────

  describe('create()', () => {
    it('calls program.methods.initialize with preset=1 for SSS-1', async () => {
      const provider = makeMockProvider();

      await SolanaStablecoin.create(provider, {
        preset: 'SSS-1',
        name: 'Test Stable',
        symbol: 'TST',
        decimals: 6,
      });

      expect(mockProgram._methodCalls.initialize).toHaveBeenCalledOnce();
      const [initParams] = mockProgram._methodCalls.initialize.mock.calls[0];
      expect(initParams.preset).toBe(1);
      expect(initParams.name).toBe('Test Stable');
      expect(initParams.symbol).toBe('TST');
      expect(initParams.decimals).toBe(6);
      expect(initParams.transferHookProgram).toBeNull();
    });

    it('calls program.methods.initialize with preset=2 for SSS-2', async () => {
      const provider = makeMockProvider();
      const hookProgram = new PublicKey('8opHzTAnfzRpPEx21XtnrVTX28YQuCpAjcn1PczScKj');

      await SolanaStablecoin.create(provider, {
        preset: 'SSS-2',
        name: 'USD Stable',
        symbol: 'USDS',
        decimals: 6,
        transferHookProgram: hookProgram,
      });

      const [initParams] = mockProgram._methodCalls.initialize.mock.calls[0];
      expect(initParams.preset).toBe(2);
      expect(initParams.transferHookProgram).toEqual(hookProgram);
    });

    it('passes the mint keypair as a signer', async () => {
      const provider = makeMockProvider();

      await SolanaStablecoin.create(provider, {
        preset: 'SSS-1',
        name: 'My Token',
        symbol: 'MTK',
      });

      // .signers([mintKeypair]) is called on the builder chain
      expect(mockProgram._builder.signers).toHaveBeenCalled();
      const [[signersArg]] = mockProgram._builder.signers.mock.calls;
      expect(Array.isArray(signersArg)).toBe(true);
      // The signer should be a Keypair (has .publicKey and .secretKey)
      expect(signersArg[0]).toHaveProperty('publicKey');
      expect(signersArg[0]).toHaveProperty('secretKey');
    });

    it('returns an instance whose .mint matches the keypair passed to initialize', async () => {
      const provider = makeMockProvider();

      const stablecoin = await SolanaStablecoin.create(provider, {
        preset: 'SSS-1',
        name: 'My Token',
        symbol: 'MTK',
      });

      // The .accounts() call receives { mint: <keypair.publicKey>, ... }
      const accountsCall = mockProgram._builder.accounts.mock.calls[0][0];
      expect(stablecoin.mint.toBase58()).toBe(accountsCall.mint.toBase58());
    });

    it('defaults to decimals=6 when not specified', async () => {
      const provider = makeMockProvider();

      await SolanaStablecoin.create(provider, {
        preset: 'SSS-1',
        name: 'No Dec',
        symbol: 'ND',
      });

      const [initParams] = mockProgram._methodCalls.initialize.mock.calls[0];
      expect(initParams.decimals).toBe(6);
    });

    it('SSS-1 sets transferHookProgram to null', async () => {
      const provider = makeMockProvider();

      await SolanaStablecoin.create(provider, {
        preset: 'SSS-1',
        name: 'T',
        symbol: 'T',
        transferHookProgram: new PublicKey('11111111111111111111111111111111'),
      });

      const [initParams] = mockProgram._methodCalls.initialize.mock.calls[0];
      // SSS-1 must ignore transferHookProgram even if provided
      expect(initParams.transferHookProgram).toBeNull();
    });
  });

  // ── mintTo() ──────────────────────────────────────────────────────────────

  describe('mintTo()', () => {
    async function makeStablecoin() {
      const provider = makeMockProvider();
      const stablecoin = await SolanaStablecoin.create(provider, {
        preset: 'SSS-1',
        name: 'T',
        symbol: 'T',
      });
      // Reset program cache so mintTo gets a fresh mock program
      (stablecoin as any)._program = null;
      mockProgram = makeMockProgram();
      const anchor = await import('@coral-xyz/anchor');
      (anchor.Program as unknown as ReturnType<typeof vi.fn>).mockImplementation(
        () => mockProgram
      );
      return { stablecoin, provider };
    }

    it('calls program.methods.mint with the correct amount as BN', async () => {
      const { stablecoin } = await makeStablecoin();

      await stablecoin.mintTo({
        mint: stablecoin.mint,
        amount: 1_000_000n,
        recipient: new PublicKey('11111111111111111111111111111111'),
      });

      expect(mockProgram._methodCalls.mint).toHaveBeenCalledOnce();
      const [amountArg] = mockProgram._methodCalls.mint.mock.calls[0];
      expect(amountArg.toString()).toBe('1000000');
    });

    it('includes config, minterInfo, mint, and tokenProgram accounts', async () => {
      const { TOKEN_2022_PROGRAM_ID } = await import('@solana/spl-token');
      const { stablecoin } = await makeStablecoin();

      await stablecoin.mintTo({
        mint: stablecoin.mint,
        amount: 500n,
        recipient: new PublicKey('11111111111111111111111111111111'),
      });

      const accountsCallArgs = mockProgram._builder.accounts.mock.calls[0][0];
      expect(accountsCallArgs.config).toBeInstanceOf(PublicKey);
      expect(accountsCallArgs.mint).toEqual(stablecoin.mint);
      expect(accountsCallArgs.tokenProgram).toEqual(TOKEN_2022_PROGRAM_ID);
      expect(accountsCallArgs.minterInfo).toBeInstanceOf(PublicKey);
      expect(accountsCallArgs.recipientTokenAccount).toBeInstanceOf(PublicKey);
    });
  });

  // ── burnFrom() ────────────────────────────────────────────────────────────

  describe('burnFrom()', () => {
    async function makeStablecoin() {
      const provider = makeMockProvider();
      const stablecoin = await SolanaStablecoin.create(provider, {
        preset: 'SSS-1',
        name: 'T',
        symbol: 'T',
      });
      (stablecoin as any)._program = null;
      mockProgram = makeMockProgram();
      const anchor = await import('@coral-xyz/anchor');
      (anchor.Program as unknown as ReturnType<typeof vi.fn>).mockImplementation(
        () => mockProgram
      );
      return { stablecoin, provider };
    }

    it('calls program.methods.burn with the correct amount as BN', async () => {
      const { stablecoin } = await makeStablecoin();
      const source = new PublicKey('So11111111111111111111111111111111111111112');

      await stablecoin.burnFrom({
        mint: stablecoin.mint,
        amount: 250_000n,
        source,
      });

      expect(mockProgram._methodCalls.burn).toHaveBeenCalledOnce();
      const [amountArg] = mockProgram._methodCalls.burn.mock.calls[0];
      expect(amountArg.toString()).toBe('250000');
    });

    it('includes sourceTokenAccount, config, and minterInfo in the accounts', async () => {
      const { stablecoin } = await makeStablecoin();
      const source = new PublicKey('So11111111111111111111111111111111111111112');

      await stablecoin.burnFrom({ mint: stablecoin.mint, amount: 1n, source });

      const accountsCallArgs = mockProgram._builder.accounts.mock.calls[0][0];
      expect(accountsCallArgs.sourceTokenAccount).toEqual(source);
      expect(accountsCallArgs.config).toBeInstanceOf(PublicKey);
      expect(accountsCallArgs.minterInfo).toBeInstanceOf(PublicKey);
    });
  });

  // ── getTotalSupply() ───────────────────────────────────────────────────────

  describe('getTotalSupply()', () => {
    it('reads totalMinted and totalBurned from the config PDA', async () => {
      const provider = makeMockProvider();
      const stablecoin = await SolanaStablecoin.create(provider, {
        preset: 'SSS-1',
        name: 'T',
        symbol: 'T',
      });

      const supply = await stablecoin.getTotalSupply();

      expect(mockProgram.account.stablecoinConfig.fetch).toHaveBeenCalledWith(
        stablecoin.configPda
      );
      expect(supply.totalMinted).toBe(1_000_000n);
      expect(supply.totalBurned).toBe(100_000n);
      expect(supply.circulatingSupply).toBe(900_000n);
    });

    it('falls back to Token-2022 mint supply when config PDA fetch fails', async () => {
      mockProgram.account.stablecoinConfig.fetch.mockRejectedValue(
        new Error('Account not found')
      );

      const provider = makeMockProvider();
      const stablecoin = await SolanaStablecoin.create(provider, {
        preset: 'SSS-1',
        name: 'T',
        symbol: 'T',
      });

      const supply = await stablecoin.getTotalSupply();

      // Fallback reads from getParsedAccountInfo which returns supply: '5000000'
      expect(supply.totalMinted).toBe(5_000_000n);
      expect(supply.totalBurned).toBe(0n);
      expect(supply.circulatingSupply).toBe(5_000_000n);
    });
  });

  // ── acceptAuthority() + acceptComplianceAuthority() ─────────────────────

  describe('acceptAuthority()', () => {
    async function makeStablecoin() {
      const provider = makeMockProvider();
      const stablecoin = await SolanaStablecoin.create(provider, {
        preset: 'SSS-1',
        name: 'T',
        symbol: 'T',
      });
      (stablecoin as any)._program = null;
      mockProgram = makeMockProgram();
      const anchor = await import('@coral-xyz/anchor');
      (anchor.Program as unknown as ReturnType<typeof vi.fn>).mockImplementation(
        () => mockProgram
      );
      return { stablecoin, provider };
    }

    it('calls program.methods.acceptAuthority with pending + config + mint accounts', async () => {
      const { stablecoin, provider } = await makeStablecoin();

      await stablecoin.acceptAuthority();

      expect(mockProgram._methodCalls.acceptAuthority).toHaveBeenCalledOnce();
      const accountsCallArgs = mockProgram._builder.accounts.mock.calls[0][0];
      expect(accountsCallArgs.pending).toEqual(provider.wallet.publicKey);
      expect(accountsCallArgs.config).toEqual(stablecoin.configPda);
      expect(accountsCallArgs.mint).toEqual(stablecoin.mint);
    });

    it('calls program.methods.acceptComplianceAuthority with correct accounts', async () => {
      const { stablecoin, provider } = await makeStablecoin();

      await stablecoin.acceptComplianceAuthority();

      expect(mockProgram._methodCalls.acceptComplianceAuthority).toHaveBeenCalledOnce();
      const accountsCallArgs = mockProgram._builder.accounts.mock.calls[0][0];
      expect(accountsCallArgs.pending).toEqual(provider.wallet.publicKey);
      expect(accountsCallArgs.config).toEqual(stablecoin.configPda);
    });
  });

  // ── SSS-3: create() with SSS-3 preset ────────────────────────────────────

  describe('create() with SSS-3 preset', () => {
    it('calls initialize with preset=3 and SSS-3 fields', async () => {
      const provider = makeMockProvider();
      const collateralMint = new PublicKey('So11111111111111111111111111111111111111112');
      const reserveVault = new PublicKey('11111111111111111111111111111111');

      await SolanaStablecoin.create(provider, {
        preset: 'SSS-3',
        name: 'Reserve USD',
        symbol: 'RUSD',
        decimals: 6,
        collateralMint,
        reserveVault,
        maxSupply: 1_000_000_000n,
      });

      expect(mockProgram._methodCalls.initialize).toHaveBeenCalledOnce();
      const [initParams] = mockProgram._methodCalls.initialize.mock.calls[0];
      expect(initParams.preset).toBe(3);
      expect(initParams.collateralMint).toEqual(collateralMint);
      expect(initParams.reserveVault).toEqual(reserveVault);
      expect(initParams.maxSupply?.toString()).toBe('1000000000');
    });

    it('sets maxSupply to null when not specified', async () => {
      const provider = makeMockProvider();

      await SolanaStablecoin.create(provider, {
        preset: 'SSS-1',
        name: 'No Max',
        symbol: 'NM',
      });

      const [initParams] = mockProgram._methodCalls.initialize.mock.calls[0];
      expect(initParams.maxSupply).toBeNull();
    });
  });

  // ── depositCollateral() ───────────────────────────────────────────────────

  describe('depositCollateral()', () => {
    async function makeStablecoin() {
      const provider = makeMockProvider();
      const stablecoin = await SolanaStablecoin.create(provider, {
        preset: 'SSS-3',
        name: 'T',
        symbol: 'T',
      });
      (stablecoin as any)._program = null;
      mockProgram = makeMockProgram();
      const anchor = await import('@coral-xyz/anchor');
      (anchor.Program as unknown as ReturnType<typeof vi.fn>).mockImplementation(
        () => mockProgram
      );
      return { stablecoin, provider };
    }

    it('calls program.methods.depositCollateral with correct amount as BN', async () => {
      const { stablecoin } = await makeStablecoin();
      const collateralMint = new PublicKey('So11111111111111111111111111111111111111112');
      const reserveVault = new PublicKey('11111111111111111111111111111111');
      const depositorCollateral = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

      await stablecoin.depositCollateral({
        amount: 500_000n,
        collateralMint,
        reserveVault,
        depositorCollateral,
      });

      expect(mockProgram._methodCalls.depositCollateral).toHaveBeenCalledOnce();
      const [amountArg] = mockProgram._methodCalls.depositCollateral.mock.calls[0];
      expect(amountArg.toString()).toBe('500000');

      const accountsCallArgs = mockProgram._builder.accounts.mock.calls[0][0];
      expect(accountsCallArgs.collateralMint).toEqual(collateralMint);
      expect(accountsCallArgs.reserveVault).toEqual(reserveVault);
      expect(accountsCallArgs.depositorCollateral).toEqual(depositorCollateral);
    });
  });

  // ── PDA derivation ────────────────────────────────────────────────────────

  describe('PDA derivation', () => {
    it('getConfigPda is deterministic', () => {
      const mint = new PublicKey('So11111111111111111111111111111111111111112');
      const [pda1] = SolanaStablecoin.getConfigPda(mint, SSS_TOKEN_PROGRAM_ID);
      const [pda2] = SolanaStablecoin.getConfigPda(mint, SSS_TOKEN_PROGRAM_ID);
      expect(pda1.toBase58()).toBe(pda2.toBase58());
    });

    it('getMinterPda is deterministic', () => {
      const configPda = new PublicKey('So11111111111111111111111111111111111111112');
      const minter = new PublicKey('11111111111111111111111111111111');
      const [pda1] = SolanaStablecoin.getMinterPda(configPda, minter, SSS_TOKEN_PROGRAM_ID);
      const [pda2] = SolanaStablecoin.getMinterPda(configPda, minter, SSS_TOKEN_PROGRAM_ID);
      expect(pda1.toBase58()).toBe(pda2.toBase58());
    });

    it('different mints produce different config PDAs', () => {
      const mint1 = new PublicKey('So11111111111111111111111111111111111111112');
      const mint2 = new PublicKey('11111111111111111111111111111111');
      const [pda1] = SolanaStablecoin.getConfigPda(mint1, SSS_TOKEN_PROGRAM_ID);
      const [pda2] = SolanaStablecoin.getConfigPda(mint2, SSS_TOKEN_PROGRAM_ID);
      expect(pda1.toBase58()).not.toBe(pda2.toBase58());
    });

    it('configPda on instance matches getConfigPda static', async () => {
      const provider = makeMockProvider();
      const stablecoin = await SolanaStablecoin.create(provider, {
        preset: 'SSS-1',
        name: 'T',
        symbol: 'T',
      });
      const [expected] = SolanaStablecoin.getConfigPda(
        stablecoin.mint,
        SSS_TOKEN_PROGRAM_ID
      );
      expect(stablecoin.configPda.toBase58()).toBe(expected.toBase58());
    });
  });

  // ── SSS-021: proposeAuthority() ───────────────────────────────────────────

  describe('proposeAuthority()', () => {
    async function makeStablecoin() {
      const provider = makeMockProvider();
      const stablecoin = await SolanaStablecoin.create(provider, {
        preset: 'SSS-1',
        name: 'T',
        symbol: 'T',
      });
      (stablecoin as any)._program = null;
      mockProgram = makeMockProgram();
      const anchor = await import('@coral-xyz/anchor');
      (anchor.Program as unknown as ReturnType<typeof vi.fn>).mockImplementation(
        () => mockProgram
      );
      return { stablecoin, provider };
    }

    it('calls program.methods.updateRoles with proposed authority as first positional arg', async () => {
      const { stablecoin } = await makeStablecoin();
      const proposed = new PublicKey('So11111111111111111111111111111111111111112');

      await stablecoin.proposeAuthority({ proposed });

      expect(mockProgram._methodCalls.updateRoles).toHaveBeenCalledOnce();
      // proposeAuthority(isCompliance=false) → updateRoles({ newAuthority: proposed, newComplianceAuthority: null })
      const [rolesArg] = mockProgram._methodCalls.updateRoles.mock.calls[0];
      expect(rolesArg.newAuthority).toEqual(proposed);
      expect(rolesArg.newComplianceAuthority).toBeNull();
    });

    it('includes config, mint, and authority in accounts', async () => {
      const { stablecoin, provider } = await makeStablecoin();
      const proposed = new PublicKey('So11111111111111111111111111111111111111112');

      await stablecoin.proposeAuthority({ proposed });

      const accountsCallArgs = mockProgram._builder.accounts.mock.calls[0][0];
      expect(accountsCallArgs.authority).toEqual(provider.wallet.publicKey);
      expect(accountsCallArgs.config).toEqual(stablecoin.configPda);
      expect(accountsCallArgs.mint).toEqual(stablecoin.mint);
    });

    it('returns the transaction signature from rpc()', async () => {
      const { stablecoin } = await makeStablecoin();
      const proposed = new PublicKey('So11111111111111111111111111111111111111112');

      const sig = await stablecoin.proposeAuthority({ proposed });
      expect(sig).toBe('mockTxSig');
    });
  });

  // ── SSS-021: redeem() ─────────────────────────────────────────────────────

  describe('redeem()', () => {
    async function makeStablecoin() {
      const provider = makeMockProvider();
      const stablecoin = await SolanaStablecoin.create(provider, {
        preset: 'SSS-3',
        name: 'Reserve USD',
        symbol: 'RUSD',
        decimals: 6,
      });
      (stablecoin as any)._program = null;
      mockProgram = makeMockProgram();
      const anchor = await import('@coral-xyz/anchor');
      (anchor.Program as unknown as ReturnType<typeof vi.fn>).mockImplementation(
        () => mockProgram
      );
      return { stablecoin, provider };
    }

    it('calls program.methods.redeem with correct amount as BN', async () => {
      const { stablecoin } = await makeStablecoin();
      const collateralMint = new PublicKey('So11111111111111111111111111111111111111112');
      const reserveVault = new PublicKey('11111111111111111111111111111111');
      const redeemerSssAccount = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
      const redeemerCollateral = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe8bSe');

      await stablecoin.redeem({
        amount: 250_000n,
        redeemerSssAccount,
        collateralMint,
        reserveVault,
        redeemerCollateral,
      });

      expect(mockProgram._methodCalls.redeem).toHaveBeenCalledOnce();
      const [amountArg] = mockProgram._methodCalls.redeem.mock.calls[0];
      expect(amountArg.toString()).toBe('250000');
    });

    it('includes all required accounts: redeemer, config, sss_mint, collateral, vault', async () => {
      const { stablecoin, provider } = await makeStablecoin();
      const collateralMint = new PublicKey('So11111111111111111111111111111111111111112');
      const reserveVault = new PublicKey('11111111111111111111111111111111');
      const redeemerSssAccount = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
      const redeemerCollateral = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe8bSe');

      await stablecoin.redeem({
        amount: 100n,
        redeemerSssAccount,
        collateralMint,
        reserveVault,
        redeemerCollateral,
      });

      const accountsCallArgs = mockProgram._builder.accounts.mock.calls[0][0];
      expect(accountsCallArgs.redeemer).toEqual(provider.wallet.publicKey);
      expect(accountsCallArgs.config).toEqual(stablecoin.configPda);
      expect(accountsCallArgs.sssMint).toEqual(stablecoin.mint);
      expect(accountsCallArgs.collateralMint).toEqual(collateralMint);
      expect(accountsCallArgs.reserveVault).toEqual(reserveVault);
      expect(accountsCallArgs.redeemerSssAccount).toEqual(redeemerSssAccount);
      expect(accountsCallArgs.redeemerCollateral).toEqual(redeemerCollateral);
    });

    it('uses TOKEN_2022_PROGRAM_ID as sssTokenProgram by default', async () => {
      const { stablecoin } = await makeStablecoin();
      const { TOKEN_2022_PROGRAM_ID } = await import('@solana/spl-token');

      await stablecoin.redeem({
        amount: 1n,
        redeemerSssAccount: new PublicKey('So11111111111111111111111111111111111111112'),
        collateralMint: new PublicKey('11111111111111111111111111111111'),
        reserveVault: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
        redeemerCollateral: new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe8bSe'),
      });

      const accountsCallArgs = mockProgram._builder.accounts.mock.calls[0][0];
      expect(accountsCallArgs.sssTokenProgram).toEqual(TOKEN_2022_PROGRAM_ID);
    });

    it('accepts a custom collateralTokenProgram override', async () => {
      const { stablecoin } = await makeStablecoin();
      const customProgram = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

      await stablecoin.redeem({
        amount: 1n,
        redeemerSssAccount: new PublicKey('So11111111111111111111111111111111111111112'),
        collateralMint: new PublicKey('11111111111111111111111111111111'),
        reserveVault: new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe8bSe'),
        redeemerCollateral: new PublicKey('So11111111111111111111111111111111111111112'),
        collateralTokenProgram: customProgram,
      });

      const accountsCallArgs = mockProgram._builder.accounts.mock.calls[0][0];
      expect(accountsCallArgs.collateralTokenProgram).toEqual(customProgram);
    });

    it('returns the transaction signature from rpc()', async () => {
      const { stablecoin } = await makeStablecoin();

      const sig = await stablecoin.redeem({
        amount: 1n,
        redeemerSssAccount: new PublicKey('So11111111111111111111111111111111111111112'),
        collateralMint: new PublicKey('11111111111111111111111111111111'),
        reserveVault: new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe8bSe'),
        redeemerCollateral: new PublicKey('So11111111111111111111111111111111111111112'),
      });
      expect(sig).toBe('mockTxSig');
    });
  });

  // ── SSS-021: SDK-level max_supply guard ───────────────────────────────────

  describe('max_supply enforcement (SDK-level guard)', () => {
    it('passes maxSupply as BN to initialize for SSS-3', async () => {
      const provider = makeMockProvider();

      await SolanaStablecoin.create(provider, {
        preset: 'SSS-3',
        name: 'Capped USD',
        symbol: 'CUSD',
        maxSupply: 5_000_000n,
      });

      expect(mockProgram._methodCalls.initialize).toHaveBeenCalledOnce();
      const [initParams] = mockProgram._methodCalls.initialize.mock.calls[0];
      expect(initParams.maxSupply?.toString()).toBe('5000000');
    });

    it('passes maxSupply as BN to initialize for SSS-1', async () => {
      const provider = makeMockProvider();

      await SolanaStablecoin.create(provider, {
        preset: 'SSS-1',
        name: 'Capped Token',
        symbol: 'CT',
        maxSupply: 1_000_000_000n,
      });

      const [initParams] = mockProgram._methodCalls.initialize.mock.calls[0];
      expect(initParams.maxSupply?.toString()).toBe('1000000000');
    });

    it('sets maxSupply to null when undefined', async () => {
      const provider = makeMockProvider();

      await SolanaStablecoin.create(provider, {
        preset: 'SSS-1',
        name: 'No Cap',
        symbol: 'NC',
      });

      const [initParams] = mockProgram._methodCalls.initialize.mock.calls[0];
      expect(initParams.maxSupply).toBeNull();
    });

    it('sets maxSupply to null when 0n (explicitly unlimited)', async () => {
      const provider = makeMockProvider();

      await SolanaStablecoin.create(provider, {
        preset: 'SSS-1',
        name: 'Explicit No Cap',
        symbol: 'ENC',
        maxSupply: 0n,
      });

      const [initParams] = mockProgram._methodCalls.initialize.mock.calls[0];
      expect(initParams.maxSupply).toBeNull();
    });

    it('getTotalSupply returns correct circulating supply after mints', async () => {
      const provider = makeMockProvider();
      const stablecoin = await SolanaStablecoin.create(provider, {
        preset: 'SSS-1',
        name: 'T',
        symbol: 'T',
      });

      // Mock: 2M minted, 500k burned → 1.5M circulating
      mockProgram.account.stablecoinConfig.fetch.mockResolvedValueOnce({
        totalMinted: new BN(2_000_000),
        totalBurned: new BN(500_000),
      });

      const supply = await stablecoin.getTotalSupply();
      expect(supply.totalMinted).toBe(2_000_000n);
      expect(supply.totalBurned).toBe(500_000n);
      expect(supply.circulatingSupply).toBe(1_500_000n);
    });
  });
});

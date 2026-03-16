import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PublicKey, Keypair } from '@solana/web3.js';
import { CollateralConfigModule } from './CollateralConfigModule';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mockProvider() {
  return {
    wallet: { publicKey: Keypair.generate().publicKey },
    connection: {
      getAccountInfo: vi.fn().mockResolvedValue(null),
    },
    sendAndConfirm: vi.fn().mockResolvedValue('mockedTxSig'),
  } as any;
}

const PROGRAM_ID = Keypair.generate().publicKey;
const SSS_MINT = Keypair.generate().publicKey;
const COLLATERAL_MINT = Keypair.generate().publicKey;

// ─── Mock Anchor program factory ─────────────────────────────────────────────

function buildMockProgram(opts: {
  rpcResult?: string;
  fetchResult?: object | null;
} = {}) {
  const rpcResult = opts.rpcResult ?? 'mockTxSignature';
  const fetchResult = opts.fetchResult;

  const rpc = vi.fn().mockResolvedValue(rpcResult);
  const accounts = {
    collateralConfig: {
      fetch: vi.fn().mockImplementation(async () => {
        if (fetchResult === null) throw new Error('Account not found');
        return fetchResult;
      }),
    },
  };

  const methodsChain = {
    accounts: vi.fn().mockReturnThis(),
    rpc,
  };

  return {
    methods: {
      registerCollateral: vi.fn().mockReturnValue(methodsChain),
      updateCollateralConfig: vi.fn().mockReturnValue(methodsChain),
    },
    account: accounts,
    _methodsChain: methodsChain,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('CollateralConfigModule', () => {
  let provider: ReturnType<typeof mockProvider>;
  let module: CollateralConfigModule;
  let mockProgram: ReturnType<typeof buildMockProgram>;

  beforeEach(() => {
    provider = mockProvider();
    module = new CollateralConfigModule(provider, PROGRAM_ID);
    mockProgram = buildMockProgram();
    // Inject the mock program
    (module as any)._program = mockProgram;
  });

  // ─── PDA derivation ───────────────────────────────────────────────────────

  describe('getCollateralConfigPda', () => {
    it('returns a valid PublicKey', () => {
      const [pda, bump] = module.getCollateralConfigPda(SSS_MINT, COLLATERAL_MINT);
      expect(pda).toBeInstanceOf(PublicKey);
      expect(typeof bump).toBe('number');
      expect(bump).toBeGreaterThanOrEqual(0);
      expect(bump).toBeLessThanOrEqual(255);
    });

    it('returns different PDAs for different collateral mints', () => {
      const otherMint = Keypair.generate().publicKey;
      const [pda1] = module.getCollateralConfigPda(SSS_MINT, COLLATERAL_MINT);
      const [pda2] = module.getCollateralConfigPda(SSS_MINT, otherMint);
      expect(pda1.toBase58()).not.toBe(pda2.toBase58());
    });

    it('returns different PDAs for different SSS mints', () => {
      const otherSssMint = Keypair.generate().publicKey;
      const [pda1] = module.getCollateralConfigPda(SSS_MINT, COLLATERAL_MINT);
      const [pda2] = module.getCollateralConfigPda(otherSssMint, COLLATERAL_MINT);
      expect(pda1.toBase58()).not.toBe(pda2.toBase58());
    });

    it('is deterministic', () => {
      const [pda1] = module.getCollateralConfigPda(SSS_MINT, COLLATERAL_MINT);
      const [pda2] = module.getCollateralConfigPda(SSS_MINT, COLLATERAL_MINT);
      expect(pda1.toBase58()).toBe(pda2.toBase58());
    });
  });

  describe('getConfigPda', () => {
    it('returns a valid PDA for stablecoin config', () => {
      const [pda, bump] = module.getConfigPda(SSS_MINT);
      expect(pda).toBeInstanceOf(PublicKey);
      expect(bump).toBeGreaterThanOrEqual(0);
    });
  });

  // ─── registerCollateral ───────────────────────────────────────────────────

  describe('registerCollateral', () => {
    it('calls the Anchor method with correct params and returns tx sig', async () => {
      const sig = await module.registerCollateral({
        mint: SSS_MINT,
        collateralMint: COLLATERAL_MINT,
        whitelisted: true,
        maxLtvBps: 7500,
        liquidationThresholdBps: 8000,
        liquidationBonusBps: 500,
        maxDepositCap: 0n,
      });

      expect(sig).toBe('mockTxSignature');
      expect(mockProgram.methods.registerCollateral).toHaveBeenCalledOnce();

      const callArg = mockProgram.methods.registerCollateral.mock.calls[0][0];
      expect(callArg.whitelisted).toBe(true);
      expect(callArg.maxLtvBps).toBe(7500);
      expect(callArg.liquidationThresholdBps).toBe(8000);
      expect(callArg.liquidationBonusBps).toBe(500);
    });

    it('passes authority from provider wallet', async () => {
      await module.registerCollateral({
        mint: SSS_MINT,
        collateralMint: COLLATERAL_MINT,
        whitelisted: false,
        maxLtvBps: 5000,
        liquidationThresholdBps: 6000,
        liquidationBonusBps: 300,
        maxDepositCap: 1_000_000n,
      });

      const accountsArg = mockProgram._methodsChain.accounts.mock.calls[0][0];
      expect(accountsArg.authority.toBase58()).toBe(
        provider.wallet.publicKey.toBase58(),
      );
    });

    it('encodes maxDepositCap as BN', async () => {
      await module.registerCollateral({
        mint: SSS_MINT,
        collateralMint: COLLATERAL_MINT,
        whitelisted: true,
        maxLtvBps: 7000,
        liquidationThresholdBps: 7500,
        liquidationBonusBps: 200,
        maxDepositCap: 500_000_000n,
      });

      const callArg = mockProgram.methods.registerCollateral.mock.calls[0][0];
      // BN.toString() should equal the original bigint
      expect(callArg.maxDepositCap.toString()).toBe('500000000');
    });
  });

  // ─── updateCollateralConfig ───────────────────────────────────────────────

  describe('updateCollateralConfig', () => {
    it('calls the Anchor method with correct params', async () => {
      const sig = await module.updateCollateralConfig({
        mint: SSS_MINT,
        collateralMint: COLLATERAL_MINT,
        whitelisted: false,
        maxLtvBps: 6000,
        liquidationThresholdBps: 7000,
        liquidationBonusBps: 400,
        maxDepositCap: 100_000_000n,
      });

      expect(sig).toBe('mockTxSignature');
      expect(mockProgram.methods.updateCollateralConfig).toHaveBeenCalledOnce();

      const callArg = mockProgram.methods.updateCollateralConfig.mock.calls[0][0];
      expect(callArg.whitelisted).toBe(false);
      expect(callArg.maxLtvBps).toBe(6000);
      expect(callArg.liquidationThresholdBps).toBe(7000);
      expect(callArg.liquidationBonusBps).toBe(400);
    });
  });

  // ─── getCollateralConfig ──────────────────────────────────────────────────

  describe('getCollateralConfig', () => {
    it('returns null when the account does not exist', async () => {
      mockProgram.account.collateralConfig.fetch.mockRejectedValue(
        new Error('Account not found'),
      );
      const result = await module.getCollateralConfig(SSS_MINT, COLLATERAL_MINT);
      expect(result).toBeNull();
    });

    it('decodes all fields correctly', async () => {
      const { BN } = await import('@coral-xyz/anchor');
      mockProgram.account.collateralConfig.fetch.mockResolvedValue({
        sssMint: SSS_MINT,
        collateralMint: COLLATERAL_MINT,
        whitelisted: true,
        maxLtvBps: 7500,
        liquidationThresholdBps: 8000,
        liquidationBonusBps: 500,
        maxDepositCap: new BN('1000000'),
        totalDeposited: new BN('250000'),
      });

      const config = await module.getCollateralConfig(SSS_MINT, COLLATERAL_MINT);

      expect(config).not.toBeNull();
      expect(config!.sssMint.toBase58()).toBe(SSS_MINT.toBase58());
      expect(config!.collateralMint.toBase58()).toBe(COLLATERAL_MINT.toBase58());
      expect(config!.whitelisted).toBe(true);
      expect(config!.maxLtvBps).toBe(7500);
      expect(config!.liquidationThresholdBps).toBe(8000);
      expect(config!.liquidationBonusBps).toBe(500);
      expect(config!.maxDepositCap).toBe(1_000_000n);
      expect(config!.totalDeposited).toBe(250_000n);
    });

    it('handles zero maxDepositCap (unlimited)', async () => {
      const { BN } = await import('@coral-xyz/anchor');
      mockProgram.account.collateralConfig.fetch.mockResolvedValue({
        sssMint: SSS_MINT,
        collateralMint: COLLATERAL_MINT,
        whitelisted: true,
        maxLtvBps: 7500,
        liquidationThresholdBps: 8000,
        liquidationBonusBps: 500,
        maxDepositCap: new BN('0'),
        totalDeposited: new BN('0'),
      });

      const config = await module.getCollateralConfig(SSS_MINT, COLLATERAL_MINT);
      expect(config!.maxDepositCap).toBe(0n);
      expect(config!.totalDeposited).toBe(0n);
    });
  });

  // ─── isWhitelisted ────────────────────────────────────────────────────────

  describe('isWhitelisted', () => {
    it('returns false when CollateralConfig does not exist', async () => {
      mockProgram.account.collateralConfig.fetch.mockRejectedValue(
        new Error('Account not found'),
      );
      const result = await module.isWhitelisted(SSS_MINT, COLLATERAL_MINT);
      expect(result).toBe(false);
    });

    it('returns true when whitelisted=true', async () => {
      const { BN } = await import('@coral-xyz/anchor');
      mockProgram.account.collateralConfig.fetch.mockResolvedValue({
        sssMint: SSS_MINT,
        collateralMint: COLLATERAL_MINT,
        whitelisted: true,
        maxLtvBps: 7500,
        liquidationThresholdBps: 8000,
        liquidationBonusBps: 500,
        maxDepositCap: new BN('0'),
        totalDeposited: new BN('0'),
      });
      const result = await module.isWhitelisted(SSS_MINT, COLLATERAL_MINT);
      expect(result).toBe(true);
    });

    it('returns false when whitelisted=false', async () => {
      const { BN } = await import('@coral-xyz/anchor');
      mockProgram.account.collateralConfig.fetch.mockResolvedValue({
        sssMint: SSS_MINT,
        collateralMint: COLLATERAL_MINT,
        whitelisted: false,
        maxLtvBps: 7500,
        liquidationThresholdBps: 8000,
        liquidationBonusBps: 500,
        maxDepositCap: new BN('0'),
        totalDeposited: new BN('0'),
      });
      const result = await module.isWhitelisted(SSS_MINT, COLLATERAL_MINT);
      expect(result).toBe(false);
    });
  });
});

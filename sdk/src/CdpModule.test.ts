import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PublicKey, Connection } from '@solana/web3.js';
import { AnchorProvider } from '@coral-xyz/anchor';

// ─── Mocks ────────────────────────────────────────────────────────────────────

// Mock the IDL import so tests don't need actual build artifacts
vi.mock('./idl/sss_token.json', () => ({
  default: {
    version: '0.1.0',
    name: 'sss_token',
    address: 'AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat',
    instructions: [],
    accounts: [],
    errors: [],
    types: [],
    metadata: {},
  },
}));

// Mock @coral-xyz/anchor Program
vi.mock('@coral-xyz/anchor', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    Program: vi.fn().mockImplementation(() => ({
      methods: {
        cdpDepositCollateral: vi.fn().mockReturnValue({
          accounts: vi.fn().mockReturnValue({
            rpc: vi.fn().mockResolvedValue('mock-deposit-sig'),
          }),
        }),
        cdpBorrowStable: vi.fn().mockReturnValue({
          accounts: vi.fn().mockReturnValue({
            rpc: vi.fn().mockResolvedValue('mock-borrow-sig'),
          }),
        }),
        cdpRepayStable: vi.fn().mockReturnValue({
          accounts: vi.fn().mockReturnValue({
            rpc: vi.fn().mockResolvedValue('mock-repay-sig'),
          }),
        }),
      },
      account: {
        cdpPosition: {
          fetch: vi.fn(),
        },
        collateralVault: {
          fetch: vi.fn(),
        },
      },
    })),
    BN: actual.BN,
  };
});

import { CdpModule, CdpPosition, CollateralEntry } from './CdpModule';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const MOCK_PROGRAM_ID = new PublicKey('AxE9NQ8z6tzNJT9AHBu2YRsVqX41uCjPmpN5RLavAaat');
const MOCK_SSS_MINT = PublicKey.unique();
const MOCK_USER = PublicKey.unique();
const MOCK_COLLATERAL_MINT = PublicKey.unique();
const MOCK_COLLATERAL_MINT_2 = PublicKey.unique();
const MOCK_PYTH_FEED = PublicKey.unique();
const MOCK_USER_SSS_ACCOUNT = PublicKey.unique();
const MOCK_USER_COLLATERAL_ACCOUNT = PublicKey.unique();
const MOCK_VAULT_TOKEN_ACCOUNT = PublicKey.unique();

function makeProvider(user = MOCK_USER): AnchorProvider {
  return {
    wallet: { publicKey: user },
    connection: {} as Connection,
  } as unknown as AnchorProvider;
}

// ─── PDA derivation tests ─────────────────────────────────────────────────────

describe('CdpModule — PDA derivation', () => {
  it('getCollateralVaultPda returns a valid PublicKey', () => {
    const cdp = new CdpModule(makeProvider(), MOCK_SSS_MINT, MOCK_PROGRAM_ID);
    const pda = cdp.getCollateralVaultPda(MOCK_USER, MOCK_COLLATERAL_MINT);
    expect(pda).toBeInstanceOf(PublicKey);
    // Same inputs → same PDA (deterministic)
    const pda2 = cdp.getCollateralVaultPda(MOCK_USER, MOCK_COLLATERAL_MINT);
    expect(pda.equals(pda2)).toBe(true);
  });

  it('getCollateralVaultPda differs per collateral mint', () => {
    const cdp = new CdpModule(makeProvider(), MOCK_SSS_MINT, MOCK_PROGRAM_ID);
    const pda1 = cdp.getCollateralVaultPda(MOCK_USER, MOCK_COLLATERAL_MINT);
    const pda2 = cdp.getCollateralVaultPda(MOCK_USER, MOCK_COLLATERAL_MINT_2);
    expect(pda1.equals(pda2)).toBe(false);
  });

  it('getCdpPositionPda returns a valid PublicKey', () => {
    const cdp = new CdpModule(makeProvider(), MOCK_SSS_MINT, MOCK_PROGRAM_ID);
    const pda = cdp.getCdpPositionPda(MOCK_USER);
    expect(pda).toBeInstanceOf(PublicKey);
    // Deterministic
    expect(pda.equals(cdp.getCdpPositionPda(MOCK_USER))).toBe(true);
  });

  it('getCdpPositionPda differs per SSS mint', () => {
    const sssMint2 = PublicKey.unique();
    const cdp1 = new CdpModule(makeProvider(), MOCK_SSS_MINT, MOCK_PROGRAM_ID);
    const cdp2 = new CdpModule(makeProvider(), sssMint2, MOCK_PROGRAM_ID);
    expect(cdp1.getCdpPositionPda(MOCK_USER).equals(cdp2.getCdpPositionPda(MOCK_USER))).toBe(false);
  });
});

// ─── depositCollateral ────────────────────────────────────────────────────────

describe('CdpModule — depositCollateral', () => {
  let cdp: CdpModule;
  let mockProgram: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    cdp = new CdpModule(makeProvider(), MOCK_SSS_MINT, MOCK_PROGRAM_ID);
    // Force load program so we can access the mock
    mockProgram = await (cdp as any)._loadProgram();
  });

  it('calls cdpDepositCollateral with correct amount and returns signature', async () => {
    const sig = await cdp.depositCollateral({
      sssMint: MOCK_SSS_MINT,
      collateralMint: MOCK_COLLATERAL_MINT,
      amount: 1_000_000n,
      userCollateralAccount: MOCK_USER_COLLATERAL_ACCOUNT,
      vaultTokenAccount: MOCK_VAULT_TOKEN_ACCOUNT,
    });

    expect(sig).toBe('mock-deposit-sig');
    expect(mockProgram.methods.cdpDepositCollateral).toHaveBeenCalledOnce();
    const [bnArg] = mockProgram.methods.cdpDepositCollateral.mock.calls[0];
    expect(bnArg.toString()).toBe('1000000');
  });

  it('passes collateralTokenProgram when provided', async () => {
    const customTokenProgram = PublicKey.unique();
    await cdp.depositCollateral({
      sssMint: MOCK_SSS_MINT,
      collateralMint: MOCK_COLLATERAL_MINT,
      amount: 500n,
      userCollateralAccount: MOCK_USER_COLLATERAL_ACCOUNT,
      vaultTokenAccount: MOCK_VAULT_TOKEN_ACCOUNT,
      collateralTokenProgram: customTokenProgram,
    });

    // The accounts() call should have been made — check it was called
    const methodChain = mockProgram.methods.cdpDepositCollateral.mock.results[0].value;
    expect(methodChain.accounts).toHaveBeenCalledOnce();
  });
});

// ─── borrowStable ─────────────────────────────────────────────────────────────

describe('CdpModule — borrowStable', () => {
  let cdp: CdpModule;
  let mockProgram: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    cdp = new CdpModule(makeProvider(), MOCK_SSS_MINT, MOCK_PROGRAM_ID);
    mockProgram = await (cdp as any)._loadProgram();
  });

  it('calls cdpBorrowStable with correct amount and returns signature', async () => {
    const sig = await cdp.borrowStable({
      sssMint: MOCK_SSS_MINT,
      collateralMint: MOCK_COLLATERAL_MINT,
      amount: 750_000n,
      userSssAccount: MOCK_USER_SSS_ACCOUNT,
      pythPriceFeed: MOCK_PYTH_FEED,
    });

    expect(sig).toBe('mock-borrow-sig');
    expect(mockProgram.methods.cdpBorrowStable).toHaveBeenCalledOnce();
    const [bnArg] = mockProgram.methods.cdpBorrowStable.mock.calls[0];
    expect(bnArg.toString()).toBe('750000');
  });

  it('includes pythPriceFeed in accounts', async () => {
    await cdp.borrowStable({
      sssMint: MOCK_SSS_MINT,
      collateralMint: MOCK_COLLATERAL_MINT,
      amount: 1n,
      userSssAccount: MOCK_USER_SSS_ACCOUNT,
      pythPriceFeed: MOCK_PYTH_FEED,
    });

    const methodResult = mockProgram.methods.cdpBorrowStable.mock.results[0].value;
    const accountsArg = methodResult.accounts.mock.calls[0][0];
    expect(accountsArg.pythPriceFeed.equals(MOCK_PYTH_FEED)).toBe(true);
  });
});

// ─── repayStable ──────────────────────────────────────────────────────────────

describe('CdpModule — repayStable', () => {
  let cdp: CdpModule;
  let mockProgram: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    cdp = new CdpModule(makeProvider(), MOCK_SSS_MINT, MOCK_PROGRAM_ID);
    mockProgram = await (cdp as any)._loadProgram();
  });

  it('calls cdpRepayStable with correct amount and returns signature', async () => {
    const sig = await cdp.repayStable({
      sssMint: MOCK_SSS_MINT,
      collateralMint: MOCK_COLLATERAL_MINT,
      amount: 250_000n,
      userSssAccount: MOCK_USER_SSS_ACCOUNT,
      vaultTokenAccount: MOCK_VAULT_TOKEN_ACCOUNT,
      userCollateralAccount: MOCK_USER_COLLATERAL_ACCOUNT,
    });

    expect(sig).toBe('mock-repay-sig');
    const [bnArg] = mockProgram.methods.cdpRepayStable.mock.calls[0];
    expect(bnArg.toString()).toBe('250000');
  });

  it('includes both token programs in accounts', async () => {
    await cdp.repayStable({
      sssMint: MOCK_SSS_MINT,
      collateralMint: MOCK_COLLATERAL_MINT,
      amount: 1n,
      userSssAccount: MOCK_USER_SSS_ACCOUNT,
      vaultTokenAccount: MOCK_VAULT_TOKEN_ACCOUNT,
      userCollateralAccount: MOCK_USER_COLLATERAL_ACCOUNT,
    });

    const methodResult = mockProgram.methods.cdpRepayStable.mock.results[0].value;
    const accountsArg = methodResult.accounts.mock.calls[0][0];
    // sssTokenProgram should be TOKEN_2022_PROGRAM_ID
    expect(accountsArg.sssTokenProgram).toBeDefined();
    expect(accountsArg.collateralTokenProgram).toBeDefined();
  });
});

// ─── getPosition ─────────────────────────────────────────────────────────────

describe('CdpModule — getPosition', () => {
  let cdp: CdpModule;
  let mockProgram: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    cdp = new CdpModule(makeProvider(), MOCK_SSS_MINT, MOCK_PROGRAM_ID);
    mockProgram = await (cdp as any)._loadProgram();
  });

  it('returns zeroed position when CdpPosition account does not exist', async () => {
    mockProgram.account.cdpPosition.fetch.mockRejectedValue(new Error('not found'));

    const pos = await cdp.getPosition(MOCK_USER, {} as Connection, []);

    expect(pos.owner.equals(MOCK_USER)).toBe(true);
    expect(pos.debtUsdc).toBe(0);
    expect(pos.collateral).toHaveLength(0);
    expect(pos.ratio).toBe(Infinity);
    expect(pos.healthFactor).toBe(Infinity);
    expect(pos.liquidationPrice).toBe(0);
  });

  it('returns Infinity ratio/health when debt is zero', async () => {
    mockProgram.account.cdpPosition.fetch.mockResolvedValue({ debtAmount: { toString: () => '0' } });

    const pos = await cdp.getPosition(MOCK_USER, {} as Connection, []);

    expect(pos.debtUsdc).toBe(0);
    expect(pos.ratio).toBe(Infinity);
    expect(pos.healthFactor).toBe(Infinity);
  });

  it('computes ratio correctly with price data', async () => {
    // 1,000,000 SSS tokens debt (6dp → 1 USDC)
    mockProgram.account.cdpPosition.fetch.mockResolvedValue({
      debtAmount: { toString: () => '1000000' },
    });
    // 2,000,000 units collateral (6dp → 2 tokens)
    mockProgram.account.collateralVault.fetch.mockResolvedValue({
      depositedAmount: { toString: () => '2000000' },
      vaultTokenAccount: MOCK_VAULT_TOKEN_ACCOUNT,
    });

    // 1 collateral unit = $1 USD; 2 units = $2 collateral value; debt = $1 → ratio = 2.0
    const prices = new Map([[MOCK_COLLATERAL_MINT.toBase58(), 1.0]]);
    const pos = await cdp.getPosition(
      MOCK_USER,
      {} as Connection,
      [MOCK_COLLATERAL_MINT],
      prices,
    );

    expect(pos.debtUsdc).toBeCloseTo(1.0, 5);
    expect(pos.ratio).toBeCloseTo(2.0, 5);
    // health = collateral_value / (debt * 1.2) = 2 / (1 * 1.2) = 1.666...
    expect(pos.healthFactor).toBeCloseTo(2 / 1.2, 4);
  });

  it('health factor < 1 when undercollateralised (120% threshold)', async () => {
    // debt = $1, collateral = $1.1 (only 110% collateral ratio < 120% threshold)
    mockProgram.account.cdpPosition.fetch.mockResolvedValue({
      debtAmount: { toString: () => '1000000' },
    });
    mockProgram.account.collateralVault.fetch.mockResolvedValue({
      depositedAmount: { toString: () => '1100000' },
      vaultTokenAccount: MOCK_VAULT_TOKEN_ACCOUNT,
    });

    const prices = new Map([[MOCK_COLLATERAL_MINT.toBase58(), 1.0]]);
    const pos = await cdp.getPosition(MOCK_USER, {} as Connection, [MOCK_COLLATERAL_MINT], prices);

    // ratio = 1.1 / 1 = 1.1 (110%)
    expect(pos.ratio).toBeCloseTo(1.1, 4);
    // health = 1.1 / (1 * 1.2) ≈ 0.917 < 1 → liquidatable
    expect(pos.healthFactor).toBeLessThan(1);
  });

  it('computes liquidation price for first collateral entry', async () => {
    // debt = 1 USDC, collateral = 2 units
    mockProgram.account.cdpPosition.fetch.mockResolvedValue({
      debtAmount: { toString: () => '1000000' },
    });
    mockProgram.account.collateralVault.fetch.mockResolvedValue({
      depositedAmount: { toString: () => '2000000' },
      vaultTokenAccount: MOCK_VAULT_TOKEN_ACCOUNT,
    });

    const prices = new Map([[MOCK_COLLATERAL_MINT.toBase58(), 1.0]]);
    const pos = await cdp.getPosition(MOCK_USER, {} as Connection, [MOCK_COLLATERAL_MINT], prices);

    // liq price = (debt * 1.2) / collateral_units = (1 * 1.2) / 2 = 0.6
    expect(pos.liquidationPrice).toBeCloseTo(0.6, 5);
  });

  it('aggregates multiple collateral types', async () => {
    mockProgram.account.cdpPosition.fetch.mockResolvedValue({
      debtAmount: { toString: () => '2000000' },
    });
    // Two vaults; first call returns vault1, second returns vault2
    mockProgram.account.collateralVault.fetch
      .mockResolvedValueOnce({
        depositedAmount: { toString: () => '1000000' },
        vaultTokenAccount: MOCK_VAULT_TOKEN_ACCOUNT,
      })
      .mockResolvedValueOnce({
        depositedAmount: { toString: () => '2000000' },
        vaultTokenAccount: MOCK_VAULT_TOKEN_ACCOUNT,
      });

    // mint1 @ $1, mint2 @ $1.5 → total collateral = 1*1 + 2*1.5 = $4
    const prices = new Map([
      [MOCK_COLLATERAL_MINT.toBase58(), 1.0],
      [MOCK_COLLATERAL_MINT_2.toBase58(), 1.5],
    ]);

    const pos = await cdp.getPosition(
      MOCK_USER,
      {} as Connection,
      [MOCK_COLLATERAL_MINT, MOCK_COLLATERAL_MINT_2],
      prices,
    );

    expect(pos.collateral).toHaveLength(2);
    expect(pos.debtUsdc).toBeCloseTo(2.0, 5);
    // ratio = 4 / 2 = 2.0
    expect(pos.ratio).toBeCloseTo(2.0, 4);
  });

  it('skips vaults that do not exist on-chain', async () => {
    mockProgram.account.cdpPosition.fetch.mockResolvedValue({
      debtAmount: { toString: () => '1000000' },
    });
    mockProgram.account.collateralVault.fetch
      .mockResolvedValueOnce({
        depositedAmount: { toString: () => '5000000' },
        vaultTokenAccount: MOCK_VAULT_TOKEN_ACCOUNT,
      })
      .mockRejectedValueOnce(new Error('not found'));

    const prices = new Map([[MOCK_COLLATERAL_MINT.toBase58(), 1.0]]);
    const pos = await cdp.getPosition(
      MOCK_USER,
      {} as Connection,
      [MOCK_COLLATERAL_MINT, MOCK_COLLATERAL_MINT_2],
      prices,
    );

    // Only one vault found
    expect(pos.collateral).toHaveLength(1);
    expect(pos.collateral[0].mint.equals(MOCK_COLLATERAL_MINT)).toBe(true);
  });

  it('returns zero ratio/health when no price data provided', async () => {
    mockProgram.account.cdpPosition.fetch.mockResolvedValue({
      debtAmount: { toString: () => '1000000' },
    });
    mockProgram.account.collateralVault.fetch.mockResolvedValue({
      depositedAmount: { toString: () => '5000000' },
      vaultTokenAccount: MOCK_VAULT_TOKEN_ACCOUNT,
    });

    // No price map provided
    const pos = await cdp.getPosition(MOCK_USER, {} as Connection, [MOCK_COLLATERAL_MINT]);

    expect(pos.debtUsdc).toBeCloseTo(1.0, 5);
    expect(pos.ratio).toBe(0);
    expect(pos.healthFactor).toBe(0);
  });
});

// ─── Type shape ──────────────────────────────────────────────────────────────

describe('CdpPosition type shape', () => {
  it('has all required fields', () => {
    const pos: CdpPosition = {
      owner: PublicKey.unique(),
      collateral: [],
      debtUsdc: 0,
      ratio: Infinity,
      healthFactor: Infinity,
      liquidationPrice: 0,
    };
    expect(pos).toBeDefined();
  });

  it('CollateralEntry has all required fields', () => {
    const entry: CollateralEntry = {
      mint: PublicKey.unique(),
      deposited: 1_000_000n,
      vaultPda: PublicKey.unique(),
      vaultTokenAccount: PublicKey.unique(),
    };
    expect(entry).toBeDefined();
  });
});

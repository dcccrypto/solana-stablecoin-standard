/**
 * SSS-100 — BadDebtBackstopModule: contribute_to_backstop, withdraw_from_backstop,
 * trigger_bad_debt_socialization, fetchBackstopFundState, computeCoverageRatio.
 *
 * Min 15 vitest tests required.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PublicKey, Keypair } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import {
  BadDebtBackstopModule,
  BackstopFundState,
  ContributeToBackstopArgs,
  WithdrawFromBackstopArgs,
} from './BadDebtBackstopModule';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const PROGRAM_ID = Keypair.generate().publicKey;
const MINT = Keypair.generate().publicKey;
const COLLATERAL_MINT = Keypair.generate().publicKey;
const INSURANCE_FUND = Keypair.generate().publicKey;
const FUND_AUTHORITY = Keypair.generate().publicKey;
const CONTRIBUTOR = Keypair.generate().publicKey;
const SOURCE_ACCOUNT = Keypair.generate().publicKey;
const DEST_ACCOUNT = Keypair.generate().publicKey;
const RESERVE_VAULT = Keypair.generate().publicKey;

/**
 * Build a fake StablecoinConfig buffer with SSS-097 tail fields.
 * Layout (tail):
 *   [-1]      bump: u8
 *   [-3..-1]  max_oracle_conf_bps: u16 LE
 *   [-7..-3]  max_oracle_age_secs: u32 LE
 *   [-9..-7]  redemption_fee_bps: u16 LE
 *   [-11..-9] stability_fee_bps: u16 LE
 *   [-13..-11] max_backstop_bps: u16 LE
 *   [-45..-13] insurance_fund_pubkey: [u8;32]
 */
function buildConfigData(
  insuranceFundPubkey: PublicKey,
  maxBackstopBps: number,
  totalLen = 400,
): Buffer {
  const buf = Buffer.alloc(totalLen, 0xab);
  insuranceFundPubkey.toBuffer().copy(buf, totalLen - 45);
  buf.writeUInt16LE(maxBackstopBps, totalLen - 13);
  buf.writeUInt16LE(0, totalLen - 11);
  buf.writeUInt16LE(0, totalLen - 9);
  buf.writeUInt32LE(60, totalLen - 7);
  buf.writeUInt16LE(200, totalLen - 3);
  buf.writeUInt8(253, totalLen - 1);
  return buf;
}

/**
 * Build a fake SPL token account data buffer.
 * Layout: [0..32] mint, [32..64] owner, [64..72] amount (u64 LE)
 */
function buildTokenAccountData(mint: PublicKey, amount: bigint): Buffer {
  const buf = Buffer.alloc(165, 0);
  mint.toBuffer().copy(buf, 0);
  buf.writeBigUInt64LE(amount, 64);
  return buf;
}

function mockProvider(configData?: Buffer, fundAccountData?: Buffer) {
  return {
    wallet: { publicKey: Keypair.generate().publicKey },
    connection: {
      getAccountInfo: vi.fn().mockImplementation(async (pubkey: PublicKey) => {
        const key = pubkey.toBase58();
        const insuranceFundKey = INSURANCE_FUND.toBase58();
        const [configPda] = PublicKey.findProgramAddressSync(
          [Buffer.from('stablecoin-config'), MINT.toBuffer()],
          PROGRAM_ID,
        );
        if (key === configPda.toBase58() && configData) {
          return { data: configData, lamports: 1_000_000, owner: PROGRAM_ID };
        }
        if (key === insuranceFundKey && fundAccountData) {
          return { data: fundAccountData, lamports: 1_000_000, owner: TOKEN_PROGRAM_ID };
        }
        return null;
      }),
    },
    sendAndConfirm: vi.fn().mockResolvedValue('txSig_sss100'),
  } as any;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('SSS-100: BadDebtBackstopModule — contribute / withdraw / socialization', () => {
  let module: BadDebtBackstopModule;
  let provider: ReturnType<typeof mockProvider>;

  beforeEach(() => {
    const configData = buildConfigData(INSURANCE_FUND, 500);
    const fundData = buildTokenAccountData(COLLATERAL_MINT, 1_000_000n);
    provider = mockProvider(configData, fundData);
    module = new BadDebtBackstopModule(provider, PROGRAM_ID);
  });

  // ─── contributeToBackstop ─────────────────────────────────────────────────

  it('1. contributeToBackstop sends a transfer_checked tx and returns sig', async () => {
    const sig = await module.contributeToBackstop({
      insuranceFund: INSURANCE_FUND,
      sourceTokenAccount: SOURCE_ACCOUNT,
      contributor: CONTRIBUTOR,
      collateralMint: COLLATERAL_MINT,
      collateralDecimals: 6,
      amount: 500_000n,
    });
    expect(sig).toBe('txSig_sss100');
    expect(provider.sendAndConfirm).toHaveBeenCalledTimes(1);
  });

  it('2. contributeToBackstop throws when amount is zero', async () => {
    await expect(
      module.contributeToBackstop({
        insuranceFund: INSURANCE_FUND,
        sourceTokenAccount: SOURCE_ACCOUNT,
        contributor: CONTRIBUTOR,
        collateralMint: COLLATERAL_MINT,
        collateralDecimals: 6,
        amount: 0n,
      }),
    ).rejects.toThrow('amount must be greater than zero');
  });

  it('3. contributeToBackstop throws when amount is negative', async () => {
    await expect(
      module.contributeToBackstop({
        insuranceFund: INSURANCE_FUND,
        sourceTokenAccount: SOURCE_ACCOUNT,
        contributor: CONTRIBUTOR,
        collateralMint: COLLATERAL_MINT,
        collateralDecimals: 6,
        amount: -1n,
      }),
    ).rejects.toThrow('amount must be greater than zero');
  });

  it('4. contributeToBackstop uses custom tokenProgram when provided', async () => {
    const customProgram = Keypair.generate().publicKey;
    const sig = await module.contributeToBackstop({
      insuranceFund: INSURANCE_FUND,
      sourceTokenAccount: SOURCE_ACCOUNT,
      contributor: CONTRIBUTOR,
      collateralMint: COLLATERAL_MINT,
      collateralDecimals: 6,
      amount: 100n,
      tokenProgram: customProgram,
    });
    expect(sig).toBe('txSig_sss100');
    const [tx] = provider.sendAndConfirm.mock.calls[0];
    expect(tx.instructions[0].programId.toBase58()).toBe(customProgram.toBase58());
  });

  it('5. contributeToBackstop includes correct transfer_checked instruction index (12)', async () => {
    await module.contributeToBackstop({
      insuranceFund: INSURANCE_FUND,
      sourceTokenAccount: SOURCE_ACCOUNT,
      contributor: CONTRIBUTOR,
      collateralMint: COLLATERAL_MINT,
      collateralDecimals: 6,
      amount: 250_000n,
    });
    const [tx] = provider.sendAndConfirm.mock.calls[0];
    const ix = tx.instructions[0];
    expect(ix.data[0]).toBe(12); // transfer_checked instruction index
  });

  it('6. contributeToBackstop encodes amount correctly in instruction data', async () => {
    const amount = 123_456n;
    await module.contributeToBackstop({
      insuranceFund: INSURANCE_FUND,
      sourceTokenAccount: SOURCE_ACCOUNT,
      contributor: CONTRIBUTOR,
      collateralMint: COLLATERAL_MINT,
      collateralDecimals: 6,
      amount,
    });
    const [tx] = provider.sendAndConfirm.mock.calls[0];
    const ix = tx.instructions[0];
    const encoded = ix.data.readBigUInt64LE(1);
    expect(encoded).toBe(amount);
  });

  // ─── withdrawFromBackstop ─────────────────────────────────────────────────

  it('7. withdrawFromBackstop sends a transfer_checked tx and returns sig', async () => {
    const sig = await module.withdrawFromBackstop({
      insuranceFund: INSURANCE_FUND,
      insuranceFundAuthority: FUND_AUTHORITY,
      destinationTokenAccount: DEST_ACCOUNT,
      collateralMint: COLLATERAL_MINT,
      collateralDecimals: 6,
      amount: 200_000n,
    });
    expect(sig).toBe('txSig_sss100');
  });

  it('8. withdrawFromBackstop throws when amount is zero', async () => {
    await expect(
      module.withdrawFromBackstop({
        insuranceFund: INSURANCE_FUND,
        insuranceFundAuthority: FUND_AUTHORITY,
        destinationTokenAccount: DEST_ACCOUNT,
        collateralMint: COLLATERAL_MINT,
        collateralDecimals: 6,
        amount: 0n,
      }),
    ).rejects.toThrow('amount must be greater than zero');
  });

  it('9. withdrawFromBackstop encodes decimals correctly', async () => {
    await module.withdrawFromBackstop({
      insuranceFund: INSURANCE_FUND,
      insuranceFundAuthority: FUND_AUTHORITY,
      destinationTokenAccount: DEST_ACCOUNT,
      collateralMint: COLLATERAL_MINT,
      collateralDecimals: 9,
      amount: 1_000_000_000n,
    });
    const [tx] = provider.sendAndConfirm.mock.calls[0];
    const ix = tx.instructions[0];
    expect(ix.data[9]).toBe(9); // decimals at offset 9
  });

  it('10. withdrawFromBackstop source is insurance fund account', async () => {
    await module.withdrawFromBackstop({
      insuranceFund: INSURANCE_FUND,
      insuranceFundAuthority: FUND_AUTHORITY,
      destinationTokenAccount: DEST_ACCOUNT,
      collateralMint: COLLATERAL_MINT,
      collateralDecimals: 6,
      amount: 50_000n,
    });
    const [tx] = provider.sendAndConfirm.mock.calls[0];
    const ix = tx.instructions[0];
    expect(ix.keys[0].pubkey.toBase58()).toBe(INSURANCE_FUND.toBase58()); // source
    expect(ix.keys[2].pubkey.toBase58()).toBe(DEST_ACCOUNT.toBase58()); // destination
  });

  // ─── triggerBadDebtSocialization ──────────────────────────────────────────

  it('11. triggerBadDebtSocialization delegates to triggerBackstop', async () => {
    const spy = vi.spyOn(module, 'triggerBackstop').mockResolvedValue('socializedTxSig');
    const args = {
      mint: MINT,
      insuranceFund: INSURANCE_FUND,
      reserveVault: RESERVE_VAULT,
      collateralMint: COLLATERAL_MINT,
      insuranceFundAuthority: FUND_AUTHORITY,
      collateralTokenProgram: TOKEN_PROGRAM_ID,
      shortfallAmount: 300_000n,
    };
    const sig = await module.triggerBadDebtSocialization(args);
    expect(sig).toBe('socializedTxSig');
    expect(spy).toHaveBeenCalledWith(args);
  });

  it('12. triggerBadDebtSocialization passes shortfallAmount through', async () => {
    const spy = vi.spyOn(module, 'triggerBackstop').mockResolvedValue('ok');
    await module.triggerBadDebtSocialization({
      mint: MINT,
      insuranceFund: INSURANCE_FUND,
      reserveVault: RESERVE_VAULT,
      collateralMint: COLLATERAL_MINT,
      insuranceFundAuthority: FUND_AUTHORITY,
      collateralTokenProgram: TOKEN_PROGRAM_ID,
      shortfallAmount: 999n,
    });
    expect(spy.mock.calls[0][0].shortfallAmount).toBe(999n);
  });

  // ─── fetchBackstopFundState ───────────────────────────────────────────────

  it('13. fetchBackstopFundState returns enabled state with live balance', async () => {
    const state: BackstopFundState = await module.fetchBackstopFundState(MINT);
    expect(state.enabled).toBe(true);
    expect(state.maxBackstopBps).toBe(500);
    expect(state.fundBalance).toBe(1_000_000n);
    expect(state.insuranceFundPubkey.toBase58()).toBe(INSURANCE_FUND.toBase58());
    expect(state.fundMint.toBase58()).toBe(COLLATERAL_MINT.toBase58());
  });

  it('14. fetchBackstopFundState returns fundBalance=0 when backstop disabled', async () => {
    const disabledConfig = buildConfigData(PublicKey.default, 0);
    const disabledProvider = mockProvider(disabledConfig, undefined);
    const disabledModule = new BadDebtBackstopModule(disabledProvider, PROGRAM_ID);
    const state = await disabledModule.fetchBackstopFundState(MINT);
    expect(state.enabled).toBe(false);
    expect(state.fundBalance).toBe(0n);
  });

  it('15. fetchBackstopFundState throws when insurance fund account not found', async () => {
    // Config points to INSURANCE_FUND but no fund account data provided
    const configData = buildConfigData(INSURANCE_FUND, 500);
    const brokenProvider = mockProvider(configData, undefined);
    const brokenModule = new BadDebtBackstopModule(brokenProvider, PROGRAM_ID);
    await expect(brokenModule.fetchBackstopFundState(MINT)).rejects.toThrow(
      'Insurance fund token account not found',
    );
  });

  // ─── computeCoverageRatio ─────────────────────────────────────────────────

  it('16. computeCoverageRatio returns 0 when netSupply is 0', () => {
    expect(module.computeCoverageRatio(1_000_000n, 0n)).toBe(0);
  });

  it('17. computeCoverageRatio returns 1.0 when fund equals net supply', () => {
    expect(module.computeCoverageRatio(1_000_000n, 1_000_000n)).toBe(1.0);
  });

  it('18. computeCoverageRatio returns >1 when fund exceeds net supply', () => {
    const ratio = module.computeCoverageRatio(2_000_000n, 1_000_000n);
    expect(ratio).toBeCloseTo(2.0);
  });

  it('19. computeCoverageRatio returns <1 when fund is underfunded', () => {
    const ratio = module.computeCoverageRatio(100_000n, 1_000_000n);
    expect(ratio).toBeCloseTo(0.1);
  });

  // ─── Type exports ─────────────────────────────────────────────────────────

  it('20. ContributeToBackstopArgs type accepts all required fields', () => {
    const args: ContributeToBackstopArgs = {
      insuranceFund: INSURANCE_FUND,
      sourceTokenAccount: SOURCE_ACCOUNT,
      contributor: CONTRIBUTOR,
      collateralMint: COLLATERAL_MINT,
      collateralDecimals: 6,
      amount: 100n,
    };
    expect(args.amount).toBe(100n);
  });

  it('21. WithdrawFromBackstopArgs type accepts all required fields', () => {
    const args: WithdrawFromBackstopArgs = {
      insuranceFund: INSURANCE_FUND,
      insuranceFundAuthority: FUND_AUTHORITY,
      destinationTokenAccount: DEST_ACCOUNT,
      collateralMint: COLLATERAL_MINT,
      collateralDecimals: 6,
      amount: 50n,
    };
    expect(args.amount).toBe(50n);
  });
});

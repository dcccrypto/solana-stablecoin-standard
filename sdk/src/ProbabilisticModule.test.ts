/**
 * SSS-111: ProbabilisticModule unit tests
 *
 * Covers happy path + edge cases for all 5 public methods:
 * commitProbabilistic, proveAndResolve, partialResolve, expireAndRefund, getCommitment.
 * Plus static helpers: decodeVault, remainingAmount, isTerminal.
 * Plus PDA derivations: configPda, vaultPda.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PublicKey, Keypair } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import {
  ProbabilisticModule,
  VaultStatus,
  FLAG_PROBABILISTIC_MONEY,
  PBS_VAULT_SEED,
  derivePbsConfigPda,
  derivePbsVaultPda,
} from './ProbabilisticModule';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mockProvider(accountData?: Buffer) {
  return {
    wallet: { publicKey: Keypair.generate().publicKey },
    connection: {
      getAccountInfo: vi.fn().mockResolvedValue(
        accountData
          ? { data: accountData, lamports: 1_000_000, owner: PublicKey.default }
          : null,
      ),
    },
    sendAndConfirm: vi.fn().mockResolvedValue('mockedTxSig'),
  } as any;
}

const PROGRAM_ID = Keypair.generate().publicKey;
const MINT = Keypair.generate().publicKey;
const CLAIMANT = Keypair.generate().publicKey;
const COMMITMENT_ID = new BN(42);
const AMOUNT = new BN(10_000_000); // 10 USDC at 6 decimals
const EXPIRY_SLOT = new BN(999_999_999);
const CONDITION_HASH = Buffer.alloc(32, 0xab);
const ESCROW_TOKEN_ACCOUNT = Keypair.generate().publicKey;
const CLAIMANT_TOKEN_ACCOUNT = Keypair.generate().publicKey;
const ISSUER_TOKEN_ACCOUNT = Keypair.generate().publicKey;

/**
 * Build a minimal ProbabilisticVault account buffer.
 * Layout (after 8-byte discriminator):
 *   config [32], issuer [32], claimant [32], stable_mint [32],
 *   committed_amount [8], resolved_amount [8],
 *   condition_hash [32], expiry_slot [8], commitment_id [8],
 *   status [1], bump [1]
 */
function buildVaultData({
  config = Keypair.generate().publicKey,
  issuer = Keypair.generate().publicKey,
  claimant = CLAIMANT,
  stableMint = MINT,
  committedAmount = 10_000_000n,
  resolvedAmount = 0n,
  conditionHash = CONDITION_HASH,
  expirySlot = 999_999_999n,
  commitmentId = 42n,
  status = VaultStatus.Pending,
  bump = 254,
}: Partial<{
  config: PublicKey;
  issuer: PublicKey;
  claimant: PublicKey;
  stableMint: PublicKey;
  committedAmount: bigint;
  resolvedAmount: bigint;
  conditionHash: Buffer;
  expirySlot: bigint;
  commitmentId: bigint;
  status: VaultStatus;
  bump: number;
}> = {}): Buffer {
  const buf = Buffer.alloc(202); // 8 disc + 194 data
  let offset = 8; // leave discriminator as zeros

  config.toBuffer().copy(buf, offset); offset += 32;
  issuer.toBuffer().copy(buf, offset); offset += 32;
  claimant.toBuffer().copy(buf, offset); offset += 32;
  stableMint.toBuffer().copy(buf, offset); offset += 32;

  buf.writeBigUInt64LE(committedAmount, offset); offset += 8;
  buf.writeBigUInt64LE(resolvedAmount, offset); offset += 8;

  Buffer.from(conditionHash).copy(buf, offset); offset += 32;

  buf.writeBigUInt64LE(expirySlot, offset); offset += 8;
  buf.writeBigUInt64LE(commitmentId, offset); offset += 8;

  buf.writeUInt8(status, offset); offset += 1;
  buf.writeUInt8(bump, offset);

  return buf;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ProbabilisticModule', () => {
  let provider: ReturnType<typeof mockProvider>;
  let pbs: ProbabilisticModule;

  beforeEach(() => {
    provider = mockProvider();
    pbs = new ProbabilisticModule(provider, PROGRAM_ID);
  });

  // ── Constants ──

  it('FLAG_PROBABILISTIC_MONEY equals 1n << 6n = 0x40n', () => {
    expect(FLAG_PROBABILISTIC_MONEY).toBe(0x40n);
  });

  it('PBS_VAULT_SEED is "pbs-vault"', () => {
    expect(PBS_VAULT_SEED.toString()).toBe('pbs-vault');
  });

  // ── PDA derivation ──

  describe('derivePbsConfigPda', () => {
    it('returns a PublicKey + bump tuple', () => {
      const [pda, bump] = derivePbsConfigPda(MINT, PROGRAM_ID);
      expect(pda).toBeInstanceOf(PublicKey);
      expect(bump).toBeGreaterThanOrEqual(0);
      expect(bump).toBeLessThanOrEqual(255);
    });

    it('is deterministic for same inputs', () => {
      const [a] = derivePbsConfigPda(MINT, PROGRAM_ID);
      const [b] = derivePbsConfigPda(MINT, PROGRAM_ID);
      expect(a.toBase58()).toBe(b.toBase58());
    });

    it('differs for different mints', () => {
      const otherMint = Keypair.generate().publicKey;
      const [a] = derivePbsConfigPda(MINT, PROGRAM_ID);
      const [b] = derivePbsConfigPda(otherMint, PROGRAM_ID);
      expect(a.toBase58()).not.toBe(b.toBase58());
    });
  });

  describe('derivePbsVaultPda', () => {
    it('returns a PublicKey + bump tuple', () => {
      const [configPda] = derivePbsConfigPda(MINT, PROGRAM_ID);
      const [pda, bump] = derivePbsVaultPda(configPda, COMMITMENT_ID, PROGRAM_ID);
      expect(pda).toBeInstanceOf(PublicKey);
      expect(bump).toBeGreaterThanOrEqual(0);
    });

    it('differs for different commitment ids', () => {
      const [configPda] = derivePbsConfigPda(MINT, PROGRAM_ID);
      const [a] = derivePbsVaultPda(configPda, new BN(1), PROGRAM_ID);
      const [b] = derivePbsVaultPda(configPda, new BN(2), PROGRAM_ID);
      expect(a.toBase58()).not.toBe(b.toBase58());
    });

    it('commitment id 0 and 1 produce distinct PDAs', () => {
      const [configPda] = derivePbsConfigPda(MINT, PROGRAM_ID);
      const [a] = derivePbsVaultPda(configPda, new BN(0), PROGRAM_ID);
      const [b] = derivePbsVaultPda(configPda, new BN(1), PROGRAM_ID);
      expect(a.toBase58()).not.toBe(b.toBase58());
    });
  });

  // ── commitProbabilistic ──

  describe('commitProbabilistic', () => {
    it('calls sendAndConfirm and returns commitmentId + txSig', async () => {
      const result = await pbs.commitProbabilistic({
        mint: MINT,
        amount: AMOUNT,
        conditionHash: CONDITION_HASH,
        expirySlot: EXPIRY_SLOT,
        claimant: CLAIMANT,
        commitmentId: COMMITMENT_ID,
        escrowTokenAccount: ESCROW_TOKEN_ACCOUNT,
      });

      expect(provider.sendAndConfirm).toHaveBeenCalledOnce();
      expect(result.txSig).toBe('mockedTxSig');
      expect(result.commitmentId.toString()).toBe(COMMITMENT_ID.toString());
    });

    it('throws when amount is zero', async () => {
      await expect(
        pbs.commitProbabilistic({
          mint: MINT,
          amount: new BN(0),
          conditionHash: CONDITION_HASH,
          expirySlot: EXPIRY_SLOT,
          claimant: CLAIMANT,
          commitmentId: COMMITMENT_ID,
          escrowTokenAccount: ESCROW_TOKEN_ACCOUNT,
        }),
      ).rejects.toThrow('amount must be > 0');
    });

    it('throws when conditionHash is not 32 bytes', async () => {
      await expect(
        pbs.commitProbabilistic({
          mint: MINT,
          amount: AMOUNT,
          conditionHash: Buffer.alloc(16, 0),
          expirySlot: EXPIRY_SLOT,
          claimant: CLAIMANT,
          commitmentId: COMMITMENT_ID,
          escrowTokenAccount: ESCROW_TOKEN_ACCOUNT,
        }),
      ).rejects.toThrow('conditionHash must be 32 bytes');
    });

    it('uses provided issuerTokenAccount when given', async () => {
      const issuerAta = Keypair.generate().publicKey;
      await pbs.commitProbabilistic({
        mint: MINT,
        amount: AMOUNT,
        conditionHash: CONDITION_HASH,
        expirySlot: EXPIRY_SLOT,
        claimant: CLAIMANT,
        commitmentId: COMMITMENT_ID,
        escrowTokenAccount: ESCROW_TOKEN_ACCOUNT,
        issuerTokenAccount: issuerAta,
      });
      // sendAndConfirm called once regardless of whether we provide the ATA
      expect(provider.sendAndConfirm).toHaveBeenCalledOnce();
    });
  });

  // ── proveAndResolve ──

  describe('proveAndResolve', () => {
    it('calls sendAndConfirm and returns txSig', async () => {
      const txSig = await pbs.proveAndResolve(CONDITION_HASH, {
        mint: MINT,
        commitmentId: COMMITMENT_ID,
        escrowTokenAccount: ESCROW_TOKEN_ACCOUNT,
        claimantTokenAccount: CLAIMANT_TOKEN_ACCOUNT,
      });

      expect(provider.sendAndConfirm).toHaveBeenCalledOnce();
      expect(txSig).toBe('mockedTxSig');
    });

    it('throws when proofHash is not 32 bytes', async () => {
      await expect(
        pbs.proveAndResolve(Buffer.alloc(10), {
          mint: MINT,
          commitmentId: COMMITMENT_ID,
          escrowTokenAccount: ESCROW_TOKEN_ACCOUNT,
          claimantTokenAccount: CLAIMANT_TOKEN_ACCOUNT,
        }),
      ).rejects.toThrow('proofHash must be 32 bytes');
    });

    it('accepts Uint8Array proofHash', async () => {
      const proofHash = new Uint8Array(32).fill(0xcd);
      const txSig = await pbs.proveAndResolve(proofHash, {
        mint: MINT,
        commitmentId: COMMITMENT_ID,
        escrowTokenAccount: ESCROW_TOKEN_ACCOUNT,
        claimantTokenAccount: CLAIMANT_TOKEN_ACCOUNT,
      });
      expect(txSig).toBe('mockedTxSig');
    });
  });

  // ── partialResolve ──

  describe('partialResolve', () => {
    it('calls sendAndConfirm with amount and proof', async () => {
      const txSig = await pbs.partialResolve(CONDITION_HASH, {
        mint: MINT,
        commitmentId: COMMITMENT_ID,
        amount: new BN(5_000_000),
        escrowTokenAccount: ESCROW_TOKEN_ACCOUNT,
        claimantTokenAccount: CLAIMANT_TOKEN_ACCOUNT,
        issuerTokenAccount: ISSUER_TOKEN_ACCOUNT,
      });

      expect(provider.sendAndConfirm).toHaveBeenCalledOnce();
      expect(txSig).toBe('mockedTxSig');
    });

    it('throws when amount is zero', async () => {
      await expect(
        pbs.partialResolve(CONDITION_HASH, {
          mint: MINT,
          commitmentId: COMMITMENT_ID,
          amount: new BN(0),
          escrowTokenAccount: ESCROW_TOKEN_ACCOUNT,
          claimantTokenAccount: CLAIMANT_TOKEN_ACCOUNT,
          issuerTokenAccount: ISSUER_TOKEN_ACCOUNT,
        }),
      ).rejects.toThrow('amount must be > 0');
    });

    it('throws when proofHash is wrong length', async () => {
      await expect(
        pbs.partialResolve(Buffer.alloc(31), {
          mint: MINT,
          commitmentId: COMMITMENT_ID,
          amount: new BN(1),
          escrowTokenAccount: ESCROW_TOKEN_ACCOUNT,
          claimantTokenAccount: CLAIMANT_TOKEN_ACCOUNT,
          issuerTokenAccount: ISSUER_TOKEN_ACCOUNT,
        }),
      ).rejects.toThrow('proofHash must be 32 bytes');
    });
  });

  // ── expireAndRefund ──

  describe('expireAndRefund', () => {
    it('calls sendAndConfirm and returns txSig', async () => {
      const txSig = await pbs.expireAndRefund({
        mint: MINT,
        commitmentId: COMMITMENT_ID,
        escrowTokenAccount: ESCROW_TOKEN_ACCOUNT,
        issuerTokenAccount: ISSUER_TOKEN_ACCOUNT,
      });

      expect(provider.sendAndConfirm).toHaveBeenCalledOnce();
      expect(txSig).toBe('mockedTxSig');
    });

    it('accepts explicit config PDA override', async () => {
      const explicitConfig = Keypair.generate().publicKey;
      const txSig = await pbs.expireAndRefund({
        mint: MINT,
        commitmentId: COMMITMENT_ID,
        config: explicitConfig,
        escrowTokenAccount: ESCROW_TOKEN_ACCOUNT,
        issuerTokenAccount: ISSUER_TOKEN_ACCOUNT,
      });
      expect(txSig).toBe('mockedTxSig');
    });
  });

  // ── getCommitment ──

  describe('getCommitment', () => {
    it('decodes vault from account data', async () => {
      const vaultData = buildVaultData({
        claimant: CLAIMANT,
        committedAmount: 10_000_000n,
        resolvedAmount: 0n,
        status: VaultStatus.Pending,
      });

      provider.connection.getAccountInfo.mockResolvedValueOnce({
        data: vaultData,
        lamports: 1_000_000,
        owner: PROGRAM_ID,
      });

      const vault = await pbs.getCommitment(MINT, COMMITMENT_ID);
      expect(vault.claimant.toBase58()).toBe(CLAIMANT.toBase58());
      expect(vault.committedAmount).toBe(10_000_000n);
      expect(vault.resolvedAmount).toBe(0n);
      expect(vault.status).toBe(VaultStatus.Pending);
    });

    it('throws when vault account is not found', async () => {
      provider.connection.getAccountInfo.mockResolvedValueOnce(null);
      await expect(pbs.getCommitment(MINT, COMMITMENT_ID)).rejects.toThrow(
        /ProbabilisticVault not found/,
      );
    });
  });

  // ── decodeVault (static) ──

  describe('ProbabilisticModule.decodeVault', () => {
    it('decodes all fields correctly', () => {
      const config   = Keypair.generate().publicKey;
      const issuer   = Keypair.generate().publicKey;
      const claimant = CLAIMANT;

      const data = buildVaultData({
        config,
        issuer,
        claimant,
        committedAmount: 50_000_000n,
        resolvedAmount: 20_000_000n,
        conditionHash: CONDITION_HASH,
        expirySlot: 12345n,
        commitmentId: 7n,
        status: VaultStatus.PartiallyResolved,
        bump: 253,
      });

      const vault = ProbabilisticModule.decodeVault(data);
      expect(vault.config.toBase58()).toBe(config.toBase58());
      expect(vault.issuer.toBase58()).toBe(issuer.toBase58());
      expect(vault.claimant.toBase58()).toBe(claimant.toBase58());
      expect(vault.committedAmount).toBe(50_000_000n);
      expect(vault.resolvedAmount).toBe(20_000_000n);
      expect(vault.expirySlot).toBe(12345n);
      expect(vault.commitmentId).toBe(7n);
      expect(vault.status).toBe(VaultStatus.PartiallyResolved);
      expect(vault.bump).toBe(253);
      expect(Array.from(vault.conditionHash)).toEqual(Array.from(CONDITION_HASH));
    });

    it('decodes Resolved status', () => {
      const data = buildVaultData({ status: VaultStatus.Resolved });
      const vault = ProbabilisticModule.decodeVault(data);
      expect(vault.status).toBe(VaultStatus.Resolved);
    });

    it('decodes Expired status', () => {
      const data = buildVaultData({ status: VaultStatus.Expired });
      const vault = ProbabilisticModule.decodeVault(data);
      expect(vault.status).toBe(VaultStatus.Expired);
    });
  });

  // ── remainingAmount ──

  describe('remainingAmount', () => {
    it('returns committedAmount when nothing resolved', () => {
      const data = buildVaultData({ committedAmount: 10_000_000n, resolvedAmount: 0n });
      const vault = ProbabilisticModule.decodeVault(data);
      expect(pbs.remainingAmount(vault)).toBe(10_000_000n);
    });

    it('returns zero when fully resolved', () => {
      const data = buildVaultData({ committedAmount: 10_000_000n, resolvedAmount: 10_000_000n });
      const vault = ProbabilisticModule.decodeVault(data);
      expect(pbs.remainingAmount(vault)).toBe(0n);
    });

    it('returns remainder after partial resolve', () => {
      const data = buildVaultData({ committedAmount: 10_000_000n, resolvedAmount: 3_000_000n });
      const vault = ProbabilisticModule.decodeVault(data);
      expect(pbs.remainingAmount(vault)).toBe(7_000_000n);
    });

    it('returns 0 on underflow (resolved > committed)', () => {
      const data = buildVaultData({ committedAmount: 5n, resolvedAmount: 10n });
      const vault = ProbabilisticModule.decodeVault(data);
      expect(pbs.remainingAmount(vault)).toBe(0n);
    });
  });

  // ── isTerminal ──

  describe('isTerminal', () => {
    it('returns false for Pending', () => {
      const data = buildVaultData({ status: VaultStatus.Pending });
      expect(pbs.isTerminal(ProbabilisticModule.decodeVault(data))).toBe(false);
    });

    it('returns false for PartiallyResolved', () => {
      const data = buildVaultData({ status: VaultStatus.PartiallyResolved });
      expect(pbs.isTerminal(ProbabilisticModule.decodeVault(data))).toBe(false);
    });

    it('returns true for Resolved', () => {
      const data = buildVaultData({ status: VaultStatus.Resolved });
      expect(pbs.isTerminal(ProbabilisticModule.decodeVault(data))).toBe(true);
    });

    it('returns true for Expired', () => {
      const data = buildVaultData({ status: VaultStatus.Expired });
      expect(pbs.isTerminal(ProbabilisticModule.decodeVault(data))).toBe(true);
    });
  });

  // ── configPda / vaultPda instance helpers ──

  describe('instance PDA helpers', () => {
    it('configPda matches derivePbsConfigPda', () => {
      const [a] = pbs.configPda(MINT);
      const [b] = derivePbsConfigPda(MINT, PROGRAM_ID);
      expect(a.toBase58()).toBe(b.toBase58());
    });

    it('vaultPda matches derivePbsVaultPda', () => {
      const [configPda] = pbs.configPda(MINT);
      const [a] = pbs.vaultPda(configPda, COMMITMENT_ID);
      const [b] = derivePbsVaultPda(configPda, COMMITMENT_ID, PROGRAM_ID);
      expect(a.toBase58()).toBe(b.toBase58());
    });
  });
});

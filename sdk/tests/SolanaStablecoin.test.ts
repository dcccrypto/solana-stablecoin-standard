/**
 * Unit tests for the on-chain SolanaStablecoin Anchor SDK wrapper.
 *
 * These tests cover PDA derivation, static helpers, and type contracts
 * without requiring a live Solana validator or network connection.
 */

import { describe, it, expect } from 'vitest';
import { PublicKey } from '@solana/web3.js';
import {
  SolanaStablecoin,
  SSS_TOKEN_PROGRAM_ID,
  SSS_TRANSFER_HOOK_PROGRAM_ID,
} from '../src/SolanaStablecoin';
import type {
  UpdateMinterParams,
  RevokeMinterParams,
  UpdateRolesParams,
} from '../src/types';

// ─── program ID constants ─────────────────────────────────────────────────────

describe('program ID constants', () => {
  it('SSS_TOKEN_PROGRAM_ID is a valid PublicKey', () => {
    expect(SSS_TOKEN_PROGRAM_ID).toBeInstanceOf(PublicKey);
    expect(SSS_TOKEN_PROGRAM_ID.toBase58()).toBe('2haUR6bUPcWXkCG9bZCPvVJYvtkGRDHnLtX1X1j9zbUY');
  });

  it('SSS_TRANSFER_HOOK_PROGRAM_ID is a valid PublicKey', () => {
    expect(SSS_TRANSFER_HOOK_PROGRAM_ID).toBeInstanceOf(PublicKey);
    expect(SSS_TRANSFER_HOOK_PROGRAM_ID.toBase58()).toBe(
      'phAtzRyRUJGpMC3ftAtWzoaX7UkghRe9x5KTig8jPQp'
    );
  });
});

// ─── getConfigPda ─────────────────────────────────────────────────────────────

describe('SolanaStablecoin.getConfigPda()', () => {
  const mint = new PublicKey('So11111111111111111111111111111111111111112');

  it('returns a tuple of [PublicKey, number]', () => {
    const result = SolanaStablecoin.getConfigPda(mint);
    expect(result).toHaveLength(2);
    expect(result[0]).toBeInstanceOf(PublicKey);
    expect(typeof result[1]).toBe('number');
    expect(result[1]).toBeGreaterThanOrEqual(0);
    expect(result[1]).toBeLessThanOrEqual(255);
  });

  it('is deterministic — same mint yields same PDA', () => {
    const [pda1] = SolanaStablecoin.getConfigPda(mint);
    const [pda2] = SolanaStablecoin.getConfigPda(mint);
    expect(pda1.toBase58()).toBe(pda2.toBase58());
  });

  it('produces different PDAs for different mints', () => {
    const mintB = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
    const [pdaA] = SolanaStablecoin.getConfigPda(mint);
    const [pdaB] = SolanaStablecoin.getConfigPda(mintB);
    expect(pdaA.toBase58()).not.toBe(pdaB.toBase58());
  });

  it('uses the default SSS_TOKEN_PROGRAM_ID when no programId is provided', () => {
    const [pdaDefault] = SolanaStablecoin.getConfigPda(mint);
    const [pdaExplicit] = SolanaStablecoin.getConfigPda(mint, SSS_TOKEN_PROGRAM_ID);
    expect(pdaDefault.toBase58()).toBe(pdaExplicit.toBase58());
  });

  it('produces a different PDA when a custom programId is supplied', () => {
    const customProgram = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
    const [pdaDefault] = SolanaStablecoin.getConfigPda(mint);
    const [pdaCustom] = SolanaStablecoin.getConfigPda(mint, customProgram);
    expect(pdaDefault.toBase58()).not.toBe(pdaCustom.toBase58());
  });
});

// ─── getMinterPda ─────────────────────────────────────────────────────────────

describe('SolanaStablecoin.getMinterPda()', () => {
  const mint = new PublicKey('So11111111111111111111111111111111111111112');
  const [configPda] = SolanaStablecoin.getConfigPda(mint);
  const minterKey = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

  it('returns a tuple of [PublicKey, number]', () => {
    const result = SolanaStablecoin.getMinterPda(configPda, minterKey);
    expect(result).toHaveLength(2);
    expect(result[0]).toBeInstanceOf(PublicKey);
    expect(typeof result[1]).toBe('number');
  });

  it('is deterministic', () => {
    const [pda1] = SolanaStablecoin.getMinterPda(configPda, minterKey);
    const [pda2] = SolanaStablecoin.getMinterPda(configPda, minterKey);
    expect(pda1.toBase58()).toBe(pda2.toBase58());
  });

  it('differs for different minter keys', () => {
    const minterB = new PublicKey('11111111111111111111111111111111');
    const [pdaA] = SolanaStablecoin.getMinterPda(configPda, minterKey);
    const [pdaB] = SolanaStablecoin.getMinterPda(configPda, minterB);
    expect(pdaA.toBase58()).not.toBe(pdaB.toBase58());
  });

  it('differs for different config PDAs', () => {
    const mintB = new PublicKey('11111111111111111111111111111111');
    const [configPdaB] = SolanaStablecoin.getConfigPda(mintB);
    const [pdaA] = SolanaStablecoin.getMinterPda(configPda, minterKey);
    const [pdaB] = SolanaStablecoin.getMinterPda(configPdaB, minterKey);
    expect(pdaA.toBase58()).not.toBe(pdaB.toBase58());
  });
});

// ─── new param type contracts ─────────────────────────────────────────────────

describe('UpdateMinterParams type', () => {
  it('accepts minter and cap as bigint', () => {
    const params: UpdateMinterParams = {
      minter: new PublicKey('So11111111111111111111111111111111111111112'),
      cap: 1_000_000n,
    };
    expect(params.cap).toBe(1_000_000n);
    expect(params.minter).toBeInstanceOf(PublicKey);
  });

  it('accepts cap=0n for unlimited', () => {
    const params: UpdateMinterParams = {
      minter: new PublicKey('So11111111111111111111111111111111111111112'),
      cap: 0n,
    };
    expect(params.cap).toBe(0n);
  });
});

describe('RevokeMinterParams type', () => {
  it('accepts a minter PublicKey', () => {
    const params: RevokeMinterParams = {
      minter: new PublicKey('So11111111111111111111111111111111111111112'),
    };
    expect(params.minter).toBeInstanceOf(PublicKey);
  });
});

describe('UpdateRolesParams type', () => {
  it('accepts both authority fields', () => {
    const params: UpdateRolesParams = {
      newAuthority: new PublicKey('So11111111111111111111111111111111111111112'),
      newComplianceAuthority: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
    };
    expect(params.newAuthority).toBeInstanceOf(PublicKey);
    expect(params.newComplianceAuthority).toBeInstanceOf(PublicKey);
  });

  it('allows omitting optional fields (partial update)', () => {
    const params: UpdateRolesParams = {};
    expect(params.newAuthority).toBeUndefined();
    expect(params.newComplianceAuthority).toBeUndefined();
  });

  it('allows updating only newAuthority', () => {
    const params: UpdateRolesParams = {
      newAuthority: new PublicKey('So11111111111111111111111111111111111111112'),
    };
    expect(params.newAuthority).toBeInstanceOf(PublicKey);
    expect(params.newComplianceAuthority).toBeUndefined();
  });
});

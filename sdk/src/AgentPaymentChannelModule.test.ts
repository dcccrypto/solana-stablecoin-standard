/**
 * SSS-111: AgentPaymentChannelModule unit tests
 *
 * Covers happy path + edge cases for all 6 write methods:
 * openChannel, submitWorkProof, proposeSettle, countersignSettle, dispute, forceClose.
 * Plus read helpers: getChannel, isForceCloseEligible, isTerminal.
 * Plus static decode: decodeChannel.
 * Plus PDA derivations: configPda, channelPda.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PublicKey, Keypair } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import {
  AgentPaymentChannelModule,
  ChannelStatus,
  DisputePolicy,
  ApcProofType,
  APC_CHANNEL_SEED,
  FLAG_AGENT_PAYMENT_CHANNEL,
  deriveApcConfigPda,
  deriveChannelPda,
} from './AgentPaymentChannelModule';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a minimal StablecoinConfig account buffer with the given feature_flags value.
 * feature_flags is at offset 298 (u64 LE). See FeatureFlagsModule._readFeatureFlags.
 */
function buildConfigData(featureFlags: bigint = FLAG_AGENT_PAYMENT_CHANNEL): Buffer {
  const buf = Buffer.alloc(400, 0);
  buf.writeBigUInt64LE(featureFlags, 298);
  return buf;
}

/**
 * Mock provider where getAccountInfo returns different data depending on what's
 * requested. If configData is provided, the first call (config PDA check in
 * openChannel) returns that; subsequent calls return channelData (or null).
 */
function mockProvider(channelData?: Buffer, configData?: Buffer) {
  // Default: provide a config with FLAG_AGENT_PAYMENT_CHANNEL set so existing
  // openChannel tests pass without modification.
  const defaultConfigData = buildConfigData(FLAG_AGENT_PAYMENT_CHANNEL);
  const resolvedConfigData = configData ?? defaultConfigData;

  const getAccountInfo = vi.fn()
    .mockResolvedValueOnce(
      // First call = config PDA (for flag guard in openChannel)
      { data: resolvedConfigData, lamports: 1_000_000, owner: PublicKey.default },
    )
    .mockResolvedValue(
      // Subsequent calls = channel account (for getChannel / read tests)
      channelData
        ? { data: channelData, lamports: 1_000_000, owner: PublicKey.default }
        : null,
    );

  return {
    wallet: { publicKey: Keypair.generate().publicKey },
    connection: { getAccountInfo },
    sendAndConfirm: vi.fn().mockResolvedValue('mockedTxSig'),
  } as any;
}

const PROGRAM_ID    = Keypair.generate().publicKey;
const MINT          = Keypair.generate().publicKey;
const COUNTERPARTY  = Keypair.generate().publicKey;
const CHANNEL_ID    = new BN(7);
const TASK_HASH     = Buffer.alloc(32, 0x11);
const OUTPUT_HASH   = Buffer.alloc(32, 0x22);
const EVIDENCE_HASH = Buffer.alloc(32, 0x33);
const ESCROW_ATA    = Keypair.generate().publicKey;
const OPENER_ATA    = Keypair.generate().publicKey;
const COUNTERPARTY_ATA = Keypair.generate().publicKey;

/**
 * Build a minimal PaymentChannel account buffer.
 * Layout (after 8-byte discriminator):
 *   config [32], opener [32], counterparty [32], stable_mint [32],
 *   deposit [8], settle_amount [8],
 *   dispute_policy [1], timeout_slots [8], settle_proposed_at [8],
 *   last_output_hash [32], last_proof_type [1],
 *   channel_id [8], status [1],
 *   opener_signed [1], counterparty_signed [1], bump [1]
 * Total: 8 + 4*32 + 2*8 + 1 + 2*8 + 32 + 1 + 8 + 4 = 8+128+16+1+16+32+1+8+4 = 214
 */
function buildChannelData({
  config = Keypair.generate().publicKey,
  opener = Keypair.generate().publicKey,
  counterparty = COUNTERPARTY,
  stableMint = MINT,
  deposit = 0n,
  settleAmount = 0n,
  disputePolicy = DisputePolicy.TimeoutFallback,
  timeoutSlots = 500n,
  settleProposedAt = 0n,
  lastOutputHash = Buffer.alloc(32, 0),
  lastProofType = ApcProofType.HashProof,
  channelId = 7n,
  status = ChannelStatus.Open,
  openerSigned = false,
  counterpartySigned = false,
  bump = 253,
}: Partial<{
  config: PublicKey;
  opener: PublicKey;
  counterparty: PublicKey;
  stableMint: PublicKey;
  deposit: bigint;
  settleAmount: bigint;
  disputePolicy: DisputePolicy;
  timeoutSlots: bigint;
  settleProposedAt: bigint;
  lastOutputHash: Buffer;
  lastProofType: ApcProofType;
  channelId: bigint;
  status: ChannelStatus;
  openerSigned: boolean;
  counterpartySigned: boolean;
  bump: number;
}> = {}): Buffer {
  // 8 disc + 4*32 + 2*8 + 1 + 2*8 + 32 + 1 + 8 + 1 + 1 + 1 + 1 = 214
  const buf = Buffer.alloc(214, 0);
  let offset = 8;

  config.toBuffer().copy(buf, offset); offset += 32;
  opener.toBuffer().copy(buf, offset); offset += 32;
  counterparty.toBuffer().copy(buf, offset); offset += 32;
  stableMint.toBuffer().copy(buf, offset); offset += 32;

  buf.writeBigUInt64LE(deposit, offset); offset += 8;
  buf.writeBigUInt64LE(settleAmount, offset); offset += 8;
  buf.writeUInt8(disputePolicy, offset); offset += 1;
  buf.writeBigUInt64LE(timeoutSlots, offset); offset += 8;
  buf.writeBigUInt64LE(settleProposedAt, offset); offset += 8;

  Buffer.from(lastOutputHash).copy(buf, offset); offset += 32;
  buf.writeUInt8(lastProofType, offset); offset += 1;
  buf.writeBigUInt64LE(channelId, offset); offset += 8;
  buf.writeUInt8(status, offset); offset += 1;
  buf.writeUInt8(openerSigned ? 1 : 0, offset); offset += 1;
  buf.writeUInt8(counterpartySigned ? 1 : 0, offset); offset += 1;
  buf.writeUInt8(bump, offset);

  return buf;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AgentPaymentChannelModule', () => {
  let provider: ReturnType<typeof mockProvider>;
  let apc: AgentPaymentChannelModule;

  beforeEach(() => {
    provider = mockProvider();
    apc = new AgentPaymentChannelModule(provider, PROGRAM_ID);
  });

  // ── Constants ──

  it('APC_CHANNEL_SEED is "apc-channel"', () => {
    expect(APC_CHANNEL_SEED.toString()).toBe('apc-channel');
  });

  it('DisputePolicy enum values are correct', () => {
    expect(DisputePolicy.TimeoutFallback).toBe(0);
    expect(DisputePolicy.MajorityOracle).toBe(1);
    expect(DisputePolicy.ArbitratorKey).toBe(2);
  });

  it('ApcProofType enum values are correct', () => {
    expect(ApcProofType.HashProof).toBe(0);
    expect(ApcProofType.ZkSnarkProof).toBe(1);
    expect(ApcProofType.OracleAttestation).toBe(2);
  });

  // ── PDA derivation ──

  describe('deriveApcConfigPda', () => {
    it('returns a PublicKey + bump', () => {
      const [pda, bump] = deriveApcConfigPda(MINT, PROGRAM_ID);
      expect(pda).toBeInstanceOf(PublicKey);
      expect(bump).toBeGreaterThanOrEqual(0);
      expect(bump).toBeLessThanOrEqual(255);
    });

    it('is deterministic', () => {
      const [a] = deriveApcConfigPda(MINT, PROGRAM_ID);
      const [b] = deriveApcConfigPda(MINT, PROGRAM_ID);
      expect(a.toBase58()).toBe(b.toBase58());
    });

    it('differs for different mints', () => {
      const other = Keypair.generate().publicKey;
      const [a] = deriveApcConfigPda(MINT, PROGRAM_ID);
      const [b] = deriveApcConfigPda(other, PROGRAM_ID);
      expect(a.toBase58()).not.toBe(b.toBase58());
    });
  });

  describe('deriveChannelPda', () => {
    it('returns distinct PDAs for different channel ids', () => {
      const [config] = deriveApcConfigPda(MINT, PROGRAM_ID);
      const [a] = deriveChannelPda(config, new BN(1), PROGRAM_ID);
      const [b] = deriveChannelPda(config, new BN(2), PROGRAM_ID);
      expect(a.toBase58()).not.toBe(b.toBase58());
    });

    it('is deterministic', () => {
      const [config] = deriveApcConfigPda(MINT, PROGRAM_ID);
      const [a] = deriveChannelPda(config, CHANNEL_ID, PROGRAM_ID);
      const [b] = deriveChannelPda(config, CHANNEL_ID, PROGRAM_ID);
      expect(a.toBase58()).toBe(b.toBase58());
    });
  });

  // ── openChannel ──

  describe('openChannel', () => {
    it('opens a zero-deposit channel', async () => {
      const result = await apc.openChannel({
        mint: MINT,
        counterparty: COUNTERPARTY,
        deposit: new BN(0),
        disputePolicy: DisputePolicy.TimeoutFallback,
        timeoutSlots: new BN(500),
        channelId: CHANNEL_ID,
      });

      expect(provider.sendAndConfirm).toHaveBeenCalledOnce();
      expect(result.txSig).toBe('mockedTxSig');
      expect(result.channelId.toString()).toBe(CHANNEL_ID.toString());
    });

    it('opens a channel with a deposit', async () => {
      const result = await apc.openChannel({
        mint: MINT,
        counterparty: COUNTERPARTY,
        deposit: new BN(10_000_000),
        disputePolicy: DisputePolicy.TimeoutFallback,
        timeoutSlots: new BN(500),
        channelId: CHANNEL_ID,
        openerTokenAccount: OPENER_ATA,
        escrowTokenAccount: ESCROW_ATA,
      });

      expect(provider.sendAndConfirm).toHaveBeenCalledOnce();
      expect(result.txSig).toBe('mockedTxSig');
    });

    it('supports ArbitratorKey dispute policy with arbitrator', async () => {
      const arbitrator = Keypair.generate().publicKey;
      const result = await apc.openChannel({
        mint: MINT,
        counterparty: COUNTERPARTY,
        deposit: new BN(0),
        disputePolicy: DisputePolicy.ArbitratorKey,
        timeoutSlots: new BN(1000),
        channelId: new BN(99),
        arbitrator,
      });
      expect(result.txSig).toBe('mockedTxSig');
    });
  });

  // ── submitWorkProof ──

  describe('submitWorkProof', () => {
    it('submits a hash proof', async () => {
      const txSig = await apc.submitWorkProof(CHANNEL_ID, {
        mint: MINT,
        taskHash: TASK_HASH,
        outputHash: OUTPUT_HASH,
        proofType: ApcProofType.HashProof,
      });

      expect(provider.sendAndConfirm).toHaveBeenCalledOnce();
      expect(txSig).toBe('mockedTxSig');
    });

    it('throws when taskHash is wrong length', async () => {
      await expect(
        apc.submitWorkProof(CHANNEL_ID, {
          mint: MINT,
          taskHash: Buffer.alloc(16),
          outputHash: OUTPUT_HASH,
          proofType: ApcProofType.HashProof,
        }),
      ).rejects.toThrow('taskHash must be 32 bytes');
    });

    it('throws when outputHash is wrong length', async () => {
      await expect(
        apc.submitWorkProof(CHANNEL_ID, {
          mint: MINT,
          taskHash: TASK_HASH,
          outputHash: Buffer.alloc(10),
          proofType: ApcProofType.HashProof,
        }),
      ).rejects.toThrow('outputHash must be 32 bytes');
    });

    it('accepts Uint8Array hashes', async () => {
      const taskHash = new Uint8Array(32).fill(0x55);
      const outputHash = new Uint8Array(32).fill(0x66);
      const txSig = await apc.submitWorkProof(CHANNEL_ID, {
        mint: MINT,
        taskHash,
        outputHash,
        proofType: ApcProofType.OracleAttestation,
      });
      expect(txSig).toBe('mockedTxSig');
    });
  });

  // ── proposeSettle ──

  describe('proposeSettle', () => {
    it('proposes settlement amount', async () => {
      const txSig = await apc.proposeSettle(CHANNEL_ID, {
        mint: MINT,
        amount: new BN(8_000_000),
      });
      expect(provider.sendAndConfirm).toHaveBeenCalledOnce();
      expect(txSig).toBe('mockedTxSig');
    });

    it('can propose zero settlement (refund channel)', async () => {
      const txSig = await apc.proposeSettle(CHANNEL_ID, {
        mint: MINT,
        amount: new BN(0),
      });
      expect(txSig).toBe('mockedTxSig');
    });
  });

  // ── countersignSettle ──

  describe('countersignSettle', () => {
    it('countersigns a settlement', async () => {
      const txSig = await apc.countersignSettle(CHANNEL_ID, {
        mint: MINT,
        openerTokenAccount: OPENER_ATA,
        counterpartyTokenAccount: COUNTERPARTY_ATA,
        escrowTokenAccount: ESCROW_ATA,
      });
      expect(provider.sendAndConfirm).toHaveBeenCalledOnce();
      expect(txSig).toBe('mockedTxSig');
    });
  });

  // ── dispute ──

  describe('dispute', () => {
    it('raises a dispute with evidence hash', async () => {
      const txSig = await apc.dispute(CHANNEL_ID, {
        mint: MINT,
        evidenceHash: EVIDENCE_HASH,
      });
      expect(provider.sendAndConfirm).toHaveBeenCalledOnce();
      expect(txSig).toBe('mockedTxSig');
    });

    it('throws when evidenceHash is wrong length', async () => {
      await expect(
        apc.dispute(CHANNEL_ID, {
          mint: MINT,
          evidenceHash: Buffer.alloc(5),
        }),
      ).rejects.toThrow('evidenceHash must be 32 bytes');
    });
  });

  // ── forceClose ──

  describe('forceClose', () => {
    it('force-closes a channel', async () => {
      const txSig = await apc.forceClose(CHANNEL_ID, {
        mint: MINT,
        openerTokenAccount: OPENER_ATA,
        escrowTokenAccount: ESCROW_ATA,
      });
      expect(provider.sendAndConfirm).toHaveBeenCalledOnce();
      expect(txSig).toBe('mockedTxSig');
    });
  });

  // ── getChannel ──
  // getChannel is a pure read — no flag guard. Use a separate provider
  // instance so the config-preflight mock slots are not consumed.

  describe('getChannel', () => {
    it('decodes channel from account data', async () => {
      const channelData = buildChannelData({
        counterparty: COUNTERPARTY,
        deposit: 10_000_000n,
        status: ChannelStatus.Open,
        timeoutSlots: 500n,
      });

      // Dedicated provider: first (and only) call returns channel data.
      const readProvider = {
        wallet: { publicKey: Keypair.generate().publicKey },
        connection: {
          getAccountInfo: vi.fn().mockResolvedValue({
            data: channelData,
            lamports: 1_000_000,
            owner: PROGRAM_ID,
          }),
        },
        sendAndConfirm: vi.fn(),
      } as any;
      const apcRead = new AgentPaymentChannelModule(readProvider, PROGRAM_ID);

      const channel = await apcRead.getChannel(MINT, CHANNEL_ID);
      expect(channel.counterparty.toBase58()).toBe(COUNTERPARTY.toBase58());
      expect(channel.deposit).toBe(10_000_000n);
      expect(channel.status).toBe(ChannelStatus.Open);
      expect(channel.timeoutSlots).toBe(500n);
    });

    it('throws when channel account is not found', async () => {
      const nullProvider = {
        wallet: { publicKey: Keypair.generate().publicKey },
        connection: { getAccountInfo: vi.fn().mockResolvedValue(null) },
        sendAndConfirm: vi.fn(),
      } as any;
      const apcNull = new AgentPaymentChannelModule(nullProvider, PROGRAM_ID);

      await expect(apcNull.getChannel(MINT, CHANNEL_ID)).rejects.toThrow(
        /PaymentChannel not found/,
      );
    });
  });

  // ── decodeChannel (static) ──

  describe('AgentPaymentChannelModule.decodeChannel', () => {
    it('decodes all fields correctly', () => {
      const opener       = Keypair.generate().publicKey;
      const counterparty = COUNTERPARTY;
      const config       = Keypair.generate().publicKey;

      const data = buildChannelData({
        config,
        opener,
        counterparty,
        deposit: 5_000_000n,
        settleAmount: 4_000_000n,
        disputePolicy: DisputePolicy.MajorityOracle,
        timeoutSlots: 300n,
        settleProposedAt: 12345n,
        lastOutputHash: OUTPUT_HASH,
        lastProofType: ApcProofType.ZkSnarkProof,
        channelId: 99n,
        status: ChannelStatus.PendingSettle,
        openerSigned: true,
        counterpartySigned: false,
        bump: 200,
      });

      const ch = AgentPaymentChannelModule.decodeChannel(data);
      expect(ch.config.toBase58()).toBe(config.toBase58());
      expect(ch.opener.toBase58()).toBe(opener.toBase58());
      expect(ch.counterparty.toBase58()).toBe(counterparty.toBase58());
      expect(ch.deposit).toBe(5_000_000n);
      expect(ch.settleAmount).toBe(4_000_000n);
      expect(ch.disputePolicy).toBe(DisputePolicy.MajorityOracle);
      expect(ch.timeoutSlots).toBe(300n);
      expect(ch.settleProposedAt).toBe(12345n);
      expect(ch.lastProofType).toBe(ApcProofType.ZkSnarkProof);
      expect(ch.channelId).toBe(99n);
      expect(ch.status).toBe(ChannelStatus.PendingSettle);
      expect(ch.openerSigned).toBe(true);
      expect(ch.counterpartySigned).toBe(false);
      expect(ch.bump).toBe(200);
      expect(Array.from(ch.lastOutputHash)).toEqual(Array.from(OUTPUT_HASH));
    });

    it('decodes Settled status', () => {
      const data = buildChannelData({
        status: ChannelStatus.Settled,
        openerSigned: true,
        counterpartySigned: true,
      });
      const ch = AgentPaymentChannelModule.decodeChannel(data);
      expect(ch.status).toBe(ChannelStatus.Settled);
      expect(ch.openerSigned).toBe(true);
      expect(ch.counterpartySigned).toBe(true);
    });
  });

  // ── isForceCloseEligible ──

  describe('isForceCloseEligible', () => {
    it('returns false when channel is Open', () => {
      const data = buildChannelData({ status: ChannelStatus.Open, settleProposedAt: 100n, timeoutSlots: 10n });
      const ch = AgentPaymentChannelModule.decodeChannel(data);
      expect(apc.isForceCloseEligible(ch, 200n)).toBe(false);
    });

    it('returns false when PendingSettle but timeout not elapsed', () => {
      const data = buildChannelData({
        status: ChannelStatus.PendingSettle,
        settleProposedAt: 1000n,
        timeoutSlots: 500n,
      });
      const ch = AgentPaymentChannelModule.decodeChannel(data);
      expect(apc.isForceCloseEligible(ch, 1200n)).toBe(false); // 1200 < 1000+500
    });

    it('returns true when PendingSettle and timeout elapsed', () => {
      const data = buildChannelData({
        status: ChannelStatus.PendingSettle,
        settleProposedAt: 1000n,
        timeoutSlots: 500n,
      });
      const ch = AgentPaymentChannelModule.decodeChannel(data);
      expect(apc.isForceCloseEligible(ch, 1500n)).toBe(true); // exactly at boundary
      expect(apc.isForceCloseEligible(ch, 2000n)).toBe(true); // past boundary
    });

    it('returns false when already Settled', () => {
      const data = buildChannelData({ status: ChannelStatus.Settled, settleProposedAt: 100n, timeoutSlots: 10n });
      const ch = AgentPaymentChannelModule.decodeChannel(data);
      expect(apc.isForceCloseEligible(ch, 9999n)).toBe(false);
    });
  });

  // ── isTerminal ──

  describe('isTerminal', () => {
    it('returns false for Open', () => {
      const data = buildChannelData({ status: ChannelStatus.Open });
      expect(apc.isTerminal(AgentPaymentChannelModule.decodeChannel(data))).toBe(false);
    });

    it('returns false for PendingSettle', () => {
      const data = buildChannelData({ status: ChannelStatus.PendingSettle });
      expect(apc.isTerminal(AgentPaymentChannelModule.decodeChannel(data))).toBe(false);
    });

    it('returns false for Disputed', () => {
      const data = buildChannelData({ status: ChannelStatus.Disputed });
      expect(apc.isTerminal(AgentPaymentChannelModule.decodeChannel(data))).toBe(false);
    });

    it('returns true for Settled', () => {
      const data = buildChannelData({ status: ChannelStatus.Settled });
      expect(apc.isTerminal(AgentPaymentChannelModule.decodeChannel(data))).toBe(true);
    });

    it('returns true for ForceClosed', () => {
      const data = buildChannelData({ status: ChannelStatus.ForceClosed });
      expect(apc.isTerminal(AgentPaymentChannelModule.decodeChannel(data))).toBe(true);
    });
  });

  // ── instance PDA helpers ──

  describe('instance PDA helpers', () => {
    it('configPda matches deriveApcConfigPda', () => {
      const [a] = apc.configPda(MINT);
      const [b] = deriveApcConfigPda(MINT, PROGRAM_ID);
      expect(a.toBase58()).toBe(b.toBase58());
    });

    it('channelPda matches deriveChannelPda', () => {
      const [config] = apc.configPda(MINT);
      const [a] = apc.channelPda(config, CHANNEL_ID);
      const [b] = deriveChannelPda(config, CHANNEL_ID, PROGRAM_ID);
      expect(a.toBase58()).toBe(b.toBase58());
    });
  });

  // ── BUG-NEW-2: FLAG_AGENT_PAYMENT_CHANNEL guard in openChannel ──

  describe('FLAG_AGENT_PAYMENT_CHANNEL guard (BUG-NEW-2)', () => {
    it('FLAG_AGENT_PAYMENT_CHANNEL constant is bit 19', () => {
      expect(FLAG_AGENT_PAYMENT_CHANNEL).toBe(1n << 19n);
      expect(FLAG_AGENT_PAYMENT_CHANNEL).toBe(0x80000n);
    });

    it('throws a descriptive error when StablecoinConfig account is not found', async () => {
      // getAccountInfo returns null (config not initialized)
      const noConfigProvider = {
        wallet: { publicKey: Keypair.generate().publicKey },
        connection: { getAccountInfo: vi.fn().mockResolvedValue(null) },
        sendAndConfirm: vi.fn(),
      } as any;
      const apcNoConfig = new AgentPaymentChannelModule(noConfigProvider, PROGRAM_ID);

      await expect(
        apcNoConfig.openChannel({
          mint: MINT,
          counterparty: COUNTERPARTY,
          deposit: new BN(0),
          disputePolicy: DisputePolicy.TimeoutFallback,
          timeoutSlots: new BN(500),
          channelId: CHANNEL_ID,
        }),
      ).rejects.toThrow('StablecoinConfig not found');

      // sendAndConfirm must NOT be called — no tx should be built
      expect(noConfigProvider.sendAndConfirm).not.toHaveBeenCalled();
    });

    it('throws a descriptive error when FLAG_AGENT_PAYMENT_CHANNEL is not set', async () => {
      // Config exists but feature flag bit 19 is not set (flags = 0)
      const noFlagProvider = mockProvider(undefined, buildConfigData(0n));
      const apcNoFlag = new AgentPaymentChannelModule(noFlagProvider, PROGRAM_ID);

      await expect(
        apcNoFlag.openChannel({
          mint: MINT,
          counterparty: COUNTERPARTY,
          deposit: new BN(0),
          disputePolicy: DisputePolicy.TimeoutFallback,
          timeoutSlots: new BN(500),
          channelId: CHANNEL_ID,
        }),
      ).rejects.toThrow('FLAG_AGENT_PAYMENT_CHANNEL (bit 19) is not set');

      expect(noFlagProvider.sendAndConfirm).not.toHaveBeenCalled();
    });

    it('throws when other flags are set but not FLAG_AGENT_PAYMENT_CHANNEL', async () => {
      // All flags except bit 19
      const otherFlags = 0xFFFFFFFFFFFFFFFn ^ FLAG_AGENT_PAYMENT_CHANNEL;
      const otherFlagProvider = mockProvider(undefined, buildConfigData(otherFlags));
      const apcOtherFlag = new AgentPaymentChannelModule(otherFlagProvider, PROGRAM_ID);

      await expect(
        apcOtherFlag.openChannel({
          mint: MINT,
          counterparty: COUNTERPARTY,
          deposit: new BN(0),
          disputePolicy: DisputePolicy.TimeoutFallback,
          timeoutSlots: new BN(500),
          channelId: CHANNEL_ID,
        }),
      ).rejects.toThrow('FLAG_AGENT_PAYMENT_CHANNEL (bit 19) is not set');

      // Ensure no transaction was submitted — the guard must fire before any build/send
      expect(otherFlagProvider.sendAndConfirm).not.toHaveBeenCalled();
    });

    it('proceeds to build tx when FLAG_AGENT_PAYMENT_CHANNEL is set', async () => {
      // Default mockProvider sets FLAG_AGENT_PAYMENT_CHANNEL — should succeed
      const result = await apc.openChannel({
        mint: MINT,
        counterparty: COUNTERPARTY,
        deposit: new BN(0),
        disputePolicy: DisputePolicy.TimeoutFallback,
        timeoutSlots: new BN(500),
        channelId: CHANNEL_ID,
      });
      expect(provider.sendAndConfirm).toHaveBeenCalledOnce();
      expect(result.txSig).toBe('mockedTxSig');
    });

    it('proceeds when FLAG_AGENT_PAYMENT_CHANNEL is combined with other flags', async () => {
      const combinedFlags = FLAG_AGENT_PAYMENT_CHANNEL | (1n << 5n) | (1n << 17n);
      const combinedProvider = mockProvider(undefined, buildConfigData(combinedFlags));
      const apcCombined = new AgentPaymentChannelModule(combinedProvider, PROGRAM_ID);

      const result = await apcCombined.openChannel({
        mint: MINT,
        counterparty: COUNTERPARTY,
        deposit: new BN(0),
        disputePolicy: DisputePolicy.TimeoutFallback,
        timeoutSlots: new BN(500),
        channelId: new BN(42),
      });
      expect(result.txSig).toBe('mockedTxSig');
    });
  });
});

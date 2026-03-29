import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PublicKey } from '@solana/web3.js';
import {
  DaoCommitteeModule,
  FLAG_DAO_COMMITTEE,
  type ProposalAccount,
  type ProposalActionKind,
} from './DaoCommitteeModule';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const PROGRAM_ID = new PublicKey('2haUR6bUPcWXkCG9bZCPvVJYvtkGRDHnLtX1X1j9zbUY');
const ADMIN      = new PublicKey('J8yr2kdmy9FLLJqtar3msUW214GRdvJymJ6uFdJtjkQS');
const MINT       = new PublicKey('8SDDdSsYRrHRZknJ9Ep358R4zDWMLpwQzmtDwNvrpkge');
const MEMBER_A   = new PublicKey('95yogXJdMH6TtZwD4WazNjXB3rFe9MsN4X7V2hLsUG3p');
const MEMBER_B   = new PublicKey('C6wNtHat7AzUSxTkKhqz9CsvJ5sK9PnwKKbwsgjhHRHd');
const MEMBER_C   = new PublicKey('EZTbsmuJT6VTg3EE77v8GzW6KQRwxyHojkmMbLPFmXNU');

// ─── Mock helpers ─────────────────────────────────────────────────────────────

/** Build a minimal mock Anchor provider. */
function makeMockProvider(fetchResult: any = null) {
  return {
    wallet: { publicKey: ADMIN },
    connection: {
      getAccountInfo: vi.fn().mockResolvedValue(null),
    },
  } as any;
}

/** Build a mock Anchor program. */
function makeMockProgram(methodsResult: any = 'tx-sig-mock') {
  const rpc = vi.fn().mockResolvedValue(methodsResult);
  const accounts = vi.fn().mockReturnThis();
  const methodsChain = { accounts, rpc } as any;

  return {
    methods: new Proxy(
      {},
      {
        get: () => () => methodsChain,
      }
    ),
    account: {
      proposalPda: {
        fetch: vi.fn(),
      },
    },
  } as any;
}

// ─── FLAG_DAO_COMMITTEE constant ──────────────────────────────────────────────

describe('FLAG_DAO_COMMITTEE', () => {
  it('equals 1n << 2n (0x04)', () => {
    expect(FLAG_DAO_COMMITTEE).toBe(4n);
  });

  it('does not overlap with bit 0 (circuit breaker)', () => {
    expect(FLAG_DAO_COMMITTEE & (1n << 0n)).toBe(0n);
  });

  it('does not overlap with bit 1 (spend policy)', () => {
    expect(FLAG_DAO_COMMITTEE & (1n << 1n)).toBe(0n);
  });
});

// ─── PDA derivation ───────────────────────────────────────────────────────────

describe('DaoCommitteeModule PDA helpers', () => {
  let dao: DaoCommitteeModule;

  beforeEach(() => {
    dao = new DaoCommitteeModule(makeMockProvider(), PROGRAM_ID);
  });

  describe('getConfigPda', () => {
    it('returns a deterministic PDA for same mint+programId', () => {
      const [pda1] = dao.getConfigPda(MINT);
      const [pda2] = dao.getConfigPda(MINT);
      expect(pda1.toBase58()).toBe(pda2.toBase58());
    });

    it('returns a different PDA for a different mint', () => {
      const otherMint = new PublicKey('9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM');
      const [pda1] = dao.getConfigPda(MINT);
      const [pda2] = dao.getConfigPda(otherMint);
      expect(pda1.toBase58()).not.toBe(pda2.toBase58());
    });
  });

  describe('getCommitteePda', () => {
    it('returns a deterministic PDA for the same mint', () => {
      const [pda1] = dao.getCommitteePda(MINT);
      const [pda2] = dao.getCommitteePda(MINT);
      expect(pda1.toBase58()).toBe(pda2.toBase58());
    });

    it('is distinct from the config PDA', () => {
      const [config] = dao.getConfigPda(MINT);
      const [committee] = dao.getCommitteePda(MINT);
      expect(config.toBase58()).not.toBe(committee.toBase58());
    });
  });

  describe('getProposalPda', () => {
    it('returns a deterministic PDA for same mint+proposalId', () => {
      const [pda1] = dao.getProposalPda(MINT, 0);
      const [pda2] = dao.getProposalPda(MINT, 0);
      expect(pda1.toBase58()).toBe(pda2.toBase58());
    });

    it('returns different PDAs for different proposal ids', () => {
      const [pda0] = dao.getProposalPda(MINT, 0);
      const [pda1] = dao.getProposalPda(MINT, 1);
      expect(pda0.toBase58()).not.toBe(pda1.toBase58());
    });
  });
});

// ─── initDaoCommittee ─────────────────────────────────────────────────────────

describe('DaoCommitteeModule.initDaoCommittee', () => {
  it('calls init_dao_committee and returns a signature', async () => {
    const provider = makeMockProvider();
    const dao = new DaoCommitteeModule(provider, PROGRAM_ID);
    const mockProgram = makeMockProgram('sig-init');
    (dao as any)._program = mockProgram;

    const sig = await dao.initDaoCommittee({
      mint: MINT,
      members: [MEMBER_A, MEMBER_B, MEMBER_C],
      quorum: 2,
    });
    expect(sig).toBe('sig-init');
  });
});

// ─── proposeAction ────────────────────────────────────────────────────────────

describe('DaoCommitteeModule.proposeAction', () => {
  const actions: Array<{ label: string; action: ProposalActionKind }> = [
    { label: 'Pause', action: { kind: 'Pause' } },
    { label: 'Unpause', action: { kind: 'Unpause' } },
    { label: 'SetFeatureFlag', action: { kind: 'SetFeatureFlag', flag: 4n } },
    { label: 'ClearFeatureFlag', action: { kind: 'ClearFeatureFlag', flag: 4n } },
    { label: 'UpdateMinter', action: { kind: 'UpdateMinter', newMinter: MEMBER_A } },
    { label: 'RevokeMinter', action: { kind: 'RevokeMinter', minter: MEMBER_B } },
  ];

  for (const { label, action } of actions) {
    it(`submits a ${label} proposal and returns signature`, async () => {
      const provider = makeMockProvider();
      const dao = new DaoCommitteeModule(provider, PROGRAM_ID);
      const mockProgram = makeMockProgram(`sig-propose-${label}`);
      (dao as any)._program = mockProgram;

      const sig = await dao.proposeAction({ mint: MINT, proposalId: 0, action });
      expect(sig).toBe(`sig-propose-${label}`);
    });
  }
});

// ─── voteAction ──────────────────────────────────────────────────────────────

describe('DaoCommitteeModule.voteAction', () => {
  it('calls vote_action and returns a signature', async () => {
    const provider = makeMockProvider();
    const dao = new DaoCommitteeModule(provider, PROGRAM_ID);
    const mockProgram = makeMockProgram('sig-vote');
    (dao as any)._program = mockProgram;

    const sig = await dao.voteAction({ mint: MINT, proposalId: 0 });
    expect(sig).toBe('sig-vote');
  });
});

// ─── executeAction ────────────────────────────────────────────────────────────

describe('DaoCommitteeModule.executeAction', () => {
  it('calls execute_action and returns a signature', async () => {
    const provider = makeMockProvider();
    const dao = new DaoCommitteeModule(provider, PROGRAM_ID);
    const mockProgram = makeMockProgram('sig-execute');
    (dao as any)._program = mockProgram;

    const sig = await dao.executeAction({ mint: MINT, proposalId: 0 });
    expect(sig).toBe('sig-execute');
  });
});

// ─── fetchProposal ────────────────────────────────────────────────────────────

describe('DaoCommitteeModule.fetchProposal', () => {
  it('returns null when the proposal account does not exist', async () => {
    const provider = makeMockProvider();
    const dao = new DaoCommitteeModule(provider, PROGRAM_ID);
    const mockProgram = makeMockProgram();
    mockProgram.account.proposalPda.fetch.mockRejectedValue(new Error('Account not found'));
    (dao as any)._program = mockProgram;

    const result = await dao.fetchProposal(MINT, 0);
    expect(result).toBeNull();
  });

  it('decodes a Pause proposal correctly', async () => {
    const provider = makeMockProvider();
    const dao = new DaoCommitteeModule(provider, PROGRAM_ID);
    const [config] = dao.getConfigPda(MINT);
    const mockProgram = makeMockProgram();
    mockProgram.account.proposalPda.fetch.mockResolvedValue({
      config,
      proposalId: 0,
      proposer: ADMIN,
      action: { pause: {} },
      votes: [MEMBER_A, MEMBER_B],
      executed: false,
      cancelled: false,
    });
    (dao as any)._program = mockProgram;

    const proposal = await dao.fetchProposal(MINT, 0);
    expect(proposal).not.toBeNull();
    expect(proposal!.action).toEqual({ kind: 'Pause' });
    expect(proposal!.executed).toBe(false);
    expect(proposal!.votes).toHaveLength(2);
  });

  it('decodes SetFeatureFlag action with correct flag bigint', async () => {
    const provider = makeMockProvider();
    const dao = new DaoCommitteeModule(provider, PROGRAM_ID);
    const [config] = dao.getConfigPda(MINT);
    const mockProgram = makeMockProgram();
    mockProgram.account.proposalPda.fetch.mockResolvedValue({
      config,
      proposalId: 1,
      proposer: MEMBER_A,
      action: { setFeatureFlag: { flag: { toString: () => '4' } } },
      votes: [MEMBER_A],
      executed: false,
      cancelled: false,
    });
    (dao as any)._program = mockProgram;

    const proposal = await dao.fetchProposal(MINT, 1);
    expect(proposal!.action).toEqual({ kind: 'SetFeatureFlag', flag: 4n });
  });

  it('decodes an executed proposal', async () => {
    const provider = makeMockProvider();
    const dao = new DaoCommitteeModule(provider, PROGRAM_ID);
    const [config] = dao.getConfigPda(MINT);
    const mockProgram = makeMockProgram();
    mockProgram.account.proposalPda.fetch.mockResolvedValue({
      config,
      proposalId: 2,
      proposer: MEMBER_B,
      action: { unpause: {} },
      votes: [MEMBER_A, MEMBER_B, MEMBER_C],
      executed: true,
      cancelled: false,
    });
    (dao as any)._program = mockProgram;

    const proposal = await dao.fetchProposal(MINT, 2);
    expect(proposal!.executed).toBe(true);
    expect(proposal!.action).toEqual({ kind: 'Unpause' });
  });
});

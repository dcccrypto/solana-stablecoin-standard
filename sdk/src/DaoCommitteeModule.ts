import { PublicKey, TransactionSignature } from '@solana/web3.js';
import { AnchorProvider, BN } from '@coral-xyz/anchor';

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Bit flag for the DAO Committee governance feature (SSS-068).
 *
 * When this flag is set in `StablecoinConfig.feature_flags`, DAO committee
 * governance is active. Proposals can be raised, voted on, and executed.
 *
 * Matches `FLAG_DAO_COMMITTEE` in the Anchor program (bit 2 = 0x04).
 *
 * @example
 * ```ts
 * const active = featureFlags.isFeatureFlagSet(mint, FLAG_DAO_COMMITTEE);
 * ```
 */
export const FLAG_DAO_COMMITTEE = 1n << 2n; // 0x04

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Supported proposal action variants (mirrors ProposalAction enum in Anchor).
 */
export type ProposalActionKind =
  | { kind: 'Pause' }
  | { kind: 'Unpause' }
  | { kind: 'SetFeatureFlag'; flag: bigint }
  | { kind: 'ClearFeatureFlag'; flag: bigint }
  | { kind: 'UpdateMinter'; newMinter: PublicKey }
  | { kind: 'RevokeMinter'; minter: PublicKey };

/**
 * On-chain state of a proposal, as decoded from the `ProposalPda` account.
 */
export interface ProposalAccount {
  /** Config pubkey this proposal targets. */
  config: PublicKey;
  /** Sequential proposal id (0-indexed). */
  proposalId: number;
  /** Proposer pubkey. */
  proposer: PublicKey;
  /** The action this proposal will execute when quorum is reached. */
  action: ProposalActionKind;
  /** List of committee members who have voted yes. */
  votes: PublicKey[];
  /** Whether the proposal has already been executed. */
  executed: boolean;
  /** Whether the proposal has been cancelled. */
  cancelled: boolean;
}

/**
 * Parameters for `initDaoCommittee`.
 */
export interface InitDaoCommitteeParams {
  /** The stablecoin mint. */
  mint: PublicKey;
  /** List of committee member pubkeys (1–10). */
  members: PublicKey[];
  /** Minimum yes-votes needed to execute a proposal (1 ≤ quorum ≤ members.length). */
  quorum: number;
}

/**
 * Parameters for `proposeAction`.
 */
export interface ProposeActionParams {
  /** The stablecoin mint. */
  mint: PublicKey;
  /** Sequential proposal id to assign (must match next expected id on-chain). */
  proposalId: number;
  /** The action to propose. */
  action: ProposalActionKind;
}

/**
 * Parameters for `voteAction`.
 */
export interface VoteActionParams {
  /** The stablecoin mint. */
  mint: PublicKey;
  /** The proposal id to vote on. */
  proposalId: number;
}

/**
 * Parameters for `executeAction`.
 */
export interface ExecuteActionParams {
  /** The stablecoin mint. */
  mint: PublicKey;
  /** The proposal id to execute. */
  proposalId: number;
}

// ─── DaoCommitteeModule ───────────────────────────────────────────────────────

/**
 * DaoCommitteeModule — SDK client for the SSS DAO Committee governance
 * system (SSS-068).
 *
 * Wraps `init_dao_committee`, `propose_action`, `vote_action`, and
 * `execute_action` Anchor instructions.  Also provides a `fetchProposal`
 * helper to read on-chain proposal state.
 *
 * ## Workflow
 * 1. Admin calls `initDaoCommittee` to create the committee config PDA.
 * 2. Any committee member calls `proposeAction` to create a proposal.
 * 3. Each committee member calls `voteAction` to cast a yes-vote.
 * 4. Once quorum is reached, anyone may call `executeAction` to run the
 *    proposed governance action.
 *
 * @example
 * ```ts
 * import { DaoCommitteeModule, FLAG_DAO_COMMITTEE } from '@sss/sdk';
 *
 * const dao = new DaoCommitteeModule(provider, programId);
 *
 * // 1. Initialise committee (admin only)
 * await dao.initDaoCommittee({ mint, members: [alice, bob, carol], quorum: 2 });
 *
 * // 2. Propose pausing the stablecoin
 * await dao.proposeAction({ mint, proposalId: 0, action: { kind: 'Pause' } });
 *
 * // 3. Members vote
 * await dao.voteAction({ mint, proposalId: 0 });   // alice
 * await dao.voteAction({ mint, proposalId: 0 });   // bob  (quorum reached)
 *
 * // 4. Execute
 * await dao.executeAction({ mint, proposalId: 0 });
 *
 * // 5. Inspect on-chain state
 * const proposal = await dao.fetchProposal(mint, 0);
 * console.log(proposal?.executed); // true
 * ```
 */
export class DaoCommitteeModule {
  private readonly provider: AnchorProvider;
  private readonly programId: PublicKey;

  static readonly CONFIG_SEED = Buffer.from('stablecoin-config');
  static readonly COMMITTEE_SEED = Buffer.from('dao-committee');
  static readonly PROPOSAL_SEED = Buffer.from('dao-proposal');

  /**
   * @param provider   Anchor provider (wallet must have appropriate authority).
   * @param programId  SSS token program ID.
   */
  constructor(provider: AnchorProvider, programId: PublicKey) {
    this.provider = provider;
    this.programId = programId;
  }

  // ─── PDA helpers ─────────────────────────────────────────────────────────

  /**
   * Derive the `StablecoinConfig` PDA for the given mint.
   */
  getConfigPda(mint: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [DaoCommitteeModule.CONFIG_SEED, mint.toBuffer()],
      this.programId
    );
  }

  /**
   * Derive the `DaoCommitteeConfig` PDA for the given mint.
   *
   * Seeds: `[b"dao-committee", config_pubkey]`
   */
  getCommitteePda(mint: PublicKey): [PublicKey, number] {
    const [config] = this.getConfigPda(mint);
    return PublicKey.findProgramAddressSync(
      [DaoCommitteeModule.COMMITTEE_SEED, config.toBuffer()],
      this.programId
    );
  }

  /**
   * Derive the `ProposalPda` for a specific proposal id.
   *
   * Seeds: `[b"dao-proposal", config_pubkey, proposal_id.to_le_bytes()]`
   */
  getProposalPda(mint: PublicKey, proposalId: number): [PublicKey, number] {
    const [config] = this.getConfigPda(mint);
    const idBuf = Buffer.alloc(4);
    idBuf.writeUInt32LE(proposalId, 0);
    return PublicKey.findProgramAddressSync(
      [DaoCommitteeModule.PROPOSAL_SEED, config.toBuffer(), idBuf],
      this.programId
    );
  }

  // ─── Writes ──────────────────────────────────────────────────────────────

  /**
   * Initialise the DAO Committee PDA for this mint.
   *
   * Calls `init_dao_committee` on the SSS token program.
   * The wallet in `provider` must be the admin authority of the
   * `StablecoinConfig`.  Requires `FLAG_DAO_COMMITTEE` to be set first.
   *
   * @param params  `{ mint, members, quorum }`
   * @returns       Transaction signature.
   */
  async initDaoCommittee(params: InitDaoCommitteeParams): Promise<TransactionSignature> {
    const { mint, members, quorum } = params;
    const program = await this._loadProgram();
    const [config] = this.getConfigPda(mint);
    const [committee] = this.getCommitteePda(mint);

    return program.methods
      .initDaoCommittee(members, quorum)
      .accounts({
        authority: this.provider.wallet.publicKey,
        mint,
        config,
        committee,
        systemProgram: PublicKey.default,
      })
      .rpc({ commitment: 'confirmed' });
  }

  /**
   * Create a new governance proposal.
   *
   * Calls `propose_action` on the SSS token program.  The wallet must be a
   * registered committee member.
   *
   * @param params  `{ mint, proposalId, action }`
   * @returns       Transaction signature.
   */
  async proposeAction(params: ProposeActionParams): Promise<TransactionSignature> {
    const { mint, proposalId, action } = params;
    const program = await this._loadProgram();
    const [config] = this.getConfigPda(mint);
    const [committee] = this.getCommitteePda(mint);
    const [proposal] = this.getProposalPda(mint, proposalId);

    return program.methods
      .proposeAction(proposalId, this._encodeAction(action))
      .accounts({
        proposer: this.provider.wallet.publicKey,
        mint,
        config,
        committee,
        proposal,
        systemProgram: PublicKey.default,
      })
      .rpc({ commitment: 'confirmed' });
  }

  /**
   * Cast a yes-vote on an existing proposal.
   *
   * Calls `vote_action` on the SSS token program.  The wallet must be a
   * committee member who has not already voted on this proposal.
   *
   * @param params  `{ mint, proposalId }`
   * @returns       Transaction signature.
   */
  async voteAction(params: VoteActionParams): Promise<TransactionSignature> {
    const { mint, proposalId } = params;
    const program = await this._loadProgram();
    const [config] = this.getConfigPda(mint);
    const [committee] = this.getCommitteePda(mint);
    const [proposal] = this.getProposalPda(mint, proposalId);

    return program.methods
      .voteAction(proposalId)
      .accounts({
        voter: this.provider.wallet.publicKey,
        mint,
        config,
        committee,
        proposal,
      })
      .rpc({ commitment: 'confirmed' });
  }

  /**
   * Execute a proposal once quorum has been reached.
   *
   * Calls `execute_action` on the SSS token program.  Anyone may call this
   * once quorum is satisfied.  Fails if already executed or quorum not met.
   *
   * @param params  `{ mint, proposalId }`
   * @returns       Transaction signature.
   */
  async executeAction(params: ExecuteActionParams): Promise<TransactionSignature> {
    const { mint, proposalId } = params;
    const program = await this._loadProgram();
    const [config] = this.getConfigPda(mint);
    const [committee] = this.getCommitteePda(mint);
    const [proposal] = this.getProposalPda(mint, proposalId);

    return program.methods
      .executeAction(proposalId)
      .accounts({
        executor: this.provider.wallet.publicKey,
        mint,
        config,
        committee,
        proposal,
      })
      .rpc({ commitment: 'confirmed' });
  }

  // ─── Reads ───────────────────────────────────────────────────────────────

  /**
   * Fetch and decode a `ProposalPda` account from on-chain.
   *
   * Returns `null` if the account does not exist yet.
   *
   * @param mint        The stablecoin mint.
   * @param proposalId  The proposal id (0-indexed).
   */
  async fetchProposal(mint: PublicKey, proposalId: number): Promise<ProposalAccount | null> {
    const program = await this._loadProgram();
    const [pda] = this.getProposalPda(mint, proposalId);
    try {
      const raw = await program.account.proposalPda.fetch(pda);
      return {
        config: raw.config as PublicKey,
        proposalId: raw.proposalId as number,
        proposer: raw.proposer as PublicKey,
        action: this._decodeAction(raw.action),
        votes: (raw.votes ?? []) as PublicKey[],
        executed: raw.executed as boolean,
        cancelled: raw.cancelled as boolean,
      };
    } catch {
      return null;
    }
  }

  // ─── Internals ───────────────────────────────────────────────────────────

  /**
   * Encode a `ProposalActionKind` into the Anchor enum wire format.
   * @internal
   */
  private _encodeAction(action: ProposalActionKind): object {
    switch (action.kind) {
      case 'Pause':
        return { pause: {} };
      case 'Unpause':
        return { unpause: {} };
      case 'SetFeatureFlag':
        return { setFeatureFlag: { flag: new BN(action.flag.toString()) } };
      case 'ClearFeatureFlag':
        return { clearFeatureFlag: { flag: new BN(action.flag.toString()) } };
      case 'UpdateMinter':
        return { updateMinter: { newMinter: action.newMinter } };
      case 'RevokeMinter':
        return { revokeMinter: { minter: action.minter } };
    }
  }

  /**
   * Decode an Anchor enum action variant back to `ProposalActionKind`.
   * @internal
   */
  private _decodeAction(raw: any): ProposalActionKind {
    if (raw.pause !== undefined) return { kind: 'Pause' };
    if (raw.unpause !== undefined) return { kind: 'Unpause' };
    if (raw.setFeatureFlag !== undefined)
      return { kind: 'SetFeatureFlag', flag: BigInt(raw.setFeatureFlag.flag.toString()) };
    if (raw.clearFeatureFlag !== undefined)
      return { kind: 'ClearFeatureFlag', flag: BigInt(raw.clearFeatureFlag.flag.toString()) };
    if (raw.updateMinter !== undefined)
      return { kind: 'UpdateMinter', newMinter: raw.updateMinter.newMinter as PublicKey };
    if (raw.revokeMinter !== undefined)
      return { kind: 'RevokeMinter', minter: raw.revokeMinter.minter as PublicKey };
    throw new Error(`Unknown ProposalAction variant: ${JSON.stringify(raw)}`);
  }

  /**
   * Lazy-load + cache the Anchor program instance.
   * @internal
   */
  private _program: any | null = null;
  private async _loadProgram(): Promise<any> {
    if (this._program) return this._program;
    const { Program: AnchorProgram } = await import('@coral-xyz/anchor');
    const idl = await import('./idl/sss_token.json');
    this._program = new AnchorProgram(idl as any, this.provider) as any;
    return this._program;
  }
}

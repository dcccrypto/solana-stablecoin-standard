import { PublicKey, TransactionSignature } from '@solana/web3.js';
import { AnchorProvider, BN } from '@coral-xyz/anchor';
import { TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Parameters for `initGuardianConfig`.
 */
export interface InitGuardianConfigParams {
  /** The stablecoin mint. */
  mint: PublicKey;
  /** List of guardian pubkeys (1–7). */
  guardians: PublicKey[];
  /** Minimum yes-votes needed to enact a pause (1 ≤ threshold ≤ guardians.length). */
  threshold: number;
}

/**
 * Parameters for `proposePause`.
 */
export interface ProposePauseParams {
  /** The stablecoin mint. */
  mint: PublicKey;
  /**
   * The proposal id to use for PDA derivation — must equal the current
   * `guardian_config.next_proposal_id` on-chain.  Fetch via
   * `fetchNextProposalId(mint)` if unknown.
   */
  proposalId: number | bigint;
  /**
   * Up to 32 bytes of freeform reason text.  Shorter strings are zero-padded;
   * longer strings are truncated to 32 bytes.
   */
  reason: string | Uint8Array;
}

/**
 * Parameters for `votePause`.
 */
export interface VotePauseParams {
  /** The stablecoin mint. */
  mint: PublicKey;
  /** The proposal id to vote on. */
  proposalId: number | bigint;
}

/**
 * Parameters for `liftPause`.
 */
export interface LiftPauseParams {
  /** The stablecoin mint. */
  mint: PublicKey;
}

// ─── GuardianModule ───────────────────────────────────────────────────────────

/**
 * GuardianModule — SDK client for the SSS Guardian multisig emergency-pause
 * system (SSS-121).
 *
 * Wraps `init_guardian_config`, `guardian_propose_pause`,
 * `guardian_vote_pause`, and `guardian_lift_pause` Anchor instructions.
 *
 * ## Workflow
 * 1. Authority calls `initGuardianConfig` once to register guardians and a
 *    vote threshold.
 * 2. Any registered guardian calls `proposePause` to open a pause proposal.
 * 3. Guardians call `votePause` until the threshold is reached; the mint is
 *    paused automatically when quorum is met.
 * 4. The authority (after the 24 h override delay if the pause was
 *    guardian-initiated) or a full guardian quorum calls `liftPause` to
 *    resume normal operation.
 *
 * @example
 * ```ts
 * import { GuardianModule } from '@sss/sdk';
 *
 * const gm = new GuardianModule(provider, programId);
 *
 * // 1. Initialise (authority only, called once)
 * await gm.initGuardianConfig({ mint, guardians: [alice, bob], threshold: 2 });
 *
 * // 2. Alice proposes a pause
 * const nextId = await gm.fetchNextProposalId(mint);
 * await gm.proposePause({ mint, proposalId: nextId, reason: 'security incident' });
 *
 * // 3. Bob votes (threshold reached → mint paused)
 * await gm.votePause({ mint, proposalId: nextId });
 *
 * // 4. After the override delay, authority lifts
 * await gm.liftPause({ mint });
 * ```
 */
export class GuardianModule {
  private readonly provider: AnchorProvider;
  private readonly programId: PublicKey;

  static readonly CONFIG_SEED = Buffer.from('stablecoin-config');
  static readonly GUARDIAN_CONFIG_SEED = Buffer.from('guardian-config');
  static readonly PAUSE_PROPOSAL_SEED = Buffer.from('pause-proposal');

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
   *
   * Seeds: `[b"stablecoin-config", mint]`
   */
  getConfigPda(mint: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [GuardianModule.CONFIG_SEED, mint.toBuffer()],
      this.programId
    );
  }

  /**
   * Derive the `GuardianConfig` PDA for the given mint.
   *
   * Seeds: `[b"guardian-config", config_pubkey]`
   */
  getGuardianConfigPda(mint: PublicKey): [PublicKey, number] {
    const [config] = this.getConfigPda(mint);
    return PublicKey.findProgramAddressSync(
      [GuardianModule.GUARDIAN_CONFIG_SEED, config.toBuffer()],
      this.programId
    );
  }

  /**
   * Derive the `PauseProposal` PDA for a specific proposal id.
   *
   * Seeds: `[b"pause-proposal", config_pubkey, proposal_id.to_le_bytes()]`
   * Note: `proposal_id` is a u64 on-chain, so we use 8 bytes LE.
   */
  getPauseProposalPda(mint: PublicKey, proposalId: number | bigint): [PublicKey, number] {
    const [config] = this.getConfigPda(mint);
    const idBuf = Buffer.alloc(8);
    idBuf.writeBigUInt64LE(BigInt(proposalId), 0);
    return PublicKey.findProgramAddressSync(
      [GuardianModule.PAUSE_PROPOSAL_SEED, config.toBuffer(), idBuf],
      this.programId
    );
  }

  // ─── Reads ───────────────────────────────────────────────────────────────

  /**
   * Fetch the current `next_proposal_id` from the on-chain `GuardianConfig`.
   *
   * Use this before calling `proposePause` to know which proposal id (and
   * thus which PDA) the program will assign to the new proposal.
   *
   * Returns `null` if the `GuardianConfig` account does not exist yet.
   *
   * @param mint  The stablecoin mint.
   */
  async fetchNextProposalId(mint: PublicKey): Promise<bigint | null> {
    const program = await this._loadProgram();
    const [pda] = this.getGuardianConfigPda(mint);
    try {
      const raw = await program.account.guardianConfig.fetch(pda);
      return BigInt((raw.nextProposalId as BN).toString());
    } catch {
      return null;
    }
  }

  // ─── Writes ──────────────────────────────────────────────────────────────

  /**
   * Initialise the guardian multisig for a stablecoin.
   *
   * Calls `init_guardian_config` on the SSS token program.
   * The wallet in `provider` must be the admin authority of the
   * `StablecoinConfig`.  Can only be called once per mint.
   *
   * @param params  `{ mint, guardians, threshold }`
   * @returns       Transaction signature.
   */
  async initGuardianConfig(params: InitGuardianConfigParams): Promise<TransactionSignature> {
    const { mint, guardians, threshold } = params;
    const program = await this._loadProgram();
    const [config] = this.getConfigPda(mint);
    const [guardianConfig] = this.getGuardianConfigPda(mint);

    return program.methods
      .initGuardianConfig(guardians, threshold)
      .accounts({
        authority: this.provider.wallet.publicKey,
        config,
        mint,
        guardianConfig,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        systemProgram: PublicKey.default,
      })
      .rpc({ commitment: 'confirmed' });
  }

  /**
   * Propose an emergency pause.
   *
   * Calls `guardian_propose_pause` on the SSS token program.  The wallet must
   * be a registered guardian.  If the threshold is 1, the mint is paused
   * immediately upon proposal.
   *
   * @param params  `{ mint, proposalId, reason }`
   * @returns       Transaction signature.
   */
  async proposePause(params: ProposePauseParams): Promise<TransactionSignature> {
    const { mint, proposalId, reason } = params;
    const program = await this._loadProgram();
    const [config] = this.getConfigPda(mint);
    const [guardianConfig] = this.getGuardianConfigPda(mint);
    const [proposal] = this.getPauseProposalPda(mint, proposalId);

    const reasonBytes = this._encodeReason(reason);

    return program.methods
      .guardianProposePause(Array.from(reasonBytes))
      .accounts({
        guardian: this.provider.wallet.publicKey,
        config,
        mint,
        guardianConfig,
        proposal,
        systemProgram: PublicKey.default,
      })
      .rpc({ commitment: 'confirmed' });
  }

  /**
   * Cast a YES vote on an open pause proposal.
   *
   * Calls `guardian_vote_pause` on the SSS token program.  The wallet must be
   * a registered guardian who has not already voted on this proposal.  When
   * votes reach the threshold the mint is paused immediately.
   *
   * @param params  `{ mint, proposalId }`
   * @returns       Transaction signature.
   */
  async votePause(params: VotePauseParams): Promise<TransactionSignature> {
    const { mint, proposalId } = params;
    const program = await this._loadProgram();
    const [config] = this.getConfigPda(mint);
    const [guardianConfig] = this.getGuardianConfigPda(mint);
    const [proposal] = this.getPauseProposalPda(mint, proposalId);

    return program.methods
      .guardianVotePause(new BN(proposalId.toString()))
      .accounts({
        guardian: this.provider.wallet.publicKey,
        config,
        mint,
        guardianConfig,
        proposal,
      })
      .rpc({ commitment: 'confirmed' });
  }

  /**
   * Lift a guardian-imposed pause.
   *
   * Calls `guardian_lift_pause` on the SSS token program.
   *
   * - The stablecoin **authority** may call this, but only after the
   *   `GUARDIAN_PAUSE_AUTHORITY_OVERRIDE_DELAY` (24 h) has elapsed since the
   *   guardian pause was set (BUG-018 enforcement).
   * - A **full guardian quorum** may lift the pause immediately at any time.
   *
   * @param params  `{ mint }`
   * @returns       Transaction signature.
   */
  async liftPause(params: LiftPauseParams): Promise<TransactionSignature> {
    const { mint } = params;
    const program = await this._loadProgram();
    const [config] = this.getConfigPda(mint);
    const [guardianConfig] = this.getGuardianConfigPda(mint);

    return program.methods
      .guardianLiftPause()
      .accounts({
        caller: this.provider.wallet.publicKey,
        config,
        mint,
        guardianConfig,
      })
      .rpc({ commitment: 'confirmed' });
  }

  // ─── Internals ───────────────────────────────────────────────────────────

  /**
   * Encode a reason string or byte array into a fixed 32-byte buffer.
   * Strings are UTF-8 encoded then zero-padded or truncated to 32 bytes.
   * @internal
   */
  private _encodeReason(reason: string | Uint8Array): Uint8Array {
    const buf = new Uint8Array(32);
    if (typeof reason === 'string') {
      const encoded = new TextEncoder().encode(reason);
      buf.set(encoded.slice(0, 32));
    } else {
      buf.set(reason.slice(0, 32));
    }
    return buf;
  }

  /**
   * Lazy-load + cache the Anchor program instance with IDL address override.
   * @internal
   */
  private _program: any | null = null;
  private async _loadProgram(): Promise<any> {
    if (this._program) return this._program;
    const { Program: AnchorProgram } = await import('@coral-xyz/anchor');
    const idl = await import('./idl/sss_token.json');
    this._program = new AnchorProgram(
      { ...(idl as any), address: this.programId.toBase58() },
      this.provider
    ) as any;
    return this._program;
  }
}

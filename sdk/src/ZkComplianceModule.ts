import { PublicKey, TransactionSignature } from '@solana/web3.js';
import { AnchorProvider } from '@coral-xyz/anchor';

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Bit flag for the ZK compliance feature (SSS-076).
 *
 * When this flag is set in `StablecoinConfig.feature_flags`, the on-chain
 * ZK compliance module is active. Users must submit a valid zero-knowledge
 * proof to the `ZkComplianceConfig` PDA before being authorised to
 * transact beyond basic thresholds.
 *
 * Matches `FLAG_ZK_COMPLIANCE` in the Anchor program (bit 4 = 0x10).
 *
 * @example
 * ```ts
 * const active = await zkModule.isZkComplianceEnabled(mint);
 * ```
 */
export const FLAG_ZK_COMPLIANCE = 1n << 4n; // 0x10

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * On-chain state of a `ZkComplianceConfig` PDA, as decoded from account data.
 *
 * Seeds: `[b"zk-compliance", sss_mint]`
 */
export interface ZkComplianceState {
  /** The SSS stablecoin mint this config belongs to. */
  sssMint: PublicKey;
  /** Program or verifying-key address used to validate submitted proofs. */
  verifierKey: PublicKey;
  /** Unix timestamp after which a compliance proof expires (seconds). */
  proofExpirySeconds: number;
  /** PDA bump. */
  bump: number;
}

/**
 * On-chain verification record for a single user's ZK compliance proof.
 *
 * Seeds: `[b"zk-verification", sss_mint, user]`
 */
export interface ZkVerificationRecord {
  /** The stablecoin mint this record belongs to. */
  sssMint: PublicKey;
  /** The user whose compliance was verified. */
  user: PublicKey;
  /** Unix timestamp when the proof was accepted (seconds). */
  verifiedAt: number;
  /** Unix timestamp when this record expires (seconds). */
  expiresAt: number;
  /** Whether the compliance status is currently valid (non-expired). */
  isValid: boolean;
  /** PDA bump. */
  bump: number;
}

/**
 * Parameters for `enableZkCompliance` (wraps `init_zk_compliance`).
 */
export interface EnableZkComplianceParams {
  /** The stablecoin mint (must hold admin authority). */
  mint: PublicKey;
  /** On-chain verifier key / program address used to validate proofs. */
  verifierKey: PublicKey;
  /**
   * Proof expiry window in seconds. After this many seconds from verification,
   * the `ZkVerificationRecord` is considered stale and re-proof is required.
   * Defaults to `2592000` (30 days).
   */
  proofExpirySeconds?: number;
}

/**
 * Parameters for `disableZkCompliance`.
 *
 * Clears `FLAG_ZK_COMPLIANCE` via `clear_feature_flag`. The
 * `ZkComplianceConfig` PDA is left intact on-chain so the verifier key and
 * expiry settings are preserved if the feature is re-enabled later.
 */
export interface DisableZkComplianceParams {
  /** The stablecoin mint. */
  mint: PublicKey;
}

/**
 * Parameters for `submitZkProof`.
 *
 * Submits a serialised zero-knowledge proof to the `submit_zk_proof`
 * Anchor instruction. The on-chain verifier validates the proof and writes
 * (or updates) the `ZkVerificationRecord` PDA for the user.
 *
 * @remarks
 * Depends on SSS-075 anchor instruction `submit_zk_proof` being deployed.
 * Once SSS-075 lands this method is fully wired; until then it throws
 * `ZkComplianceNotAvailable` at runtime.
 */
export interface SubmitZkProofParams {
  /** The stablecoin mint. */
  mint: PublicKey;
  /** The user whose compliance is being proven (defaults to provider wallet). */
  user?: PublicKey;
  /** Serialised ZK proof bytes (Groth16 or Plonk; format determined by verifier). */
  proofData: Uint8Array;
  /** Optional public inputs for the proof (ABI-encoded as bytes). */
  publicInputs?: Uint8Array;
}

/**
 * Parameters for `verifyComplianceStatus`.
 *
 * Read-only check: fetches the `ZkVerificationRecord` and returns whether it
 * is present and not expired relative to the current clock.
 */
export interface VerifyComplianceStatusParams {
  /** The stablecoin mint. */
  mint: PublicKey;
  /** The user to check. Defaults to provider wallet public key. */
  user?: PublicKey;
}

// ─── ZkComplianceModule ───────────────────────────────────────────────────────

/**
 * ZkComplianceModule — TypeScript SDK client for the SSS ZK compliance
 * feature (SSS-076).
 *
 * Wraps the `init_zk_compliance` and `submit_zk_proof` Anchor instructions
 * (SSS-075/076). Also provides `disableZkCompliance` (via `clear_feature_flag`)
 * and read helpers for the `ZkComplianceConfig` and `ZkVerificationRecord`
 * PDAs.
 *
 * ## Workflow
 * 1. Admin calls `enableZkCompliance` → creates `ZkComplianceConfig` PDA and
 *    sets `FLAG_ZK_COMPLIANCE` atomically.
 * 2. Users call `submitZkProof` with a serialised ZK proof → on-chain verifier
 *    validates and writes/updates `ZkVerificationRecord`.
 * 3. Application/program checks `verifyComplianceStatus` before allowing
 *    restricted operations.
 * 4. Admin calls `disableZkCompliance` to clear the flag (PDA preserved).
 *
 * @example
 * ```ts
 * import { ZkComplianceModule, FLAG_ZK_COMPLIANCE } from '@sss/sdk';
 *
 * const zk = new ZkComplianceModule(provider, programId);
 *
 * // 1. Enable
 * await zk.enableZkCompliance({ mint, verifierKey, proofExpirySeconds: 86400 });
 *
 * // 2. User submits proof
 * await zk.submitZkProof({ mint, proofData: myProofBytes });
 *
 * // 3. Check status
 * const status = await zk.verifyComplianceStatus({ mint });
 * console.log(status?.isValid); // true
 *
 * // 4. Disable
 * await zk.disableZkCompliance({ mint });
 * ```
 */
export class ZkComplianceModule {
  private readonly provider: AnchorProvider;
  private readonly programId: PublicKey;

  static readonly CONFIG_SEED         = Buffer.from('stablecoin-config');
  static readonly ZK_COMPLIANCE_SEED  = Buffer.from('zk-compliance');
  static readonly ZK_VERIFICATION_SEED = Buffer.from('zk-verification');

  /** Default proof expiry: 30 days in seconds. */
  static readonly DEFAULT_PROOF_EXPIRY_SECONDS = 2_592_000;

  /**
   * @param provider   Anchor provider (wallet used as signer for write ops).
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
      [ZkComplianceModule.CONFIG_SEED, mint.toBuffer()],
      this.programId
    );
  }

  /**
   * Derive the `ZkComplianceConfig` PDA for the given mint.
   *
   * Seeds: `[b"zk-compliance", mint]`
   */
  getZkCompliancePda(mint: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [ZkComplianceModule.ZK_COMPLIANCE_SEED, mint.toBuffer()],
      this.programId
    );
  }

  /**
   * Derive the `ZkVerificationRecord` PDA for a specific user and mint.
   *
   * Seeds: `[b"zk-verification", mint, user]`
   */
  getVerificationRecordPda(mint: PublicKey, user: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [ZkComplianceModule.ZK_VERIFICATION_SEED, mint.toBuffer(), user.toBuffer()],
      this.programId
    );
  }

  // ─── Writes ──────────────────────────────────────────────────────────────

  /**
   * Enable ZK compliance for this mint.
   *
   * Calls `init_zk_compliance` — creates the `ZkComplianceConfig` PDA and
   * atomically sets `FLAG_ZK_COMPLIANCE` on the `StablecoinConfig`.
   *
   * Authority only. Fails if the PDA already exists (call `set_feature_flag`
   * directly to re-enable without re-initialising).
   *
   * @param params  `{ mint, verifierKey, proofExpirySeconds? }`
   * @returns       Transaction signature.
   */
  async enableZkCompliance(params: EnableZkComplianceParams): Promise<TransactionSignature> {
    const {
      mint,
      verifierKey,
      proofExpirySeconds = ZkComplianceModule.DEFAULT_PROOF_EXPIRY_SECONDS,
    } = params;
    const program = await this._loadProgram();
    const [config] = this.getConfigPda(mint);
    const [zkComplianceConfig] = this.getZkCompliancePda(mint);

    return program.methods
      .initZkCompliance(verifierKey, proofExpirySeconds)
      .accounts({
        authority: this.provider.wallet.publicKey,
        mint,
        config,
        zkComplianceConfig,
        systemProgram: PublicKey.default,
      })
      .rpc({ commitment: 'confirmed' });
  }

  /**
   * Disable ZK compliance for this mint.
   *
   * Calls `clear_feature_flag` with `FLAG_ZK_COMPLIANCE`. The
   * `ZkComplianceConfig` PDA is **not** closed — it remains on-chain so the
   * verifier key and expiry settings are preserved if the feature is
   * re-enabled later.
   *
   * Authority only.
   *
   * @param params  `{ mint }`
   * @returns       Transaction signature.
   */
  async disableZkCompliance(params: DisableZkComplianceParams): Promise<TransactionSignature> {
    const { mint } = params;
    const program = await this._loadProgram();
    const [config] = this.getConfigPda(mint);

    return program.methods
      .clearFeatureFlag(FLAG_ZK_COMPLIANCE.toString())
      .accounts({
        authority: this.provider.wallet.publicKey,
        mint,
        config,
      })
      .rpc({ commitment: 'confirmed' });
  }

  /**
   * Submit a zero-knowledge compliance proof.
   *
   * Calls `submit_zk_proof` — validates the proof on-chain using the
   * registered verifier key and writes (or refreshes) the
   * `ZkVerificationRecord` PDA for the user.
   *
   * Requires `FLAG_ZK_COMPLIANCE` to be active on the stablecoin config.
   * The user defaults to the connected wallet if not specified.
   *
   * @param params  `{ mint, proofData, user?, publicInputs? }`
   * @returns       Transaction signature.
   */
  async submitZkProof(params: SubmitZkProofParams): Promise<TransactionSignature> {
    const { mint, proofData, publicInputs = new Uint8Array(0) } = params;
    const user = params.user ?? this.provider.wallet.publicKey;
    const program = await this._loadProgram();
    const [config] = this.getConfigPda(mint);
    const [zkComplianceConfig] = this.getZkCompliancePda(mint);
    const [verificationRecord] = this.getVerificationRecordPda(mint, user);

    return program.methods
      .submitZkProof(Array.from(proofData), Array.from(publicInputs))
      .accounts({
        user,
        mint,
        config,
        zkComplianceConfig,
        verificationRecord,
        systemProgram: PublicKey.default,
      })
      .rpc({ commitment: 'confirmed' });
  }

  // ─── Reads ───────────────────────────────────────────────────────────────

  /**
   * Fetch and decode the `ZkComplianceConfig` PDA from on-chain.
   *
   * Returns `null` if the account has not been initialised yet
   * (`enableZkCompliance` not called, or wrong mint).
   *
   * @param mint  The stablecoin mint.
   */
  async fetchZkComplianceState(mint: PublicKey): Promise<ZkComplianceState | null> {
    const program = await this._loadProgram();
    const [pda] = this.getZkCompliancePda(mint);
    try {
      const raw = await program.account.zkComplianceConfig.fetch(pda);
      return {
        sssMint: raw.sssMint as PublicKey,
        verifierKey: raw.verifierKey as PublicKey,
        proofExpirySeconds: Number(raw.proofExpirySeconds),
        bump: raw.bump as number,
      };
    } catch {
      return null;
    }
  }

  /**
   * Fetch and decode a `ZkVerificationRecord` for a specific user.
   *
   * Returns `null` if the user has not submitted a proof yet.
   *
   * @param mint  The stablecoin mint.
   * @param user  The user whose record to fetch. Defaults to provider wallet.
   */
  async fetchVerificationRecord(
    mint: PublicKey,
    user?: PublicKey
  ): Promise<ZkVerificationRecord | null> {
    const resolvedUser = user ?? this.provider.wallet.publicKey;
    const program = await this._loadProgram();
    const [pda] = this.getVerificationRecordPda(mint, resolvedUser);
    try {
      const raw = await program.account.zkVerificationRecord.fetch(pda);
      const verifiedAt = Number(raw.verifiedAt);
      const expiresAt = Number(raw.expiresAt);
      const nowSec = Math.floor(Date.now() / 1000);
      return {
        sssMint: raw.sssMint as PublicKey,
        user: raw.user as PublicKey,
        verifiedAt,
        expiresAt,
        isValid: expiresAt > nowSec,
        bump: raw.bump as number,
      };
    } catch {
      return null;
    }
  }

  /**
   * Check whether `FLAG_ZK_COMPLIANCE` is currently set for a mint.
   *
   * Reads `StablecoinConfig.feature_flags` from on-chain. Returns `false`
   * if the config account does not exist.
   *
   * @param mint  The stablecoin mint.
   */
  async isZkComplianceEnabled(mint: PublicKey): Promise<boolean> {
    const program = await this._loadProgram();
    const [configPda] = this.getConfigPda(mint);
    try {
      const config = await program.account.stablecoinConfig.fetch(configPda);
      const flags = BigInt(config.featureFlags.toString());
      return (flags & FLAG_ZK_COMPLIANCE) !== 0n;
    } catch {
      return false;
    }
  }

  /**
   * Verify the compliance status of a user.
   *
   * Convenience wrapper around `fetchVerificationRecord` that checks both
   * existence and expiry. Returns the record if valid, `null` otherwise.
   *
   * @param params  `{ mint, user? }`
   */
  async verifyComplianceStatus(
    params: VerifyComplianceStatusParams
  ): Promise<ZkVerificationRecord | null> {
    const { mint } = params;
    const user = params.user ?? this.provider.wallet.publicKey;
    const record = await this.fetchVerificationRecord(mint, user);
    if (!record || !record.isValid) return null;
    return record;
  }

  // ─── Internals ───────────────────────────────────────────────────────────

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

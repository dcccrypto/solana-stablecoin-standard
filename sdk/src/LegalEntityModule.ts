import { PublicKey, TransactionSignature } from '@solana/web3.js';
import { AnchorProvider, BN } from '@coral-xyz/anchor';

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Bit flag for the Legal Entity Registry feature.
 *
 * When this flag is set in `StablecoinConfig.feature_flags`, the issuer's
 * legal entity has been registered on-chain.
 *
 * Matches `FLAG_LEGAL_REGISTRY` in the Anchor program.
 */
export const FLAG_LEGAL_REGISTRY = 1n << 5n; // 0x20

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * On-chain state of an `IssuerRegistry` PDA.
 */
export interface IssuerRegistryAccount {
  /** The `StablecoinConfig` this registry belongs to. */
  config: PublicKey;
  /** SHA-256 hash of the legal entity name (32 bytes). */
  legalEntityHash: number[];
  /** ISO-3166-1 alpha-2 + 2-byte extension jurisdiction code (4 bytes). */
  jurisdiction: number[];
  /** SHA-256 hash of the registration number (32 bytes). */
  registrationNumberHash: number[];
  /** Trusted attestor pubkey. */
  attestor: PublicKey;
  /** Slot at which the registry expires (0 = never). */
  expirySlot: bigint;
  /** Whether the attestor has co-signed this registry. */
  attested: boolean;
}

/**
 * Parameters for `registerLegalEntity`.
 */
export interface RegisterLegalEntityParams {
  /** The stablecoin mint. */
  mint: PublicKey;
  /** SHA-256 hash of the legal entity name (32 bytes). */
  legalEntityHash: number[] | Uint8Array;
  /** ISO jurisdiction code (4 bytes, e.g. `[0x55, 0x53, 0x00, 0x00]` for US). */
  jurisdiction: number[] | Uint8Array;
  /** SHA-256 hash of the registration number (32 bytes). */
  registrationNumberHash: number[] | Uint8Array;
  /** Trusted attestor pubkey who will co-sign this registry. */
  attestor: PublicKey;
  /**
   * Slot at which the registration expires.
   * Pass `BigInt(0)` for no expiry.
   */
  expirySlot: bigint | number;
}

/**
 * Parameters for `updateLegalEntity`.
 * Identical shape to `RegisterLegalEntityParams` — updating resets attestation.
 */
export interface UpdateLegalEntityParams extends RegisterLegalEntityParams {}

// ─── LegalEntityModule ────────────────────────────────────────────────────────

/**
 * LegalEntityModule — SDK client for the SSS Legal Entity Registry.
 *
 * Wraps `register_legal_entity`, `update_legal_entity`, and
 * `attest_legal_entity` Anchor instructions.  Also provides a
 * `fetchIssuerRegistry` helper to read on-chain state.
 *
 * ## Workflow
 * 1. Authority calls `registerLegalEntity` to create the `IssuerRegistry` PDA
 *    and enable `FLAG_LEGAL_REGISTRY` on the stablecoin config.
 * 2. Optionally, the authority calls `updateLegalEntity` to amend the record
 *    (this resets the `attested` flag).
 * 3. The designated attestor calls `attestLegalEntity` to co-sign, setting
 *    `attested = true`.
 *
 * @example
 * ```ts
 * import { LegalEntityModule } from '@sss/sdk';
 * import * as crypto from 'crypto';
 *
 * const le = new LegalEntityModule(provider, programId);
 *
 * const legalEntityHash = Array.from(crypto.createHash('sha256').update('Acme Corp').digest());
 * const registrationNumberHash = Array.from(crypto.createHash('sha256').update('REG-12345').digest());
 * const jurisdiction = [0x55, 0x53, 0x00, 0x00]; // US
 *
 * // 1. Authority registers the legal entity
 * await le.registerLegalEntity({
 *   mint,
 *   legalEntityHash,
 *   jurisdiction,
 *   registrationNumberHash,
 *   attestor: attestorPublicKey,
 *   expirySlot: BigInt(0),
 * });
 *
 * // 2. Attestor co-signs
 * await le.attestLegalEntity(mint);
 *
 * // 3. Inspect on-chain state
 * const registry = await le.fetchIssuerRegistry(mint);
 * console.log(registry?.attested); // true
 * ```
 */
export class LegalEntityModule {
  private readonly provider: AnchorProvider;
  private readonly programId: PublicKey;

  static readonly CONFIG_SEED = Buffer.from('stablecoin-config');
  static readonly ISSUER_REGISTRY_SEED = Buffer.from('issuer_registry');

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
      [LegalEntityModule.CONFIG_SEED, mint.toBuffer()],
      this.programId
    );
  }

  /**
   * Derive the `IssuerRegistry` PDA for the given mint.
   *
   * Seeds: `[b"issuer_registry", config]`
   */
  getIssuerRegistryPda(mint: PublicKey): [PublicKey, number] {
    const [config] = this.getConfigPda(mint);
    return PublicKey.findProgramAddressSync(
      [LegalEntityModule.ISSUER_REGISTRY_SEED, config.toBuffer()],
      this.programId
    );
  }

  // ─── Writes ──────────────────────────────────────────────────────────────

  /**
   * Register the issuer's legal entity on-chain.
   *
   * Calls `register_legal_entity` on the SSS token program.
   * The wallet in `provider` must be the admin authority of the
   * `StablecoinConfig`.  Creates the `IssuerRegistry` PDA and enables
   * `FLAG_LEGAL_REGISTRY`.
   *
   * @param params  Registration parameters.
   * @returns       Transaction signature.
   */
  async registerLegalEntity(params: RegisterLegalEntityParams): Promise<TransactionSignature> {
    const { mint, legalEntityHash, jurisdiction, registrationNumberHash, attestor, expirySlot } =
      params;
    const program = await this._loadProgram();
    const [config] = this.getConfigPda(mint);
    const [issuerRegistry] = this.getIssuerRegistryPda(mint);

    return program.methods
      .registerLegalEntity(
        Array.from(legalEntityHash),
        Array.from(jurisdiction),
        Array.from(registrationNumberHash),
        attestor,
        new BN(expirySlot.toString())
      )
      .accounts({
        authority: this.provider.wallet.publicKey,
        config,
        issuerRegistry,
        systemProgram: PublicKey.default,
      })
      .rpc({ commitment: 'confirmed' });
  }

  /**
   * Update the legal entity record (resets attestation).
   *
   * Calls `update_legal_entity` on the SSS token program.
   * The wallet in `provider` must be the admin authority of the
   * `StablecoinConfig`.  After an update, the attestor must re-attest.
   *
   * @param params  Updated registration parameters.
   * @returns       Transaction signature.
   */
  async updateLegalEntity(params: UpdateLegalEntityParams): Promise<TransactionSignature> {
    const { mint, legalEntityHash, jurisdiction, registrationNumberHash, attestor, expirySlot } =
      params;
    const program = await this._loadProgram();
    const [config] = this.getConfigPda(mint);
    const [issuerRegistry] = this.getIssuerRegistryPda(mint);

    return program.methods
      .updateLegalEntity(
        Array.from(legalEntityHash),
        Array.from(jurisdiction),
        Array.from(registrationNumberHash),
        attestor,
        new BN(expirySlot.toString())
      )
      .accounts({
        authority: this.provider.wallet.publicKey,
        config,
        issuerRegistry,
      })
      .rpc({ commitment: 'confirmed' });
  }

  /**
   * Attestor co-signs the `IssuerRegistry`, marking it as attested.
   *
   * Calls `attest_legal_entity` on the SSS token program.
   * The wallet in `provider` must match the `attestor` field stored in the
   * `IssuerRegistry` PDA.
   *
   * @param mint  The stablecoin mint.
   * @returns     Transaction signature.
   */
  async attestLegalEntity(mint: PublicKey): Promise<TransactionSignature> {
    const program = await this._loadProgram();
    const [config] = this.getConfigPda(mint);
    const [issuerRegistry] = this.getIssuerRegistryPda(mint);

    return program.methods
      .attestLegalEntity()
      .accounts({
        attestor: this.provider.wallet.publicKey,
        config,
        issuerRegistry,
      })
      .rpc({ commitment: 'confirmed' });
  }

  // ─── Reads ───────────────────────────────────────────────────────────────

  /**
   * Fetch and decode the `IssuerRegistry` PDA from on-chain.
   *
   * Returns `null` if the account does not exist yet.
   *
   * @param mint  The stablecoin mint.
   */
  async fetchIssuerRegistry(mint: PublicKey): Promise<IssuerRegistryAccount | null> {
    const program = await this._loadProgram();
    const [pda] = this.getIssuerRegistryPda(mint);
    try {
      const raw = await program.account.issuerRegistry.fetch(pda);
      return {
        config: raw.config as PublicKey,
        legalEntityHash: raw.legalEntityHash as number[],
        jurisdiction: raw.jurisdiction as number[],
        registrationNumberHash: raw.registrationNumberHash as number[],
        attestor: raw.attestor as PublicKey,
        expirySlot: BigInt((raw.expirySlot as BN).toString()),
        attested: raw.attested as boolean,
      };
    } catch {
      return null;
    }
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
    this._program = new AnchorProgram(
      { ...idl as any, address: this.programId.toBase58() },
      this.provider
    ) as any;
    return this._program;
  }
}

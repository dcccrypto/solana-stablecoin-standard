/**
 * SSS-056 — Direction 3: CPI Composability SDK Module
 *
 * TypeScript wrapper for the on-chain CPI Composability Standard (SSS-055).
 *
 * External programs that want to mint/burn SSS tokens via CPI should use
 * the standardized `cpi_mint` / `cpi_burn` entrypoints instead of the raw
 * `mint` / `burn` instructions. These entrypoints gate on an `InterfaceVersion`
 * PDA — callers pin to a known version and receive an explicit error if the
 * interface is deprecated or mismatched.
 *
 * This module provides:
 *  - `CpiModule` — wraps `cpi_mint`, `cpi_burn`, `init_interface_version`,
 *    `update_interface_version` instructions via Anchor.
 *  - `getInterfaceVersionPda` — derive the PDA off-chain.
 *  - `fetchInterfaceVersion` — read current version + active flag.
 *  - `isSssProgramCompatible` — convenience check for callers before CPI.
 *
 * @example
 * ```ts
 * const cpi = new CpiModule(provider, mint);
 *
 * // One-time setup (authority only)
 * await cpi.initInterfaceVersion();
 *
 * // External program issuing a CPI mint
 * await cpi.cpiMint({ amount: 1_000_000n, recipient: userTokenAccount });
 *
 * // Check compatibility before constructing a CPI call
 * const ok = await cpi.isSssProgramCompatible(connection);
 * ```
 */

import { Connection, PublicKey, TransactionSignature } from '@solana/web3.js';
import { AnchorProvider, BN, Program } from '@coral-xyz/anchor';
import { TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';

import { SSS_TOKEN_PROGRAM_ID } from './SolanaStablecoin';

// ─── Seeds ────────────────────────────────────────────────────────────────────

const INTERFACE_VERSION_SEED = Buffer.from('interface-version');
const STABLECOIN_CONFIG_SEED = Buffer.from('stablecoin-config');
const MINTER_INFO_SEED = Buffer.from('minter-info');

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * The current CPI interface version for the SSS program (SSS-055).
 * Pass this as `requiredVersion` to `cpiMint` / `cpiBurn` unless you
 * intentionally want to test version-mismatch error paths.
 */
export const CURRENT_INTERFACE_VERSION = 1;

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * On-chain `InterfaceVersion` account data, decoded from the PDA.
 */
export interface InterfaceVersionInfo {
  /** The SSS mint this interface applies to */
  mint: PublicKey;
  /**
   * Current interface version.
   * Callers should pin to `CURRENT_INTERFACE_VERSION` and reject if mismatched.
   */
  version: number;
  /**
   * Whether this interface is active.
   * `false` means the protocol has been deprecated; stop using this program.
   */
  active: boolean;
  /**
   * Interface namespace bytes (up to 32 bytes, zero-padded).
   * Discriminators follow `sha256("global:<instruction_name>")[..8]`.
   */
  namespace: Uint8Array;
  /** PDA bump seed */
  bump: number;
}

/** Parameters for `cpiMint` */
export interface CpiMintParams {
  /** Amount to mint in base units (e.g. 1_000_000n = 1.0 with 6 decimals) */
  amount: bigint;
  /** Recipient's SSS token account (Token-2022) */
  recipient: PublicKey;
  /**
   * Interface version to pin against. Defaults to `CURRENT_INTERFACE_VERSION`.
   * The on-chain program rejects if this doesn't match the PDA version.
   */
  requiredVersion?: number;
  /**
   * Token program for the SSS mint (defaults to TOKEN_2022_PROGRAM_ID).
   * Override only if using a non-standard token program in tests.
   */
  tokenProgram?: PublicKey;
}

/** Parameters for `cpiBurn` */
export interface CpiBurnParams {
  /** Amount to burn in base units */
  amount: bigint;
  /** Minter's SSS token account to burn from (must be owned by the provider wallet) */
  source: PublicKey;
  /**
   * Interface version to pin against. Defaults to `CURRENT_INTERFACE_VERSION`.
   */
  requiredVersion?: number;
  /** Token program for the SSS mint (defaults to TOKEN_2022_PROGRAM_ID) */
  tokenProgram?: PublicKey;
}

/** Parameters for `updateInterfaceVersion` */
export interface UpdateInterfaceVersionParams {
  /** Bump to a new version number (omit to leave unchanged) */
  newVersion?: number;
  /** Set the active flag (omit to leave unchanged) */
  active?: boolean;
}

// ─── PDA Helpers ──────────────────────────────────────────────────────────────

/**
 * Derive the `InterfaceVersion` PDA for a given SSS mint.
 *
 * Seeds: `["interface-version", mint]`
 *
 * @param mint      - The SSS stablecoin mint
 * @param programId - The SSS token program (defaults to mainnet/devnet address)
 * @returns `[pda, bump]`
 */
export function getInterfaceVersionPda(
  mint: PublicKey,
  programId: PublicKey = SSS_TOKEN_PROGRAM_ID,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [INTERFACE_VERSION_SEED, mint.toBuffer()],
    programId,
  );
}

/**
 * Derive the `StablecoinConfig` PDA for a given SSS mint.
 * @internal
 */
function getConfigPda(mint: PublicKey, programId: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [STABLECOIN_CONFIG_SEED, mint.toBuffer()],
    programId,
  );
  return pda;
}

/**
 * Derive the `MinterInfo` PDA for a given (config, minter) pair.
 * @internal
 */
function getMinterInfoPda(
  configPda: PublicKey,
  minter: PublicKey,
  programId: PublicKey,
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [MINTER_INFO_SEED, configPda.toBuffer(), minter.toBuffer()],
    programId,
  );
  return pda;
}

// ─── CpiModule ────────────────────────────────────────────────────────────────

/**
 * SDK module for the Direction 3 CPI Composability Standard (SSS-056).
 *
 * Wraps the four on-chain CPI instructions:
 *  - `init_interface_version`   — one-time authority setup
 *  - `update_interface_version` — bump version or deprecate
 *  - `cpi_mint`                 — standardized mint entrypoint
 *  - `cpi_burn`                 — standardized burn entrypoint
 *
 * Also exposes `fetchInterfaceVersion` and `isSssProgramCompatible` for
 * off-chain compatibility checking before constructing CPI calls.
 */
export class CpiModule {
  private readonly provider: AnchorProvider;
  private readonly mint: PublicKey;
  private readonly programId: PublicKey;
  private _program: any | null = null;

  constructor(
    provider: AnchorProvider,
    mint: PublicKey,
    programId: PublicKey = SSS_TOKEN_PROGRAM_ID,
  ) {
    this.provider = provider;
    this.mint = mint;
    this.programId = programId;
  }

  // ─── Internal ─────────────────────────────────────────────────────────────

  private async _loadProgram(): Promise<any> {
    if (this._program) return this._program;
    const idl = await import('./idl/sss_token.json');
    this._program = new Program(
      { ...(idl as any), address: this.programId.toBase58() },
      this.provider,
    ) as any;
    return this._program;
  }

  // ─── PDA Utilities ────────────────────────────────────────────────────────

  /**
   * Derive the `InterfaceVersion` PDA for this module's mint.
   */
  getInterfaceVersionPda(): [PublicKey, number] {
    return getInterfaceVersionPda(this.mint, this.programId);
  }

  /**
   * Derive the `StablecoinConfig` PDA for this module's mint.
   */
  getConfigPda(): PublicKey {
    return getConfigPda(this.mint, this.programId);
  }

  /**
   * Derive the `MinterInfo` PDA for the current provider wallet (or a given minter).
   */
  getMinterInfoPda(minter?: PublicKey): PublicKey {
    const minterKey = minter ?? this.provider.wallet.publicKey;
    const configPda = getConfigPda(this.mint, this.programId);
    return getMinterInfoPda(configPda, minterKey, this.programId);
  }

  // ─── fetchInterfaceVersion ────────────────────────────────────────────────

  /**
   * Fetch and decode the on-chain `InterfaceVersion` PDA.
   *
   * Returns `null` if the PDA has not been initialized yet (stablecoin
   * authority has not called `initInterfaceVersion`).
   *
   * @param connection - Solana connection
   */
  async fetchInterfaceVersion(
    connection: Connection,
  ): Promise<InterfaceVersionInfo | null> {
    const program = await this._loadProgram();
    const [ivPda] = this.getInterfaceVersionPda();
    try {
      const account = await program.account.interfaceVersion.fetch(ivPda);
      return {
        mint: account.mint as PublicKey,
        version: account.version as number,
        active: account.active as boolean,
        namespace: account.namespace as Uint8Array,
        bump: account.bump as number,
      };
    } catch {
      return null;
    }
  }

  // ─── isSssProgramCompatible ───────────────────────────────────────────────

  /**
   * Convenience helper: check if the on-chain SSS program is compatible with
   * the calling client before building a CPI.
   *
   * Returns `true` if:
   *  1. The `InterfaceVersion` PDA exists
   *  2. `active` is `true` (interface not deprecated)
   *  3. `version` matches `expectedVersion` (defaults to `CURRENT_INTERFACE_VERSION`)
   *
   * @param connection      - Solana connection
   * @param expectedVersion - Version the caller was built against (default: 1)
   */
  async isSssProgramCompatible(
    connection: Connection,
    expectedVersion: number = CURRENT_INTERFACE_VERSION,
  ): Promise<boolean> {
    const iv = await this.fetchInterfaceVersion(connection);
    if (!iv) return false;
    return iv.active && iv.version === expectedVersion;
  }

  // ─── initInterfaceVersion ─────────────────────────────────────────────────

  /**
   * One-time initialization of the `InterfaceVersion` PDA for this mint.
   *
   * **Authority only.** Must be called by the stablecoin authority before
   * external programs can use `cpiMint` or `cpiBurn`.
   *
   * Sets `version = 1`, `active = true`, and records the interface namespace.
   */
  async initInterfaceVersion(): Promise<TransactionSignature> {
    const program = await this._loadProgram();
    const authority = this.provider.wallet.publicKey;
    const configPda = getConfigPda(this.mint, this.programId);
    const [ivPda] = this.getInterfaceVersionPda();

    return program.methods
      .initInterfaceVersion()
      .accounts({
        authority,
        config: configPda,
        mint: this.mint,
        interfaceVersion: ivPda,
        systemProgram: (await import('@solana/web3.js')).SystemProgram.programId,
      })
      .rpc({ commitment: 'confirmed' });
  }

  // ─── updateInterfaceVersion ───────────────────────────────────────────────

  /**
   * Update the on-chain `InterfaceVersion` PDA.
   *
   * **Authority only.** Use to:
   *  - Bump the version after a breaking interface change (`newVersion`)
   *  - Deprecate the interface (`active: false`) when migrating to a new program
   *
   * @param params - Fields to update; omit a field to leave it unchanged
   */
  async updateInterfaceVersion(
    params: UpdateInterfaceVersionParams,
  ): Promise<TransactionSignature> {
    const program = await this._loadProgram();
    const authority = this.provider.wallet.publicKey;
    const configPda = getConfigPda(this.mint, this.programId);
    const [ivPda] = this.getInterfaceVersionPda();

    const newVersion = params.newVersion !== undefined ? params.newVersion : null;
    const active = params.active !== undefined ? params.active : null;

    return program.methods
      .updateInterfaceVersion(newVersion, active)
      .accounts({
        authority,
        config: configPda,
        interfaceVersion: ivPda,
      })
      .rpc({ commitment: 'confirmed' });
  }

  // ─── cpiMint ─────────────────────────────────────────────────────────────

  /**
   * Call the standardized `cpi_mint` entrypoint.
   *
   * Validates the `InterfaceVersion` PDA on-chain before minting.
   * The caller (provider wallet) must be a registered minter with sufficient cap.
   *
   * @param params - Mint parameters including `amount`, `recipient`, and optional `requiredVersion`
   *
   * @throws If the interface is deprecated, version mismatched, or the minter is unauthorized.
   *
   * @example
   * ```ts
   * const sig = await cpi.cpiMint({
   *   amount: 1_000_000n,
   *   recipient: userTokenAccount,
   * });
   * ```
   */
  async cpiMint(params: CpiMintParams): Promise<TransactionSignature> {
    const program = await this._loadProgram();
    const minter = this.provider.wallet.publicKey;
    const configPda = getConfigPda(this.mint, this.programId);
    const minterInfoPda = getMinterInfoPda(configPda, minter, this.programId);
    const [ivPda] = this.getInterfaceVersionPda();
    const tokenProgram = params.tokenProgram ?? TOKEN_2022_PROGRAM_ID;
    const requiredVersion = params.requiredVersion ?? CURRENT_INTERFACE_VERSION;

    return program.methods
      .cpiMint(new BN(params.amount.toString()), requiredVersion)
      .accounts({
        minter,
        config: configPda,
        minterInfo: minterInfoPda,
        mint: this.mint,
        recipientTokenAccount: params.recipient,
        interfaceVersion: ivPda,
        tokenProgram,
      })
      .rpc({ commitment: 'confirmed' });
  }

  // ─── cpiBurn ──────────────────────────────────────────────────────────────

  /**
   * Call the standardized `cpi_burn` entrypoint.
   *
   * Validates the `InterfaceVersion` PDA on-chain before burning.
   * The caller (provider wallet) must be a registered minter.
   * The `source` token account must be owned by the minter.
   *
   * @param params - Burn parameters including `amount`, `source`, and optional `requiredVersion`
   *
   * @throws If the interface is deprecated, version mismatched, or the minter is unauthorized.
   *
   * @example
   * ```ts
   * const sig = await cpi.cpiBurn({
   *   amount: 500_000n,
   *   source: minterTokenAccount,
   * });
   * ```
   */
  async cpiBurn(params: CpiBurnParams): Promise<TransactionSignature> {
    const program = await this._loadProgram();
    const minter = this.provider.wallet.publicKey;
    const configPda = getConfigPda(this.mint, this.programId);
    const minterInfoPda = getMinterInfoPda(configPda, minter, this.programId);
    const [ivPda] = this.getInterfaceVersionPda();
    const tokenProgram = params.tokenProgram ?? TOKEN_2022_PROGRAM_ID;
    const requiredVersion = params.requiredVersion ?? CURRENT_INTERFACE_VERSION;

    return program.methods
      .cpiBurn(new BN(params.amount.toString()), requiredVersion)
      .accounts({
        minter,
        config: configPda,
        minterInfo: minterInfoPda,
        mint: this.mint,
        sourceTokenAccount: params.source,
        interfaceVersion: ivPda,
        tokenProgram,
      })
      .rpc({ commitment: 'confirmed' });
  }
}

import type { Keypair, PublicKey } from "@solana/web3.js";

/** SSS compliance presets. */
export enum Presets {
  SSS_1 = "sss-1",
  SSS_2 = "sss-2",
}

// ─── Extension options (deploy-time) ─────────────────────────────────────────

export interface TransferHookConfig {
  programId: PublicKey;
  /** Keypair that becomes the blacklist admin. Defaults to `authority`. */
  admin?: Keypair;
}

export interface ExtensionsConfig {
  /** On-mint metadata (name/symbol/uri). Defaults to `true`. */
  metadata?: boolean;
  /** Token-2022 Pausable extension. Defaults to `false`. */
  pausable?: boolean;
  /** Token-2022 Permanent Delegate extension. Defaults to `false`. */
  permanentDelegate?: boolean;
  /** Transfer-hook extension (e.g. blacklist). Required for SSS-2. */
  transferHook?: boolean | TransferHookConfig;
}

// ─── Factory options ─────────────────────────────────────────────────────────

export interface CreateOptions {
  /** SSS preset. Determines required extensions. Defaults to SSS_1. */
  preset?: Presets;
  /** Human-readable token name (stored in on-mint metadata). */
  name: string;
  /** Ticker symbol. */
  symbol: string;
  /** Decimal places. Defaults to `6`. */
  decimals?: number;
  /** Optional metadata URI. */
  uri?: string;
  /**
   * Main authority keypair. Used as mint authority, payer, and default for
   * freeze / metadata authorities when they are not explicitly provided.
   */
  authority: Keypair;
  /** Freeze authority. Defaults to `authority`. Accepts a Keypair or PublicKey. */
  freezeAuthority?: Keypair | PublicKey;
  /** Metadata authority. Defaults to `authority`. Accepts a Keypair or PublicKey. */
  metadataAuthority?: Keypair | PublicKey;
  /** Extensions to enable. Presets supply sensible defaults. */
  extensions?: ExtensionsConfig;
}

export interface LoadOptions {
  /** Existing on-chain mint address. */
  mint: PublicKey;
  /** Token program. Defaults to TOKEN_2022_PROGRAM_ID. */
  tokenProgramId?: PublicKey;
  /** Transfer-hook program ID (for blacklist operations). */
  transferHookProgramId?: PublicKey;
  /** SSS-Core program ID (for RBAC, quotas, pause, seize). */
  ssCoreProgramId?: PublicKey;
}

// ─── Operation options ───────────────────────────────────────────────────────

export interface MintOptions {
  /** Recipient wallet. An ATA is created if it doesn't exist. */
  recipient: PublicKey;
  /** Amount in raw units (smallest denomination). */
  amount: bigint;
  /** Mint authority keypair. Also used as payer. */
  minter: Keypair;
}

export interface BurnOptions {
  /** Amount in raw units. */
  amount: bigint;
  /** Token account owner / payer. Burns from their ATA by default. */
  owner: Keypair;
  /** Specific token account to burn from. Defaults to owner's ATA. */
  tokenAccount?: PublicKey;
}

export interface TransferOptions {
  /** Source wallet (must be signer). */
  owner: Keypair;
  /** Destination wallet public key. */
  destination: PublicKey;
  /** Amount in raw units. */
  amount: bigint;
  /** Decimals of the mint. */
  decimals: number;
  /** Source token account. Defaults to owner's ATA. */
  sourceTokenAccount?: PublicKey;
  /** Destination token account. Defaults to destination's ATA. */
  destinationTokenAccount?: PublicKey;
}

export interface SeizeOptions {
  /** Frozen token account to seize from. */
  targetTokenAccount: PublicKey;
  /** Treasury wallet that receives the seized tokens. */
  treasury: PublicKey;
  /** Amount to seize in raw units. */
  amount: bigint;
  /** Freeze authority keypair (must also be permanent delegate). */
  authority: Keypair;
}

export interface FreezeOptions {
  /** Token account address to freeze. */
  tokenAccount: PublicKey;
  /** Freeze authority keypair. */
  freezeAuthority: Keypair;
}

export interface ThawOptions {
  /** Token account address to thaw. */
  tokenAccount: PublicKey;
  /** Freeze authority keypair. */
  freezeAuthority: Keypair;
}

export type AuthorityKind =
  | "mint"
  | "freeze"
  | "metadata"
  | "metadata-pointer"
  | "pause"
  | "permanent-delegate"
  | "transfer-fee-config"
  | "close-mint"
  | "interest-rate";

export interface SetAuthorityOptions {
  /** Which authority to change. */
  type: AuthorityKind;
  /** Current authority keypair (must sign). */
  currentAuthority: Keypair;
  /** New authority, or `null` to revoke. */
  newAuthority: PublicKey | null;
}

// ─── Read-only return types ──────────────────────────────────────────────────

export interface SupplyInfo {
  raw: bigint;
  /** Convenience float — may lose precision for amounts > 2^53. */
  uiAmount: number;
  /** Precise string representation (e.g. "1234567.890000"). */
  uiAmountString: string;
  decimals: number;
}

export interface BalanceInfo {
  raw: bigint;
  uiAmount: number;
  uiAmountString: string;
  /** Associated token account for this wallet + mint. */
  ata: PublicKey;
  /** Whether the ATA exists on-chain. */
  exists: boolean;
}

export interface TokenStatus {
  mint: PublicKey;
  supply: SupplyInfo;
  mintAuthority: PublicKey | null;
  freezeAuthority: PublicKey | null;
}

export interface AuditLogEntry {
  signature: string;
  slot: number;
  err: unknown;
  blockTime: Date | null;
}

export interface BlacklistStatus {
  wallet: PublicKey;
  pda: PublicKey;
  blocked: boolean;
}

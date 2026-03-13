// ─── API envelope ────────────────────────────────────────────────────────────

export interface ApiResponse<T> {
  success: boolean;
  data: T | null;
  error: string | null;
}

// ─── Health ──────────────────────────────────────────────────────────────────

export interface HealthData {
  status: string;
  version: string;
  timestamp: string;
}

// ─── Mint ────────────────────────────────────────────────────────────────────

export interface MintRequest {
  /** Solana token-mint public key */
  token_mint: string;
  /** Token amount in raw units (must be > 0) */
  amount: number;
  /** Recipient wallet public key */
  recipient: string;
  /** Optional Solana transaction signature */
  tx_signature?: string;
}

export interface MintEvent {
  id: string;
  token_mint: string;
  amount: number;
  recipient: string;
  tx_signature: string | null;
  created_at: string;
}

// ─── Burn ────────────────────────────────────────────────────────────────────

export interface BurnRequest {
  /** Solana token-mint public key */
  token_mint: string;
  /** Token amount in raw units (must be > 0) */
  amount: number;
  /** Source wallet public key */
  source: string;
  /** Optional Solana transaction signature */
  tx_signature?: string;
}

export interface BurnEvent {
  id: string;
  token_mint: string;
  amount: number;
  source: string;
  tx_signature: string | null;
  created_at: string;
}

// ─── Supply & events ─────────────────────────────────────────────────────────

export interface SupplyResponse {
  token_mint: string;
  total_minted: number;
  total_burned: number;
  circulating_supply: number;
}

export interface EventsResponse {
  mint_events: MintEvent[];
  burn_events: BurnEvent[];
}

// ─── Compliance ──────────────────────────────────────────────────────────────

export interface BlacklistRequest {
  address: string;
  reason: string;
}

export interface BlacklistEntry {
  id: string;
  address: string;
  reason: string;
  created_at: string;
}

export interface AuditEntry {
  id: string;
  action: string;
  address: string;
  details: string;
  created_at: string;
}

// ─── Webhooks ─────────────────────────────────────────────────────────────────

export type EventKind = "mint" | "burn" | "all";

export interface WebhookRequest {
  url: string;
  events: EventKind[];
}

export interface WebhookEntry {
  id: string;
  url: string;
  events: EventKind[];
  created_at: string;
}

// ─── API keys ────────────────────────────────────────────────────────────────

/** Returned when listing keys (full key is redacted) */
export interface ApiKeyListEntry {
  id: string;
  label: string;
  key_prefix: string;
  created_at: string;
}

/** Returned once at creation time — includes the full key */
export interface ApiKeyEntry {
  id: string;
  key: string;
  label: string;
  created_at: string;
}

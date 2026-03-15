use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct HealthResponse {
    pub status: String,
    pub version: String,
    pub timestamp: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MintRequest {
    pub token_mint: String,
    pub amount: u64,
    pub recipient: String,
    pub tx_signature: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BurnRequest {
    pub token_mint: String,
    pub amount: u64,
    pub source: String,
    pub tx_signature: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MintEvent {
    pub id: String,
    pub token_mint: String,
    pub amount: u64,
    pub recipient: String,
    pub tx_signature: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BurnEvent {
    pub id: String,
    pub token_mint: String,
    pub amount: u64,
    pub source: String,
    pub tx_signature: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SupplyResponse {
    pub token_mint: String,
    pub total_minted: u64,
    pub total_burned: u64,
    pub circulating_supply: u64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct EventsResponse {
    pub mint_events: Vec<MintEvent>,
    pub burn_events: Vec<BurnEvent>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BlacklistRequest {
    pub address: String,
    pub reason: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BlacklistEntry {
    pub id: String,
    pub address: String,
    pub reason: String,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AuditEntry {
    pub id: String,
    pub action: String,
    pub address: String,
    pub details: String,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WebhookRequest {
    pub url: String,
    pub events: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WebhookEntry {
    pub id: String,
    pub url: String,
    pub events: Vec<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ApiKeyEntry {
    pub id: String,
    pub key: String,
    pub label: String,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ApiResponse<T: Serialize> {
    pub success: bool,
    pub data: Option<T>,
    pub error: Option<String>,
}

impl<T: Serialize> ApiResponse<T> {
    pub fn ok(data: T) -> Self {
        Self {
            success: true,
            data: Some(data),
            error: None,
        }
    }

    #[allow(dead_code)]
    pub fn err(msg: impl Into<String>) -> Self {
        Self {
            success: false,
            data: None,
            error: Some(msg.into()),
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct SupplyQuery {
    pub token_mint: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct EventsQuery {
    pub token_mint: Option<String>,
    /// Maximum number of events to return (default: 100, max: 1000).
    pub limit: Option<u32>,
    /// ISO-8601 / RFC-3339 lower bound for `created_at` (inclusive).
    /// Example: `2026-01-01T00:00:00Z`
    pub from: Option<String>,
    /// ISO-8601 / RFC-3339 upper bound for `created_at` (inclusive).
    /// Example: `2026-12-31T23:59:59Z`
    pub to: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct AuditQuery {
    /// Filter by wallet/contract address (exact match)
    pub address: Option<String>,
    /// Filter by action type (e.g. BLACKLIST_ADD, BLACKLIST_REMOVE)
    pub action: Option<String>,
    /// Maximum number of entries to return (default: 100, max: 1000)
    pub limit: Option<u32>,
}

/// Query parameters for GET /api/reserves/proof
#[derive(Debug, Deserialize)]
pub struct ReservesProofQuery {
    /// SPL token mint address (base58)
    pub mint: String,
    /// Optional holder address (base58) — future use for individual proof
    pub holder: Option<String>,
}

/// Proof type variants
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProofType {
    /// Full Merkle tree over all balances (on-chain data)
    MerkleBalance,
    /// Simple on-chain supply snapshot (no Merkle tree yet)
    SupplySnapshot,
}

/// Response for GET /api/reserves/proof
#[derive(Debug, Serialize, Deserialize)]
pub struct ReservesProofResponse {
    /// Hex-encoded Merkle root (SHA-256 over leaf of total_supply LE-8)
    pub merkle_root: String,
    /// Total supply from SPL mint (raw u64)
    pub total_supply: u64,
    /// Last confirmed slot returned by devnet RPC
    pub last_verified_slot: u64,
    /// Proof variant used
    pub proof_type: ProofType,
    /// Mint pubkey echoed back
    pub mint: String,
    /// Holder echoed back (null when not provided)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub holder: Option<String>,
}

/// SSS-095: on-chain event log entry (circuit-breaker, CDP, oracle).
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct EventLogEntry {
    pub id: String,
    /// Event type: "circuit_breaker_toggle" | "cdp_deposit" | "cdp_borrow" | "cdp_liquidate" | "oracle_params_update"
    pub event_type: String,
    /// Token mint / CDP position address / program address
    pub address: String,
    /// JSON blob with event-specific fields (raw string)
    pub data: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tx_signature: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub slot: Option<i64>,
    pub created_at: String,
}

/// SSS-095: query params for GET /api/chain-events
#[derive(Debug, Deserialize)]
pub struct ChainEventsQuery {
    /// Filter by event type (e.g. "circuit_breaker_toggle", "cdp_borrow")
    #[serde(rename = "type")]
    pub event_type: Option<String>,
    /// Filter by address (token mint, CDP position, or program address)
    pub address: Option<String>,
    /// Maximum number of entries to return (default: 100, max: 1000)
    pub limit: Option<u32>,
}

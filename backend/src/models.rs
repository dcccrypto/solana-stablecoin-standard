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
    /// Maximum number of events to return per page (default: 50, max: 500).
    pub limit: Option<u32>,
    /// Zero-based offset for pagination (default: 0).
    pub offset: Option<u32>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PageMeta {
    /// Total number of matching records in the database.
    pub total: u32,
    /// Zero-based offset used for this page.
    pub offset: u32,
    /// Page size applied to this page.
    pub limit: u32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct EventsPageResponse {
    pub mint_events: Vec<MintEvent>,
    pub burn_events: Vec<BurnEvent>,
    /// Pagination metadata for mint_events.
    pub mint_page: PageMeta,
    /// Pagination metadata for burn_events.
    pub burn_page: PageMeta,
}

#[derive(Debug, Deserialize)]
pub struct AuditQuery {
    /// Filter by wallet/contract address (exact match)
    pub address: Option<String>,
    /// Filter by action type (e.g. BLACKLIST_ADD, BLACKLIST_REMOVE)
    pub action: Option<String>,
    /// Maximum number of entries to return (default: 50, max: 1000).
    pub limit: Option<u32>,
    /// Zero-based offset for pagination (default: 0).
    pub offset: Option<u32>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AuditPageResponse {
    pub entries: Vec<AuditEntry>,
    pub page: PageMeta,
}

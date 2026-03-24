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
    /// Optional HMAC-SHA256 secret for signing deliveries.
    /// If provided, each webhook POST will include an
    /// `X-SSS-Signature: sha256=<hex>` header.
    #[serde(default)]
    pub secret_key: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WebhookEntry {
    pub id: String,
    pub url: String,
    pub events: Vec<String>,
    /// Stored hashed secret. This is the HMAC key stored in the DB as a hash;
    /// callers must NOT use this directly for HMAC signing — it is stored hashed.
    /// For dispatch, retrieve the plaintext secret from registration and use it there.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hashed_secret: Option<String>,
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

/// SSS-098: on-chain CollateralConfig PDA record (per-collateral parameters).
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CollateralConfigEntry {
    /// SSS stablecoin mint this config belongs to.
    pub sss_mint: String,
    /// The collateral token mint this config applies to.
    pub collateral_mint: String,
    /// Whether this collateral is whitelisted for CDP use.
    pub whitelisted: bool,
    /// Maximum LTV in basis points (e.g. 6667 = 66.67%).
    pub max_ltv_bps: u16,
    /// Liquidation threshold in basis points (e.g. 7500 = 75%).
    pub liquidation_threshold_bps: u16,
    /// Liquidation bonus in basis points (e.g. 500 = 5%).
    pub liquidation_bonus_bps: u16,
    /// Maximum deposit cap in collateral native units (0 = unlimited).
    pub max_deposit_cap: i64,
    /// Total collateral deposited (native units) across all CDPs.
    pub total_deposited: i64,
    /// Transaction signature of the last register/update.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tx_signature: Option<String>,
    pub updated_at: String,
}

/// SSS-098: query params for GET /api/cdp/collateral-configs
#[derive(Debug, Deserialize)]
pub struct CollateralConfigsQuery {
    /// Filter by SSS stablecoin mint address (optional).
    pub sss_mint: Option<String>,
    /// Filter by collateral mint address (optional).
    pub collateral_mint: Option<String>,
    /// When true, return only whitelisted configs (default: return all).
    pub whitelisted_only: Option<bool>,
}

// ─── SSS-102: Liquidation history ────────────────────────────────────────────

/// A single liquidation event as stored in `liquidation_history`.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LiquidationHistoryEntry {
    pub id: String,
    /// CDP position address (base58).
    pub cdp_address: String,
    /// Collateral token mint that was seized.
    pub collateral_mint: String,
    /// Amount of collateral seized (native units).
    pub collateral_seized: i64,
    /// Amount of stablecoin debt repaid (native units).
    pub debt_repaid: i64,
    /// Liquidator wallet address.
    pub liquidator: String,
    /// Slot at which the liquidation occurred.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub slot: Option<i64>,
    /// Transaction signature of the liquidation tx.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tx_sig: Option<String>,
    pub created_at: String,
}

/// SSS-102: query params for GET /api/liquidations
#[derive(Debug, Deserialize)]
pub struct LiquidationsQuery {
    /// Filter by CDP address (optional).
    pub cdp_address: Option<String>,
    /// Filter by collateral mint (optional).
    pub collateral_mint: Option<String>,
    /// Maximum rows to return (default: 100, max: 1000).
    pub limit: Option<u32>,
    /// Row offset for pagination (default: 0).
    pub offset: Option<u32>,
}

// ─── SSS-127: Travel Rule records ────────────────────────────────────────────

/// A single indexed TravelRuleRecord event from on-chain.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TravelRuleRecord {
    pub id: String,
    /// SSS stablecoin mint.
    pub mint: String,
    /// Monotonic nonce used to derive the PDA.
    pub nonce: i64,
    /// Originating VASP pubkey (base58).
    pub originator_vasp: String,
    /// Beneficiary VASP pubkey (base58).
    pub beneficiary_vasp: String,
    /// Transfer amount in native token units.
    pub transfer_amount: i64,
    /// Slot at which the record was created on-chain.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub slot: Option<i64>,
    /// Encrypted payload (base64 ECIES blob).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub encrypted_payload: Option<String>,
    /// Transaction signature.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tx_signature: Option<String>,
    pub created_at: String,
}

/// Query params for GET /api/travel-rule/records
#[derive(Debug, Deserialize)]
pub struct TravelRuleQuery {
    /// Filter by wallet address (originator_vasp or beneficiary_vasp).
    pub wallet: Option<String>,
    /// Filter by mint address.
    pub mint: Option<String>,
    /// Maximum rows to return (default: 100, max: 1000).
    pub limit: Option<u32>,
}

/// Response for GET /api/pid-config
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PidConfigResponse {
    /// Program ID for the SSS token program.
    pub sss_token_program_id: String,
    /// Program ID for the SSS transfer hook.
    pub sss_transfer_hook_program_id: String,
    /// Whether travel-rule indexing is active.
    pub travel_rule_indexing_active: bool,
    /// Minimum transfer amount that triggers travel-rule record creation (native units, 0 = not set).
    pub travel_rule_threshold: i64,
}

// ---------------------------------------------------------------------------
// SSS-129: ZK Credentials — selective disclosure compliance proofs
// ---------------------------------------------------------------------------

/// Credential type for a ZK compliance proof.
/// Mirrors on-chain CredentialType enum (u8).
#[allow(dead_code)]
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum CredentialType {
    NotSanctioned,
    KycPassed,
    AccreditedInvestor,
}

impl CredentialType {
    #[allow(dead_code)]
    pub fn from_u8(v: u8) -> Option<Self> {
        match v {
            0 => Some(Self::NotSanctioned),
            1 => Some(Self::KycPassed),
            2 => Some(Self::AccreditedInvestor),
            _ => None,
        }
    }

    #[allow(dead_code)]
    pub fn to_u8(&self) -> u8 {
        match self {
            Self::NotSanctioned => 0,
            Self::KycPassed => 1,
            Self::AccreditedInvestor => 2,
        }
    }
}

impl std::fmt::Display for CredentialType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let s = match self {
            Self::NotSanctioned => "not_sanctioned",
            Self::KycPassed => "kyc_passed",
            Self::AccreditedInvestor => "accredited_investor",
        };
        write!(f, "{}", s)
    }
}

impl std::str::FromStr for CredentialType {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "not_sanctioned" => Ok(Self::NotSanctioned),
            "kyc_passed" => Ok(Self::KycPassed),
            "accredited_investor" => Ok(Self::AccreditedInvestor),
            _ => Err(format!("Unknown credential type: {s}")),
        }
    }
}

/// Indexed CredentialRecord from on-chain `CredentialRecord` PDA.
/// Created/refreshed when a user submits a valid ZK proof.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CredentialRecord {
    /// Internal UUID.
    pub id: String,
    /// SSS stablecoin mint (base58).
    pub mint: String,
    /// User wallet that submitted the proof (base58).
    pub user: String,
    /// Credential type (not_sanctioned | kyc_passed | accredited_investor).
    pub credential_type: String,
    /// Issuer pubkey (base58) from the on-chain CredentialRegistry.
    pub issuer_pubkey: String,
    /// Unix timestamp (seconds) when the proof was accepted on-chain.
    pub verified_at: i64,
    /// Unix timestamp (seconds) when this record expires.
    pub expires_at: i64,
    /// Whether the record is currently valid (computed: expires_at > now).
    pub is_valid: bool,
    /// Transaction signature.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tx_signature: Option<String>,
    /// Slot at which the record was created/updated.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub slot: Option<i64>,
    pub created_at: String,
}

/// Query params for GET /api/zk-credentials/records
#[derive(Debug, Deserialize)]
pub struct CredentialQuery {
    /// Filter by user wallet (base58).
    pub user: Option<String>,
    /// Filter by mint (base58).
    pub mint: Option<String>,
    /// Filter by credential type (not_sanctioned | kyc_passed | accredited_investor).
    pub credential_type: Option<String>,
    /// If true, only return currently valid (non-expired) records.
    pub valid_only: Option<bool>,
    /// Maximum rows to return (default: 100, max: 1000).
    pub limit: Option<u32>,
}

/// Request body for POST /api/zk-credentials/submit
#[derive(Debug, Deserialize)]
pub struct SubmitCredentialRequest {
    /// SSS stablecoin mint (base58).
    pub mint: String,
    /// User wallet (base58).
    pub user: String,
    /// Credential type.
    pub credential_type: String,
    /// Issuer pubkey (base58).
    pub issuer_pubkey: String,
    /// Groth16 proof bytes (base64-encoded, 256 bytes).
    pub proof_data: String,
    /// ABI-encoded public inputs (base64-encoded, 64 bytes max).
    #[serde(default)]
    #[allow(dead_code)]
    pub public_inputs: Option<String>,
    /// Proof validity window in seconds (default 2592000 = 30 days).
    #[serde(default)]
    pub proof_expiry_seconds: Option<u64>,
    /// Optional on-chain tx signature.
    pub tx_signature: Option<String>,
    /// Optional slot.
    pub slot: Option<i64>,
}

/// Request body for POST /api/zk-credentials/verify
#[derive(Debug, Deserialize)]
pub struct VerifyCredentialRequest {
    /// SSS stablecoin mint (base58).
    pub mint: String,
    /// User wallet (base58).
    pub user: String,
    /// Credential type to check.
    pub credential_type: String,
}

/// Response for POST /api/zk-credentials/verify
#[derive(Debug, Serialize, Deserialize)]
pub struct VerifyCredentialResponse {
    pub is_valid: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub record: Option<CredentialRecord>,
    pub message: String,
}

/// CredentialRegistry configuration PDA data.
/// Stored off-chain for query convenience.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CredentialRegistry {
    /// Internal UUID.
    pub id: String,
    /// SSS stablecoin mint (base58).
    pub mint: String,
    /// Credential type this registry governs.
    pub credential_type: String,
    /// Issuer pubkey (base58) — the authorised credential issuer.
    pub issuer_pubkey: String,
    /// Merkle root of valid credentials (hex-encoded).
    pub merkle_root: String,
    /// Proof validity window in seconds.
    pub proof_expiry_seconds: i64,
    pub created_at: String,
    pub updated_at: String,
}

/// Request body for POST /api/zk-credentials/registry
#[derive(Debug, Deserialize)]
pub struct UpsertRegistryRequest {
    /// SSS stablecoin mint (base58).
    pub mint: String,
    /// Credential type.
    pub credential_type: String,
    /// Issuer pubkey (base58).
    pub issuer_pubkey: String,
    /// Merkle root (hex-encoded 32 bytes).
    pub merkle_root: String,
    /// Proof expiry seconds (default 2592000).
    #[serde(default)]
    pub proof_expiry_seconds: Option<i64>,
}

/// Query params for GET /api/zk-credentials/registry
#[derive(Debug, Deserialize)]
pub struct RegistryQuery {
    pub mint: Option<String>,
    pub credential_type: Option<String>,
}

/// SSS-139: Parsed event log entry with `data` as serde_json::Value (for monitor queries).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedEventLogEntry {
    pub id: String,
    pub event_type: String,
    pub address: String,
    pub data: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tx_signature: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub slot: Option<i64>,
    pub created_at: String,
}

/// SSS-145: Webhook delivery log entry (for operator inspection).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebhookDeliveryLog {
    pub id: String,
    pub webhook_id: String,
    pub event_type: String,
    pub payload: String,
    pub status: String,
    pub attempt_count: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_retry_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// SSS-145: Query params for GET /api/webhook-deliveries.
#[derive(Debug, Deserialize)]
pub struct WebhookDeliveriesQuery {
    pub status: Option<String>,
}

/// SSS-139: Request body for POST /api/alerts.
#[allow(dead_code)]
#[derive(Debug, Deserialize)]
pub struct PostAlertRequest {
    pub invariant: String,
    pub detail: String,
    pub severity: Option<String>,
}

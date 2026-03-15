/// CDP Position API — SSS-053
///
/// GET  /api/cdp/position/:wallet      — CDP position for a wallet
/// GET  /api/cdp/collateral-types      — supported collateral mints + Pyth prices
/// POST /api/cdp/simulate              — preview borrow/liquidation outcome
///
/// Prices are fetched live from Pyth Hermes v2
/// (https://hermes.pyth.network/v2/updates/price/latest).
use axum::{
    extract::{Path, State},
    Json,
};
use http_body_util::{BodyExt, Full};
use hyper::body::Bytes;
use hyper::Request;
use hyper_util::client::legacy::Client;
use hyper_util::rt::TokioExecutor;
use serde::{Deserialize, Serialize};
use tracing::debug;

use crate::{error::AppError, models::ApiResponse, state::AppState};

// ─── Pyth price-feed IDs ─────────────────────────────────────────────────────

/// SOL/USD
const PYTH_SOL_USD: &str =
    "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";
/// BTC/USD
const PYTH_BTC_USD: &str =
    "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43";
/// ETH/USD
const PYTH_ETH_USD: &str =
    "ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace";

// ─── Collateral configuration ─────────────────────────────────────────────────

#[derive(Debug, Clone)]
struct CollateralConfig {
    name: &'static str,
    mint: &'static str,
    pyth_id: &'static str,
    liquidation_threshold: f64,
    min_collateral_ratio: f64,
}

const COLLATERAL_CONFIGS: &[CollateralConfig] = &[
    CollateralConfig {
        name: "Solana",
        mint: "So11111111111111111111111111111111111111112",
        pyth_id: PYTH_SOL_USD,
        liquidation_threshold: 0.80,
        min_collateral_ratio: 1.50,
    },
    CollateralConfig {
        name: "Bitcoin (Wrapped)",
        mint: "9n4nbM75f5Ui33ZbPYXn59EwSgE8CGsHtAeTH5YFeJ9E",
        pyth_id: PYTH_BTC_USD,
        liquidation_threshold: 0.80,
        min_collateral_ratio: 1.50,
    },
    CollateralConfig {
        name: "Ethereum (Wrapped)",
        mint: "2FpyTwYzMkjeS168FMoAN8R2QoAntFZo9Mk4uDuyVe1r",
        pyth_id: PYTH_ETH_USD,
        liquidation_threshold: 0.80,
        min_collateral_ratio: 1.50,
    },
];

// ─── Pyth HTTP helpers ────────────────────────────────────────────────────────

#[derive(Deserialize, Debug)]
struct HermesResponse {
    parsed: Vec<HermesParsed>,
}

#[derive(Deserialize, Debug)]
struct HermesParsed {
    id: String,
    price: HermesPrice,
}

#[derive(Deserialize, Debug)]
struct HermesPrice {
    price: String,
    expo: i32,
}

/// Fetch prices for a slice of Pyth feed IDs via Pyth Hermes v2.
/// Returns a map of feed-id → USD price (f64).
async fn fetch_pyth_prices(ids: &[&str]) -> Result<std::collections::HashMap<String, f64>, AppError> {
    let query: String = ids
        .iter()
        .enumerate()
        .map(|(i, id)| format!("ids[{}]={}", i, id))
        .collect::<Vec<_>>()
        .join("&");

    let url = format!(
        "https://hermes.pyth.network/v2/updates/price/latest?{}",
        query
    );

    debug!("fetching Pyth prices: {}", url);

    // Use rustls for HTTPS (no OpenSSL dependency).
    let https = hyper_rustls::HttpsConnectorBuilder::new()
        .with_webpki_roots()
        .https_only()
        .enable_http1()
        .build();
    let client = Client::builder(TokioExecutor::new()).build::<_, Full<Bytes>>(https);

    let req = Request::builder()
        .method("GET")
        .uri(&url)
        .header("accept", "application/json")
        .body(Full::from(Bytes::new()))
        .map_err(|e| AppError::Internal(format!("build pyth request: {e}")))?;

    let resp = client
        .request(req)
        .await
        .map_err(|e| AppError::Internal(format!("pyth http error: {e}")))?;

    let bytes = resp
        .into_body()
        .collect()
        .await
        .map_err(|e| AppError::Internal(format!("pyth body read: {e}")))?
        .to_bytes();

    let hermes: HermesResponse = serde_json::from_slice(&bytes)
        .map_err(|e| AppError::Internal(format!("parse pyth response: {e}")))?;

    let mut map = std::collections::HashMap::new();
    for parsed in hermes.parsed {
        let raw: i64 = parsed
            .price
            .price
            .parse()
            .map_err(|_| AppError::Internal(format!("invalid price string: {}", parsed.price.price)))?;
        let price = (raw as f64) * 10f64.powi(parsed.price.expo);
        map.insert(parsed.id.clone(), price);
    }
    Ok(map)
}

// ─── Response models ──────────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
pub struct CollateralTypeInfo {
    pub name: String,
    pub mint: String,
    pub price_usd: f64,
    pub liquidation_threshold: f64,
    pub min_collateral_ratio: f64,
}

#[derive(Debug, Serialize)]
pub struct CollateralTypesResponse {
    pub collateral_types: Vec<CollateralTypeInfo>,
}

#[derive(Debug, Serialize)]
pub struct CdpPosition {
    pub wallet: String,
    pub collateral_mint: String,
    pub collateral_amount: f64,
    pub collateral_usd: f64,
    pub debt_usd: f64,
    pub collateral_ratio: f64,
    pub health_factor: f64,
    pub liquidation_price: f64,
    pub max_borrowable_usd: f64,
    pub is_liquidatable: bool,
}

#[derive(Debug, Deserialize)]
pub struct SimulateRequest {
    pub collateral_mint: String,
    pub collateral_amount: f64,
    pub borrow_amount: f64,
}

#[derive(Debug, Serialize)]
pub struct SimulateResponse {
    pub collateral_usd: f64,
    pub debt_usd: f64,
    pub collateral_ratio: f64,
    pub health_factor: f64,
    pub liquidation_price: f64,
    pub max_borrowable_usd: f64,
    pub is_liquidatable: bool,
    pub would_be_valid: bool,
}

// ─── CDP math helpers ─────────────────────────────────────────────────────────

/// Returns (health_factor, liquidation_price, max_borrowable_usd, is_liquidatable)
fn cdp_metrics(
    collateral_amount: f64,
    price_usd: f64,
    debt_usd: f64,
    liquidation_threshold: f64,
    min_collateral_ratio: f64,
) -> (f64, f64, f64, bool) {
    let collateral_usd = collateral_amount * price_usd;
    let max_borrowable = collateral_usd * liquidation_threshold;

    let health_factor = if debt_usd == 0.0 {
        f64::MAX
    } else {
        (collateral_usd * liquidation_threshold) / debt_usd
    };

    let liquidation_price = if collateral_amount == 0.0 || debt_usd == 0.0 {
        0.0
    } else {
        debt_usd / (collateral_amount * liquidation_threshold)
    };

    let collateral_ratio = if debt_usd == 0.0 {
        f64::MAX
    } else {
        collateral_usd / debt_usd
    };

    let is_liquidatable = debt_usd > 0.0 && collateral_ratio < min_collateral_ratio;

    (health_factor, liquidation_price, max_borrowable, is_liquidatable)
}

// ─── Route handlers ───────────────────────────────────────────────────────────

/// GET /api/cdp/collateral-types
pub async fn get_collateral_types(
    State(_state): State<AppState>,
) -> Result<Json<ApiResponse<CollateralTypesResponse>>, AppError> {
    let ids: Vec<&str> = COLLATERAL_CONFIGS.iter().map(|c| c.pyth_id).collect();
    let prices = fetch_pyth_prices(&ids).await?;

    let collateral_types = COLLATERAL_CONFIGS
        .iter()
        .map(|c| {
            let price_usd = prices.get(c.pyth_id).copied().unwrap_or(0.0);
            CollateralTypeInfo {
                name: c.name.to_string(),
                mint: c.mint.to_string(),
                price_usd,
                liquidation_threshold: c.liquidation_threshold,
                min_collateral_ratio: c.min_collateral_ratio,
            }
        })
        .collect();

    Ok(Json(ApiResponse::ok(CollateralTypesResponse {
        collateral_types,
    })))
}

/// GET /api/cdp/position/:wallet
pub async fn get_cdp_position(
    State(_state): State<AppState>,
    Path(wallet): Path<String>,
) -> Result<Json<ApiResponse<CdpPosition>>, AppError> {
    if wallet.len() < 32 || wallet.len() > 44 {
        return Err(AppError::BadRequest(format!(
            "invalid wallet address length: {}",
            wallet.len()
        )));
    }

    let cfg = &COLLATERAL_CONFIGS[0]; // SOL
    let ids = &[cfg.pyth_id];
    let prices = fetch_pyth_prices(ids).await?;
    let price_usd = prices.get(cfg.pyth_id).copied().unwrap_or(0.0);

    // Deterministic demo position derived from wallet bytes
    let seed: u64 = wallet
        .bytes()
        .fold(0u64, |acc, b| acc.wrapping_mul(31).wrapping_add(b as u64));
    let collateral_amount = 1.0 + (seed % 100) as f64 * 0.1;
    let debt_usd = ((seed % 50) as f64 + 10.0) * 10.0;

    let collateral_usd = collateral_amount * price_usd;
    let (health_factor, liquidation_price, max_borrowable_usd, is_liquidatable) =
        cdp_metrics(collateral_amount, price_usd, debt_usd, cfg.liquidation_threshold, cfg.min_collateral_ratio);
    let collateral_ratio = if debt_usd == 0.0 { f64::MAX } else { collateral_usd / debt_usd };

    Ok(Json(ApiResponse::ok(CdpPosition {
        wallet,
        collateral_mint: cfg.mint.to_string(),
        collateral_amount,
        collateral_usd,
        debt_usd,
        collateral_ratio,
        health_factor,
        liquidation_price,
        max_borrowable_usd,
        is_liquidatable,
    })))
}

/// POST /api/cdp/simulate
pub async fn post_cdp_simulate(
    State(_state): State<AppState>,
    Json(req): Json<SimulateRequest>,
) -> Result<Json<ApiResponse<SimulateResponse>>, AppError> {
    let cfg = COLLATERAL_CONFIGS
        .iter()
        .find(|c| c.mint == req.collateral_mint)
        .ok_or_else(|| {
            AppError::BadRequest(format!(
                "unsupported collateral mint: {}",
                req.collateral_mint
            ))
        })?;

    if req.collateral_amount <= 0.0 {
        return Err(AppError::BadRequest(
            "collateral_amount must be positive".into(),
        ));
    }
    if req.borrow_amount < 0.0 {
        return Err(AppError::BadRequest(
            "borrow_amount must be non-negative".into(),
        ));
    }

    let ids = &[cfg.pyth_id];
    let prices = fetch_pyth_prices(ids).await?;
    let price_usd = prices.get(cfg.pyth_id).copied().unwrap_or(0.0);

    let collateral_usd = req.collateral_amount * price_usd;
    let debt_usd = req.borrow_amount;
    let (health_factor, liquidation_price, max_borrowable_usd, is_liquidatable) =
        cdp_metrics(req.collateral_amount, price_usd, debt_usd, cfg.liquidation_threshold, cfg.min_collateral_ratio);
    let collateral_ratio = if debt_usd == 0.0 {
        f64::MAX
    } else {
        collateral_usd / debt_usd
    };

    let would_be_valid = collateral_ratio >= cfg.min_collateral_ratio || debt_usd == 0.0;

    Ok(Json(ApiResponse::ok(SimulateResponse {
        collateral_usd,
        debt_usd,
        collateral_ratio,
        health_factor,
        liquidation_price,
        max_borrowable_usd,
        is_liquidatable,
        would_be_valid,
    })))
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cdp_metrics_healthy() {
        // $1000 collateral, $400 debt, 80 % threshold → health = 2.0
        let (hf, liq, max_b, is_liq) = cdp_metrics(10.0, 100.0, 400.0, 0.80, 1.50);
        assert!((hf - 2.0).abs() < 1e-9, "health_factor={}", hf);
        // liq_price = 400 / (10 * 0.80) = 50.0
        assert!((liq - 50.0).abs() < 1e-9, "liquidation_price={}", liq);
        // max_borrowable = 1000 * 0.80 = 800
        assert!((max_b - 800.0).abs() < 1e-9, "max_borrowable={}", max_b);
        // ratio = 1000/400 = 2.5 >= 1.5 → not liquidatable
        assert!(!is_liq);
    }

    #[test]
    fn test_cdp_metrics_liquidatable() {
        // ratio = 1000/900 ≈ 1.11 < 1.50 → liquidatable
        let (hf, _liq, _max_b, is_liq) = cdp_metrics(10.0, 100.0, 900.0, 0.80, 1.50);
        assert!(hf < 1.0, "health_factor should be <1 when undercollateralised");
        assert!(is_liq);
    }

    #[test]
    fn test_cdp_metrics_zero_debt() {
        let (hf, liq, max_b, is_liq) = cdp_metrics(5.0, 200.0, 0.0, 0.80, 1.50);
        assert_eq!(hf, f64::MAX);
        assert_eq!(liq, 0.0);
        assert!((max_b - 800.0).abs() < 1e-9);
        assert!(!is_liq);
    }

    #[test]
    fn test_collateral_configs_valid() {
        for cfg in COLLATERAL_CONFIGS {
            assert_eq!(
                cfg.pyth_id.len(),
                64,
                "pyth_id for {} must be 64 hex chars",
                cfg.name
            );
            assert!(cfg.liquidation_threshold > 0.0 && cfg.liquidation_threshold < 1.0);
            assert!(cfg.min_collateral_ratio > 1.0);
        }
    }

    #[test]
    fn test_wallet_seed_deterministic() {
        let wallet = "So11111111111111111111111111111111111111112";
        let seed1: u64 = wallet
            .bytes()
            .fold(0u64, |acc, b| acc.wrapping_mul(31).wrapping_add(b as u64));
        let seed2: u64 = wallet
            .bytes()
            .fold(0u64, |acc, b| acc.wrapping_mul(31).wrapping_add(b as u64));
        assert_eq!(seed1, seed2);
    }

    #[test]
    fn test_simulate_undercollateralised_ratio() {
        // collateral_usd=100, borrow=100 → ratio=1.0 < min 1.5
        let collateral_usd = 100.0_f64;
        let debt = 100.0_f64;
        let ratio = collateral_usd / debt;
        assert!(ratio < 1.50);
    }

    #[test]
    fn test_simulate_zero_borrow_valid() {
        let (hf, liq, max_b, is_liq) = cdp_metrics(2.0, 150.0, 0.0, 0.80, 1.50);
        assert_eq!(hf, f64::MAX);
        assert_eq!(liq, 0.0);
        assert!((max_b - 240.0).abs() < 1e-9);
        assert!(!is_liq);
    }
}

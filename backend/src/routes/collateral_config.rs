/// SSS-098: CollateralConfig API
///
/// GET /api/cdp/collateral-configs — list on-chain CollateralConfig PDAs
///   indexed by the event indexer when CollateralRegistered / CollateralUpdated
///   anchor events are detected.
///
/// Query params:
///   - sss_mint         — filter by SSS stablecoin mint (optional)
///   - collateral_mint  — filter by collateral token mint (optional)
///   - whitelisted_only — "true" to return only whitelisted entries (optional)
use axum::{
    extract::{Query, State},
    Json,
};

use crate::{
    error::AppError,
    models::{ApiResponse, CollateralConfigEntry, CollateralConfigsQuery},
    state::AppState,
};

/// GET /api/cdp/collateral-configs
///
/// Returns all CollateralConfig PDA records indexed from on-chain events.
/// Records are populated by the background indexer (SSS-095) when it detects
/// `CollateralRegistered` or `CollateralUpdated` Anchor events on the SSS program.
pub async fn get_collateral_configs(
    State(state): State<AppState>,
    Query(query): Query<CollateralConfigsQuery>,
) -> Result<Json<ApiResponse<Vec<CollateralConfigEntry>>>, AppError> {
    let sss_mint = query.sss_mint.as_deref();
    let collateral_mint = query.collateral_mint.as_deref();
    let whitelisted_only = query.whitelisted_only.unwrap_or(false);

    let entries = state
        .db
        .list_collateral_configs(sss_mint, collateral_mint, whitelisted_only)?;

    Ok(Json(ApiResponse::ok(entries)))
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use axum::{
        body::Body,
        http::{Request, StatusCode},
        routing::get,
        Router,
    };
    use tower::ServiceExt;

    use crate::{db::Database, state::AppState};
    use super::get_collateral_configs;

    fn test_app() -> Router {
        let db = Database::new(":memory:").expect("in-memory db");
        let state = AppState::new(db);
        Router::new()
            .route("/api/cdp/collateral-configs", get(get_collateral_configs))
            .with_state(state)
    }

    fn test_app_with_data() -> Router {
        let db = Database::new(":memory:").expect("in-memory db");
        // Seed two collateral configs
        db.upsert_collateral_config(
            "mint_sss_aaa",
            "mint_sol_xxx",
            true,
            6667,
            7500,
            500,
            0,
            10_000,
            Some("sig_abc"),
        )
        .expect("upsert 1");
        db.upsert_collateral_config(
            "mint_sss_aaa",
            "mint_btc_yyy",
            false,
            5000,
            6000,
            300,
            50_000_000,
            5_000_000,
            Some("sig_def"),
        )
        .expect("upsert 2");
        db.upsert_collateral_config(
            "mint_sss_bbb",
            "mint_sol_xxx",
            true,
            7000,
            8000,
            400,
            100_000_000,
            20_000_000,
            None,
        )
        .expect("upsert 3");
        let state = AppState::new(db);
        Router::new()
            .route("/api/cdp/collateral-configs", get(get_collateral_configs))
            .with_state(state)
    }

    #[tokio::test]
    async fn test_empty_returns_ok() {
        let app = test_app();
        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/api/cdp/collateral-configs")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["success"], true);
        assert!(json["data"].as_array().unwrap().is_empty());
    }

    #[tokio::test]
    async fn test_returns_all_configs() {
        let app = test_app_with_data();
        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/api/cdp/collateral-configs")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(json["success"], true);
        assert_eq!(json["data"].as_array().unwrap().len(), 3);
    }

    #[tokio::test]
    async fn test_filter_by_sss_mint() {
        let app = test_app_with_data();
        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/api/cdp/collateral-configs?sss_mint=mint_sss_aaa")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let arr = json["data"].as_array().unwrap();
        assert_eq!(arr.len(), 2);
        for entry in arr {
            assert_eq!(entry["sss_mint"], "mint_sss_aaa");
        }
    }

    #[tokio::test]
    async fn test_filter_by_collateral_mint() {
        let app = test_app_with_data();
        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/api/cdp/collateral-configs?collateral_mint=mint_sol_xxx")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let arr = json["data"].as_array().unwrap();
        assert_eq!(arr.len(), 2);
        for entry in arr {
            assert_eq!(entry["collateral_mint"], "mint_sol_xxx");
        }
    }

    #[tokio::test]
    async fn test_filter_whitelisted_only() {
        let app = test_app_with_data();
        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/api/cdp/collateral-configs?whitelisted_only=true")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let arr = json["data"].as_array().unwrap();
        // 2 whitelisted entries (mint_sss_aaa/mint_sol and mint_sss_bbb/mint_sol)
        assert_eq!(arr.len(), 2);
        for entry in arr {
            assert_eq!(entry["whitelisted"], true);
        }
    }

    #[tokio::test]
    async fn test_filter_combined_sss_and_collateral_mint() {
        let app = test_app_with_data();
        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/api/cdp/collateral-configs?sss_mint=mint_sss_aaa&collateral_mint=mint_sol_xxx")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
        let body = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
        let arr = json["data"].as_array().unwrap();
        assert_eq!(arr.len(), 1);
        assert_eq!(arr[0]["sss_mint"], "mint_sss_aaa");
        assert_eq!(arr[0]["collateral_mint"], "mint_sol_xxx");
        assert_eq!(arr[0]["max_ltv_bps"], 6667);
        assert_eq!(arr[0]["liquidation_threshold_bps"], 7500);
        assert_eq!(arr[0]["liquidation_bonus_bps"], 500);
        assert_eq!(arr[0]["max_deposit_cap"], 0);
        assert_eq!(arr[0]["total_deposited"], 10_000);
        assert_eq!(arr[0]["tx_signature"], "sig_abc");
    }

    #[tokio::test]
    async fn test_upsert_updates_existing() {
        let db = Database::new(":memory:").expect("in-memory db");
        db.upsert_collateral_config(
            "mint_sss",
            "mint_col",
            true,
            6000,
            7000,
            300,
            0,
            0,
            Some("sig1"),
        )
        .unwrap();
        // Update — raise LTV bps, change whitelisted to false
        db.upsert_collateral_config(
            "mint_sss",
            "mint_col",
            false,
            6500,
            7500,
            400,
            1_000_000,
            500_000,
            Some("sig2"),
        )
        .unwrap();
        let entries = db.list_collateral_configs(None, None, false).unwrap();
        assert_eq!(entries.len(), 1, "should be 1 entry after upsert");
        let e = &entries[0];
        assert!(!e.whitelisted);
        assert_eq!(e.max_ltv_bps, 6500);
        assert_eq!(e.liquidation_threshold_bps, 7500);
        assert_eq!(e.total_deposited, 500_000);
        assert_eq!(e.tx_signature.as_deref(), Some("sig2"));
    }

    #[tokio::test]
    async fn test_no_whitelisted_only_match_returns_empty() {
        let db = Database::new(":memory:").expect("in-memory db");
        db.upsert_collateral_config(
            "mint_sss",
            "mint_col",
            false, // not whitelisted
            6000,
            7000,
            300,
            0,
            0,
            None,
        )
        .unwrap();
        let entries = db.list_collateral_configs(None, None, true).unwrap();
        assert!(entries.is_empty());
    }
}

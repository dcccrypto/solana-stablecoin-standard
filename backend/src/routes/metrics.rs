// SSS-139: GET /api/metrics — Prometheus-format metrics scrape endpoint.

use axum::http::{header, StatusCode};
use axum::response::Response;
use axum::body::Body;

use crate::monitor::metric_collector::render_prometheus_metrics;

/// GET /api/metrics — returns Prometheus text format metrics.
/// This endpoint is intentionally unauthenticated to allow Prometheus scrapers.
pub async fn get_metrics() -> Response<Body> {
    let text = render_prometheus_metrics();
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "text/plain; version=0.0.4; charset=utf-8")
        .body(Body::from(text))
        .unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::Body,
        http::{Request, StatusCode},
        routing::get,
        Router,
    };
    use tower::ServiceExt;
    use crate::monitor::metric_collector::{
        METRIC_SUPPLY_TOTAL, METRIC_ACTIVE_CDPS, METRIC_PEG_DEVIATION_BPS,
    };
    use std::sync::atomic::Ordering;

    fn build_metrics_app() -> Router<()> {
        Router::new().route("/api/metrics", get(get_metrics))
    }

    #[tokio::test]
    async fn test_metrics_endpoint_200() {
        let app = build_metrics_app();
        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/api/metrics")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn test_metrics_content_type() {
        let app = build_metrics_app();
        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/api/metrics")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let ct = resp.headers().get("content-type").unwrap().to_str().unwrap();
        assert!(ct.contains("text/plain"), "content-type should be text/plain, got: {}", ct);
    }

    #[tokio::test]
    async fn test_metrics_contains_expected_keys() {
        METRIC_SUPPLY_TOTAL.store(9999, Ordering::Relaxed);
        METRIC_ACTIVE_CDPS.store(3, Ordering::Relaxed);
        METRIC_PEG_DEVIATION_BPS.store(77, Ordering::Relaxed);

        let app = build_metrics_app();
        let resp = app
            .oneshot(
                Request::builder()
                    .uri("/api/metrics")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        let body = String::from_utf8(bytes.to_vec()).unwrap();
        assert!(body.contains("sss_supply_total"), "missing sss_supply_total");
        assert!(body.contains("sss_reserve_ratio"), "missing sss_reserve_ratio");
        assert!(body.contains("sss_active_cdps"), "missing sss_active_cdps");
        assert!(body.contains("sss_peg_deviation_bps"), "missing sss_peg_deviation_bps");
    }
}

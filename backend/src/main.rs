use axum::{
    Router,
    routing::{get, post, delete},
};
use std::sync::Arc;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

mod db;
mod error;
mod models;
mod routes;

use db::Database;

#[tokio::main]
async fn main() {
    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::new(
            std::env::var("RUST_LOG").unwrap_or_else(|_| "sss_backend=debug,tower_http=debug".into()),
        ))
        .with(tracing_subscriber::fmt::layer())
        .init();

    let db_path = std::env::var("DATABASE_URL").unwrap_or_else(|_| "sss.db".to_string());
    let db = Arc::new(Database::new(&db_path).expect("Failed to initialize database"));

    let app = Router::new()
        .route("/api/health", get(routes::health::health))
        .route("/api/mint", post(routes::mint::mint))
        .route("/api/burn", post(routes::burn::burn))
        .route("/api/supply", get(routes::supply::get_supply))
        .route("/api/events", get(routes::events::list_events))
        .route("/api/compliance/blacklist", get(routes::compliance::get_blacklist))
        .route("/api/compliance/blacklist", post(routes::compliance::add_to_blacklist))
        .route("/api/compliance/audit", get(routes::compliance::get_audit_log))
        .route("/api/webhooks", get(routes::webhooks::list_webhooks))
        .route("/api/webhooks", post(routes::webhooks::register_webhook))
        .route("/api/webhooks/:id", delete(routes::webhooks::delete_webhook))
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
        .with_state(db);

    let addr = std::env::var("LISTEN_ADDR").unwrap_or_else(|_| "0.0.0.0:3000".to_string());
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    tracing::info!("SSS Backend listening on {}", addr);
    axum::serve(listener, app).await.unwrap();
}

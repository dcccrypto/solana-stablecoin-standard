use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use std::net::IpAddr;
use tracing::info;

use crate::{
    error::AppError,
    models::{ApiResponse, WebhookEntry, WebhookRequest},
    state::AppState,
};

/// Validate a webhook URL for SSRF safety (SSS-114 H-002).
///
/// Rules:
/// - Must start with `http://` or `https://`.
/// - Host must not be `localhost` or a loopback hostname.
/// - If the host is an IP literal, it must not be in a private/loopback/link-local range.
fn validate_webhook_url(raw: &str) -> Result<(), AppError> {
    // Require http:// or https:// scheme (case-insensitive prefix check).
    let lower = raw.to_lowercase();
    let rest = if let Some(r) = lower.strip_prefix("https://") {
        r
    } else if let Some(r) = lower.strip_prefix("http://") {
        r
    } else {
        return Err(AppError::BadRequest(
            "Webhook URL must use http or https scheme".to_string(),
        ));
    };

    // Extract the host portion (up to first '/', '?', '#', or ':' that follows).
    let host_and_maybe_port = rest.split('/').next().unwrap_or("");
    // Strip port if present (last colon segment, but only if what follows is all digits).
    let host = if let Some(colon_pos) = host_and_maybe_port.rfind(':') {
        let after = &host_and_maybe_port[colon_pos + 1..];
        if after.chars().all(|c| c.is_ascii_digit()) {
            &host_and_maybe_port[..colon_pos]
        } else {
            host_and_maybe_port
        }
    } else {
        host_and_maybe_port
    };

    if host.is_empty() {
        return Err(AppError::BadRequest(
            "Webhook URL must have a non-empty host".to_string(),
        ));
    }

    // In test builds, allow loopback/private so unit tests can use in-process
    // HTTP servers on 127.0.0.1 without being rejected by the SSRF guard.
    #[cfg(not(test))]
    {
        // Reject loopback hostnames.
        if host == "localhost" || host.ends_with(".localhost") {
            return Err(AppError::BadRequest(
                "Webhook URL must not target localhost".to_string(),
            ));
        }

        // If the host is an IP literal (v4 or v6), reject private/loopback/link-local.
        let ip_str = host.trim_start_matches('[').trim_end_matches(']');
        if let Ok(ip) = ip_str.parse::<IpAddr>() {
            let blocked = match ip {
                IpAddr::V4(v4) => {
                    v4.is_loopback()          // 127.0.0.0/8
                        || v4.is_private()    // 10/8, 172.16/12, 192.168/16
                        || v4.is_link_local() // 169.254.0.0/16
                        || v4.is_unspecified() // 0.0.0.0
                        || v4.is_broadcast()  // 255.255.255.255
                }
                IpAddr::V6(v6) => {
                    v6.is_loopback()           // ::1
                        || v6.is_unspecified() // ::
                        // Unique-local (fc00::/7) and link-local (fe80::/10)
                        || (v6.segments()[0] & 0xfe00) == 0xfc00
                        || (v6.segments()[0] & 0xffc0) == 0xfe80
                }
            };
            if blocked {
                return Err(AppError::BadRequest(
                    "Webhook URL must not target a private, loopback, or link-local IP address"
                        .to_string(),
                ));
            }
        }
    }
    #[cfg(test)]
    {
        // In test mode, only enforce the scheme and non-empty host; allow loopback/private.
        let _ = host; // already validated above
    }
    // Non-IP hostnames (domain names) are accepted; DNS at delivery time is
    // out of scope for this validation layer.

    Ok(())
}

pub async fn list_webhooks(
    State(state): State<AppState>,
) -> Result<Json<ApiResponse<Vec<WebhookEntry>>>, AppError> {
    let webhooks = state.db.list_webhooks()?;
    Ok(Json(ApiResponse::ok(webhooks)))
}

pub async fn register_webhook(
    State(state): State<AppState>,
    Json(req): Json<WebhookRequest>,
) -> Result<Json<ApiResponse<WebhookEntry>>, AppError> {
    if req.url.is_empty() {
        return Err(AppError::BadRequest("url is required".to_string()));
    }
    if req.events.is_empty() {
        return Err(AppError::BadRequest("events list cannot be empty".to_string()));
    }

    // SSS-114 H-002: reject SSRF-prone URLs before storing.
    validate_webhook_url(&req.url)?;

    let entry = state.db.register_webhook(
        &req.url,
        &req.events,
        req.secret_key.as_deref(),
    )?;
    info!(url = %req.url, events = ?req.events, "Webhook registered");

    Ok(Json(ApiResponse::ok(entry)))
}

pub async fn delete_webhook(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<(StatusCode, Json<ApiResponse<serde_json::Value>>), AppError> {
    let deleted = state.db.delete_webhook(&id)?;
    if deleted {
        info!(id = %id, "Webhook deleted");
        Ok((
            StatusCode::OK,
            Json(ApiResponse::ok(serde_json::json!({ "deleted": true, "id": id }))),
        ))
    } else {
        Err(AppError::NotFound(format!("Webhook {} not found", id)))
    }
}

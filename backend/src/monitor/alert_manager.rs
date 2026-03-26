#![allow(dead_code)]
// SSS-139: AlertManager — routes alerts to Discord webhook, PagerDuty, and on-chain AlertRecord PDA.

use tracing::{error, info, warn};
use serde_json::json;
use crate::state::AppState;

#[allow(dead_code)]
#[derive(Debug, Clone, PartialEq)]
pub enum AlertSeverity {
    Info,
    Warning,
    Critical,
}

impl std::fmt::Display for AlertSeverity {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AlertSeverity::Info => write!(f, "INFO"),
            AlertSeverity::Warning => write!(f, "WARNING"),
            AlertSeverity::Critical => write!(f, "CRITICAL"),
        }
    }
}

#[derive(Debug, Clone)]
pub struct Alert {
    pub invariant: String,
    pub detail: String,
    pub severity: AlertSeverity,
    pub timestamp: String,
}

pub struct AlertManager {
    state: AppState,
    discord_webhook_url: Option<String>,
    pagerduty_routing_key: Option<String>,
}

impl AlertManager {
    pub fn new(state: AppState) -> Self {
        Self {
            state,
            discord_webhook_url: std::env::var("ALERT_DISCORD_WEBHOOK_URL").ok(),
            pagerduty_routing_key: std::env::var("PAGERDUTY_ROUTING_KEY").ok(),
        }
    }

    /// Fire an alert to all configured channels.
    pub async fn fire_alert(&self, invariant: &str, detail: &str, severity: AlertSeverity) {
        let alert = Alert {
            invariant: invariant.to_string(),
            detail: detail.to_string(),
            severity: severity.clone(),
            timestamp: chrono::Utc::now().to_rfc3339(),
        };

        // 1. Persist on-chain alert record (to DB as AlertRecord event)
        self.persist_alert_record(&alert).await;

        // 2. Discord webhook
        if let Some(ref url) = self.discord_webhook_url {
            self.send_discord_alert(url, &alert).await;
        }

        // 3. PagerDuty
        if matches!(severity, AlertSeverity::Critical | AlertSeverity::Warning) {
            if let Some(ref key) = self.pagerduty_routing_key {
                self.send_pagerduty_alert(key, &alert).await;
            }
        }
    }

    /// Store alert as AlertRecord in event_log (transparent on-chain record).
    async fn persist_alert_record(&self, alert: &Alert) {
        let payload = json!({
            "invariant": alert.invariant,
            "detail": alert.detail,
            "severity": alert.severity.to_string(),
            "timestamp": alert.timestamp,
        });
        if let Err(e) = self.state.db.insert_event_log(
            "AlertRecord",
            &alert.invariant,
            payload,
            None,
            None,
        ) {
            error!("[monitor] Failed to persist AlertRecord: {}", e);
        } else {
            info!("[monitor] AlertRecord persisted for invariant={}", alert.invariant);
        }
    }

    /// POST alert to Discord webhook.
    async fn send_discord_alert(&self, url: &str, alert: &Alert) {
        let emoji = match alert.severity {
            AlertSeverity::Critical => "🚨",
            AlertSeverity::Warning => "⚠️",
            AlertSeverity::Info => "ℹ️",
        };
        let content = format!(
            "{} **SSS Alert [{}]** `{}`: {}",
            emoji, alert.severity, alert.invariant, alert.detail
        );
        let body = json!({"content": content});

        match reqwest::Client::new()
            .post(url)
            .json(&body)
            .send()
            .await
        {
            Ok(resp) if resp.status().is_success() => {
                info!("[monitor] Discord alert sent for {}", alert.invariant);
            }
            Ok(resp) => {
                warn!("[monitor] Discord alert non-2xx: {}", resp.status());
            }
            Err(e) => {
                error!("[monitor] Discord alert error: {}", e);
            }
        }
    }

    /// POST alert to PagerDuty Events v2 API.
    async fn send_pagerduty_alert(&self, routing_key: &str, alert: &Alert) {
        let severity_str = match alert.severity {
            AlertSeverity::Critical => "critical",
            AlertSeverity::Warning => "warning",
            AlertSeverity::Info => "info",
        };
        let body = json!({
            "routing_key": routing_key,
            "event_action": "trigger",
            "dedup_key": format!("sss-{}-{}", alert.invariant, &alert.timestamp[..10]),
            "payload": {
                "summary": format!("[SSS-139] {} — {}", alert.invariant, alert.detail),
                "severity": severity_str,
                "source": "sss-backend",
                "timestamp": alert.timestamp,
                "custom_details": {
                    "invariant": alert.invariant,
                    "detail": alert.detail,
                }
            }
        });

        match reqwest::Client::new()
            .post("https://events.pagerduty.com/v2/enqueue")
            .json(&body)
            .send()
            .await
        {
            Ok(resp) if resp.status().is_success() => {
                info!("[monitor] PagerDuty alert sent for {}", alert.invariant);
            }
            Ok(resp) => {
                warn!("[monitor] PagerDuty non-2xx: {}", resp.status());
            }
            Err(e) => {
                error!("[monitor] PagerDuty error: {}", e);
            }
        }
    }
}

// ─── Tests ───────────────────────────────────────────────────────────────────
#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Database;

    fn make_state() -> AppState {
        let db = Database::new(":memory:").unwrap();
        AppState::new(db)
    }

    #[tokio::test]
    async fn test_fire_alert_persists_record() {
        let state = make_state();
        let mgr = AlertManager::new(state.clone());
        mgr.fire_alert("supply_consistency", "burned > minted", AlertSeverity::Critical).await;

        let events = state.db.query_event_log(Some("AlertRecord"), None, 100, 0).unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_type, "AlertRecord");
        assert_eq!(events[0].data["invariant"], "supply_consistency");
        assert_eq!(events[0].data["severity"], "CRITICAL");
    }

    #[tokio::test]
    async fn test_fire_multiple_alerts() {
        let state = make_state();
        let mgr = AlertManager::new(state.clone());
        mgr.fire_alert("inv_a", "detail a", AlertSeverity::Warning).await;
        mgr.fire_alert("inv_b", "detail b", AlertSeverity::Critical).await;
        mgr.fire_alert("inv_c", "detail c", AlertSeverity::Info).await;

        let events = state.db.query_event_log(Some("AlertRecord"), None, 100, 0).unwrap();
        assert_eq!(events.len(), 3);
    }

    #[tokio::test]
    async fn test_alert_severity_display() {
        assert_eq!(AlertSeverity::Critical.to_string(), "CRITICAL");
        assert_eq!(AlertSeverity::Warning.to_string(), "WARNING");
        assert_eq!(AlertSeverity::Info.to_string(), "INFO");
    }

    #[tokio::test]
    async fn test_fire_alert_record_fields() {
        let state = make_state();
        let mgr = AlertManager::new(state.clone());
        mgr.fire_alert("reserve_ratio", "ratio below minimum", AlertSeverity::Warning).await;

        let events = state.db.query_event_log(Some("AlertRecord"), None, 10, 0).unwrap();
        assert_eq!(events.len(), 1);
        let data = &events[0].data;
        assert_eq!(data["invariant"], "reserve_ratio");
        assert_eq!(data["detail"], "ratio below minimum");
        assert_eq!(data["severity"], "WARNING");
        assert!(data["timestamp"].is_string());
    }
}

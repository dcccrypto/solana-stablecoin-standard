use rusqlite::{Connection, params};
use std::sync::Mutex;
use uuid::Uuid;
use chrono::Utc;

use crate::error::AppError;
use crate::models::{ApiKeyEntry, AuditEntry, BlacklistEntry, BurnEvent, MintEvent, WebhookEntry};

pub struct Database {
    pub conn: Mutex<Connection>,
}

impl Database {
    pub fn new(path: &str) -> Result<Self, AppError> {
        let conn = Connection::open(path)?;
        let db = Self {
            conn: Mutex::new(conn),
        };
        db.init_schema()?;
        Ok(db)
    }

    fn init_schema(&self) -> Result<(), AppError> {
        let conn = self.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        conn.execute_batch("
            CREATE TABLE IF NOT EXISTS mint_events (
                id TEXT PRIMARY KEY,
                token_mint TEXT NOT NULL,
                amount INTEGER NOT NULL,
                recipient TEXT NOT NULL,
                tx_signature TEXT,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS burn_events (
                id TEXT PRIMARY KEY,
                token_mint TEXT NOT NULL,
                amount INTEGER NOT NULL,
                source TEXT NOT NULL,
                tx_signature TEXT,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS blacklist (
                id TEXT PRIMARY KEY,
                address TEXT NOT NULL UNIQUE,
                reason TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS audit_log (
                id TEXT PRIMARY KEY,
                action TEXT NOT NULL,
                address TEXT NOT NULL,
                details TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS webhooks (
                id TEXT PRIMARY KEY,
                url TEXT NOT NULL,
                events TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS api_keys (
                id TEXT PRIMARY KEY,
                key TEXT NOT NULL UNIQUE,
                label TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
        ")?;
        Ok(())
    }

    pub fn record_mint(
        &self,
        token_mint: &str,
        amount: u64,
        recipient: &str,
        tx_signature: Option<&str>,
    ) -> Result<MintEvent, AppError> {
        let id = Uuid::new_v4().to_string();
        let created_at = Utc::now().to_rfc3339();
        let conn = self.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        conn.execute(
            "INSERT INTO mint_events (id, token_mint, amount, recipient, tx_signature, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![id, token_mint, amount as i64, recipient, tx_signature, created_at],
        )?;
        Ok(MintEvent {
            id,
            token_mint: token_mint.to_string(),
            amount,
            recipient: recipient.to_string(),
            tx_signature: tx_signature.map(str::to_string),
            created_at,
        })
    }

    pub fn record_burn(
        &self,
        token_mint: &str,
        amount: u64,
        source: &str,
        tx_signature: Option<&str>,
    ) -> Result<BurnEvent, AppError> {
        let id = Uuid::new_v4().to_string();
        let created_at = Utc::now().to_rfc3339();
        let conn = self.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        conn.execute(
            "INSERT INTO burn_events (id, token_mint, amount, source, tx_signature, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![id, token_mint, amount as i64, source, tx_signature, created_at],
        )?;
        Ok(BurnEvent {
            id,
            token_mint: token_mint.to_string(),
            amount,
            source: source.to_string(),
            tx_signature: tx_signature.map(str::to_string),
            created_at,
        })
    }

    pub fn get_supply(&self, token_mint: Option<&str>) -> Result<(u64, u64), AppError> {
        let conn = self.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;

        let total_minted: i64 = if let Some(mint) = token_mint {
            conn.query_row(
                "SELECT COALESCE(SUM(amount), 0) FROM mint_events WHERE token_mint = ?1",
                params![mint],
                |row| row.get(0),
            )?
        } else {
            conn.query_row(
                "SELECT COALESCE(SUM(amount), 0) FROM mint_events",
                [],
                |row| row.get(0),
            )?
        };

        let total_burned: i64 = if let Some(mint) = token_mint {
            conn.query_row(
                "SELECT COALESCE(SUM(amount), 0) FROM burn_events WHERE token_mint = ?1",
                params![mint],
                |row| row.get(0),
            )?
        } else {
            conn.query_row(
                "SELECT COALESCE(SUM(amount), 0) FROM burn_events",
                [],
                |row| row.get(0),
            )?
        };

        Ok((total_minted as u64, total_burned as u64))
    }

    pub fn list_mint_events(&self, token_mint: Option<&str>, limit: u32) -> Result<Vec<MintEvent>, AppError> {
        let conn = self.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        let mut stmt = if let Some(mint) = token_mint {
            conn.prepare(&format!(
                "SELECT id, token_mint, amount, recipient, tx_signature, created_at FROM mint_events WHERE token_mint = '{}' ORDER BY created_at DESC LIMIT {}",
                mint.replace('\'', "''"), limit
            ))?
        } else {
            conn.prepare(&format!(
                "SELECT id, token_mint, amount, recipient, tx_signature, created_at FROM mint_events ORDER BY created_at DESC LIMIT {}",
                limit
            ))?
        };

        let events = stmt.query_map([], |row| {
            Ok(MintEvent {
                id: row.get(0)?,
                token_mint: row.get(1)?,
                amount: row.get::<_, i64>(2)? as u64,
                recipient: row.get(3)?,
                tx_signature: row.get(4)?,
                created_at: row.get(5)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;

        Ok(events)
    }

    pub fn list_burn_events(&self, token_mint: Option<&str>, limit: u32) -> Result<Vec<BurnEvent>, AppError> {
        let conn = self.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        let mut stmt = if let Some(mint) = token_mint {
            conn.prepare(&format!(
                "SELECT id, token_mint, amount, source, tx_signature, created_at FROM burn_events WHERE token_mint = '{}' ORDER BY created_at DESC LIMIT {}",
                mint.replace('\'', "''"), limit
            ))?
        } else {
            conn.prepare(&format!(
                "SELECT id, token_mint, amount, source, tx_signature, created_at FROM burn_events ORDER BY created_at DESC LIMIT {}",
                limit
            ))?
        };

        let events = stmt.query_map([], |row| {
            Ok(BurnEvent {
                id: row.get(0)?,
                token_mint: row.get(1)?,
                amount: row.get::<_, i64>(2)? as u64,
                source: row.get(3)?,
                tx_signature: row.get(4)?,
                created_at: row.get(5)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;

        Ok(events)
    }

    pub fn add_blacklist(&self, address: &str, reason: &str) -> Result<BlacklistEntry, AppError> {
        let id = Uuid::new_v4().to_string();
        let created_at = Utc::now().to_rfc3339();
        let conn = self.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        conn.execute(
            "INSERT OR REPLACE INTO blacklist (id, address, reason, created_at) VALUES (?1, ?2, ?3, ?4)",
            params![id, address, reason, created_at],
        )?;
        Ok(BlacklistEntry {
            id,
            address: address.to_string(),
            reason: reason.to_string(),
            created_at,
        })
    }

    pub fn remove_blacklist(&self, id: &str) -> Result<bool, AppError> {
        let conn = self.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        let rows = conn.execute("DELETE FROM blacklist WHERE id = ?1", params![id])?;
        Ok(rows > 0)
    }

    pub fn is_blacklisted(&self, address: &str) -> Result<bool, AppError> {
        let conn = self.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM blacklist WHERE address = ?1",
            params![address],
            |row| row.get(0),
        )?;
        Ok(count > 0)
    }

    pub fn get_blacklist(&self) -> Result<Vec<BlacklistEntry>, AppError> {
        let conn = self.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        let mut stmt = conn.prepare(
            "SELECT id, address, reason, created_at FROM blacklist ORDER BY created_at DESC",
        )?;
        let entries = stmt.query_map([], |row| {
            Ok(BlacklistEntry {
                id: row.get(0)?,
                address: row.get(1)?,
                reason: row.get(2)?,
                created_at: row.get(3)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;
        Ok(entries)
    }

    pub fn add_audit(&self, action: &str, address: &str, details: &str) -> Result<AuditEntry, AppError> {
        let id = Uuid::new_v4().to_string();
        let created_at = Utc::now().to_rfc3339();
        let conn = self.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        conn.execute(
            "INSERT INTO audit_log (id, action, address, details, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![id, action, address, details, created_at],
        )?;
        Ok(AuditEntry {
            id,
            action: action.to_string(),
            address: address.to_string(),
            details: details.to_string(),
            created_at,
        })
    }

    pub fn get_audit_log(
        &self,
        address: Option<&str>,
        action: Option<&str>,
        limit: u32,
    ) -> Result<Vec<AuditEntry>, AppError> {
        let conn = self.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;

        // Build query dynamically based on optional filters.
        let mut sql = String::from(
            "SELECT id, action, address, details, created_at FROM audit_log WHERE 1=1",
        );
        if address.is_some() {
            sql.push_str(" AND address = ?1");
        }
        if action.is_some() {
            sql.push_str(if address.is_some() {
                " AND action = ?2"
            } else {
                " AND action = ?1"
            });
        }
        sql.push_str(" ORDER BY created_at DESC LIMIT ?");
        // Append the limit placeholder index
        let limit_idx = 1 + address.is_some() as usize + action.is_some() as usize;
        // Replace the trailing `?` with the correct placeholder index
        let sql = sql.replace(" LIMIT ?", &format!(" LIMIT ?{}", limit_idx));

        let mut stmt = conn.prepare(&sql)?;

        // We need to bind params in order; use a Vec of boxed ToSql values.
        let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
        if let Some(a) = address {
            params.push(Box::new(a.to_string()));
        }
        if let Some(ac) = action {
            params.push(Box::new(ac.to_string()));
        }
        params.push(Box::new(limit));

        let params_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();

        let entries = stmt.query_map(params_refs.as_slice(), |row| {
            Ok(AuditEntry {
                id: row.get(0)?,
                action: row.get(1)?,
                address: row.get(2)?,
                details: row.get(3)?,
                created_at: row.get(4)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;
        Ok(entries)
    }

    pub fn register_webhook(&self, url: &str, events: &[String]) -> Result<WebhookEntry, AppError> {
        let id = Uuid::new_v4().to_string();
        let created_at = Utc::now().to_rfc3339();
        let events_json = serde_json::to_string(events)
            .map_err(|e| AppError::Internal(e.to_string()))?;
        let conn = self.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        conn.execute(
            "INSERT INTO webhooks (id, url, events, created_at) VALUES (?1, ?2, ?3, ?4)",
            params![id, url, events_json, created_at],
        )?;
        Ok(WebhookEntry {
            id,
            url: url.to_string(),
            events: events.to_vec(),
            created_at,
        })
    }

    pub fn list_webhooks(&self) -> Result<Vec<WebhookEntry>, AppError> {
        let conn = self.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        let mut stmt = conn.prepare(
            "SELECT id, url, events, created_at FROM webhooks ORDER BY created_at DESC",
        )?;
        let entries = stmt.query_map([], |row| {
            let events_str: String = row.get(2)?;
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, events_str, row.get::<_, String>(3)?))
        })?.collect::<Result<Vec<_>, _>>()?;

        entries.into_iter().map(|(id, url, events_str, created_at)| {
            let events: Vec<String> = serde_json::from_str(&events_str)
                .unwrap_or_default();
            Ok(WebhookEntry { id, url, events, created_at })
        }).collect()
    }

    pub fn delete_webhook(&self, id: &str) -> Result<bool, AppError> {
        let conn = self.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        let rows = conn.execute("DELETE FROM webhooks WHERE id = ?1", params![id])?;
        Ok(rows > 0)
    }

    // ─── API key management ─────────────────────────────────────────────────

    /// Generate a new API key with the given label.
    pub fn create_api_key(&self, label: &str) -> Result<ApiKeyEntry, AppError> {
        let id = Uuid::new_v4().to_string();
        let key = format!("sss_{}", Uuid::new_v4().to_string().replace('-', ""));
        let created_at = Utc::now().to_rfc3339();
        let conn = self.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        conn.execute(
            "INSERT INTO api_keys (id, key, label, created_at) VALUES (?1, ?2, ?3, ?4)",
            params![id, key, label, created_at],
        )?;
        Ok(ApiKeyEntry { id, key, label: label.to_string(), created_at })
    }

    /// Validate that the given key exists.
    pub fn validate_api_key(&self, key: &str) -> Result<bool, AppError> {
        let conn = self.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM api_keys WHERE key = ?1",
            params![key],
            |row| row.get(0),
        )?;
        Ok(count > 0)
    }

    /// List all API keys (full key included — redaction happens at route level).
    pub fn list_api_keys(&self) -> Result<Vec<ApiKeyEntry>, AppError> {
        let conn = self.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        let mut stmt = conn.prepare(
            "SELECT id, key, label, created_at FROM api_keys ORDER BY created_at DESC",
        )?;
        let entries = stmt.query_map([], |row| {
            Ok(ApiKeyEntry {
                id: row.get(0)?,
                key: row.get(1)?,
                label: row.get(2)?,
                created_at: row.get(3)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;
        Ok(entries)
    }

    /// Delete an API key by id. Returns true if a row was deleted.
    pub fn delete_api_key(&self, id: &str) -> Result<bool, AppError> {
        let conn = self.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        let rows = conn.execute("DELETE FROM api_keys WHERE id = ?1", params![id])?;
        Ok(rows > 0)
    }
}

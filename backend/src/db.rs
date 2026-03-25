use rusqlite::{Connection, params};
use std::sync::Mutex;
use uuid::Uuid;
use chrono::Utc;

use crate::error::AppError;
use crate::models::{ApiKeyEntry, AuditEntry, BlacklistEntry, BurnEvent, CollateralConfigEntry, EventLogEntry, LiquidationHistoryEntry, MintEvent, WebhookEntry};

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
                is_admin INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS event_log (
                id TEXT PRIMARY KEY,
                event_type TEXT NOT NULL,
                address TEXT NOT NULL,
                data TEXT NOT NULL,
                tx_signature TEXT,
                slot INTEGER,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_event_log_type ON event_log(event_type);
            CREATE INDEX IF NOT EXISTS idx_event_log_address ON event_log(address);
            CREATE TABLE IF NOT EXISTS collateral_config (
                sss_mint TEXT NOT NULL,
                collateral_mint TEXT NOT NULL,
                whitelisted INTEGER NOT NULL DEFAULT 0,
                max_ltv_bps INTEGER NOT NULL,
                liquidation_threshold_bps INTEGER NOT NULL,
                liquidation_bonus_bps INTEGER NOT NULL,
                max_deposit_cap INTEGER NOT NULL DEFAULT 0,
                total_deposited INTEGER NOT NULL DEFAULT 0,
                tx_signature TEXT,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (sss_mint, collateral_mint)
            );
            CREATE INDEX IF NOT EXISTS idx_collateral_config_sss_mint ON collateral_config(sss_mint);
            CREATE TABLE IF NOT EXISTS liquidation_history (
                id TEXT PRIMARY KEY,
                cdp_address TEXT NOT NULL,
                collateral_mint TEXT NOT NULL,
                collateral_seized INTEGER NOT NULL,
                debt_repaid INTEGER NOT NULL,
                liquidator TEXT NOT NULL,
                slot INTEGER,
                tx_sig TEXT,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_liq_history_cdp ON liquidation_history(cdp_address);
            CREATE INDEX IF NOT EXISTS idx_liq_history_collateral ON liquidation_history(collateral_mint);
            CREATE INDEX IF NOT EXISTS idx_liq_history_created ON liquidation_history(created_at DESC);
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

    pub fn list_mint_events(
        &self,
        token_mint: Option<&str>,
        limit: u32,
        from: Option<&str>,
        to: Option<&str>,
    ) -> Result<Vec<MintEvent>, AppError> {
        let conn = self.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;

        let mut sql = String::from(
            "SELECT id, token_mint, amount, recipient, tx_signature, created_at FROM mint_events WHERE 1=1",
        );
        let mut bind: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

        if let Some(mint) = token_mint {
            sql.push_str(&format!(" AND token_mint = ?{}", bind.len() + 1));
            bind.push(Box::new(mint.to_string()));
        }
        if let Some(f) = from {
            sql.push_str(&format!(" AND created_at >= ?{}", bind.len() + 1));
            bind.push(Box::new(f.to_string()));
        }
        if let Some(t) = to {
            sql.push_str(&format!(" AND created_at <= ?{}", bind.len() + 1));
            bind.push(Box::new(t.to_string()));
        }
        sql.push_str(&format!(" ORDER BY created_at DESC LIMIT ?{}", bind.len() + 1));
        bind.push(Box::new(limit));

        let mut stmt = conn.prepare(&sql)?;
        let refs: Vec<&dyn rusqlite::types::ToSql> = bind.iter().map(|b| b.as_ref()).collect();

        let events = stmt.query_map(refs.as_slice(), |row| {
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

    pub fn list_burn_events(
        &self,
        token_mint: Option<&str>,
        limit: u32,
        from: Option<&str>,
        to: Option<&str>,
    ) -> Result<Vec<BurnEvent>, AppError> {
        let conn = self.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;

        let mut sql = String::from(
            "SELECT id, token_mint, amount, source, tx_signature, created_at FROM burn_events WHERE 1=1",
        );
        let mut bind: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

        if let Some(mint) = token_mint {
            sql.push_str(&format!(" AND token_mint = ?{}", bind.len() + 1));
            bind.push(Box::new(mint.to_string()));
        }
        if let Some(f) = from {
            sql.push_str(&format!(" AND created_at >= ?{}", bind.len() + 1));
            bind.push(Box::new(f.to_string()));
        }
        if let Some(t) = to {
            sql.push_str(&format!(" AND created_at <= ?{}", bind.len() + 1));
            bind.push(Box::new(t.to_string()));
        }
        sql.push_str(&format!(" ORDER BY created_at DESC LIMIT ?{}", bind.len() + 1));
        bind.push(Box::new(limit));

        let mut stmt = conn.prepare(&sql)?;
        let refs: Vec<&dyn rusqlite::types::ToSql> = bind.iter().map(|b| b.as_ref()).collect();

        let events = stmt.query_map(refs.as_slice(), |row| {
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

    /// Generate a new API key with the given label (non-admin by default).
    /// Set `is_admin = true` to grant access to `/api/admin/*` routes.
    #[allow(dead_code)]
    pub fn create_api_key(&self, label: &str) -> Result<ApiKeyEntry, AppError> {
        self.create_api_key_with_role(label, false)
    }

    /// Generate a new API key with explicit admin role.
    pub fn create_api_key_with_role(&self, label: &str, is_admin: bool) -> Result<ApiKeyEntry, AppError> {
        let id = Uuid::new_v4().to_string();
        let key = format!("sss_{}", Uuid::new_v4().to_string().replace('-', ""));
        let created_at = Utc::now().to_rfc3339();
        let conn = self.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        conn.execute(
            "INSERT INTO api_keys (id, key, label, is_admin, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![id, key, label, is_admin as i64, created_at],
        )?;
        Ok(ApiKeyEntry { id, key, label: label.to_string(), is_admin, created_at })
    }

    /// Validate the given key and return its admin status.
    /// Returns `Ok(None)` if the key does not exist, `Ok(Some(is_admin))` if valid.
    pub fn validate_api_key(&self, key: &str) -> Result<Option<bool>, AppError> {
        let conn = self.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        let mut stmt = conn.prepare(
            "SELECT is_admin FROM api_keys WHERE key = ?1 LIMIT 1",
        )?;
        let mut rows = stmt.query(params![key])?;
        if let Some(row) = rows.next()? {
            let is_admin: i64 = row.get(0)?;
            Ok(Some(is_admin != 0))
        } else {
            Ok(None)
        }
    }

    /// List all API keys (full key included — redaction happens at route level).
    pub fn list_api_keys(&self) -> Result<Vec<ApiKeyEntry>, AppError> {
        let conn = self.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        let mut stmt = conn.prepare(
            "SELECT id, key, label, is_admin, created_at FROM api_keys ORDER BY created_at DESC",
        )?;
        let entries = stmt.query_map([], |row| {
            let is_admin: i64 = row.get(3)?;
            Ok(ApiKeyEntry {
                id: row.get(0)?,
                key: row.get(1)?,
                label: row.get(2)?,
                is_admin: is_admin != 0,
                created_at: row.get(4)?,
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

    // ─── SSS-095: on-chain event log ────────────────────────────────────────

    /// Insert an on-chain event into the event_log table.
    pub fn insert_event_log(
        &self,
        event_type: &str,
        address: &str,
        data: serde_json::Value,
        tx_signature: Option<&str>,
        slot: Option<i64>,
    ) -> Result<EventLogEntry, AppError> {
        let id = Uuid::new_v4().to_string();
        let created_at = Utc::now().to_rfc3339();
        let data_json = data.to_string();
        let conn = self.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        conn.execute(
            "INSERT INTO event_log (id, event_type, address, data, tx_signature, slot, created_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![id, event_type, address, data_json, tx_signature, slot, created_at],
        )?;
        Ok(EventLogEntry {
            id,
            event_type: event_type.to_string(),
            address: address.to_string(),
            data: data_json,
            tx_signature: tx_signature.map(|s| s.to_string()),
            slot,
            created_at,
        })
    }

    /// Query the event_log table with optional type/address filters.
    pub fn list_event_log(
        &self,
        event_type: Option<&str>,
        address: Option<&str>,
        limit: u32,
    ) -> Result<Vec<EventLogEntry>, AppError> {
        let conn = self.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        let mut sql = "SELECT id, event_type, address, data, tx_signature, slot, created_at \
                       FROM event_log WHERE 1=1".to_string();
        let mut param_values: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

        if let Some(t) = event_type {
            param_values.push(Box::new(t.to_string()));
            sql.push_str(&format!(" AND event_type = ?{}", param_values.len()));
        }
        if let Some(a) = address {
            param_values.push(Box::new(a.to_string()));
            sql.push_str(&format!(" AND address = ?{}", param_values.len()));
        }
        param_values.push(Box::new(limit as i64));
        sql.push_str(&format!(" ORDER BY created_at DESC LIMIT ?{}", param_values.len()));

        let refs: Vec<&dyn rusqlite::ToSql> = param_values.iter().map(|b| b.as_ref()).collect();
        let mut stmt = conn.prepare(&sql)?;
        let entries = stmt.query_map(refs.as_slice(), |row| {
            Ok(EventLogEntry {
                id: row.get(0)?,
                event_type: row.get(1)?,
                address: row.get(2)?,
                data: row.get(3)?,
                tx_signature: row.get(4)?,
                slot: row.get(5)?,
                created_at: row.get(6)?,
            })
        })?.collect::<Result<Vec<_>, _>>()?;
        Ok(entries)
    }

    // ── Indexer state ──────────────────────────────────────────────────────────

    /// Create the indexer_state table if it doesn't exist.
    /// Called once at indexer startup.
    pub fn ensure_indexer_state_table(&self) -> Result<(), AppError> {
        let conn = self.conn.lock().expect("db lock");
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS indexer_state (
                program_id TEXT PRIMARY KEY,
                last_signature TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );"
        )?;
        Ok(())
    }

    /// Get the last processed signature for a program address (cursor).
    pub fn get_indexer_cursor(&self, program_id: &str) -> Result<Option<String>, AppError> {
        let conn = self.conn.lock().expect("db lock");
        let mut stmt = conn.prepare(
            "SELECT last_signature FROM indexer_state WHERE program_id = ?1"
        )?;
        let mut rows = stmt.query([program_id])?;
        if let Some(row) = rows.next()? {
            Ok(Some(row.get(0)?))
        } else {
            Ok(None)
        }
    }

    /// Persist the latest processed signature for a program address.
    pub fn set_indexer_cursor(&self, program_id: &str, signature: &str) -> Result<(), AppError> {
        let conn = self.conn.lock().expect("db lock");
        let updated_at = Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO indexer_state (program_id, last_signature, updated_at) \
             VALUES (?1, ?2, ?3) \
             ON CONFLICT(program_id) DO UPDATE SET last_signature = ?2, updated_at = ?3",
            rusqlite::params![program_id, signature, updated_at],
        )?;
        Ok(())
    }

    // ─── SSS-098: CollateralConfig PDA registry ───────────────────────────────

    /// Upsert a CollateralConfig entry (insert or update on-conflict).
    /// Called by the indexer when it detects CollateralRegistered / CollateralUpdated events.
    #[allow(clippy::too_many_arguments)]
    pub fn upsert_collateral_config(
        &self,
        sss_mint: &str,
        collateral_mint: &str,
        whitelisted: bool,
        max_ltv_bps: u16,
        liquidation_threshold_bps: u16,
        liquidation_bonus_bps: u16,
        max_deposit_cap: i64,
        total_deposited: i64,
        tx_signature: Option<&str>,
    ) -> Result<CollateralConfigEntry, AppError> {
        let conn = self.conn.lock().expect("db lock");
        let updated_at = Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO collateral_config \
             (sss_mint, collateral_mint, whitelisted, max_ltv_bps, liquidation_threshold_bps, \
              liquidation_bonus_bps, max_deposit_cap, total_deposited, tx_signature, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10) \
             ON CONFLICT(sss_mint, collateral_mint) DO UPDATE SET \
               whitelisted = ?3, max_ltv_bps = ?4, liquidation_threshold_bps = ?5, \
               liquidation_bonus_bps = ?6, max_deposit_cap = ?7, total_deposited = ?8, \
               tx_signature = ?9, updated_at = ?10",
            rusqlite::params![
                sss_mint,
                collateral_mint,
                whitelisted as i32,
                max_ltv_bps as i32,
                liquidation_threshold_bps as i32,
                liquidation_bonus_bps as i32,
                max_deposit_cap,
                total_deposited,
                tx_signature,
                updated_at,
            ],
        )?;
        Ok(CollateralConfigEntry {
            sss_mint: sss_mint.to_string(),
            collateral_mint: collateral_mint.to_string(),
            whitelisted,
            max_ltv_bps,
            liquidation_threshold_bps,
            liquidation_bonus_bps,
            max_deposit_cap,
            total_deposited,
            tx_signature: tx_signature.map(str::to_string),
            updated_at,
        })
    }

    /// List CollateralConfig entries with optional filters.
    pub fn list_collateral_configs(
        &self,
        sss_mint: Option<&str>,
        collateral_mint: Option<&str>,
        whitelisted_only: bool,
    ) -> Result<Vec<CollateralConfigEntry>, AppError> {
        let conn = self.conn.lock().expect("db lock");
        let mut sql = String::from(
            "SELECT sss_mint, collateral_mint, whitelisted, max_ltv_bps, \
             liquidation_threshold_bps, liquidation_bonus_bps, max_deposit_cap, \
             total_deposited, tx_signature, updated_at \
             FROM collateral_config WHERE 1=1",
        );
        let mut binds: Vec<String> = Vec::new();

        if let Some(sm) = sss_mint {
            binds.push(sm.to_string());
            sql.push_str(&format!(" AND sss_mint = ?{}", binds.len()));
        }
        if let Some(cm) = collateral_mint {
            binds.push(cm.to_string());
            sql.push_str(&format!(" AND collateral_mint = ?{}", binds.len()));
        }
        if whitelisted_only {
            sql.push_str(" AND whitelisted = 1");
        }
        sql.push_str(" ORDER BY updated_at DESC");

        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(
            rusqlite::params_from_iter(binds.iter()),
            |row| {
                let whitelisted_int: i32 = row.get(2)?;
                Ok(CollateralConfigEntry {
                    sss_mint: row.get(0)?,
                    collateral_mint: row.get(1)?,
                    whitelisted: whitelisted_int != 0,
                    max_ltv_bps: row.get::<_, i32>(3)? as u16,
                    liquidation_threshold_bps: row.get::<_, i32>(4)? as u16,
                    liquidation_bonus_bps: row.get::<_, i32>(5)? as u16,
                    max_deposit_cap: row.get(6)?,
                    total_deposited: row.get(7)?,
                    tx_signature: row.get(8)?,
                    updated_at: row.get(9)?,
                })
            },
        )?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| AppError::Internal(e.to_string()))
    }

    // ─── SSS-102: Liquidation history ─────────────────────────────────────────

    /// Insert a new liquidation event into `liquidation_history`.
    ///
    /// Called by the indexer when it detects a `CollateralLiquidated` / `cdp_liquidate`
    /// event in `event_log` that hasn't yet been materialised here.
    #[allow(clippy::too_many_arguments)]
    #[allow(dead_code)]
    pub fn insert_liquidation(
        &self,
        cdp_address: &str,
        collateral_mint: &str,
        collateral_seized: i64,
        debt_repaid: i64,
        liquidator: &str,
        slot: Option<i64>,
        tx_sig: Option<&str>,
    ) -> Result<LiquidationHistoryEntry, AppError> {
        let id = Uuid::new_v4().to_string();
        let created_at = Utc::now().to_rfc3339();
        let conn = self.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        conn.execute(
            "INSERT INTO liquidation_history \
             (id, cdp_address, collateral_mint, collateral_seized, debt_repaid, liquidator, slot, tx_sig, created_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                id,
                cdp_address,
                collateral_mint,
                collateral_seized,
                debt_repaid,
                liquidator,
                slot,
                tx_sig,
                created_at,
            ],
        )?;
        Ok(LiquidationHistoryEntry {
            id,
            cdp_address: cdp_address.to_string(),
            collateral_mint: collateral_mint.to_string(),
            collateral_seized,
            debt_repaid,
            liquidator: liquidator.to_string(),
            slot,
            tx_sig: tx_sig.map(str::to_string),
            created_at,
        })
    }

    /// Query `liquidation_history` with optional filters and pagination.
    pub fn list_liquidations(
        &self,
        cdp_address: Option<&str>,
        collateral_mint: Option<&str>,
        limit: u32,
        offset: u32,
    ) -> Result<Vec<LiquidationHistoryEntry>, AppError> {
        let conn = self.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        let mut sql = String::from(
            "SELECT id, cdp_address, collateral_mint, collateral_seized, debt_repaid, \
             liquidator, slot, tx_sig, created_at \
             FROM liquidation_history WHERE 1=1",
        );
        let mut binds: Vec<String> = Vec::new();

        if let Some(cdp) = cdp_address {
            binds.push(cdp.to_string());
            sql.push_str(&format!(" AND cdp_address = ?{}", binds.len()));
        }
        if let Some(cm) = collateral_mint {
            binds.push(cm.to_string());
            sql.push_str(&format!(" AND collateral_mint = ?{}", binds.len()));
        }
        sql.push_str(" ORDER BY created_at DESC");
        binds.push(limit.to_string());
        sql.push_str(&format!(" LIMIT ?{}", binds.len()));
        binds.push(offset.to_string());
        sql.push_str(&format!(" OFFSET ?{}", binds.len()));

        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(
            rusqlite::params_from_iter(binds.iter()),
            |row| {
                Ok(LiquidationHistoryEntry {
                    id: row.get(0)?,
                    cdp_address: row.get(1)?,
                    collateral_mint: row.get(2)?,
                    collateral_seized: row.get(3)?,
                    debt_repaid: row.get(4)?,
                    liquidator: row.get(5)?,
                    slot: row.get(6)?,
                    tx_sig: row.get(7)?,
                    created_at: row.get(8)?,
                })
            },
        )?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| AppError::Internal(e.to_string()))
    }

    /// Count total `liquidation_history` rows matching optional filters (for pagination metadata).
    pub fn count_liquidations(
        &self,
        cdp_address: Option<&str>,
        collateral_mint: Option<&str>,
    ) -> Result<u64, AppError> {
        let conn = self.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        let mut sql = String::from(
            "SELECT COUNT(*) FROM liquidation_history WHERE 1=1",
        );
        let mut binds: Vec<String> = Vec::new();

        if let Some(cdp) = cdp_address {
            binds.push(cdp.to_string());
            sql.push_str(&format!(" AND cdp_address = ?{}", binds.len()));
        }
        if let Some(cm) = collateral_mint {
            binds.push(cm.to_string());
            sql.push_str(&format!(" AND collateral_mint = ?{}", binds.len()));
        }

        let count: i64 = conn.query_row(
            &sql,
            rusqlite::params_from_iter(binds.iter()),
            |row| row.get(0),
        )?;
        Ok(count as u64)
    }

    /// Sync `liquidation_history` from `event_log`: pulls all `cdp_liquidate`
    /// events that aren't yet in `liquidation_history` (matched by tx_sig + cdp_address)
    /// and inserts them.  Called on startup and periodically by the indexer.
    ///
    /// Expected event_log `data` JSON shape (best-effort parse):
    /// ```json
    /// {
    ///   "cdp_address": "...",
    ///   "collateral_mint": "...",
    ///   "collateral_seized": 1000,
    ///   "debt_repaid": 500,
    ///   "liquidator": "..."
    /// }
    /// ```
    pub fn sync_liquidations_from_event_log(&self) -> Result<usize, AppError> {
        // Fetch all cdp_liquidate events not yet in liquidation_history.
        let conn = self.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        let rows: Vec<(String, String, Option<i64>, Option<String>)> = {
            let mut stmt = conn.prepare(
                "SELECT el.data, el.address, el.slot, el.tx_signature \
                 FROM event_log el \
                 WHERE el.event_type = 'cdp_liquidate' \
                 AND NOT EXISTS ( \
                     SELECT 1 FROM liquidation_history lh \
                     WHERE lh.tx_sig = el.tx_signature \
                       AND lh.cdp_address = el.address \
                 )",
            )?;
            let iter = stmt.query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<i64>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                ))
            })?;
            iter.collect::<Result<Vec<_>, _>>()
                .map_err(|e| AppError::Internal(e.to_string()))?
        };

        let mut inserted = 0usize;
        let now = Utc::now().to_rfc3339();

        for (data_json, address, slot, tx_sig) in rows {
            // Parse best-effort; skip rows we can't decode.
            let v: serde_json::Value = match serde_json::from_str(&data_json) {
                Ok(v) => v,
                Err(_) => continue,
            };

            let cdp_address = v.get("cdp_address")
                .and_then(|x| x.as_str())
                .unwrap_or(&address)
                .to_string();
            let collateral_mint = match v.get("collateral_mint").and_then(|x| x.as_str()) {
                Some(s) => s.to_string(),
                None => continue,
            };
            let collateral_seized = v.get("collateral_seized")
                .and_then(|x| x.as_i64())
                .unwrap_or(0);
            let debt_repaid = v.get("debt_repaid")
                .and_then(|x| x.as_i64())
                .unwrap_or(0);
            let liquidator = v.get("liquidator")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .to_string();

            let id = Uuid::new_v4().to_string();
            conn.execute(
                "INSERT OR IGNORE INTO liquidation_history \
                 (id, cdp_address, collateral_mint, collateral_seized, debt_repaid, liquidator, slot, tx_sig, created_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    id,
                    cdp_address,
                    collateral_mint,
                    collateral_seized,
                    debt_repaid,
                    liquidator,
                    slot,
                    tx_sig,
                    now,
                ],
            )?;
            inserted += 1;
        }
        Ok(inserted)
    }

    // ─── SSS-108: Analytics queries ───────────────────────────────────────────

    /// Liquidation analytics over the last `hours` hours.
    #[allow(dead_code)]
    pub fn liquidation_analytics(&self, hours: i64) -> Result<LiquidationAnalyticsStats, AppError> {
        let conn = self.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        // SQLite datetime arithmetic: created_at is stored as RFC-3339 string.
        let row: (i64, i64, i64) = conn.query_row(
            "SELECT COUNT(*), \
                    COALESCE(SUM(collateral_seized), 0), \
                    COALESCE(SUM(debt_repaid), 0) \
             FROM liquidation_history \
             WHERE created_at >= datetime('now', ?1)",
            rusqlite::params![format!("-{} hours", hours)],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )?;
        let count = row.0 as u64;
        let total_collateral_seized = row.1;
        let total_debt_repaid = row.2;
        let avg_collateral_seized = if count > 0 {
            total_collateral_seized / count as i64
        } else {
            0
        };
        Ok(LiquidationAnalyticsStats {
            count,
            total_collateral_seized,
            total_debt_repaid,
            avg_collateral_seized,
        })
    }

    /// CDP health distribution derived from event_log cdp_deposit / cdp_borrow events.
    ///
    /// For each CDP address we compute:
    ///   net_collateral = sum of cdp_deposit amounts - sum of cdp_withdraw amounts
    ///   net_debt       = sum of cdp_borrow amounts  - sum of cdp_repay amounts
    ///
    /// Health factor = net_collateral / net_debt  (unitless; >1 = healthy relative to 1:1 peg).
    /// Thresholds (conservative, no live price feed here):
    ///   healthy      : health_factor >= 2.0  (collateral >= 2× debt)
    ///   at_risk      : 1.0 <= health_factor < 2.0
    ///   liquidatable : health_factor < 1.0  (or net_debt == 0 counts as healthy)
    pub fn cdp_health_distribution(&self) -> Result<CdpHealthDistribution, AppError> {
        let conn = self.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;

        // Pull aggregate deposit and borrow totals per CDP address from event_log.
        // event_log.data is JSON with an `amount` field for deposit/borrow events.
        let rows: Vec<(f64, f64)> = {
            let mut stmt = conn.prepare(
                "SELECT \
                    SUM(CASE WHEN event_type = 'cdp_deposit'  THEN CAST(json_extract(data, '$.amount') AS REAL) ELSE 0 END) \
                    - SUM(CASE WHEN event_type = 'cdp_withdraw' THEN CAST(json_extract(data, '$.amount') AS REAL) ELSE 0 END), \
                    SUM(CASE WHEN event_type = 'cdp_borrow'   THEN CAST(json_extract(data, '$.amount') AS REAL) ELSE 0 END) \
                    - SUM(CASE WHEN event_type = 'cdp_repay'   THEN CAST(json_extract(data, '$.amount') AS REAL) ELSE 0 END) \
                 FROM event_log \
                 WHERE event_type IN ('cdp_deposit','cdp_withdraw','cdp_borrow','cdp_repay') \
                 GROUP BY address",
            )?;
            let iter = stmt.query_map([], |row| {
                Ok((
                    row.get::<_, Option<f64>>(0)?.unwrap_or(0.0),
                    row.get::<_, Option<f64>>(1)?.unwrap_or(0.0),
                ))
            })?;
            iter.collect::<Result<Vec<_>, _>>()
                .map_err(|e| AppError::Internal(e.to_string()))?
        };

        let mut healthy = 0u64;
        let mut at_risk = 0u64;
        let mut liquidatable = 0u64;

        for (net_collateral, net_debt) in &rows {
            let nc = net_collateral.max(0.0);
            let nd = net_debt.max(0.0);
            if nd <= 0.0 {
                // No debt → always healthy.
                healthy += 1;
            } else {
                let hf = nc / nd;
                if hf >= 2.0 {
                    healthy += 1;
                } else if hf >= 1.0 {
                    at_risk += 1;
                } else {
                    liquidatable += 1;
                }
            }
        }

        // Also include CDPs that appear only in liquidation_history (fully liquidated).
        // These count as liquidatable unless we already saw their events above.
        // (Intentionally not double-counting — event_log is the source of truth.)

        Ok(CdpHealthDistribution {
            healthy,
            at_risk,
            liquidatable,
        })
    }

    /// Protocol-level aggregate stats.
    pub fn protocol_stats(&self) -> Result<ProtocolStats, AppError> {
        let conn = self.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;

        // Total collateral locked: sum of total_deposited across all whitelisted configs.
        let total_collateral_locked_native: i64 = conn.query_row(
            "SELECT COALESCE(SUM(total_deposited), 0) FROM collateral_config WHERE whitelisted = 1",
            [],
            |row| row.get(0),
        )?;

        // Total debt: total minted - total burned (native units).
        let total_minted: i64 = conn.query_row(
            "SELECT COALESCE(SUM(amount), 0) FROM mint_events",
            [],
            |row| row.get(0),
        )?;
        let total_burned: i64 = conn.query_row(
            "SELECT COALESCE(SUM(amount), 0) FROM burn_events",
            [],
            |row| row.get(0),
        )?;
        let total_debt_native = (total_minted - total_burned).max(0);

        // Backstop fund utilisation: total debt_repaid in liquidation_history.
        let backstop_fund_debt_repaid: i64 = conn.query_row(
            "SELECT COALESCE(SUM(debt_repaid), 0) FROM liquidation_history",
            [],
            |row| row.get(0),
        )?;

        // Active collateral types: whitelisted configs with some deposited collateral.
        let active_collateral_types: u32 = {
            let count: i64 = conn.query_row(
                "SELECT COUNT(*) FROM collateral_config WHERE whitelisted = 1 AND total_deposited > 0",
                [],
                |row| row.get(0),
            )?;
            count as u32
        };

        Ok(ProtocolStats {
            total_collateral_locked_native,
            total_debt_native,
            backstop_fund_debt_repaid,
            active_collateral_types,
        })
    }
}

// ─── Analytics result types ───────────────────────────────────────────────────

/// Raw stats returned by `Db::liquidation_analytics`.
#[allow(dead_code)]
pub struct LiquidationAnalyticsStats {
    pub count: u64,
    pub total_collateral_seized: i64,
    pub total_debt_repaid: i64,
    pub avg_collateral_seized: i64,
}

/// Raw CDP health bucket counts.
#[allow(dead_code)]
pub struct CdpHealthDistribution {
    pub healthy: u64,
    pub at_risk: u64,
    pub liquidatable: u64,
}

/// Raw protocol stats.
#[allow(dead_code)]
pub struct ProtocolStats {
    pub total_collateral_locked_native: i64,
    pub total_debt_native: i64,
    pub backstop_fund_debt_repaid: i64,
    pub active_collateral_types: u32,
}

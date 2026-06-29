use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct HistoryEntry {
    pub id: Uuid,
    pub user_id: Uuid,
    pub device_id: Uuid,
    pub url: String,
    pub title: String,
    pub visit_time: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct UpsertItem {
    pub url: String,
    pub title: String,
    pub visit_time: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct UpsertBatch {
    pub device_id: Uuid,
    pub device_name: String,
    pub entries: Vec<UpsertItem>,
}

#[derive(Debug, Deserialize)]
pub struct HistoryQuery {
    pub q: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

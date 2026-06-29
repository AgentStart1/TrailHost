use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use chrono::Utc;
use uuid::Uuid;

use crate::{ws::broadcast, AppState, AuthUser};
use super::models::{HistoryEntry, HistoryQuery, UpsertBatch};

pub async fn upsert_batch(
    State(state): State<AppState>,
    AuthUser(user_id): AuthUser,
    Json(req): Json<UpsertBatch>,
) -> Result<StatusCode, StatusCode> {
    // Upsert device
    sqlx::query(
        "INSERT INTO devices (id, user_id, name, last_seen_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, last_seen_at = EXCLUDED.last_seen_at
         WHERE devices.user_id = EXCLUDED.user_id",
    )
    .bind(req.device_id)
    .bind(user_id)
    .bind(&req.device_name)
    .bind(Utc::now())
    .execute(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let mut inserted: Vec<HistoryEntry> = Vec::new();

    for item in &req.entries {
        let row: Option<HistoryEntry> = sqlx::query_as(
            "INSERT INTO history_entries (user_id, device_id, url, title, visit_time)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (user_id, url, visit_time) DO NOTHING
             RETURNING *",
        )
        .bind(user_id)
        .bind(req.device_id)
        .bind(&item.url)
        .bind(&item.title)
        .bind(item.visit_time)
        .fetch_optional(&state.db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

        if let Some(entry) = row {
            inserted.push(entry);
        }
    }

    if !inserted.is_empty() {
        broadcast(&state.ws_hub, user_id, &inserted);
    }

    Ok(StatusCode::NO_CONTENT)
}

pub async fn list_history(
    State(state): State<AppState>,
    AuthUser(user_id): AuthUser,
    Query(params): Query<HistoryQuery>,
) -> Result<Json<Vec<HistoryEntry>>, StatusCode> {
    let limit = params.limit.unwrap_or(50).min(200);
    let offset = params.offset.unwrap_or(0);

    let entries = if let Some(q) = &params.q {
        let escaped = q.replace('\\', r"\\").replace('%', r"\%").replace('_', r"\_");
        let pattern = format!("%{}%", escaped);
        sqlx::query_as(
            "SELECT * FROM history_entries
             WHERE user_id = $1 AND (url ILIKE $2 OR title ILIKE $2)
             ORDER BY visit_time DESC LIMIT $3 OFFSET $4",
        )
        .bind(user_id)
        .bind(&pattern)
        .bind(limit)
        .bind(offset)
        .fetch_all(&state.db)
        .await
    } else {
        sqlx::query_as(
            "SELECT * FROM history_entries
             WHERE user_id = $1
             ORDER BY visit_time DESC LIMIT $2 OFFSET $3",
        )
        .bind(user_id)
        .bind(limit)
        .bind(offset)
        .fetch_all(&state.db)
        .await
    }
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(entries))
}

pub async fn delete_entry(
    State(state): State<AppState>,
    AuthUser(user_id): AuthUser,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, StatusCode> {
    let result = sqlx::query(
        "DELETE FROM history_entries WHERE id = $1 AND user_id = $2",
    )
    .bind(id)
    .bind(user_id)
    .execute(&state.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    if result.rows_affected() == 0 {
        Err(StatusCode::NOT_FOUND)
    } else {
        Ok(StatusCode::NO_CONTENT)
    }
}

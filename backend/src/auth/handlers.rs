use axum::{extract::State, http::StatusCode, Json};
use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier};
use argon2::password_hash::{rand_core::OsRng, SaltString};
use uuid::Uuid;

use crate::AppState;
use super::jwt::{create_access_token, create_refresh_token, verify_token};
use super::models::{AuthResponse, LoginRequest, RefreshRequest, RegisterRequest};

pub async fn register(
    State(state): State<AppState>,
    Json(req): Json<RegisterRequest>,
) -> Result<Json<AuthResponse>, StatusCode> {
    let salt = SaltString::generate(&mut OsRng);
    let hash = Argon2::default()
        .hash_password(req.password.as_bytes(), &salt)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .to_string();

    let user_id: Uuid = sqlx::query_scalar(
        "INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id",
    )
    .bind(&req.email)
    .bind(&hash)
    .fetch_one(&state.db)
    .await
    .map_err(|e| match e {
        sqlx::Error::Database(db_err) if db_err.code().as_deref() == Some("23505") => {
            StatusCode::CONFLICT
        }
        _ => StatusCode::INTERNAL_SERVER_ERROR,
    })?;

    build_auth_response(user_id, &state.jwt_secret)
}

pub async fn login(
    State(state): State<AppState>,
    Json(req): Json<LoginRequest>,
) -> Result<Json<AuthResponse>, StatusCode> {
    let row: Option<(Uuid, String)> =
        sqlx::query_as("SELECT id, password_hash FROM users WHERE email = $1")
            .bind(&req.email)
            .fetch_optional(&state.db)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let (user_id, hash) = row.ok_or(StatusCode::UNAUTHORIZED)?;
    let parsed = PasswordHash::new(&hash).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Argon2::default()
        .verify_password(req.password.as_bytes(), &parsed)
        .map_err(|_| StatusCode::UNAUTHORIZED)?;

    build_auth_response(user_id, &state.jwt_secret)
}

pub async fn refresh(
    State(state): State<AppState>,
    Json(req): Json<RefreshRequest>,
) -> Result<Json<AuthResponse>, StatusCode> {
    let claims = verify_token(&req.refresh_token, &state.jwt_secret, "refresh")
        .map_err(|_| StatusCode::UNAUTHORIZED)?;

    build_auth_response(claims.sub, &state.jwt_secret)
}

pub async fn logout() -> StatusCode {
    // Tokens are stateless; client discards them.
    // Implement a token blocklist here if revocation is needed.
    StatusCode::NO_CONTENT
}

fn build_auth_response(user_id: Uuid, secret: &str) -> Result<Json<AuthResponse>, StatusCode> {
    let access_token =
        create_access_token(user_id, secret).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let refresh_token =
        create_refresh_token(user_id, secret).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(AuthResponse {
        access_token,
        refresh_token,
        user_id: user_id.to_string(),
    }))
}

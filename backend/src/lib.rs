pub mod auth;
pub mod db;
pub mod history;
pub mod ws;

use axum::{
    async_trait,
    extract::FromRequestParts,
    http::{request::Parts, StatusCode},
    routing::{delete, get, post},
    Router,
};
use axum_extra::{
    headers::{authorization::Bearer, Authorization},
    TypedHeader,
};
use sqlx::PgPool;
use tower_http::cors::CorsLayer;
use uuid::Uuid;

use ws::WsHub;

#[derive(Clone)]
pub struct AppState {
    pub db: PgPool,
    pub jwt_secret: String,
    pub ws_hub: WsHub,
}

pub struct AuthUser(pub Uuid);

#[async_trait]
impl FromRequestParts<AppState> for AuthUser {
    type Rejection = StatusCode;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let TypedHeader(Authorization(bearer)) =
            TypedHeader::<Authorization<Bearer>>::from_request_parts(parts, state)
                .await
                .map_err(|_| StatusCode::UNAUTHORIZED)?;

        let claims = auth::verify_token(bearer.token(), &state.jwt_secret, "access")
            .map_err(|_| StatusCode::UNAUTHORIZED)?;

        Ok(AuthUser(claims.sub))
    }
}

async fn health() -> StatusCode {
    StatusCode::OK
}

pub fn build_router(state: AppState) -> Router {
    Router::new()
        .route("/api/health", get(health))
        .route("/api/auth/register", post(auth::register))
        .route("/api/auth/login", post(auth::login))
        .route("/api/auth/refresh", post(auth::refresh))
        .route("/api/auth/logout", post(auth::logout))
        .route("/api/history", get(history::list_history))
        .route("/api/history/batch", post(history::upsert_batch))
        .route("/api/history/:id", delete(history::delete_entry))
        .route("/api/ws", get(ws::ws_handler))
        .layer(CorsLayer::permissive())
        .with_state(state)
}

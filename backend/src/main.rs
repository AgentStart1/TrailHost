use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};
use trailhost::{build_router, db, ws, AppState};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();
    tracing_subscriber::registry()
        .with(tracing_subscriber::EnvFilter::from_default_env())
        .with(tracing_subscriber::fmt::layer())
        .init();

    let database_url = std::env::var("DATABASE_URL")?;
    let jwt_secret = std::env::var("JWT_SECRET")?;
    let bind_addr = std::env::var("BIND_ADDR").unwrap_or_else(|_| "0.0.0.0:8080".into());

    let pool = db::create_pool(&database_url).await?;
    let ws_hub = ws::new_hub();
    let state = AppState { db: pool, jwt_secret, ws_hub };

    let listener = tokio::net::TcpListener::bind(&bind_addr).await?;
    tracing::info!("listening on {bind_addr}");
    axum::serve(listener, build_router(state)).await?;
    Ok(())
}

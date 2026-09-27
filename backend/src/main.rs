use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};
use trailhost::{auth, build_router, db, ws, AppState};

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
    let configured_email = non_empty_env("TRAILHOST_USER_EMAIL");
    let configured_password = non_empty_env("TRAILHOST_USER_PASSWORD");
    let registration_enabled = match (configured_email, configured_password) {
        (Some(email), Some(password)) => {
            auth::provision_user(&pool, &email, &password).await?;
            tracing::info!("environment-configured user provisioned; registration disabled");
            false
        }
        (None, None) => true,
        _ => anyhow::bail!("TRAILHOST_USER_EMAIL and TRAILHOST_USER_PASSWORD must be set together"),
    };
    let ws_hub = ws::new_hub();
    let state = AppState {
        db: pool,
        jwt_secret,
        ws_hub,
        registration_enabled,
    };

    let listener = tokio::net::TcpListener::bind(&bind_addr).await?;
    tracing::info!("listening on {bind_addr}");
    axum::serve(listener, build_router(state)).await?;
    Ok(())
}

fn non_empty_env(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|value| !value.is_empty())
}

use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt;
use serde_json::{json, Value};
use sqlx::{AssertSqlSafe, PgPool};
use testcontainers::{runners::AsyncRunner, ImageExt};
use testcontainers_modules::postgres::Postgres;
use tokio::sync::{Mutex, OnceCell};
use tower::ServiceExt;
use trailhost::{build_router, ws, AppState};

const TEST_SECRET: &str = "test_jwt_secret_at_least_32_chars!!";

struct TestPostgres {
    _container: testcontainers::ContainerAsync<Postgres>,
    port: u16,
}

// One shared container for all tests; each test gets its own database.
// Cache the mapped port with the container so parallel tests do not repeatedly
// inspect the remote Docker daemon.
static PG: OnceCell<TestPostgres> = OnceCell::const_new();
static DB_SETUP: Mutex<()> = Mutex::const_new(());

async fn create_test_pool() -> PgPool {
    // Creating a database and running its migrations is intentionally serialized.
    // The tests still execute concurrently after their isolated pools are ready.
    let _setup_guard = DB_SETUP.lock().await;
    let container = PG
        .get_or_init(|| async {
            let container = Postgres::default()
                .with_tag("16-alpine")
                .start()
                .await
                .expect("failed to start postgres container");
            let port = container
                .get_host_port_ipv4(5432)
                .await
                .expect("postgres port");
            TestPostgres {
                _container: container,
                port,
            }
        })
        .await;
    let port = container.port;

    // Create a unique database so tests are fully isolated
    let base_url = format!("postgres://postgres:postgres@127.0.0.1:{}/postgres", port);
    let root = PgPool::connect(&base_url).await.expect("root pool");
    let db_name = format!("t{}", uuid::Uuid::new_v4().simple());
    // db_name is generated from a simple UUID and cannot contain SQL syntax.
    sqlx::query(AssertSqlSafe(format!("CREATE DATABASE \"{db_name}\"")))
        .execute(&root)
        .await
        .expect("create test db");
    root.close().await;

    let url = format!(
        "postgres://postgres:postgres@127.0.0.1:{}/{}",
        port, db_name
    );
    let pool = PgPool::connect(&url).await.expect("test pool");
    sqlx::migrate!("./migrations")
        .run(&pool)
        .await
        .expect("migrations");
    pool
}

fn make_state(pool: PgPool) -> AppState {
    make_state_with_registration(pool, true)
}

fn make_state_with_registration(pool: PgPool, registration_enabled: bool) -> AppState {
    AppState {
        db: pool,
        jwt_secret: TEST_SECRET.to_string(),
        ws_hub: ws::new_hub(),
        registration_enabled,
    }
}

async fn read_json(body: Body) -> Value {
    let bytes = body.collect().await.unwrap().to_bytes();
    if bytes.is_empty() {
        return Value::Null;
    }
    serde_json::from_slice(&bytes).unwrap()
}

async fn post_json(app: axum::Router, uri: &str, body: Value) -> (StatusCode, Value) {
    let res = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(uri)
                .header("content-type", "application/json")
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = res.status();
    let json = read_json(res.into_body()).await;
    (status, json)
}

// ── Auth ──────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn register_success() {
    let app = build_router(make_state(create_test_pool().await));
    let (status, body) = post_json(
        app,
        "/api/auth/register",
        json!({ "email": "alice@example.com", "password": "password123" }),
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert!(body["access_token"].is_string());
    assert!(body["refresh_token"].is_string());
    assert!(body["user_id"].is_string());
}

#[tokio::test]
async fn register_duplicate_email() {
    let app = build_router(make_state(create_test_pool().await));
    let payload = json!({ "email": "bob@example.com", "password": "password123" });

    let (s1, _) = post_json(app.clone(), "/api/auth/register", payload.clone()).await;
    let (s2, _) = post_json(app, "/api/auth/register", payload).await;

    assert_eq!(s1, StatusCode::OK);
    assert_eq!(s2, StatusCode::CONFLICT);
}

#[tokio::test]
async fn provisioned_user_disables_registration_and_can_login() {
    let pool = create_test_pool().await;
    trailhost::auth::provision_user(&pool, "owner@example.com", "first_password")
        .await
        .unwrap();
    trailhost::auth::provision_user(&pool, "owner@example.com", "updated_password")
        .await
        .unwrap();
    let app = build_router(make_state_with_registration(pool, false));

    let (register_status, _) = post_json(
        app.clone(),
        "/api/auth/register",
        json!({ "email": "another@example.com", "password": "password123" }),
    )
    .await;
    assert_eq!(register_status, StatusCode::FORBIDDEN);

    let (old_password_status, _) = post_json(
        app.clone(),
        "/api/auth/login",
        json!({ "email": "owner@example.com", "password": "first_password" }),
    )
    .await;
    assert_eq!(old_password_status, StatusCode::UNAUTHORIZED);

    let (login_status, body) = post_json(
        app,
        "/api/auth/login",
        json!({ "email": "owner@example.com", "password": "updated_password" }),
    )
    .await;
    assert_eq!(login_status, StatusCode::OK);
    assert!(body["access_token"].is_string());
}

#[tokio::test]
async fn login_success() {
    let app = build_router(make_state(create_test_pool().await));
    let creds = json!({ "email": "carol@example.com", "password": "password123" });

    post_json(app.clone(), "/api/auth/register", creds.clone()).await;
    let (status, body) = post_json(app, "/api/auth/login", creds).await;

    assert_eq!(status, StatusCode::OK);
    assert!(body["access_token"].is_string());
}

#[tokio::test]
async fn login_wrong_password() {
    let app = build_router(make_state(create_test_pool().await));
    post_json(
        app.clone(),
        "/api/auth/register",
        json!({ "email": "dave@example.com", "password": "correct_pass" }),
    )
    .await;

    let (status, _) = post_json(
        app,
        "/api/auth/login",
        json!({ "email": "dave@example.com", "password": "wrong_pass" }),
    )
    .await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn login_unknown_email() {
    let app = build_router(make_state(create_test_pool().await));
    let (status, _) = post_json(
        app,
        "/api/auth/login",
        json!({ "email": "nobody@example.com", "password": "pass" }),
    )
    .await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn refresh_token_works() {
    let app = build_router(make_state(create_test_pool().await));
    let (_, reg) = post_json(
        app.clone(),
        "/api/auth/register",
        json!({ "email": "eve@example.com", "password": "password123" }),
    )
    .await;

    let refresh_token = reg["refresh_token"].as_str().unwrap().to_string();
    let (status, body) = post_json(
        app,
        "/api/auth/refresh",
        json!({ "refresh_token": refresh_token }),
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert!(body["access_token"].is_string());
}

#[tokio::test]
async fn refresh_with_invalid_token() {
    let app = build_router(make_state(create_test_pool().await));
    let (status, _) = post_json(
        app,
        "/api/auth/refresh",
        json!({ "refresh_token": "not.a.valid.token" }),
    )
    .await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

// ── History ───────────────────────────────────────────────────────────────────

async fn register_and_login(app: axum::Router, email: &str) -> String {
    let creds = json!({ "email": email, "password": "password123" });
    let (_, body) = post_json(app.clone(), "/api/auth/register", creds.clone()).await;
    body["access_token"].as_str().unwrap().to_string()
}

async fn authed_post(app: axum::Router, uri: &str, token: &str, body: Value) -> StatusCode {
    app.oneshot(
        Request::builder()
            .method("POST")
            .uri(uri)
            .header("content-type", "application/json")
            .header("authorization", format!("Bearer {token}"))
            .body(Body::from(body.to_string()))
            .unwrap(),
    )
    .await
    .unwrap()
    .status()
}

async fn authed_get(app: axum::Router, uri: &str, token: &str) -> (StatusCode, Value) {
    let res = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri(uri)
                .header("authorization", format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let status = res.status();
    let json = read_json(res.into_body()).await;
    (status, json)
}

#[tokio::test]
async fn history_batch_upsert_and_list() {
    let app = build_router(make_state(create_test_pool().await));
    let token = register_and_login(app.clone(), "frank@example.com").await;

    let status = authed_post(
        app.clone(),
        "/api/history/batch",
        &token,
        json!({
            "device_id": "00000000-0000-0000-0000-000000000001",
            "device_name": "Test Browser",
            "entries": [
                { "url": "https://example.com", "title": "Example", "visit_time": "2024-01-01T10:00:00Z" },
                { "url": "https://rust-lang.org", "title": "Rust", "visit_time": "2024-01-01T11:00:00Z" }
            ]
        }),
    )
    .await;

    assert_eq!(status, StatusCode::NO_CONTENT);

    let (status, body) = authed_get(app, "/api/history", &token).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body.as_array().unwrap().len(), 2);
}

#[tokio::test]
async fn history_batch_idempotent() {
    let app = build_router(make_state(create_test_pool().await));
    let token = register_and_login(app.clone(), "grace@example.com").await;

    let batch = json!({
        "device_id": "00000000-0000-0000-0000-000000000002",
        "device_name": "Test Browser",
        "entries": [
            { "url": "https://example.com", "title": "Example", "visit_time": "2024-01-01T10:00:00Z" }
        ]
    });

    authed_post(app.clone(), "/api/history/batch", &token, batch.clone()).await;
    authed_post(app.clone(), "/api/history/batch", &token, batch).await;

    let (_, body) = authed_get(app, "/api/history", &token).await;
    assert_eq!(body.as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn history_search() {
    let app = build_router(make_state(create_test_pool().await));
    let token = register_and_login(app.clone(), "heidi@example.com").await;

    authed_post(
        app.clone(),
        "/api/history/batch",
        &token,
        json!({
            "device_id": "00000000-0000-0000-0000-000000000003",
            "device_name": "Test",
            "entries": [
                { "url": "https://rust-lang.org", "title": "Rust Language", "visit_time": "2024-01-01T10:00:00Z" },
                { "url": "https://python.org", "title": "Python", "visit_time": "2024-01-01T11:00:00Z" }
            ]
        }),
    )
    .await;

    let (_, body) = authed_get(app, "/api/history?q=rust", &token).await;
    let entries = body.as_array().unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0]["url"], "https://rust-lang.org");
}

#[tokio::test]
async fn history_delete() {
    let app = build_router(make_state(create_test_pool().await));
    let token = register_and_login(app.clone(), "ivan@example.com").await;

    authed_post(
        app.clone(),
        "/api/history/batch",
        &token,
        json!({
            "device_id": "00000000-0000-0000-0000-000000000004",
            "device_name": "Test",
            "entries": [
                { "url": "https://delete-me.com", "title": "Delete me", "visit_time": "2024-01-01T10:00:00Z" }
            ]
        }),
    )
    .await;

    let (_, body) = authed_get(app.clone(), "/api/history", &token).await;
    let id = body.as_array().unwrap()[0]["id"]
        .as_str()
        .unwrap()
        .to_string();

    let status = app
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri(format!("/api/history/{id}"))
                .header("authorization", format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap()
        .status();

    assert_eq!(status, StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn history_delete_other_users_entry() {
    let app = build_router(make_state(create_test_pool().await));
    let token_a = register_and_login(app.clone(), "judy@example.com").await;
    let token_b = register_and_login(app.clone(), "karl@example.com").await;

    authed_post(
        app.clone(),
        "/api/history/batch",
        &token_a,
        json!({
            "device_id": "00000000-0000-0000-0000-000000000005",
            "device_name": "Test",
            "entries": [
                { "url": "https://judy-only.com", "title": "Private", "visit_time": "2024-01-01T10:00:00Z" }
            ]
        }),
    )
    .await;

    let (_, body) = authed_get(app.clone(), "/api/history", &token_a).await;
    let id = body.as_array().unwrap()[0]["id"]
        .as_str()
        .unwrap()
        .to_string();

    let status = app
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri(format!("/api/history/{id}"))
                .header("authorization", format!("Bearer {token_b}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap()
        .status();

    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn unauthenticated_history_request() {
    let app = build_router(make_state(create_test_pool().await));
    let res = app
        .oneshot(
            Request::builder()
                .method("GET")
                .uri("/api/history")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn health_endpoint() {
    let app = build_router(make_state(create_test_pool().await));
    let res = app
        .oneshot(
            Request::builder()
                .uri("/api/health")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(res.status(), StatusCode::OK);
}

#[tokio::test]
async fn history_batch_preserves_long_urls_and_deduplicates_retries() {
    let app = build_router(make_state(create_test_pool().await));
    let token = register_and_login(app.clone(), "long-url@example.com").await;
    // UUIDs keep the URL poorly compressible, reproducing the B-tree limit.
    let suffix: String = (0..300)
        .map(|_| uuid::Uuid::new_v4().simple().to_string())
        .collect();
    let url = format!("https://example.com/?q={suffix}");
    let other = format!("{url}x");
    let batch = json!({
        "device_id": uuid::Uuid::new_v4(), "device_name": "Test Browser",
        "entries": [
            {"url": url, "title": "Long", "visit_time": "2024-01-01T10:00:00Z"},
            {"url": other, "title": "Other", "visit_time": "2024-01-01T10:00:00Z"}
        ]
    });
    for _ in 0..2 {
        assert_eq!(
            authed_post(app.clone(), "/api/history/batch", &token, batch.clone()).await,
            StatusCode::NO_CONTENT
        );
    }
    let (status, body) = authed_get(app, "/api/history", &token).await;
    assert_eq!(status, StatusCode::OK);
    let entries = body.as_array().unwrap();
    assert_eq!(entries.len(), 2);
    assert!(entries.iter().any(|entry| entry["url"] == url));
    assert!(entries.iter().any(|entry| entry["url"] == other));
}

#[tokio::test]
async fn history_batch_rolls_back_device_and_entries_without_broadcast() {
    let pool = create_test_pool().await;
    // A deterministic database failure after the first valid entry.
    sqlx::query(
        "ALTER TABLE history_entries ADD CONSTRAINT test_reject_title CHECK (title <> 'reject')",
    )
    .execute(&pool)
    .await
    .unwrap();
    let state = make_state(pool.clone());
    let hub = state.ws_hub.clone();
    let app = build_router(state);
    let token = register_and_login(app.clone(), "rollback@example.com").await;
    let user_id: uuid::Uuid = sqlx::query_scalar("SELECT id FROM users")
        .fetch_one(&pool)
        .await
        .unwrap();
    let (sender, mut receiver) = tokio::sync::broadcast::channel(16);
    hub.lock().unwrap().insert(user_id, sender);
    let device_id = uuid::Uuid::new_v4();
    let status = authed_post(app, "/api/history/batch", &token, json!({
        "device_id": device_id, "device_name": "Test Browser",
        "entries": [
            {"url": "https://example.com/a-ok", "title": "ok", "visit_time": "2024-01-01T10:00:00Z"},
            {"url": "https://example.com/z-fail", "title": "reject", "visit_time": "2024-01-01T11:00:00Z"}
        ]
    })).await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    let entries: i64 = sqlx::query_scalar("SELECT count(*) FROM history_entries")
        .fetch_one(&pool)
        .await
        .unwrap();
    let devices: i64 = sqlx::query_scalar("SELECT count(*) FROM devices WHERE id = $1")
        .bind(device_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(entries, 0);
    assert_eq!(devices, 0);
    assert!(matches!(
        receiver.try_recv(),
        Err(tokio::sync::broadcast::error::TryRecvError::Empty)
    ));
}

#[tokio::test]
async fn history_digest_migration_preserves_existing_rows_and_deduplication() {
    let pool = create_test_pool().await;
    sqlx::raw_sql("ALTER TABLE history_entries DROP CONSTRAINT history_entries_user_url_digest_visit_key, DROP COLUMN url_sha256, ADD CONSTRAINT history_entries_user_id_url_visit_time_key UNIQUE (user_id, url, visit_time)")
        .execute(&pool).await.unwrap();
    let user_id: uuid::Uuid = sqlx::query_scalar("INSERT INTO users (email, password_hash) VALUES ('migration@example.com', 'unused') RETURNING id").fetch_one(&pool).await.unwrap();
    let device_id: uuid::Uuid =
        sqlx::query_scalar("INSERT INTO devices (user_id, name) VALUES ($1, 'Test') RETURNING id")
            .bind(user_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    let entry_id: uuid::Uuid = sqlx::query_scalar("INSERT INTO history_entries (user_id, device_id, url, title, visit_time) VALUES ($1, $2, 'https://example.com/original', 'Original', '2024-01-01T10:00:00Z') RETURNING id").bind(user_id).bind(device_id).fetch_one(&pool).await.unwrap();
    sqlx::raw_sql(include_str!("../migrations/0002_history_url_digest.sql"))
        .execute(&pool)
        .await
        .unwrap();
    let entry: (uuid::Uuid, String, String, i32) =
        sqlx::query_as("SELECT id, url, title, octet_length(url_sha256) FROM history_entries")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(
        entry,
        (
            entry_id,
            "https://example.com/original".into(),
            "Original".into(),
            32
        )
    );
    let result = sqlx::query("INSERT INTO history_entries (user_id, device_id, url, title, visit_time) VALUES ($1, $2, 'https://example.com/original', 'Retry', '2024-01-01T10:00:00Z') ON CONFLICT (user_id, url_sha256, visit_time) DO NOTHING").bind(user_id).bind(device_id).execute(&pool).await.unwrap();
    assert_eq!(result.rows_affected(), 0);
}

#[tokio::test]
async fn history_batch_concurrent_reversed_entries_do_not_deadlock() {
    let pool = create_test_pool().await;
    let app = build_router(make_state(pool.clone()));
    let token = register_and_login(app.clone(), "concurrent@example.com").await;
    let gate = (uuid::Uuid::new_v4().as_u128() & i64::MAX as u128) as i64;
    // Hold the first successful INSERT until both requests are waiting on locks.
    // Without consistent ordering, each request owns a different unique key;
    // releasing this gate then deterministically exposes the deadlock.
    sqlx::raw_sql(AssertSqlSafe(format!(
        "CREATE FUNCTION gate_history_insert() RETURNS trigger LANGUAGE plpgsql AS $$
         BEGIN PERFORM pg_advisory_xact_lock_shared({gate}); RETURN NEW; END $$;
         CREATE TRIGGER gate_history_insert AFTER INSERT ON history_entries
         FOR EACH ROW EXECUTE FUNCTION gate_history_insert();"
    )))
    .execute(&pool)
    .await
    .unwrap();
    let mut coordinator = pool.acquire().await.unwrap();
    sqlx::query("SELECT pg_advisory_lock($1)")
        .bind(gate)
        .execute(&mut *coordinator)
        .await
        .unwrap();
    let a =
        json!({"url": "https://example.com/a", "title": "A", "visit_time": "2024-01-01T10:00:00Z"});
    let b =
        json!({"url": "https://example.com/b", "title": "B", "visit_time": "2024-01-01T10:00:00Z"});
    let first =
        json!({"device_id": uuid::Uuid::new_v4(), "device_name": "First", "entries": [a, b]});
    let second =
        json!({"device_id": uuid::Uuid::new_v4(), "device_name": "Second", "entries": [b, a]});
    let release_gate =
        async {
            let ready =
                tokio::time::timeout(std::time::Duration::from_secs(10), async {
                    loop {
                        let waiting: i64 = sqlx::query_scalar(
                    "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()
                     AND wait_event_type = 'Lock' AND query LIKE 'INSERT INTO history_entries%'"
                ).fetch_one(&mut *coordinator).await.unwrap();
                        if waiting == 2 {
                            break;
                        }
                        tokio::task::yield_now().await;
                    }
                })
                .await;
            sqlx::query("SELECT pg_advisory_unlock($1)")
                .bind(gate)
                .execute(&mut *coordinator)
                .await
                .unwrap();
            ready.expect("both batches should reach the lock gate");
        };
    let (first_status, second_status, ()) = tokio::join!(
        authed_post(app.clone(), "/api/history/batch", &token, first),
        authed_post(app.clone(), "/api/history/batch", &token, second),
        release_gate,
    );
    assert_eq!(first_status, StatusCode::NO_CONTENT);
    assert_eq!(second_status, StatusCode::NO_CONTENT);
    let (status, body) = authed_get(app, "/api/history", &token).await;
    assert_eq!(status, StatusCode::OK);
    let entries = body.as_array().unwrap();
    assert_eq!(entries.len(), 2);
    assert!(entries.iter().any(|entry| entry["url"] == a["url"]));
    assert!(entries.iter().any(|entry| entry["url"] == b["url"]));
}

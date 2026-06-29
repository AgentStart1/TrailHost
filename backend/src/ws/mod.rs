use axum::{
    extract::{
        ws::{Message, WebSocket},
        Query, State, WebSocketUpgrade,
    },
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Deserialize;
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};
use tokio::sync::broadcast::{self, Sender};
use uuid::Uuid;

use crate::auth::verify_token;
use crate::history::HistoryEntry;
use crate::AppState;

pub type WsHub = Arc<Mutex<HashMap<Uuid, Sender<String>>>>;

pub fn new_hub() -> WsHub {
    Arc::new(Mutex::new(HashMap::new()))
}

pub fn broadcast(hub: &WsHub, user_id: Uuid, entries: &[HistoryEntry]) {
    let payload = serde_json::json!({
        "type": "history_sync",
        "entries": entries,
    });
    let msg = payload.to_string();

    if let Ok(hub) = hub.lock() {
        if let Some(tx) = hub.get(&user_id) {
            let _ = tx.send(msg);
        }
    }
}

#[derive(Deserialize)]
pub struct WsQuery {
    token: String,
}

pub async fn ws_handler(
    ws: WebSocketUpgrade,
    Query(q): Query<WsQuery>,
    State(state): State<AppState>,
) -> Response {
    let claims = verify_token(&q.token, &state.jwt_secret, "access");
    match claims {
        Ok(c) => ws.on_upgrade(move |socket| handle_socket(socket, c.sub, state)),
        Err(_) => StatusCode::UNAUTHORIZED.into_response(),
    }
}

async fn handle_socket(mut socket: WebSocket, user_id: Uuid, state: AppState) {
    let rx = {
        let Ok(mut hub) = state.ws_hub.lock() else { return };
        let tx = hub
            .entry(user_id)
            .or_insert_with(|| broadcast::channel(64).0)
            .clone();
        tx.subscribe()
    };
    let mut rx = rx;

    loop {
        tokio::select! {
            Ok(msg) = rx.recv() => {
                if socket.send(Message::Text(msg.into())).await.is_err() {
                    break;
                }
            }
            msg = socket.recv() => {
                match msg {
                    Some(Ok(_)) => {}
                    _ => break,
                }
            }
        }
    }

    // Remove the hub entry when the last subscriber for this user disconnects
    drop(rx);
    if let Ok(mut hub) = state.ws_hub.lock() {
        if let Some(tx) = hub.get(&user_id) {
            if tx.receiver_count() == 0 {
                hub.remove(&user_id);
            }
        }
    }
}

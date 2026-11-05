//! KeyStoneOS control plane (CLAUDE.md §1).
//!
//! Owns the WebSocket state stream to the Tauri UI (apps/desktop). It is the
//! single source the UI reads from (§9). The desktop client connects here
//! (VITE_KEYSTONE_WS=ws://localhost:8080/stream) and receives CPEvents; commands
//! (e.g. run_mission) come back over the same socket and are forwarded to
//! Temporal. NATS JetStream fans telemetry in; this plane fans it out.
//!
//! This file is the wiring skeleton: the WS endpoint, the shared state, and the
//! lease/router modules. Temporal client wiring is the marked integration point.

mod lease;
mod router;

use axum::{
    extract::ws::{Message, WebSocket, WebSocketUpgrade},
    response::IntoResponse,
    routing::get,
    Router as AxumRouter,
};
use serde::{Deserialize, Serialize};

#[derive(Serialize)]
#[serde(tag = "type")]
enum CpEvent {
    #[serde(rename = "telemetry")]
    Telemetry { telemetry: Telemetry },
}

#[derive(Serialize)]
struct Telemetry {
    #[serde(rename = "vramPct")]
    vram_pct: u32,
    #[serde(rename = "ramPct")]
    ram_pct: u32,
    #[serde(rename = "cpuPct")]
    cpu_pct: u32,
}

#[derive(Deserialize)]
#[serde(tag = "cmd")]
enum Command {
    #[serde(rename = "run_mission")]
    RunMission { source: Option<String> },
}

use axum::http::HeaderMap;
use axum::response::Response;
use axum::http::StatusCode;

const DEFAULT_BIND: &str = "127.0.0.1:8080";

/// True only when the bind address is a loopback address. Parsed, not prefix-matched,
/// so e.g. "127.0.0.1.evil.com:80" or "localhostile:80" are NOT loopback.
/// Anything unparseable is treated as non-loopback (fail closed).
fn is_loopback_bind(addr: &str) -> bool {
    if let Ok(sa) = addr.parse::<std::net::SocketAddr>() {
        return sa.ip().is_loopback();
    }
    match addr.rsplit_once(':') {
        Some((host, _port)) => host == "localhost",
        None => false,
    }
}

/// The configured auth token, or None when unset/empty/whitespace.
fn configured_token() -> Option<String> {
    std::env::var("KEYSTONE_AUTH_TOKEN")
        .ok()
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
}

/// Decide whether a request may proceed. Loopback binds need no token. A
/// non-loopback bind requires a configured non-empty token and an exact
/// "Bearer <token>" Authorization header; with no token configured nothing passes.
fn is_authorized(bind: &str, token: Option<&str>, auth_header: Option<&str>) -> bool {
    if is_loopback_bind(bind) {
        return true;
    }
    match (token, auth_header) {
        (Some(t), Some(h)) => h == format!("Bearer {t}"),
        _ => false,
    }
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();
    let addr = std::env::var("KEYSTONE_BIND").unwrap_or_else(|_| DEFAULT_BIND.to_string());

    // Fail closed: refuse to listen on a non-loopback address without a token.
    if !is_loopback_bind(&addr) && configured_token().is_none() {
        eprintln!("refusing to start: KEYSTONE_BIND={addr} is not loopback and KEYSTONE_AUTH_TOKEN is unset or empty");
        std::process::exit(1);
    }

    // Route auth policy: /healthz is intentionally open (liveness probe, returns
    // only "ok"). /stream is the only other route and is gated by is_authorized.
    let app = AxumRouter::new()
        .route("/healthz", get(|| async { "ok" }))
        .route("/stream", get(ws_handler));

    tracing::info!("KeyStoneOS control plane on {addr}");
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

async fn ws_handler(headers: HeaderMap, ws: WebSocketUpgrade) -> Response {
    let addr = std::env::var("KEYSTONE_BIND").unwrap_or_else(|_| DEFAULT_BIND.to_string());
    let token = configured_token();
    let auth = headers.get("authorization").and_then(|v| v.to_str().ok());

    if !is_authorized(&addr, token.as_deref(), auth) {
        return (StatusCode::UNAUTHORIZED, "Unauthorized").into_response();
    }

    ws.on_upgrade(handle_socket).into_response()
}

async fn handle_socket(mut socket: WebSocket) {
    // On connect, push a telemetry frame so the UI's strip is live immediately.
    let hello = serde_json::to_string(&CpEvent::Telemetry {
        telemetry: Telemetry { vram_pct: 64, ram_pct: 41, cpu_pct: 22 },
    })
    .unwrap();
    let _ = socket.send(Message::Text(hello)).await;

    // Receive commands from the UI and forward to Temporal (integration point).
    while let Some(Ok(msg)) = socket.recv().await {
        if let Message::Text(txt) = msg {
            match serde_json::from_str::<Command>(&txt) {
                Ok(Command::RunMission { source }) => {
                    tracing::info!("run_mission requested (source={:?})", source);
                    // Mock integration: send a series of simulated timeline events
                    let mock_events = vec![
                        r#"{"type": "timeline:add", "event": {"id": "1", "ts": "10:00:00", "description": "Mission requested (simulated)", "files": []}}"#,
                        r#"{"type": "timeline:add", "event": {"id": "2", "ts": "10:00:02", "description": "Acquired lease (simulated)", "files": []}}"#,
                        r#"{"type": "timeline:add", "event": {"id": "3", "ts": "10:00:05", "description": "Mission finished (simulated, no real work done)", "files": []}}"#,
                        r#"{"type": "mission", "mission": {"id": "mock-001", "status": "simulated", "branch": "mock-branch", "attempt": 1, "maxAttempts": 3, "request": "Mock run", "activity": "done"}}"#
                    ];
                    for e in mock_events {
                        let _ = socket.send(Message::Text(e.to_string())).await;
                    }
                }
                Err(e) => tracing::warn!("bad command frame: {e}"),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loopback_is_parsed_not_prefix_matched() {
        assert!(is_loopback_bind("127.0.0.1:8080"));
        assert!(is_loopback_bind("[::1]:8080"));
        assert!(is_loopback_bind("localhost:8080"));
        assert!(!is_loopback_bind("0.0.0.0:8080"));
        assert!(!is_loopback_bind("127.0.0.1.evil.com:8080"));
        assert!(!is_loopback_bind("localhostile:8080"));
        assert!(!is_loopback_bind("garbage"));
    }

    #[test]
    fn non_loopback_fails_closed_without_token() {
        // Empty bearer header must not pass when no token is configured.
        assert!(!is_authorized("0.0.0.0:8080", None, Some("Bearer ")));
        assert!(!is_authorized("0.0.0.0:8080", None, None));
        assert!(!is_authorized("0.0.0.0:8080", Some("s3cret"), Some("Bearer wrong")));
        assert!(!is_authorized("0.0.0.0:8080", Some("s3cret"), None));
        assert!(is_authorized("0.0.0.0:8080", Some("s3cret"), Some("Bearer s3cret")));
        assert!(is_authorized("127.0.0.1:8080", None, None));
    }
}

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

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();
    let app = AxumRouter::new()
        .route("/healthz", get(|| async { "ok" }))
        .route("/stream", get(ws_handler));

    let addr = "0.0.0.0:8080";
    tracing::info!("KeyStoneOS control plane on {addr}");
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

async fn ws_handler(ws: WebSocketUpgrade) -> impl IntoResponse {
    ws.on_upgrade(handle_socket)
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
                    // TODO(integration): start MissionWorkflow via the Temporal
                    // client, then stream its activity events back as CpEvents.
                }
                Err(e) => tracing::warn!("bad command frame: {e}"),
            }
        }
    }
}

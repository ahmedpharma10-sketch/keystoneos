// KeyStoneOS desktop shell — Tauri backend (CLAUDE.md §1: Tauri + React).
// Hosts the React UI (apps/desktop) in a native window. The UI reads its state
// from the control-plane WebSocket (§9); this shell only owns the window.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running KeyStoneOS");
}

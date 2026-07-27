//! Tauri / UI adapters — thin wrappers around the application core.
//! Domain logic and secrets stay in the core / OS vault, not the webview.

mod commands;
mod stub_ports;
mod tray;

pub use commands::{auth_state, save_capture, AppState};
pub use stub_ports::build_stub_core;
pub use tray::setup_tray;

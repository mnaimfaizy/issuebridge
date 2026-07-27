//! Tauri / UI adapters — thin wrappers around the application core.
//! Domain logic and secrets stay in the core / OS vault, not the webview.

mod app_core;
mod commands;
mod github_http;
mod keyring_token_store;
mod oauth_loopback;
mod tray;

pub use app_core::build_app_core;
pub use commands::{
    auth_state, save_capture, sign_in_with_github, sign_in_with_pat, sign_out, AppState,
};
pub use tray::setup_tray;

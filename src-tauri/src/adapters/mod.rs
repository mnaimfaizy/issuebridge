//! Tauri / UI adapters — thin wrappers around the application core.
//! Domain logic and secrets stay in the core / OS vault, not the webview.

mod app_core;
mod commands;
mod file_settings_store;
mod github_http;
mod keyring_token_store;
mod oauth_loopback;
mod tray;

pub use app_core::build_app_core;
pub use commands::{
    add_testing_set_repo, all_repositories_warning, app_visible_repos, auth_state,
    complete_testing_set, continue_install, first_run_step, open_app_install,
    remove_testing_set_repo, save_capture, sign_in_with_github, sign_in_with_pat, sign_out,
    testing_set, AppState,
};
pub use tray::setup_tray;

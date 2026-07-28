//! Tauri / UI adapters — thin wrappers around the application core.
//! Domain logic and secrets stay in the core / OS vault, not the webview.

mod app_core;
mod capture_window;
mod commands;
mod file_draft_store;
mod file_settings_store;
mod github_http;
mod keyring_token_store;
mod oauth_loopback;
mod tray;

pub use app_core::build_app_core;
pub use capture_window::show_capture_window;
pub use commands::{
    add_testing_set_repo, all_repositories_warning, app_visible_repos, auth_state,
    complete_testing_set, continue_install, edit_draft, first_run_step, get_draft,
    last_used_repo, list_inbox, open_app_install, publish_draft, remove_testing_set_repo,
    save_capture, show_capture, sign_in_with_github, sign_in_with_pat, sign_out, testing_set,
    AppState,
};
pub use tray::setup_tray;

//! Tauri / UI adapters — thin wrappers around the application core.
//! Domain logic and secrets stay in the core / OS vault, not the webview.

mod app_core;
mod capture_window;
mod commands;
mod file_draft_store;
mod file_label_catalog_store;
mod file_rewrite_model_store;
mod file_settings_store;
mod github_http;
mod keyring_token_store;
mod llama_rewrite;
mod oauth_loopback;
mod system_hardware_probe;
mod tray;
mod whisper_voice;

pub use app_core::build_app_core;
pub use capture_window::{show_capture_window, show_capture_window_detached};
pub use commands::{
    add_all_app_visible_to_testing_set, add_custom_rewrite_style, add_testing_set_repo,
    all_repositories_warning, app_visible_repos, apply_ptt, auth_state, cancel_rewrite,
    cancel_rewrite_model_download, complete_testing_set, continue_install, edit_draft,
    ensure_label_catalog, first_run_step, generate_rewrite, get_draft, get_rewrite_model_status,
    keep_mine, last_used_repo, list_inbox, list_rewrite_styles, open_app_install,
    prefetch_testing_set_label_catalogs, ptt_hotkey, publish_draft,
    reconcile_testing_set_with_app_visible, remember_last_rewrite_style,
    remove_custom_rewrite_style, remove_rewrite_model, remove_testing_set_repo,
    respond_rewrite_hardware_prompt, save_capture, set_active_rewrite_model, set_testing_set_max,
    show_capture, sign_in_with_github, sign_in_with_pat, sign_out, skip_try_capture,
    start_rewrite_model_download, testing_set, testing_set_max, update_linked_draft, use_theirs,
    AppState, ModelDownloadHandle,
};
pub use llama_rewrite::RewriteJobHandle;
pub use tray::setup_tray;

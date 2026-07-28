pub mod adapters;
pub mod core;

use adapters::{
    add_testing_set_repo, all_repositories_warning, app_visible_repos, auth_state, build_app_core,
    complete_testing_set, continue_install, first_run_step, open_app_install,
    remove_testing_set_repo, save_capture, setup_tray, sign_in_with_github, sign_in_with_pat,
    sign_out, testing_set, AppState,
};
use std::sync::Mutex;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState {
            core: Mutex::new(build_app_core()),
        })
        .invoke_handler(tauri::generate_handler![
            auth_state,
            first_run_step,
            sign_in_with_github,
            sign_in_with_pat,
            sign_out,
            open_app_install,
            continue_install,
            app_visible_repos,
            all_repositories_warning,
            testing_set,
            add_testing_set_repo,
            remove_testing_set_repo,
            complete_testing_set,
            save_capture
        ])
        .setup(|app| {
            setup_tray(app.handle())?;

            // Tray-first: closing the main window hides it instead of quitting.
            if let Some(window) = app.get_webview_window("main") {
                let window_for_close = window.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = window_for_close.hide();
                    }
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

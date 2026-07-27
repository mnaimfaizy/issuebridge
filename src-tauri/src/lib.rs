pub mod adapters;
pub mod core;

use adapters::{
    auth_state, build_app_core, save_capture, setup_tray, sign_in_with_github, sign_in_with_pat,
    sign_out, AppState,
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
            sign_in_with_github,
            sign_in_with_pat,
            sign_out,
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

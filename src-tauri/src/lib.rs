pub mod adapters;
pub mod core;

use adapters::{
    add_testing_set_repo, all_repositories_warning, app_visible_repos, auth_state, build_app_core,
    complete_testing_set, continue_install, edit_draft, first_run_step, get_draft, keep_mine,
    last_used_repo, list_inbox, open_app_install, publish_draft, remove_testing_set_repo,
    save_capture, setup_tray, show_capture, show_capture_window, sign_in_with_github,
    sign_in_with_pat, sign_out, testing_set, update_linked_draft, use_theirs, AppState,
};
use std::sync::Mutex;
use tauri::Manager;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
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
            save_capture,
            list_inbox,
            get_draft,
            edit_draft,
            publish_draft,
            update_linked_draft,
            keep_mine,
            use_theirs,
            last_used_repo,
            show_capture
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

            register_open_hotkey(app.handle()).map_err(|err| err.to_string())?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn register_open_hotkey(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let configured = {
        let state = app.state::<AppState>();
        let core = state.core.lock().map_err(|e| e.to_string())?;
        core.open_hotkey()
    };
    let shortcut = open_shortcut_from_setting(&configured);

    let handle = app.clone();
    app.global_shortcut().on_shortcut(shortcut, move |_app, _shortcut, event| {
        if event.state == ShortcutState::Pressed {
            let _ = show_capture_window(&handle);
        }
    })?;

    Ok(())
}

/// Maps persisted Open-hotkey setting to a Shortcut. Unknown values fall back to default.
fn open_shortcut_from_setting(setting: &str) -> Shortcut {
    // v0.1: default Ctrl+Alt+Shift+I; settings can store that string (or omit → core default).
    if setting.eq_ignore_ascii_case("Ctrl+Alt+Shift+I") {
        return Shortcut::new(
            Some(Modifiers::CONTROL | Modifiers::ALT | Modifiers::SHIFT),
            Code::KeyI,
        );
    }
    Shortcut::new(
        Some(Modifiers::CONTROL | Modifiers::ALT | Modifiers::SHIFT),
        Code::KeyI,
    )
}

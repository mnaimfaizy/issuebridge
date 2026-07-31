pub mod adapters;
pub mod core;

use adapters::{
    add_all_app_visible_to_testing_set, add_custom_rewrite_style, add_testing_set_repo,
    all_repositories_warning, app_visible_repos, apply_ptt, auth_state, build_app_core,
    complete_testing_set, continue_install, edit_draft, ensure_label_catalog, first_run_step,
    generate_rewrite, get_draft, keep_mine, last_used_repo, list_inbox, list_rewrite_styles,
    open_app_install, prefetch_testing_set_label_catalogs, ptt_hotkey, publish_draft,
    reconcile_testing_set_with_app_visible, remember_last_rewrite_style,
    remove_custom_rewrite_style, remove_testing_set_repo, save_capture, set_testing_set_max,
    setup_tray, show_capture, show_capture_window_detached, sign_in_with_github, sign_in_with_pat,
    sign_out, skip_try_capture, testing_set, testing_set_max, update_linked_draft, use_theirs,
    AppState,
};
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(AppState {
            core: Arc::new(Mutex::new(build_app_core())),
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
            testing_set_max,
            set_testing_set_max,
            add_all_app_visible_to_testing_set,
            reconcile_testing_set_with_app_visible,
            add_testing_set_repo,
            remove_testing_set_repo,
            complete_testing_set,
            skip_try_capture,
            save_capture,
            apply_ptt,
            ptt_hotkey,
            list_inbox,
            get_draft,
            ensure_label_catalog,
            prefetch_testing_set_label_catalogs,
            edit_draft,
            publish_draft,
            update_linked_draft,
            keep_mine,
            use_theirs,
            last_used_repo,
            list_rewrite_styles,
            add_custom_rewrite_style,
            remove_custom_rewrite_style,
            generate_rewrite,
            remember_last_rewrite_style,
            show_capture
        ])
        .setup(|app| {
            setup_tray(app.handle())?;

            // Tray-first: closing the main window hides it instead of quitting.
            // While first-run is incomplete, keep main visible on the current step.
            if let Some(window) = app.get_webview_window("main") {
                #[cfg(debug_assertions)]
                {
                    window.open_devtools();
                    eprintln!("[issuebridge] DevTools opened (debug build). Watch this terminal for [issuebridge] logs.");
                }

                let open_main = {
                    let state = app.state::<AppState>();
                    let core = state
                        .core
                        .lock()
                        .map_err(|e| e.to_string())?;
                    core.should_open_main_on_launch()
                };
                if !open_main {
                    let _ = window.hide();
                }

                let window_for_close = window.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = window_for_close.hide();
                    }
                });
            }

            register_open_hotkey(app.handle()).map_err(|err| err.to_string())?;
            register_ptt_hotkey(app.handle()).map_err(|err| err.to_string())?;

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
    app.global_shortcut()
        .on_shortcut(shortcut, move |_app, _shortcut, event| {
            if event.state == ShortcutState::Pressed {
                show_capture_window_detached(&handle);
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

fn register_ptt_hotkey(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let configured = {
        let state = app.state::<AppState>();
        let core = state.core.lock().map_err(|e| e.to_string())?;
        core.ptt_hotkey()
    };
    let shortcut = ptt_shortcut_from_setting(&configured);

    let handle = app.clone();
    app.global_shortcut()
        .on_shortcut(shortcut, move |app, _shortcut, event| {
            let capture_visible = app
                .get_webview_window("capture")
                .and_then(|w| w.is_visible().ok())
                .unwrap_or(false);
            if !capture_visible {
                return;
            }
            let event_name = match event.state {
                ShortcutState::Pressed => "ptt-pressed",
                ShortcutState::Released => "ptt-released",
            };
            let _ = handle.emit(event_name, ());
        })?;

    Ok(())
}

/// Maps persisted PTT-hotkey setting to a Shortcut.
/// Recognizes `Ctrl+Alt+Shift+<Letter>`; unknown values fall back to default V.
fn ptt_shortcut_from_setting(setting: &str) -> Shortcut {
    let mods = Modifiers::CONTROL | Modifiers::ALT | Modifiers::SHIFT;
    if let Some(code) = parse_ctrl_alt_shift_letter(setting) {
        return Shortcut::new(Some(mods), code);
    }
    Shortcut::new(Some(mods), Code::KeyV)
}

fn parse_ctrl_alt_shift_letter(setting: &str) -> Option<Code> {
    let rest = setting
        .trim()
        .strip_prefix("Ctrl+Alt+Shift+")
        .or_else(|| setting.trim().strip_prefix("ctrl+alt+shift+"))?;
    if rest.len() != 1 {
        return None;
    }
    match rest.chars().next()?.to_ascii_uppercase() {
        'A' => Some(Code::KeyA),
        'B' => Some(Code::KeyB),
        'C' => Some(Code::KeyC),
        'D' => Some(Code::KeyD),
        'E' => Some(Code::KeyE),
        'F' => Some(Code::KeyF),
        'G' => Some(Code::KeyG),
        'H' => Some(Code::KeyH),
        'I' => Some(Code::KeyI),
        'J' => Some(Code::KeyJ),
        'K' => Some(Code::KeyK),
        'L' => Some(Code::KeyL),
        'M' => Some(Code::KeyM),
        'N' => Some(Code::KeyN),
        'O' => Some(Code::KeyO),
        'P' => Some(Code::KeyP),
        'Q' => Some(Code::KeyQ),
        'R' => Some(Code::KeyR),
        'S' => Some(Code::KeyS),
        'T' => Some(Code::KeyT),
        'U' => Some(Code::KeyU),
        'V' => Some(Code::KeyV),
        'W' => Some(Code::KeyW),
        'X' => Some(Code::KeyX),
        'Y' => Some(Code::KeyY),
        'Z' => Some(Code::KeyZ),
        _ => None,
    }
}

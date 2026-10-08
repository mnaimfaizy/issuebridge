//! Capture popup window helper.
//!
//! On Windows, creating a Webview from a synchronous command or event handler can
//! deadlock WebView2 and leave a frozen blank window. Prefer the async command path,
//! or [`show_capture_window_detached`] from tray / hotkey handlers.

use tauri::{AppHandle, Emitter, Manager, Runtime, WebviewUrl, WebviewWindowBuilder};

pub fn show_capture_window<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("capture") {
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }

    eprintln!("[issuebridge] creating Capture window (capture.html)");
    let window = WebviewWindowBuilder::new(app, "capture", WebviewUrl::App("capture.html".into()))
        .title("Capture")
        // Default size fits the whole surface — hero, Testing-set chips, repo
        // field, Title, Body and the Save Draft / Cancel footer — so the popup
        // opens without a scrollbar. Below the default the compose region
        // scrolls on its own and the hero and footer stay put (see capture.css).
        // Mirrored by CAPTURE_DEFAULT_SIZE / CAPTURE_MIN_SIZE in src/capture/geometry.ts.
        //
        // `min_inner_size` is a hard floor, not a hint: Windows enforces it on
        // the `SetWindowPos` behind `setSize`, so a smaller request is silently
        // raised back to it. The display clamp in geometry.ts therefore never
        // returns below CAPTURE_MIN_SIZE — a size the window cannot take would
        // come back as a resize nobody asked for and be stored as the user's.
        // Letting Capture get smaller than this on a short work area means
        // lowering the floor here first, with the mirror kept in step.
        .inner_size(460.0, 640.0)
        .min_inner_size(400.0, 560.0)
        .resizable(true)
        .always_on_top(true)
        .visible(true)
        .build()
        .map_err(|e| e.to_string())?;

    #[cfg(debug_assertions)]
    {
        window.open_devtools();
        eprintln!("[issuebridge] Capture DevTools opened (debug build)");
    }

    let window_for_close = window.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            // Closing with X ends the Capture, same as Esc. The webview cannot
            // see this hide, so tell it: without the event the next show keeps
            // the ended Capture's fields, status line and caret.
            let _ = window_for_close.emit("capture-hidden", ());
            let _ = window_for_close.hide();
        }
    });

    Ok(())
}

/// Show Capture from a sync tray / hotkey handler without deadlocking WebView2 on Windows.
pub fn show_capture_window_detached<R: Runtime>(app: &AppHandle<R>) {
    let app = app.clone();
    std::thread::spawn(move || {
        if let Err(err) = show_capture_window(&app) {
            eprintln!("[issuebridge] show_capture failed: {err}");
        }
    });
}

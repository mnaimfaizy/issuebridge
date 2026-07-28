//! Capture popup window helper.

use tauri::{AppHandle, Manager, Runtime, WebviewUrl, WebviewWindowBuilder};

pub fn show_capture_window<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("capture") {
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }

    let window = WebviewWindowBuilder::new(app, "capture", WebviewUrl::App("capture.html".into()))
        .title("Capture")
        .inner_size(420.0, 480.0)
        .resizable(false)
        .always_on_top(true)
        .visible(true)
        .build()
        .map_err(|e| e.to_string())?;

    let window_for_close = window.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = window_for_close.hide();
        }
    });

    Ok(())
}

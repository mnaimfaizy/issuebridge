//! App-wide diagnostics sink and the terse macros the adapters emit through.
//!
//! # Why this exists
//!
//! Every adapter reports trouble with a `[issuebridge] <component>: …` line.
//! Historically those were `eprintln!`, which only survives under `tauri dev`:
//! an official NSIS Release sets `windows_subsystem = "windows"`
//! (`src-tauri/src/main.rs`), so the process has no stderr handle and every line
//! is discarded. On the Windows-first primary platform that left maintainers and
//! users with no trace of a failed publish, a dead OAuth exchange, or a sidecar
//! that would not die.
//!
//! [`install`] attaches `tauri-plugin-log` once at startup so those same lines
//! land in a rotating file under the per-user app log dir in *every* build, while
//! still echoing to stderr under `tauri dev`. The call sites do not change shape:
//! they emit through the [`diag_warn!`], [`diag_error!`], and [`diag_info!`]
//! macros below, which route to the `log` facade under the shared `issuebridge`
//! target so a line reads `[issuebridge][WARN] <component>: …`.
//!
//! # Why the `log` facade and not a passed-in handle
//!
//! Many call sites are free functions or adapters with no `AppHandle` in scope
//! (`process_kill::kill_process`, the whisper/llama sidecar run loops). A sink
//! that had to be threaded through as an argument could not reach them. The `log`
//! crate's macros are global, so a terminate deep in a worker thread logs the
//! same way a command handler does.
//!
//! # Policy
//!
//! - **Level:** `Debug` under `tauri dev`, `Info` in release — info/warn/error
//!   are kept on disk; chatty breadcrumbs stay in dev.
//! - **File:** `issuebridge.log` under `app_log_dir()` (per-user; on Windows
//!   `%LOCALAPPDATA%\<identifier>\logs`), rotated at ~5 MiB keeping one backup.
//! - **Stderr:** also attached, so the existing `tauri dev` "watch the terminal"
//!   flow is unchanged; in release the process has no stderr and it is a no-op.
//!
//! Migration is incremental: the highest-value signals (failed sidecar
//! terminate, OAuth/publish errors) route through here now; the remaining
//! informational `eprintln!` breadcrumbs are swept in a follow-up.

/// The shared `log` target for every app diagnostic, so a filter or a grep can
/// isolate our lines from any dependency's logging.
pub(crate) const DIAG_TARGET: &str = "issuebridge";

/// Build the configured `tauri-plugin-log` plugin. Attached once in
/// `adapters::setup` / `lib::run`; see the module docs for the policy.
pub(crate) fn plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    use tauri_plugin_log::{Target, TargetKind};

    // Debug breadcrumbs under `tauri dev`; info and above in release.
    let level = if cfg!(debug_assertions) {
        log::LevelFilter::Debug
    } else {
        log::LevelFilter::Info
    };

    tauri_plugin_log::Builder::new()
        .level(level)
        .max_file_size(5 * 1024 * 1024)
        .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepOne)
        .target(Target::new(TargetKind::Stderr))
        .target(Target::new(TargetKind::LogDir {
            file_name: Some("issuebridge".into()),
        }))
        .build()
}

/// Warn-level app diagnostic: a recoverable failure worth a trace in release
/// (failed sidecar terminate, a GitHub error response). `component` is the
/// `[issuebridge] <component>:` tag (`rewrite`, `whisper`, `OAuth`, …).
///
/// `crate::diag_warn!(component, "fmt", args…)`.
#[macro_export]
macro_rules! diag_warn {
    ($component:expr, $($arg:tt)+) => {
        ::log::warn!(target: $crate::adapters::DIAG_TARGET, "{}: {}", $component, format_args!($($arg)+))
    };
}

/// Error-level app diagnostic: a request or parse that failed outright
/// (network/transport error, malformed response). Same shape as [`diag_warn!`].
#[macro_export]
macro_rules! diag_error {
    ($component:expr, $($arg:tt)+) => {
        ::log::error!(target: $crate::adapters::DIAG_TARGET, "{}: {}", $component, format_args!($($arg)+))
    };
}

/// Info-level app diagnostic: a successful milestone worth keeping in release
/// (publish ok, OAuth exchange ok). Same shape as [`diag_warn!`].
#[macro_export]
macro_rules! diag_info {
    ($component:expr, $($arg:tt)+) => {
        ::log::info!(target: $crate::adapters::DIAG_TARGET, "{}: {}", $component, format_args!($($arg)+))
    };
}

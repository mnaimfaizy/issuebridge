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
//! - **Level:** our `issuebridge` target is `Debug` under `tauri dev` and `Info`
//!   in release; every other crate logging through the `log` facade is capped at
//!   `Warn` so dependency chatter cannot crowd our lines out of the file.
//! - **File:** `issuebridge.log` under `app_log_dir()` (per-user; on Windows
//!   `%LOCALAPPDATA%\<identifier>\logs`), rotated at ~5 MiB keeping the newest
//!   few files (so the lead-up to a failure survives a rollover).
//! - **Stderr:** also attached, so the existing `tauri dev` "watch the terminal"
//!   flow is unchanged; in release the process has no stderr and it is a no-op.
//! - **Non-fatal:** attaching the file sink can fail (an unwritable or occupied
//!   log dir). `lib::run` attaches it so that failure degrades to no sink rather
//!   than taking the app down — a diagnostics sink must never block launch.
//!
//! Migration is incremental: the highest-value signals (failed sidecar
//! terminate, OAuth/publish/sign-in/voice errors) route through here now; the
//! remaining informational `eprintln!` breadcrumbs are swept in a follow-up.

/// The shared `log` target for every app diagnostic, so a filter or a grep can
/// isolate our lines from any dependency's logging.
pub(crate) const DIAG_TARGET: &str = "issuebridge";

/// The verbosity for our own [`DIAG_TARGET`] lines: `Debug` breadcrumbs under
/// `tauri dev`, `Info` and above in release. Extracted from [`plugin`] so the
/// policy is unit-testable without standing up a Tauri runtime (the built plugin
/// is otherwise opaque and has no test double).
const fn diag_level() -> log::LevelFilter {
    if cfg!(debug_assertions) {
        log::LevelFilter::Debug
    } else {
        log::LevelFilter::Info
    }
}

/// Build the configured `tauri-plugin-log` plugin. Attached once from `lib::run`'s
/// setup hook, where a file-target failure can be caught and degraded rather than
/// panicking the launch; see the module docs for the policy.
pub(crate) fn plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    use tauri_plugin_log::{Target, TargetKind};

    tauri_plugin_log::Builder::new()
        // `Builder::new()` ships default targets: `Stdout` and a
        // `LogDir { file_name: None }` that writes `<productName>.log`
        // (`Issuebridge.log`). `.target()` *appends*, so without clearing first
        // our `issuebridge.log` would run alongside `Issuebridge.log` — the same
        // path on case-insensitive NTFS, held open by two append handles, which
        // doubles every written line and halves the retained history. Start from
        // an empty target set and declare exactly the two we want.
        .clear_targets()
        // Our own lines: Debug breadcrumbs under `tauri dev`, Info and above in
        // release. Dependency crates (`reqwest`, `hyper`, `tao`, `wry`, …) that
        // also log through the `log` facade are capped at `Warn` so they cannot
        // crowd our diagnostics out of the file budget — `level_for` scopes the
        // verbose level to `DIAG_TARGET`, making the shared target do real work.
        .level(log::LevelFilter::Warn)
        .level_for(DIAG_TARGET, diag_level())
        .max_file_size(5 * 1024 * 1024)
        // Keep the active file plus the newest few rolled-over backups: on
        // rollover the current log is renamed with a timestamp and `KeepSome(3)`
        // retains three such backups. `KeepOne` would *delete* the previous file
        // on rollover, discarding the lead-up to the very failure the sink exists
        // to preserve.
        .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepSome(3))
        .target(Target::new(TargetKind::Stderr))
        .target(Target::new(TargetKind::LogDir {
            file_name: Some("issuebridge".into()),
        }))
        .build()
}

// These are deliberately *not* `#[macro_export]`. That attribute publishes a
// macro at the crate root as part of the public API, but every body expands to
// `$crate::adapters::DIAG_TARGET`, which is `pub(crate)` — so any expansion from
// outside this crate (an integration test under `src-tauri/tests/`, a future
// consumer) would fail to compile with E0603. `macro_rules!` + `pub(crate) use`
// scopes the macros to exactly their real audience, matching `DIAG_TARGET`'s
// visibility. They are re-exported up to the crate root (`adapters/mod.rs`,
// `lib.rs`) so call sites keep using `crate::diag_warn!`.

/// Warn-level app diagnostic: a recoverable failure worth a trace in release
/// (failed sidecar terminate, a GitHub error response). `component` is the
/// `[issuebridge] <component>:` tag (`rewrite`, `whisper`, `OAuth`, …).
///
/// `crate::diag_warn!(component, "fmt", args…)`.
macro_rules! diag_warn {
    ($component:expr, $($arg:tt)+) => {
        ::log::warn!(target: $crate::adapters::DIAG_TARGET, "{}: {}", $component, format_args!($($arg)+))
    };
}

/// Error-level app diagnostic: a request or parse that failed outright
/// (network/transport error, malformed response). Same shape as [`diag_warn!`].
macro_rules! diag_error {
    ($component:expr, $($arg:tt)+) => {
        ::log::error!(target: $crate::adapters::DIAG_TARGET, "{}: {}", $component, format_args!($($arg)+))
    };
}

/// Info-level app diagnostic: a milestone worth keeping in release (publish ok,
/// a keyring round-trip, sign-in load outcomes). Same shape as [`diag_warn!`].
macro_rules! diag_info {
    ($component:expr, $($arg:tt)+) => {
        ::log::info!(target: $crate::adapters::DIAG_TARGET, "{}: {}", $component, format_args!($($arg)+))
    };
}

pub(crate) use diag_error;
pub(crate) use diag_info;
pub(crate) use diag_warn;

#[cfg(test)]
mod tests {
    use super::diag_level;

    #[test]
    fn diag_target_is_verbose_in_dev_builds() {
        // Unit tests compile with `debug_assertions` on — the `tauri dev`
        // configuration — so the policy must resolve to Debug here. This locks
        // the dev/release split that `plugin()` feeds into `level_for`, the one
        // branch of this module reachable without a real Tauri runtime.
        assert_eq!(diag_level(), log::LevelFilter::Debug);
    }
}

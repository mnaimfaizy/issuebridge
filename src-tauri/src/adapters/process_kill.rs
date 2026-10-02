//! Best-effort termination of the Rewrite/PTT sidecars that leaves a trace when
//! it genuinely fails.
//!
//! `kill_process(tag, pid)` owns the platform terminate command — the `cfg`
//! split, the `taskkill`/`kill` argv, and hiding the console window — so the
//! adapters do not each carry a copy. It is reached from the Rewrite **cancel**
//! path (`RewriteJobHandle::cancel`) and from the wait-failure / timeout arms of
//! both sidecars' run loops. Whisper has no cancel port — `VoiceTranscriber` only
//! transcribes — so its two call sites are the mutually exclusive timeout and
//! wait-failure arms of `run_with_timeout`, not a cancel.
//!
//! An "already gone" pid counts as success, not failure. On the cancel path a pid
//! can be terminated when it is already dead: a sidecar that exited on its own
//! just as the timeout fired. (A double cancel of the same pid used to be the main
//! source; `RewriteJobHandle` now claims the pid before killing, so that no longer
//! reaches here.) This allowance is a Rewrite-shaped concession applied to whisper
//! too — for whisper an already-gone pid is anomalous, but silencing it is better
//! than a false "did not take effect" on the common exit race.
//!
//! The failure is logged through the app's `[issuebridge]` channel via
//! [`crate::diag_warn!`], which `adapters::diagnostics` routes to a rotating file
//! under the per-user app log dir in every build — so the warning survives on a
//! release build (`windows_subsystem = "windows"`), not just under `tauri dev`.

use std::process::{Command, ExitStatus, Stdio};

use crate::adapters::system_exec::system_command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// Avoid a flashing console window when spawning the terminate helper.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Terminate `pid` with the platform's stock tool, logging only when the
/// terminate did not clearly take effect. `tag` is the `[issuebridge] <tag>:` log
/// component (`rewrite` / `whisper`). Best-effort: the caller does not block on
/// re-checking the pid.
pub(crate) fn kill_process(tag: &str, pid: u32) {
    if let Some(reason) = failure_reason(terminate_command(pid).status()) {
        crate::diag_warn!(
            tag,
            "terminate pid={pid} may not have taken effect: {reason}"
        );
    }
}

#[cfg(windows)]
fn terminate_command(pid: u32) -> Command {
    let mut command = system_command("taskkill");
    command
        .args(["/PID", &pid.to_string(), "/F"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW);
    command
}

#[cfg(not(windows))]
fn terminate_command(pid: u32) -> Command {
    let mut command = system_command("kill");
    command
        .args(["-9", &pid.to_string()])
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    command
}

/// `None` when the terminate left no child behind — a clean kill or an
/// already-gone pid; `Some(reason)` when it never ran (missing binary) or, on
/// Windows, failed for a real reason. Thin wiring over [`left_no_child`] so the
/// platform decision is one pure function testable on any host.
fn failure_reason(result: std::io::Result<ExitStatus>) -> Option<String> {
    match result {
        Ok(status) if left_no_child(status.code(), cfg!(windows)) => None,
        Ok(status) => Some(format!("terminate command exited with {status}")),
        Err(err) => Some(format!("terminate command failed to run: {err}")),
    }
}

/// Whether a terminate exit `code` means no child remains. Pure and platform-
/// parameterised so both tables run on Linux CI, where the `#[cfg(windows)]`
/// runtime path is never compiled.
///
/// Windows `taskkill /F`: 0 = killed, 128 = the pid was already gone — both leave
/// no child; any other code (1 = access denied, or a process caught mid-exit) is
/// a real failure. Non-Windows `kill`: a non-zero exit cannot distinguish ESRCH
/// from other errors, and SIGKILL to our own child never leaves it running, so
/// every exit means the child is gone — the only detectable failure there is the
/// spawn error (missing binary), handled by [`failure_reason`].
fn left_no_child(code: Option<i32>, windows: bool) -> bool {
    !windows || matches!(code, Some(0) | Some(128))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_table_keeps_only_killed_or_already_gone() {
        assert!(left_no_child(Some(0), true), "0 = killed");
        assert!(left_no_child(Some(128), true), "128 = already gone");
        assert!(
            !left_no_child(Some(1), true),
            "1 = access denied is a failure"
        );
        assert!(!left_no_child(Some(255), true), "other codes are failures");
        assert!(
            !left_no_child(None, true),
            "no exit code is a failure on Windows"
        );
    }

    #[test]
    fn unix_table_treats_every_exit_as_gone() {
        assert!(left_no_child(Some(0), false));
        assert!(left_no_child(Some(1), false));
        assert!(left_no_child(Some(255), false));
        assert!(left_no_child(None, false));
    }

    #[test]
    fn spawn_failure_is_reported() {
        // The terminate binary was missing, so the command never ran. This is the
        // one failure detectable on every platform, and must not be forgiven.
        let err = std::io::Error::new(std::io::ErrorKind::NotFound, "no terminate binary");
        let reason = failure_reason(Err(err));
        assert!(reason.is_some(), "a spawn failure must be surfaced");
        assert!(reason.unwrap().contains("failed to run"));
    }
}

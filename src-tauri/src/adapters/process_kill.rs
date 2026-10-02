//! Best-effort child termination that leaves a trace when it fails.
//!
//! The Rewrite and PTT cancel/timeout paths call `kill_process(pid)` and then
//! report the sidecar cancelled regardless of whether the terminate command
//! actually ran. When it discards the result, a failed kill — the resolved
//! system binary missing, or the pid already reaped/reused — is indistinguishable
//! from success, so the UI says "cancelled" while `llama-cli`/`whisper-cli` may
//! still be running to its full timeout holding the GGUF and the GPU. This keeps
//! the terminate best-effort (the cancel path does not block on re-checking the
//! pid) and logs a *genuine* failure — distinguished from the already-gone pid a
//! healthy cancel produces — through the app's `[issuebridge]` diagnostic channel.
//!
//! That channel is only attached under `tauri dev`: an official build runs with
//! `windows_subsystem = "windows"` (no stderr handle) and the project has no log
//! sink, so the line is discarded there. Surfacing a failed terminate to a user
//! on a release build therefore waits on an app-wide log sink, tracked
//! separately; this change makes the signal correct and testable so that sink has
//! something accurate to carry.

use std::process::{Command, ExitStatus};

/// Run `command` to terminate `pid`, logging when it did not clearly take
/// effect. `component` is the log tag (`whisper` / `rewrite`) matching the
/// `[issuebridge] <component>: …` lines the caller already emits.
pub(crate) fn report_termination(component: &str, pid: u32, mut command: Command) {
    if let Some(reason) = failure_reason(command.status()) {
        eprintln!(
            "[issuebridge] {component}: terminate pid={pid} may not have taken effect: {reason}"
        );
    }
}

/// `None` when the terminate left no child behind — a clean kill, or an
/// "already gone" result, which on the cancel path is success, not failure.
/// `Some(reason)` is a terminate that never ran (missing binary) or, on Windows,
/// a genuinely failing exit. Split out so both branches are unit-testable
/// without spawning a real victim process.
///
/// Already-gone is reachable on the healthy path: `RewriteJobHandle::cancel`
/// kills the stored pid without clearing it, so a second cancel — or a user
/// cancel racing the backend timeout branch — issues a second kill against a pid
/// that is already dead. Flagging that as a failure would devalue the signal.
fn failure_reason(result: std::io::Result<ExitStatus>) -> Option<String> {
    match result {
        Ok(status) if terminate_left_no_child(&status) => None,
        Ok(status) => Some(format!("terminate command exited with {status}")),
        Err(err) => Some(format!("terminate command failed to run: {err}")),
    }
}

/// Whether the terminate command's exit means no child remains (the cancel
/// worked), covering both a clean kill and a pid that was already gone.
#[cfg(windows)]
fn terminate_left_no_child(status: &ExitStatus) -> bool {
    // `taskkill /F`: 0 = killed, 128 = the pid no longer existed. Both leave no
    // child; other non-zero codes (e.g. 1 = access denied) are real failures.
    matches!(status.code(), Some(0) | Some(128))
}

/// `kill` reports failure only through a non-zero exit and cannot tell ESRCH
/// (already gone) from other errors by code; SIGKILL to our own child never
/// leaves it running, so any exit here means the child is gone. The actionable
/// failure on this platform is the spawn error (missing binary), handled above.
#[cfg(not(windows))]
fn terminate_left_no_child(status: &ExitStatus) -> bool {
    let _ = status;
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    // A command that exits 0 / non-zero on the test host, without depending on a
    // constructable `ExitStatus` (which has no cross-platform public constructor).
    fn exit_command(code: u8) -> Command {
        #[cfg(windows)]
        {
            let mut command = Command::new("cmd");
            command.args(["/C", "exit", &code.to_string()]);
            command
        }
        #[cfg(not(windows))]
        {
            let mut command = Command::new("sh");
            command.args(["-c", &format!("exit {code}")]);
            command
        }
    }

    #[test]
    fn missing_terminate_binary_is_reported_as_failure() {
        // The reviewer's scenario: the resolved terminate binary is absent, so
        // the spawn itself fails. A cancel must not report success over this.
        let mut command = Command::new("issuebridge-no-such-terminator-xyz");
        let reason = failure_reason(command.status());
        assert!(reason.is_some(), "expected a failure reason");
        assert!(
            reason.unwrap().contains("failed to run"),
            "spawn failure should be named"
        );
    }

    #[test]
    fn zero_exit_is_treated_as_success() {
        let reason = failure_reason(exit_command(0).status());
        assert_eq!(reason, None);
    }

    // `taskkill /F` exits 128 for a pid that is already gone — the cancel worked.
    #[cfg(windows)]
    #[test]
    fn already_gone_exit_128_is_success_on_windows() {
        let reason = failure_reason(exit_command(128).status());
        assert_eq!(reason, None, "an already-gone pid is not a failure");
    }

    // A non-zero taskkill exit other than 128 (e.g. 1 = access denied) is real.
    #[cfg(windows)]
    #[test]
    fn genuine_nonzero_exit_is_failure_on_windows() {
        let reason = failure_reason(exit_command(1).status());
        assert!(
            reason.is_some(),
            "a genuine terminate failure must be surfaced"
        );
    }

    // `kill` cannot distinguish already-gone from other errors by exit code, and
    // SIGKILL to our own child never leaves it alive, so any exit means gone.
    #[cfg(not(windows))]
    #[test]
    fn nonzero_kill_exit_is_treated_as_already_gone_on_unix() {
        let reason = failure_reason(exit_command(1).status());
        assert_eq!(reason, None, "an already-gone pid is not a failure");
    }

    #[test]
    fn report_termination_over_a_missing_binary_does_not_panic() {
        // The public entry point must stay infallible on the cancel path.
        report_termination(
            "test",
            std::process::id(),
            Command::new("issuebridge-no-such-xyz"),
        );
    }
}

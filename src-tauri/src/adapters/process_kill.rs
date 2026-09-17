//! Best-effort child termination that leaves a trace when it fails.
//!
//! The Rewrite and PTT cancel/timeout paths call `kill_process(pid)` and then
//! report the sidecar cancelled regardless of whether the terminate command
//! actually ran. When it discards the result, a failed kill — the resolved
//! system binary missing, or the pid already reaped/reused — is indistinguishable
//! from success, so the UI says "cancelled" while `llama-cli`/`whisper-cli` may
//! still be running to its full timeout holding the GGUF and the GPU. This keeps
//! the terminate best-effort (the cancel path does not block on re-checking the
//! pid) but logs when it did not clearly take effect, so the failure is visible.

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

/// `None` when the terminate command ran and reported success; `Some(reason)`
/// when it failed to start (missing binary) or exited non-zero (e.g. the pid
/// was already gone). Split out so the failure branch is unit-testable without
/// spawning a real victim process.
fn failure_reason(result: std::io::Result<ExitStatus>) -> Option<String> {
    match result {
        Ok(status) if status.success() => None,
        Ok(status) => Some(format!("terminate command exited with {status}")),
        Err(err) => Some(format!("terminate command failed to run: {err}")),
    }
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

    #[test]
    fn nonzero_exit_is_reported_as_failure() {
        let reason = failure_reason(exit_command(1).status());
        assert!(
            reason.is_some(),
            "a non-zero terminate exit must be surfaced"
        );
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

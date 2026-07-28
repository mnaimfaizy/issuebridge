//! Whisper `base` transcription via bundled `whisper-cli` + `ggml-base.bin`.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

use crate::core::{VoiceError, VoiceTranscriber};

const DEFAULT_TIMEOUT: Duration = Duration::from_secs(60);

/// Runs offline Whisper transcription against a 16-bit WAV file.
#[derive(Debug, Clone)]
pub struct WhisperVoiceTranscriber {
    timeout: Duration,
}

impl Default for WhisperVoiceTranscriber {
    fn default() -> Self {
        Self {
            timeout: DEFAULT_TIMEOUT,
        }
    }
}

impl VoiceTranscriber for WhisperVoiceTranscriber {
    fn transcribe(&self, audio_path: &str) -> Result<String, VoiceError> {
        let audio = Path::new(audio_path);
        if !audio.is_file() {
            return Err(VoiceError::SidecarFailed);
        }

        let sidecar = resolve_sidecar_path().ok_or(VoiceError::SidecarFailed)?;
        let model = resolve_model_path().ok_or(VoiceError::SidecarFailed)?;

        let mut command = Command::new(&sidecar);
        command
            .arg("-m")
            .arg(&model)
            .arg("-f")
            .arg(audio)
            .arg("-nt")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let output = run_with_timeout(command, self.timeout)?;
        if !output.status.success() {
            return Err(VoiceError::SidecarFailed);
        }

        let text = String::from_utf8_lossy(&output.stdout);
        let transcript = extract_transcript(&text);
        if transcript.is_empty() {
            return Err(VoiceError::EmptyTranscript);
        }
        Ok(transcript)
    }
}

fn run_with_timeout(
    mut command: Command,
    timeout: Duration,
) -> Result<std::process::Output, VoiceError> {
    let child = command.spawn().map_err(|_| VoiceError::SidecarFailed)?;
    let pid = child.id();
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        let _ = tx.send(child.wait_with_output());
    });

    match rx.recv_timeout(timeout) {
        Ok(Ok(output)) => Ok(output),
        Ok(Err(_)) | Err(_) => {
            kill_process(pid);
            Err(VoiceError::SidecarFailed)
        }
    }
}

fn kill_process(pid: u32) {
    #[cfg(windows)]
    {
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/F"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    #[cfg(not(windows))]
    {
        let _ = Command::new("kill")
            .args(["-9", &pid.to_string()])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
}

/// Prefer stdout lines that look like spoken text; ignore whisper.cpp banners.
fn extract_transcript(stdout: &str) -> String {
    let mut lines: Vec<&str> = stdout
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .filter(|line| !line.starts_with("whisper_"))
        .filter(|line| !line.starts_with("main:"))
        .filter(|line| !line.starts_with("system_info:"))
        .filter(|line| !line.starts_with("ggml_"))
        .collect();

    // Drop common leading meta lines that mention model load.
    while lines
        .first()
        .is_some_and(|l| l.contains("loading model") || l.starts_with("operator"))
    {
        lines.remove(0);
    }

    lines.join(" ").trim().to_string()
}

fn resolve_sidecar_path() -> Option<PathBuf> {
    if let Ok(path) = std::env::var("ISSUEBRIDGE_WHISPER_CLI") {
        let p = PathBuf::from(path);
        if p.is_file() {
            return Some(p);
        }
    }

    let candidates = sidecar_candidates();
    candidates.into_iter().find(|p| p.is_file())
}

fn resolve_model_path() -> Option<PathBuf> {
    if let Ok(path) = std::env::var("ISSUEBRIDGE_WHISPER_MODEL") {
        let p = PathBuf::from(path);
        if p.is_file() {
            return Some(p);
        }
    }

    model_candidates().into_iter().find(|p| p.is_file())
}

fn sidecar_candidates() -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            out.push(dir.join("whisper-cli.exe"));
            out.push(dir.join("whisper-cli-x86_64-pc-windows-msvc.exe"));
            out.push(dir.join("binaries").join("whisper-cli-x86_64-pc-windows-msvc.exe"));
        }
    }
    // Dev layout relative to cwd / crate.
    out.push(PathBuf::from("binaries/whisper-cli-x86_64-pc-windows-msvc.exe"));
    out.push(PathBuf::from("src-tauri/binaries/whisper-cli-x86_64-pc-windows-msvc.exe"));
    out
}

fn model_candidates() -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            out.push(dir.join("resources").join("models").join("ggml-base.bin"));
            out.push(dir.join("ggml-base.bin"));
        }
    }
    out.push(PathBuf::from("resources/models/ggml-base.bin"));
    out.push(PathBuf::from("src-tauri/resources/models/ggml-base.bin"));
    out
}

/// Write WAV bytes to a unique temp path under the given directory.
pub fn write_temp_wav(dir: &Path, wav_bytes: &[u8]) -> Result<PathBuf, VoiceError> {
    std::fs::create_dir_all(dir).map_err(|_| VoiceError::SidecarFailed)?;
    let path = dir.join(format!(
        "ptt-{}.wav",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    ));
    let mut file = std::fs::File::create(&path).map_err(|_| VoiceError::SidecarFailed)?;
    file.write_all(wav_bytes)
        .map_err(|_| VoiceError::SidecarFailed)?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_transcript_joins_spoken_lines() {
        let stdout = "\
whisper_init: loading model
main: processing
hello from the mic
more words
";
        assert_eq!(extract_transcript(stdout), "hello from the mic more words");
    }
}

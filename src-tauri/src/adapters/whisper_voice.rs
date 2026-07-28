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
            eprintln!("[issuebridge] whisper: audio missing at {audio_path}");
            return Err(VoiceError::SidecarFailed);
        }

        let sidecar = resolve_sidecar_path().ok_or_else(|| {
            eprintln!("[issuebridge] whisper: sidecar not found (run scripts/fetch-whisper-assets.ps1)");
            VoiceError::SidecarFailed
        })?;
        let model = resolve_model_path().ok_or_else(|| {
            eprintln!("[issuebridge] whisper: model not found (run scripts/fetch-whisper-assets.ps1)");
            VoiceError::SidecarFailed
        })?;

        // Absolute paths: we set cwd to the sidecar dir so Windows finds ggml/whisper DLLs.
        let audio_abs = absolute_path(audio);
        let model_abs = absolute_path(&model);

        eprintln!(
            "[issuebridge] whisper: cli={} model={}",
            sidecar.display(),
            model_abs.display()
        );

        let mut command = Command::new(&sidecar);
        command
            .arg("-m")
            .arg(&model_abs)
            .arg("-f")
            .arg(&audio_abs)
            .arg("-nt")
            .arg("-l")
            .arg(whisper_language())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        // Windows loads ggml/whisper DLLs from the exe dir, then PATH.
        if let Some(dir) = sidecar.parent() {
            command.current_dir(dir);
            prepend_path_env(&mut command, dir);
        }
        for dll_dir in dll_search_dirs() {
            prepend_path_env(&mut command, &dll_dir);
        }

        let output = run_with_timeout(command, self.timeout)?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            eprintln!(
                "[issuebridge] whisper: exit={:?} stderr={}",
                output.status.code(),
                truncate_for_log(&stderr)
            );
            return Err(VoiceError::SidecarFailed);
        }

        let text = String::from_utf8_lossy(&output.stdout);
        let transcript = extract_transcript(&text);
        if transcript.is_empty() {
            eprintln!("[issuebridge] whisper: empty transcript");
            return Err(VoiceError::EmptyTranscript);
        }
        eprintln!(
            "[issuebridge] whisper: ok transcript_len={}",
            transcript.len()
        );
        Ok(transcript)
    }
}

fn prepend_path_env(command: &mut Command, dir: &Path) {
    let key = if cfg!(windows) { "Path" } else { "PATH" };
    let sep = if cfg!(windows) { ";" } else { ":" };
    let dir = dir.to_string_lossy();
    let joined = match std::env::var_os(key) {
        Some(existing) => format!("{dir}{sep}{}", existing.to_string_lossy()),
        None => dir.into_owned(),
    };
    command.env(key, joined);
}

fn run_with_timeout(
    mut command: Command,
    timeout: Duration,
) -> Result<std::process::Output, VoiceError> {
    let child = command.spawn().map_err(|err| {
        eprintln!("[issuebridge] whisper: spawn failed: {err}");
        VoiceError::SidecarFailed
    })?;
    let pid = child.id();
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        let _ = tx.send(child.wait_with_output());
    });

    match rx.recv_timeout(timeout) {
        Ok(Ok(output)) => Ok(output),
        Ok(Err(err)) => {
            eprintln!("[issuebridge] whisper: wait failed: {err}");
            kill_process(pid);
            Err(VoiceError::SidecarFailed)
        }
        Err(_) => {
            eprintln!("[issuebridge] whisper: timed out after {timeout:?}");
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
        .filter(|line| !line.starts_with("load_backend:"))
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

    // Prefer a copy that sits next to ggml/whisper DLLs (dev binaries folder).
    sidecar_candidates()
        .into_iter()
        .find(|p| p.is_file() && sidecar_has_dlls(p))
        .or_else(|| sidecar_candidates().into_iter().find(|p| p.is_file()))
}

fn sidecar_has_dlls(exe: &Path) -> bool {
    let Some(dir) = exe.parent() else {
        return false;
    };
    dir.join("ggml.dll").is_file() && dir.join("whisper.dll").is_file()
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
    // Dev layout first so we pick the DLL-complete binaries folder over a bare
    // target/debug/whisper-cli.exe copy from Tauri.
    out.push(PathBuf::from("src-tauri/binaries/whisper-cli-x86_64-pc-windows-msvc.exe"));
    out.push(PathBuf::from("binaries/whisper-cli-x86_64-pc-windows-msvc.exe"));
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            out.push(dir.join("whisper-cli.exe"));
            out.push(dir.join("whisper-cli-x86_64-pc-windows-msvc.exe"));
            out.push(dir.join("binaries").join("whisper-cli-x86_64-pc-windows-msvc.exe"));
        }
    }
    out
}

fn model_candidates() -> Vec<PathBuf> {
    let mut out = Vec::new();
    out.push(PathBuf::from("src-tauri/resources/models/ggml-base.bin"));
    out.push(PathBuf::from("resources/models/ggml-base.bin"));
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            out.push(dir.join("resources").join("models").join("ggml-base.bin"));
            out.push(dir.join("ggml-base.bin"));
        }
    }
    out
}

fn dll_search_dirs() -> Vec<PathBuf> {
    let mut out = Vec::new();
    out.push(PathBuf::from("src-tauri/binaries"));
    out.push(PathBuf::from("binaries"));
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            out.push(dir.to_path_buf());
            out.push(dir.join("binaries"));
            out.push(dir.join("resources"));
        }
    }
    out.into_iter().filter(|p| p.is_dir()).collect()
}

fn absolute_path(path: &Path) -> PathBuf {
    let abs = std::fs::canonicalize(path).unwrap_or_else(|_| {
        if path.is_absolute() {
            path.to_path_buf()
        } else {
            std::env::current_dir()
                .map(|cwd| cwd.join(path))
                .unwrap_or_else(|_| path.to_path_buf())
        }
    });
    strip_verbatim_prefix(abs)
}

/// whisper-cli on Windows can fail to open `\\?\C:\...` verbatim paths.
fn strip_verbatim_prefix(path: PathBuf) -> PathBuf {
    let s = path.to_string_lossy();
    if let Some(stripped) = s.strip_prefix(r"\\?\") {
        return PathBuf::from(stripped);
    }
    path
}

fn truncate_for_log(body: &str) -> String {
    body.chars().take(400).collect()
}

/// Default English — multilingual `base` is much weaker without a language hint.
/// Override with `ISSUEBRIDGE_WHISPER_LANGUAGE` (e.g. `auto`, `en`, `es`).
fn whisper_language() -> String {
    std::env::var("ISSUEBRIDGE_WHISPER_LANGUAGE")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "en".to_string())
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

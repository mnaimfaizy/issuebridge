//! Whisper `base` transcription via bundled `whisper-cli` + `ggml-base.bin`.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use crate::core::{VoiceError, VoiceTranscriber};

/// Avoid a flashing console window when spawning `whisper-cli` (console subsystem).
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

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
            eprintln!(
                "[issuebridge] whisper: sidecar not found (run scripts/fetch-whisper-assets.ps1)"
            );
            VoiceError::SidecarFailed
        })?;
        let model = resolve_model_path().ok_or_else(|| {
            eprintln!(
                "[issuebridge] whisper: model not found (run scripts/fetch-whisper-assets.ps1)"
            );
            VoiceError::SidecarFailed
        })?;

        // Absolute model/audio paths: cwd is the DLL directory (see apply_dll_search).
        let audio_abs = absolute_path(audio);
        let model_abs = absolute_path(&model);
        let dll_dir = resolve_dll_dir(&sidecar);

        eprintln!(
            "[issuebridge] whisper: cli={} model={} dll_dir={}",
            sidecar.display(),
            model_abs.display(),
            dll_dir
                .as_ref()
                .map(|p| p.display().to_string())
                .unwrap_or_else(|| "(none)".into())
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

        apply_dll_search(&mut command, &sidecar, dll_dir.as_deref());

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

/// Windows loads `whisper.dll` / `ggml.dll` from the exe dir, cwd, then PATH.
/// ggml also loads `ggml-cpu-*.dll` backends from exe dir / cwd (not PATH).
/// Prefer cwd = directory that actually contains those DLLs (#55).
fn apply_dll_search(command: &mut Command, sidecar: &Path, dll_dir: Option<&Path>) {
    let cwd = dll_dir
        .map(|p| p.to_path_buf())
        .or_else(|| sidecar.parent().map(|p| p.to_path_buf()));
    if let Some(ref dir) = cwd {
        command.current_dir(dir);
    }

    let mut dirs = Vec::new();
    if let Some(dir) = dll_dir {
        dirs.push(dir.to_path_buf());
    }
    if let Some(parent) = sidecar.parent() {
        dirs.push(parent.to_path_buf());
    }
    dirs.extend(dll_search_dirs());
    prepend_path_dirs(command, &dirs);
}

/// Prepend all dirs to Path in one write so later calls cannot overwrite earlier ones.
fn prepend_path_dirs(command: &mut Command, dirs: &[PathBuf]) {
    let key = if cfg!(windows) { "Path" } else { "PATH" };
    let sep = if cfg!(windows) { ";" } else { ":" };
    let mut prefixes = Vec::new();
    for dir in dirs {
        let s = dir.to_string_lossy().into_owned();
        if !s.is_empty() && !prefixes.iter().any(|p: &String| p == &s) {
            prefixes.push(s);
        }
    }
    if prefixes.is_empty() {
        return;
    }
    let prefix = prefixes.join(sep);
    let joined = match std::env::var_os(key) {
        Some(existing) => format!("{prefix}{sep}{}", existing.to_string_lossy()),
        None => prefix,
    };
    command.env(key, joined);
}

/// Directory containing `whisper.dll` + `ggml.dll` for this sidecar (colocated or `binaries/`).
fn resolve_dll_dir(sidecar: &Path) -> Option<PathBuf> {
    resolve_dll_dir_near_sidecar(sidecar).or_else(|| {
        dll_search_dirs()
            .into_iter()
            .find(|d| dir_has_whisper_dlls(d))
    })
}

/// Sidecar-adjacent only: install root, or legacy `binaries/` next to the exe (#55).
fn resolve_dll_dir_near_sidecar(sidecar: &Path) -> Option<PathBuf> {
    let parent = sidecar.parent()?;
    [parent.to_path_buf(), parent.join("binaries")]
        .into_iter()
        .find(|d| dir_has_whisper_dlls(d))
}

fn dir_has_whisper_dlls(dir: &Path) -> bool {
    dir.join("ggml.dll").is_file() && dir.join("whisper.dll").is_file()
}

fn hide_console_window(command: &mut Command) {
    #[cfg(windows)]
    {
        command.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    {
        let _ = command;
    }
}

fn run_with_timeout(
    mut command: Command,
    timeout: Duration,
) -> Result<std::process::Output, VoiceError> {
    hide_console_window(&mut command);
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
        let mut command = Command::new("taskkill");
        command
            .args(["/PID", &pid.to_string(), "/F"])
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        hide_console_window(&mut command);
        let _ = command.status();
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
        if let Some(path) = canonical_file(PathBuf::from(path)) {
            return Some(path);
        }
    }

    // Prefer a copy that sits next to ggml/whisper DLLs (dev binaries folder).
    sidecar_candidates()
        .into_iter()
        .find(|path| path.is_file() && sidecar_has_dlls(path))
        .or_else(|| sidecar_candidates().into_iter().find(|path| path.is_file()))
        .and_then(canonical_file)
}

fn sidecar_has_dlls(exe: &Path) -> bool {
    resolve_dll_dir(exe).is_some()
}

fn resolve_model_path() -> Option<PathBuf> {
    if let Ok(path) = std::env::var("ISSUEBRIDGE_WHISPER_MODEL") {
        if let Some(path) = canonical_file(PathBuf::from(path)) {
            return Some(path);
        }
    }

    model_candidates()
        .into_iter()
        .find(|path| path.is_file())
        .and_then(canonical_file)
}

fn sidecar_candidates() -> Vec<PathBuf> {
    let mut out = vec![manifest_dir()
        .join("binaries")
        .join("whisper-cli-x86_64-pc-windows-msvc.exe")];
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            out.push(dir.join("whisper-cli.exe"));
            out.push(dir.join("whisper-cli-x86_64-pc-windows-msvc.exe"));
            out.push(
                dir.join("binaries")
                    .join("whisper-cli-x86_64-pc-windows-msvc.exe"),
            );
        }
    }
    out
}

fn model_candidates() -> Vec<PathBuf> {
    let mut out = vec![manifest_dir()
        .join("resources")
        .join("models")
        .join("ggml-base.bin")];
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            out.push(dir.join("resources").join("models").join("ggml-base.bin"));
            out.push(dir.join("ggml-base.bin"));
        }
    }
    out
}

fn dll_search_dirs() -> Vec<PathBuf> {
    let mut out = vec![manifest_dir().join("binaries")];
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            // Install root first (DLLs colocated with whisper-cli after #55),
            // then legacy nested binaries/ from 0.1.0.
            out.push(dir.to_path_buf());
            out.push(dir.join("binaries"));
        }
    }
    out.into_iter().filter(|p| p.is_dir()).collect()
}

fn manifest_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn canonical_file(path: PathBuf) -> Option<PathBuf> {
    path.is_file()
        .then(|| std::fs::canonicalize(path).ok().map(strip_verbatim_prefix))
        .flatten()
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
    use std::fs;

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

    #[test]
    fn resolve_dll_dir_prefers_colocated_with_sidecar() {
        let root =
            std::env::temp_dir().join(format!("ib-whisper-dll-colocated-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let cli = root.join("whisper-cli.exe");
        fs::write(&cli, b"x").unwrap();
        fs::write(root.join("whisper.dll"), b"x").unwrap();
        fs::write(root.join("ggml.dll"), b"x").unwrap();

        let resolved = resolve_dll_dir(&cli).expect("dll dir");
        assert_eq!(resolved, root);

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn resolve_dll_dir_falls_back_to_nested_binaries() {
        let root =
            std::env::temp_dir().join(format!("ib-whisper-dll-nested-{}", std::process::id()));
        let binaries = root.join("binaries");
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&binaries).unwrap();
        let cli = root.join("whisper-cli.exe");
        fs::write(&cli, b"x").unwrap();
        fs::write(binaries.join("whisper.dll"), b"x").unwrap();
        fs::write(binaries.join("ggml.dll"), b"x").unwrap();

        let resolved = resolve_dll_dir(&cli).expect("dll dir");
        assert_eq!(resolved, binaries);

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn resolve_dll_dir_near_sidecar_none_when_missing() {
        let root =
            std::env::temp_dir().join(format!("ib-whisper-dll-missing-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let cli = root.join("whisper-cli.exe");
        fs::write(&cli, b"x").unwrap();

        // Do not use resolve_dll_dir: from the repo cwd it can still find
        // src-tauri/binaries via dll_search_dirs().
        assert!(resolve_dll_dir_near_sidecar(&cli).is_none());

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn implicit_asset_candidates_use_absolute_trusted_roots() {
        let build_root = Path::new(env!("CARGO_MANIFEST_DIR"));
        let executable_root = std::env::current_exe()
            .expect("current executable")
            .parent()
            .expect("executable directory")
            .to_path_buf();
        for candidate in sidecar_candidates()
            .into_iter()
            .chain(model_candidates())
            .chain(dll_search_dirs())
        {
            assert!(candidate.is_absolute(), "candidate={}", candidate.display());
            assert!(
                candidate.starts_with(build_root) || candidate.starts_with(&executable_root),
                "untrusted candidate={}",
                candidate.display()
            );
        }
    }

    #[test]
    fn prepend_path_dirs_joins_all_prefixes() {
        let sep = if cfg!(windows) { ";" } else { ":" };
        let first = PathBuf::from("first");
        let second = PathBuf::from("second");
        let mut command = Command::new("echo");
        prepend_path_dirs(
            &mut command,
            &[first.clone(), second.clone(), first.clone()],
        );
        let envs: Vec<_> = command.get_envs().collect();
        let key = if cfg!(windows) { "Path" } else { "PATH" };
        let path = envs
            .iter()
            .find(|(k, _)| k.to_string_lossy() == key)
            .and_then(|(_, v)| v.as_ref())
            .expect("PATH/Path set");
        let path = path.to_string_lossy();
        let expected_prefix = format!("first{sep}second");
        assert!(
            path == expected_prefix || path.starts_with(&format!("{expected_prefix}{sep}")),
            "path={path}"
        );
    }
}

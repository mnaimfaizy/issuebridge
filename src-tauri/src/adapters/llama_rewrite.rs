//! llama.cpp Rewrite sidecar — offline Generate via `llama-cli` + local GGUF.
//!
//! Models are **not** bundled in NSIS. Prefer the active catalog GGUF under
//! app-data (`models/`); override with `ISSUEBRIDGE_REWRITE_GGUF` (and optional
//! `ISSUEBRIDGE_REWRITE_CLI`) for local/dev.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::mpsc;
use std::sync::Arc;
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use crate::core::{
    RewriteEngine, RewriteEngineError, RewriteInput, RewriteProposal, StubRewriteEngine,
};

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Soft timeout for Generate. Cold model load + Vulkan can take tens of seconds.
const DEFAULT_TIMEOUT: Duration = Duration::from_secs(120);

const JSON_SCHEMA: &str = r#"{"type":"object","properties":{"title":{"type":"string"},"body":{"type":"string"}},"required":["title","body"]}"#;

/// Shared cancel/PID handle so IPC can stop an in-flight Generate without the core lock.
#[derive(Debug, Default)]
pub struct RewriteJobHandle {
    cancel: AtomicBool,
    pid: AtomicU32,
}

impl RewriteJobHandle {
    pub fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }

    pub fn cancel(&self) {
        self.cancel.store(true, Ordering::SeqCst);
        let pid = self.pid.load(Ordering::SeqCst);
        if pid != 0 {
            kill_process(pid);
        }
    }

    fn begin(&self) {
        self.cancel.store(false, Ordering::SeqCst);
        self.pid.store(0, Ordering::SeqCst);
    }

    fn set_pid(&self, pid: u32) {
        self.pid.store(pid, Ordering::SeqCst);
    }

    fn clear_pid(&self) {
        self.pid.store(0, Ordering::SeqCst);
    }

    fn is_cancelled(&self) -> bool {
        self.cancel.load(Ordering::SeqCst)
    }
}

/// Prefer llama.cpp when sidecar + GGUF are configured; otherwise stub (UX demos / #67).
#[derive(Debug)]
pub struct PreferLlamaRewriteEngine {
    llama: LlamaRewriteEngine,
    stub: StubRewriteEngine,
}

impl PreferLlamaRewriteEngine {
    pub fn new(job: Arc<RewriteJobHandle>) -> Self {
        Self {
            llama: LlamaRewriteEngine::new(job),
            stub: StubRewriteEngine,
        }
    }

    #[cfg(test)]
    fn is_configured_for_tests(&self) -> bool {
        self.llama.is_configured()
    }
}

impl RewriteEngine for PreferLlamaRewriteEngine {
    fn rewrite(&self, input: &RewriteInput) -> Result<RewriteProposal, RewriteEngineError> {
        if self.llama.is_configured() {
            self.llama.rewrite(input)
        } else {
            self.stub.rewrite(input)
        }
    }

    fn cancel(&self) {
        self.llama.cancel();
    }
}

/// Spawns bundled `llama-cli` against a local GGUF for Rewrite proposals.
#[derive(Debug, Clone)]
pub struct LlamaRewriteEngine {
    timeout: Duration,
    job: Arc<RewriteJobHandle>,
}

impl LlamaRewriteEngine {
    pub fn new(job: Arc<RewriteJobHandle>) -> Self {
        Self {
            timeout: DEFAULT_TIMEOUT,
            job,
        }
    }

    pub fn is_configured(&self) -> bool {
        if resolve_model_path().is_none() {
            return false;
        }
        // Dev CLI override may be a test helper without colocated DLLs.
        if std::env::var_os("ISSUEBRIDGE_REWRITE_CLI").is_some() {
            return resolve_sidecar_path().is_some();
        }
        resolve_sidecar_path().is_some_and(|p| resolve_dll_dir(&p).is_some())
    }
}

impl RewriteEngine for LlamaRewriteEngine {
    fn rewrite(&self, input: &RewriteInput) -> Result<RewriteProposal, RewriteEngineError> {
        self.job.begin();

        let sidecar = resolve_sidecar_path().ok_or_else(|| {
            eprintln!(
                "[issuebridge] rewrite: llama-cli not found (run scripts/fetch-llama-assets.ps1)"
            );
            RewriteEngineError::EngineFailed
        })?;
        let model = resolve_model_path().ok_or_else(|| {
            eprintln!(
                "[issuebridge] rewrite: GGUF missing (download via Rewrite… or set ISSUEBRIDGE_REWRITE_GGUF)"
            );
            RewriteEngineError::EngineFailed
        })?;

        let model_abs = absolute_path(&model);
        let dll_dir = resolve_dll_dir(&sidecar);
        let prompt = build_rewrite_prompt(input);
        let prompt_file =
            write_temp_sidecar_file("prompt.txt", prompt.as_bytes()).map_err(|err| {
                eprintln!("[issuebridge] rewrite: prompt temp file failed: {err}");
                RewriteEngineError::EngineFailed
            })?;
        let schema_file =
            write_temp_sidecar_file("schema.json", JSON_SCHEMA.as_bytes()).map_err(|err| {
                eprintln!("[issuebridge] rewrite: schema temp file failed: {err}");
                RewriteEngineError::EngineFailed
            })?;

        eprintln!(
            "[issuebridge] rewrite: cli={} model={} dll_dir={}",
            sidecar.display(),
            model_abs.display(),
            dll_dir
                .as_ref()
                .map(|p| p.display().to_string())
                .unwrap_or_else(|| "(none)".into())
        );

        // -st: one shot then exit (modern llama-cli defaults to interactive chat).
        // --no-jinja: avoid chat-template tokens breaking JSON-schema grammars.
        let mut command = Command::new(&sidecar);
        command
            .arg("-m")
            .arg(&model_abs)
            .arg("--offline")
            .arg("-st")
            .arg("--no-jinja")
            .arg("-n")
            .arg("512")
            .arg("-f")
            .arg(&prompt_file)
            .arg("-jf")
            .arg(&schema_file)
            .arg("--simple-io")
            .arg("--no-display-prompt")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        apply_dll_search(&mut command, &sidecar, dll_dir.as_deref());

        let output = run_with_job(command, self.timeout, &self.job);
        let _ = fs::remove_file(&prompt_file);
        let _ = fs::remove_file(&schema_file);
        let output = output?;
        if self.job.is_cancelled() {
            return Err(RewriteEngineError::Cancelled);
        }
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            eprintln!(
                "[issuebridge] rewrite: exit={:?} stderr={}",
                output.status.code(),
                truncate_for_log(&stderr)
            );
            return Err(RewriteEngineError::EngineFailed);
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        parse_proposal_from_stdout(&stdout).ok_or_else(|| {
            eprintln!(
                "[issuebridge] rewrite: could not parse title/body JSON from stdout={}",
                truncate_for_log(&stdout)
            );
            RewriteEngineError::EngineFailed
        })
    }

    fn cancel(&self) {
        self.job.cancel();
    }
}

pub fn build_rewrite_prompt(input: &RewriteInput) -> String {
    format!(
        "You rewrite GitHub issue drafts. Follow the style instruction exactly. \
Preserve facts; do not invent steps, environment, product scope, or answers. \
Respond with one JSON object only, with string keys title and body. \
Do not wrap the JSON in markdown fences.\n\n\
Style ({name}): {instruction}\n\n\
Current title:\n{title}\n\n\
Current body:\n{body}\n\n\
JSON:",
        name = input.style.name,
        instruction = input.style.instruction,
        title = input.title.trim(),
        body = input.body.trim(),
    )
}

/// Extract `{ "title", "body" }` from llama-cli stdout (may include banners / echoed prompt).
pub fn parse_proposal_from_stdout(stdout: &str) -> Option<RewriteProposal> {
    if let Some(proposal) = try_parse_json_object(stdout.trim()) {
        return Some(proposal);
    }
    // Prefer the last valid object — echoed prompts may contain earlier placeholders.
    let bytes = stdout.as_bytes();
    let mut last = None;
    for (i, &b) in bytes.iter().enumerate() {
        if b != b'{' {
            continue;
        }
        if let Some(end) = find_json_object_end(bytes, i) {
            let slice = &stdout[i..end];
            if let Some(proposal) = try_parse_json_object(slice) {
                last = Some(proposal);
            }
        }
    }
    last
}

fn try_parse_json_object(s: &str) -> Option<RewriteProposal> {
    let value: serde_json::Value = serde_json::from_str(s).ok()?;
    let title = value.get("title")?.as_str()?.trim();
    let body = value.get("body")?.as_str()?.trim();
    if title.is_empty() && body.is_empty() {
        return None;
    }
    // Reject prompt-echo placeholders like {"title":"...","body":"..."}.
    if is_placeholder_field(title) && is_placeholder_field(body) {
        return None;
    }
    Some(RewriteProposal {
        title: title.to_string(),
        body: body.to_string(),
    })
}

fn is_placeholder_field(s: &str) -> bool {
    matches!(s, "..." | "…" | "title" | "body" | "<title>" | "<body>")
}

fn find_json_object_end(bytes: &[u8], start: usize) -> Option<usize> {
    let mut depth = 0i32;
    let mut in_string = false;
    let mut escape = false;
    for (idx, &b) in bytes.iter().enumerate().skip(start) {
        if in_string {
            if escape {
                escape = false;
            } else if b == b'\\' {
                escape = true;
            } else if b == b'"' {
                in_string = false;
            }
            continue;
        }
        match b {
            b'"' => in_string = true,
            b'{' => depth += 1,
            b'}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(idx + 1);
                }
            }
            _ => {}
        }
    }
    None
}

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

fn resolve_dll_dir(sidecar: &Path) -> Option<PathBuf> {
    resolve_dll_dir_near_sidecar(sidecar).or_else(|| {
        dll_search_dirs()
            .into_iter()
            .find(|d| dir_has_llama_dlls(d))
    })
}

fn resolve_dll_dir_near_sidecar(sidecar: &Path) -> Option<PathBuf> {
    let parent = sidecar.parent()?;
    [parent.to_path_buf(), parent.join("binaries")]
        .into_iter()
        .find(|d| dir_has_llama_dlls(d))
}

fn dir_has_llama_dlls(dir: &Path) -> bool {
    dir.join("ggml.dll").is_file() && dir.join("llama.dll").is_file()
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

fn run_with_job(
    mut command: Command,
    timeout: Duration,
    job: &RewriteJobHandle,
) -> Result<std::process::Output, RewriteEngineError> {
    hide_console_window(&mut command);
    let child = command.spawn().map_err(|err| {
        eprintln!("[issuebridge] rewrite: spawn failed: {err}");
        RewriteEngineError::EngineFailed
    })?;
    let pid = child.id();
    job.set_pid(pid);
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        let _ = tx.send(child.wait_with_output());
    });

    let result = match rx.recv_timeout(timeout) {
        Ok(Ok(output)) => {
            job.clear_pid();
            if job.is_cancelled() {
                Err(RewriteEngineError::Cancelled)
            } else {
                Ok(output)
            }
        }
        Ok(Err(err)) => {
            eprintln!("[issuebridge] rewrite: wait failed: {err}");
            kill_process(pid);
            job.clear_pid();
            if job.is_cancelled() {
                Err(RewriteEngineError::Cancelled)
            } else {
                Err(RewriteEngineError::EngineFailed)
            }
        }
        Err(_) => {
            eprintln!("[issuebridge] rewrite: timed out after {timeout:?}");
            kill_process(pid);
            job.clear_pid();
            if job.is_cancelled() {
                Err(RewriteEngineError::Cancelled)
            } else {
                Err(RewriteEngineError::TimedOut)
            }
        }
    };
    result
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

fn resolve_sidecar_path() -> Option<PathBuf> {
    if let Ok(path) = std::env::var("ISSUEBRIDGE_REWRITE_CLI") {
        if let Some(path) = canonical_file(PathBuf::from(path)) {
            return Some(path);
        }
    }

    sidecar_candidates()
        .into_iter()
        .find(|path| path.is_file() && resolve_dll_dir(path).is_some())
        .or_else(|| sidecar_candidates().into_iter().find(|path| path.is_file()))
        .and_then(canonical_file)
}

fn resolve_model_path() -> Option<PathBuf> {
    if let Ok(path) = std::env::var("ISSUEBRIDGE_REWRITE_GGUF") {
        if let Some(path) = canonical_file(PathBuf::from(path)) {
            return Some(path);
        }
    }
    // Active catalog download (#69); env override above wins for local/dev.
    crate::adapters::file_rewrite_model_store::resolve_active_catalog_gguf()
        .and_then(canonical_file)
}

fn sidecar_candidates() -> Vec<PathBuf> {
    let mut out = vec![manifest_dir()
        .join("binaries")
        .join("llama-cli-x86_64-pc-windows-msvc.exe")];
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            out.push(dir.join("llama-cli.exe"));
            out.push(dir.join("llama-cli-x86_64-pc-windows-msvc.exe"));
            out.push(
                dir.join("binaries")
                    .join("llama-cli-x86_64-pc-windows-msvc.exe"),
            );
        }
    }
    out
}

fn dll_search_dirs() -> Vec<PathBuf> {
    let mut out = vec![manifest_dir().join("binaries")];
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            out.push(dir.to_path_buf());
            out.push(dir.join("binaries"));
        }
    }
    out.into_iter().filter(|path| path.is_dir()).collect()
}

fn manifest_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn canonical_file(path: PathBuf) -> Option<PathBuf> {
    path.is_file()
        .then(|| {
            std::fs::canonicalize(path)
                .ok()
                .map(|path| strip_verbatim_prefix(&path))
        })
        .flatten()
}

fn absolute_path(path: &Path) -> PathBuf {
    if path.is_absolute() {
        return strip_verbatim_prefix(path);
    }
    std::env::current_dir()
        .map(|cwd| strip_verbatim_prefix(&cwd.join(path)))
        .unwrap_or_else(|_| path.to_path_buf())
}

fn strip_verbatim_prefix(path: &Path) -> PathBuf {
    let s = path.to_string_lossy();
    if let Some(rest) = s.strip_prefix(r"\\?\") {
        PathBuf::from(rest)
    } else {
        path.to_path_buf()
    }
}

fn truncate_for_log(s: &str) -> String {
    const MAX: usize = 400;
    let trimmed = s.trim();
    if trimmed.chars().count() <= MAX {
        return trimmed.to_string();
    }
    let head: String = trimmed.chars().take(MAX).collect();
    format!("{head}…")
}

fn write_temp_sidecar_file(name: &str, bytes: &[u8]) -> std::io::Result<PathBuf> {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let path = std::env::temp_dir().join(format!(
        "issuebridge-rewrite-{}-{}-{}",
        std::process::id(),
        nanos,
        name
    ));
    fs::write(&path, bytes)?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::RewriteStyleInfo;
    use std::fs;
    use std::sync::{Arc, Mutex, OnceLock};
    use std::time::Duration;

    fn env_lock() -> std::sync::MutexGuard<'static, ()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
            .lock()
            .unwrap_or_else(|e| e.into_inner())
    }

    fn sample_input() -> RewriteInput {
        RewriteInput {
            title: "login fails".into(),
            body: "When I click sign in nothing happens on the settings page after refresh.".into(),
            style: RewriteStyleInfo {
                id: "clear".into(),
                name: "Clear".into(),
                instruction: "Rewrite as a clear GitHub issue.".into(),
                builtin: true,
            },
        }
    }

    #[test]
    fn parse_proposal_from_clean_json() {
        let proposal = parse_proposal_from_stdout(
            "{\"title\":\"Sign-in button does nothing\",\"body\":\"## Problem\\nClicking sign in fails.\"}",
        )
        .expect("parse");
        assert_eq!(proposal.title, "Sign-in button does nothing");
        assert!(proposal.body.contains("Problem"));
    }

    #[test]
    fn parse_proposal_from_stdout_with_banners() {
        let stdout = r#"
load_backend: ggml
system_info: n_threads = 8
{"title":"Clear title","body":"Clear body with details."}
llama_perf: ...
"#;
        let proposal = parse_proposal_from_stdout(stdout).expect("parse amid banners");
        assert_eq!(proposal.title, "Clear title");
        assert_eq!(proposal.body, "Clear body with details.");
    }

    #[test]
    fn parse_proposal_skips_prompt_placeholder_and_uses_later_object() {
        let stdout = "\
> Respond with JSON.\n\
{\"title\":\"...\",\"body\":\"...\"}\n\
JSON:\n\
{\"title\":\"Login fails on settings\",\"body\":\"## Problem\\nSign-in does nothing after refresh.\"}\n";
        let proposal = parse_proposal_from_stdout(stdout).expect("prefer real proposal");
        assert_eq!(proposal.title, "Login fails on settings");
        assert!(proposal.body.contains("Problem"));
    }

    #[test]
    fn parse_proposal_rejects_empty_object() {
        assert!(parse_proposal_from_stdout(r#"{"title":"","body":""}"#).is_none());
        assert!(parse_proposal_from_stdout(r#"{"title":"...","body":"..."}"#).is_none());
    }

    #[test]
    fn build_rewrite_prompt_includes_style_and_draft() {
        let prompt = build_rewrite_prompt(&sample_input());
        assert!(prompt.contains("Clear"));
        assert!(prompt.contains("Rewrite as a clear GitHub issue."));
        assert!(prompt.contains("login fails"));
        assert!(prompt.contains("sign in nothing happens"));
        assert!(prompt.contains("JSON:"));
        assert!(
            !prompt.contains(r#"{"title":"...","body":"..."}"#),
            "prompt must not embed a parseable placeholder JSON object"
        );
    }

    #[test]
    fn resolve_dll_dir_prefers_colocated_llama_dlls() {
        let root =
            std::env::temp_dir().join(format!("ib-llama-dll-colocated-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let cli = root.join("llama-cli.exe");
        fs::write(&cli, b"x").unwrap();
        fs::write(root.join("llama.dll"), b"x").unwrap();
        fs::write(root.join("ggml.dll"), b"x").unwrap();

        assert_eq!(resolve_dll_dir_near_sidecar(&cli), Some(root.clone()));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn resolve_dll_dir_near_sidecar_none_when_whisper_only() {
        let root =
            std::env::temp_dir().join(format!("ib-llama-dll-whisper-only-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let cli = root.join("llama-cli.exe");
        fs::write(&cli, b"x").unwrap();
        fs::write(root.join("whisper.dll"), b"x").unwrap();
        fs::write(root.join("ggml.dll"), b"x").unwrap();

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
        for candidate in sidecar_candidates().into_iter().chain(dll_search_dirs()) {
            assert!(candidate.is_absolute(), "candidate={}", candidate.display());
            assert!(
                candidate.starts_with(build_root) || candidate.starts_with(&executable_root),
                "untrusted candidate={}",
                candidate.display()
            );
        }
    }

    #[test]
    fn prefer_llama_falls_back_to_stub_when_unconfigured() {
        let _guard = env_lock();
        // Ensure env overrides do not accidentally configure the engine in CI.
        let _gguf = EnvGuard::remove("ISSUEBRIDGE_REWRITE_GGUF");
        let _cli = EnvGuard::remove("ISSUEBRIDGE_REWRITE_CLI");

        let engine = PreferLlamaRewriteEngine::new(RewriteJobHandle::new());
        assert!(!engine.is_configured_for_tests());
        let proposal = engine.rewrite(&sample_input()).expect("stub");
        assert!(
            proposal.body.contains("Stub Rewrite") || !proposal.title.is_empty(),
            "expected stub proposal, got {proposal:?}"
        );
    }

    #[test]
    fn run_with_job_times_out_and_kills_slow_process() {
        let command = slow_command();
        let job = RewriteJobHandle::new();
        let err = run_with_job(command, Duration::from_millis(400), &job).expect_err("timeout");
        assert_eq!(err, RewriteEngineError::TimedOut);
    }

    #[test]
    fn run_with_job_cancel_stops_in_flight_process() {
        let command = slow_command();
        let job = RewriteJobHandle::new();
        let job_cancel = Arc::clone(&job);
        thread::spawn(move || {
            thread::sleep(Duration::from_millis(200));
            job_cancel.cancel();
        });
        let err = run_with_job(command, Duration::from_secs(30), &job).expect_err("cancelled");
        assert_eq!(err, RewriteEngineError::Cancelled);
    }

    #[test]
    fn is_configured_when_cli_and_gguf_env_override_exist() {
        let _guard = env_lock();
        let cli = write_temp_file("fake-cli.exe", b"x");
        let model = write_temp_file("fake-ok.gguf", b"gguf");
        let _cli = EnvGuard::set("ISSUEBRIDGE_REWRITE_CLI", cli.to_str().unwrap());
        let _gguf = EnvGuard::set("ISSUEBRIDGE_REWRITE_GGUF", model.to_str().unwrap());
        let engine = LlamaRewriteEngine::new(RewriteJobHandle::new());
        assert!(engine.is_configured());
    }

    fn slow_command() -> Command {
        #[cfg(windows)]
        {
            let mut command = Command::new("ping");
            command
                .args(["-n", "20", "127.0.0.1"])
                .stdout(Stdio::null())
                .stderr(Stdio::null());
            command
        }
        #[cfg(not(windows))]
        {
            let mut command = Command::new("sleep");
            command
                .arg("20")
                .stdout(Stdio::null())
                .stderr(Stdio::null());
            command
        }
    }

    fn write_temp_file(name: &str, bytes: &[u8]) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "ib-rewrite-{}-{}-{}",
            name,
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::write(&path, bytes).unwrap();
        path
    }

    struct EnvGuard {
        key: &'static str,
        prev: Option<std::ffi::OsString>,
    }

    impl EnvGuard {
        fn set(key: &'static str, value: &str) -> Self {
            let prev = std::env::var_os(key);
            std::env::set_var(key, value);
            Self { key, prev }
        }

        fn remove(key: &'static str) -> Self {
            let prev = std::env::var_os(key);
            std::env::remove_var(key);
            Self { key, prev }
        }
    }

    impl Drop for EnvGuard {
        fn drop(&mut self) {
            match &self.prev {
                Some(v) => std::env::set_var(self.key, v),
                None => std::env::remove_var(self.key),
            }
        }
    }
}

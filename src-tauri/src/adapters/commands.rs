//! IPC commands — adapters that call the application core and return safe DTOs.
//! Command results never include raw access/refresh/PAT strings.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_opener::OpenerExt;

use crate::adapters::app_core::AppCore;
use crate::adapters::file_rewrite_model_store::{FileRewriteModelStore, ModelDownloadError};
use crate::adapters::github_http::{HttpGitHub, APP_INSTALL_URL};
use crate::adapters::llama_rewrite::RewriteJobHandle;
use crate::adapters::oauth_loopback::{
    authorize_url, bind_loopback, generate_pkce, generate_state, wait_for_authorization_code,
    OAuthLoopbackError,
};
use crate::adapters::whisper_voice::write_temp_wav;
use crate::core::{
    find_rewrite_model, AuthError, AuthState, CaptureError, CaptureInput, EditDraftInput,
    FirstRunStep, GitHub, InboxError, InstallContinueOutcome, InstallError, LabelCatalogError,
    PublishError, RepoId, RewriteError, SessionProbe, TestingSetError, TimestampDisplay,
    UpdateError, VoiceError,
};

/// Cancel flag for in-flight Rewrite model downloads (lock-free vs core mutex).
#[derive(Debug, Default)]
pub struct ModelDownloadHandle {
    cancel: AtomicBool,
    busy: AtomicBool,
}

impl ModelDownloadHandle {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn cancel(&self) {
        self.cancel.store(true, Ordering::SeqCst);
    }

    pub fn reset_for_start(&self) -> bool {
        if self
            .busy
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return false;
        }
        self.cancel.store(false, Ordering::SeqCst);
        true
    }

    pub fn finish(&self) {
        self.busy.store(false, Ordering::SeqCst);
    }

    pub fn cancel_flag(&self) -> &AtomicBool {
        &self.cancel
    }
}

pub struct AppState {
    pub core: Arc<Mutex<AppCore>>,
    /// Shared with the llama Rewrite engine so Cancel can kill without the core lock.
    pub rewrite_job: Arc<RewriteJobHandle>,
    pub model_download: Arc<ModelDownloadHandle>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AuthStateDto {
    SignedOut,
    SignedIn,
}

impl From<AuthState> for AuthStateDto {
    fn from(value: AuthState) -> Self {
        match value {
            AuthState::SignedOut => Self::SignedOut,
            AuthState::SignedIn => Self::SignedIn,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FirstRunStepDto {
    SignIn,
    InstallApp,
    TestingSet,
    TryCapture,
    Ready,
}

impl From<FirstRunStep> for FirstRunStepDto {
    fn from(value: FirstRunStep) -> Self {
        match value {
            FirstRunStep::SignIn => Self::SignIn,
            FirstRunStep::InstallApp => Self::InstallApp,
            FirstRunStep::TestingSet => Self::TestingSet,
            FirstRunStep::TryCapture => Self::TryCapture,
            FirstRunStep::Ready => Self::Ready,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum InstallContinueOutcomeDto {
    NoInstall,
    ZeroRepos,
    Ready { all_repositories_warning: bool },
}

impl From<InstallContinueOutcome> for InstallContinueOutcomeDto {
    fn from(value: InstallContinueOutcome) -> Self {
        match value {
            InstallContinueOutcome::NoInstall => Self::NoInstall,
            InstallContinueOutcome::ZeroRepos => Self::ZeroRepos,
            InstallContinueOutcome::Ready {
                all_repositories_warning,
            } => Self::Ready {
                all_repositories_warning,
            },
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepoIdDto {
    pub owner: String,
    pub name: String,
}

impl From<RepoId> for RepoIdDto {
    fn from(value: RepoId) -> Self {
        Self {
            owner: value.owner,
            name: value.name,
        }
    }
}

impl From<RepoIdDto> for RepoId {
    fn from(value: RepoIdDto) -> Self {
        Self {
            owner: value.owner,
            name: value.name,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct CaptureInputDto {
    pub owner: String,
    pub name: String,
    pub title: String,
    pub body: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct InboxItemDto {
    pub id: String,
    pub display_title: String,
    pub owner: String,
    pub name: String,
    pub linked: bool,
    pub dirty: bool,
    pub created_at_millis: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct DraftDto {
    pub id: String,
    pub owner: String,
    pub name: String,
    pub title: String,
    pub body: String,
    pub label_names: Vec<String>,
    pub linked: bool,
    pub dirty: bool,
    pub issue_number: Option<u64>,
    pub html_url: Option<String>,
    pub created_at_millis: u64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct EditDraftDto {
    pub id: String,
    pub title: String,
    pub body: String,
    pub label_names: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PatSignInDto {
    pub token: String,
}

#[tauri::command]
pub fn auth_state(state: State<'_, AppState>) -> Result<AuthStateDto, String> {
    let core = state
        .core
        .lock()
        .map_err(|_| "core lock poisoned".to_string())?;
    Ok(AuthStateDto::from(core.auth_state()))
}

/// Tell the shell the session changed underneath it (forced Sign out after a rejected
/// token), so routing to Sign in does not wait for the next window focus.
fn emit_auth_changed(app: &AppHandle, state: AuthStateDto) {
    let _ = app.emit("auth-changed", state);
}

/// Emit `auth-changed` when a failed command left the core signed out.
fn emit_if_signed_out(app: &AppHandle, auth: AuthState) {
    if auth == AuthState::SignedOut {
        emit_auth_changed(app, AuthStateDto::SignedOut);
    }
}

/// Prove the vaulted credentials against GitHub. Rejected credentials are signed out here.
#[tauri::command]
pub async fn validate_session(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<AuthStateDto, String> {
    let core = Arc::clone(&state.core);
    let auth = tauri::async_runtime::spawn_blocking(move || {
        let mut core = core.lock().map_err(|_| "core lock poisoned".to_string())?;
        Ok::<AuthState, String>(core.validate_session())
    })
    .await
    .map_err(|err| format!("session validation task failed: {err}"))??;
    emit_if_signed_out(&app, auth);
    Ok(AuthStateDto::from(auth))
}

/// Launch-time session validation. Runs off the main thread so a slow or offline
/// `GET /user` never blocks window creation, and still runs on a tray-first launch.
///
/// The request is issued *outside* the core lock. Validating inside it would hold the
/// mutex for the whole HTTP timeout, so the shell's first `auth_state` / `first_run_step`
/// / `list_inbox` call would block behind a launch on a hanging network.
pub fn validate_session_on_launch(app: &AppHandle) {
    let handle = app.clone();
    let core = Arc::clone(&app.state::<AppState>().core);
    tauri::async_runtime::spawn(async move {
        let validated = tauri::async_runtime::spawn_blocking(move || {
            // Read the vaulted token, then release the lock before touching the network.
            let token = {
                let mut guard = core.lock().ok()?;
                match guard.probe_session() {
                    SessionProbe::Token(token) => token,
                    SessionProbe::SignedOut => return Some(AuthState::SignedOut),
                    SessionProbe::Unreadable => return Some(guard.auth_state()),
                }
            };

            let result = HttpGitHub::default().validate_pat(&token);

            // Re-acquire only to record the verdict. `apply_session_validation` drops the
            // answer if the vault changed while the request was in flight.
            let mut guard = core.lock().ok()?;
            Some(guard.apply_session_validation(&token, result))
        })
        .await;
        match validated {
            Ok(Some(auth)) => {
                eprintln!("[issuebridge] launch session validation: {auth:?}");
                emit_if_signed_out(&handle, auth);
            }
            Ok(None) => eprintln!("[issuebridge] launch session validation: core lock poisoned"),
            Err(err) => eprintln!("[issuebridge] launch session validation failed: {err}"),
        }
    });
}

#[tauri::command]
pub fn first_run_step(state: State<'_, AppState>) -> Result<FirstRunStepDto, String> {
    let core = state
        .core
        .lock()
        .map_err(|_| "core lock poisoned".to_string())?;
    Ok(FirstRunStepDto::from(core.first_run_step()))
}

#[tauri::command]
pub async fn sign_in_with_pat(
    state: State<'_, AppState>,
    input: PatSignInDto,
) -> Result<AuthStateDto, String> {
    let token_len = input.token.trim().len();
    eprintln!("[issuebridge] sign_in_with_pat: start (token_len={token_len})");
    let core = Arc::clone(&state.core);
    let token = input.token;
    let result = tauri::async_runtime::spawn_blocking(move || {
        eprintln!("[issuebridge] sign_in_with_pat: validating with GitHub…");
        let mut core = core.lock().map_err(|_| "core lock poisoned".to_string())?;
        let outcome = core
            .sign_in_with_pat(&token)
            .map(AuthStateDto::from)
            .map_err(auth_error_message);
        match &outcome {
            Ok(_) => eprintln!("[issuebridge] sign_in_with_pat: success"),
            Err(err) => eprintln!("[issuebridge] sign_in_with_pat: error: {err}"),
        }
        outcome
    })
    .await
    .map_err(|err| format!("sign-in task failed: {err}"))?;
    result
}

#[tauri::command]
pub fn sign_out(state: State<'_, AppState>) -> Result<AuthStateDto, String> {
    let mut core = state
        .core
        .lock()
        .map_err(|_| "core lock poisoned".to_string())?;
    core.sign_out().map_err(auth_error_message)?;
    Ok(AuthStateDto::SignedOut)
}

/// Primary GitHub App sign-in: PKCE S256 + fixed loopback callback, then core exchange.
#[tauri::command]
pub fn sign_in_with_github(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<AuthStateDto, String> {
    let state_param = generate_state();
    let pkce = generate_pkce();
    let url = authorize_url(&state_param, &pkce);

    // Bind before opening the browser so the redirect is never missed.
    let listener = bind_loopback().map_err(loopback_error_message)?;

    app.opener()
        .open_url(&url, None::<&str>)
        .map_err(|err| format!("could not open browser: {err}"))?;

    let code = wait_for_authorization_code(&listener, &state_param, Duration::from_secs(180))
        .map_err(loopback_error_message)?;

    let mut core = state
        .core
        .lock()
        .map_err(|_| "core lock poisoned".to_string())?;
    core.sign_in_with_oauth(&code, &pkce.verifier)
        .map(AuthStateDto::from)
        .map_err(auth_error_message)
}

#[tauri::command]
pub fn open_app_install(app: tauri::AppHandle) -> Result<(), String> {
    app.opener()
        .open_url(APP_INSTALL_URL, None::<&str>)
        .map_err(|err| format!("could not open browser: {err}"))
}

#[tauri::command]
pub fn continue_install(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<InstallContinueOutcomeDto, String> {
    let mut core = state
        .core
        .lock()
        .map_err(|_| "core lock poisoned".to_string())?;
    match core.continue_install() {
        Ok(outcome) => Ok(InstallContinueOutcomeDto::from(outcome)),
        Err(err) => {
            let auth = core.auth_state();
            drop(core);
            emit_if_signed_out(&app, auth);
            Err(install_error_message(err))
        }
    }
}

#[tauri::command]
pub fn app_visible_repos(state: State<'_, AppState>) -> Result<Vec<RepoIdDto>, String> {
    let core = state
        .core
        .lock()
        .map_err(|_| "core lock poisoned".to_string())?;
    Ok(core
        .app_visible_repos()
        .into_iter()
        .map(RepoIdDto::from)
        .collect())
}

#[tauri::command]
pub fn all_repositories_warning(state: State<'_, AppState>) -> Result<bool, String> {
    let core = state
        .core
        .lock()
        .map_err(|_| "core lock poisoned".to_string())?;
    Ok(core.all_repositories_warning())
}

#[tauri::command]
pub fn testing_set(state: State<'_, AppState>) -> Result<Vec<RepoIdDto>, String> {
    let core = state
        .core
        .lock()
        .map_err(|_| "core lock poisoned".to_string())?;
    Ok(core
        .testing_set()
        .into_iter()
        .map(RepoIdDto::from)
        .collect())
}

#[tauri::command]
pub fn add_testing_set_repo(
    state: State<'_, AppState>,
    repo: RepoIdDto,
) -> Result<Vec<RepoIdDto>, String> {
    let mut core = state
        .core
        .lock()
        .map_err(|_| "core lock poisoned".to_string())?;
    core.add_testing_set_repo(RepoId::from(repo))
        .map_err(testing_set_error_message)?;
    Ok(core
        .testing_set()
        .into_iter()
        .map(RepoIdDto::from)
        .collect())
}

#[tauri::command]
pub fn remove_testing_set_repo(
    state: State<'_, AppState>,
    repo: RepoIdDto,
) -> Result<Vec<RepoIdDto>, String> {
    let mut core = state
        .core
        .lock()
        .map_err(|_| "core lock poisoned".to_string())?;
    core.remove_testing_set_repo(&RepoId::from(repo))
        .map_err(testing_set_error_message)?;
    Ok(core
        .testing_set()
        .into_iter()
        .map(RepoIdDto::from)
        .collect())
}

#[tauri::command]
pub fn testing_set_max(state: State<'_, AppState>) -> Result<usize, String> {
    let core = state
        .core
        .lock()
        .map_err(|_| "core lock poisoned".to_string())?;
    Ok(core.testing_set_max())
}

#[tauri::command]
pub fn set_testing_set_max(state: State<'_, AppState>, max: usize) -> Result<usize, String> {
    let mut core = state
        .core
        .lock()
        .map_err(|_| "core lock poisoned".to_string())?;
    core.set_testing_set_max(max)
        .map_err(testing_set_error_message)?;
    Ok(core.testing_set_max())
}

#[tauri::command]
pub fn add_all_app_visible_to_testing_set(
    state: State<'_, AppState>,
) -> Result<Vec<RepoIdDto>, String> {
    let mut core = state
        .core
        .lock()
        .map_err(|_| "core lock poisoned".to_string())?;
    core.add_all_app_visible_to_testing_set()
        .map_err(testing_set_error_message)?;
    Ok(core
        .testing_set()
        .into_iter()
        .map(RepoIdDto::from)
        .collect())
}

#[tauri::command]
pub fn reconcile_testing_set_with_app_visible(state: State<'_, AppState>) -> Result<bool, String> {
    let mut core = state
        .core
        .lock()
        .map_err(|_| "core lock poisoned".to_string())?;
    core.reconcile_testing_set_with_app_visible()
        .map_err(testing_set_error_message)
}

#[tauri::command]
pub fn complete_testing_set(state: State<'_, AppState>) -> Result<FirstRunStepDto, String> {
    let mut core = state
        .core
        .lock()
        .map_err(|_| "core lock poisoned".to_string())?;
    core.complete_testing_set()
        .map_err(testing_set_error_message)?;
    Ok(FirstRunStepDto::from(core.first_run_step()))
}

#[tauri::command]
pub fn skip_try_capture(state: State<'_, AppState>) -> Result<FirstRunStepDto, String> {
    let mut core = state
        .core
        .lock()
        .map_err(|_| "core lock poisoned".to_string())?;
    core.skip_try_capture().map_err(testing_set_error_message)?;
    Ok(FirstRunStepDto::from(core.first_run_step()))
}

#[tauri::command]
pub fn save_capture(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: CaptureInputDto,
) -> Result<(), String> {
    let mut core = state
        .core
        .lock()
        .map_err(|_| "core lock poisoned".to_string())?;
    core.save_capture(CaptureInput {
        repo: RepoId {
            owner: input.owner,
            name: input.name,
        },
        title: input.title,
        body: input.body,
    })
    .map_err(capture_error_message)?;
    drop(core);
    let _ = app.emit("inbox-changed", ());
    Ok(())
}

#[tauri::command]
pub fn list_inbox(state: State<'_, AppState>) -> Result<Vec<InboxItemDto>, String> {
    let core = state
        .core
        .lock()
        .map_err(|_| "core lock poisoned".to_string())?;
    core.list_inbox()
        .map(|items| {
            items
                .into_iter()
                .map(|item| InboxItemDto {
                    id: item.id,
                    display_title: item.display_title,
                    owner: item.repo.owner,
                    name: item.repo.name,
                    linked: item.linked,
                    dirty: item.dirty,
                    created_at_millis: crate::adapters::system_time_millis(item.created_at),
                })
                .collect()
        })
        .map_err(inbox_error_message)
}

#[tauri::command]
pub fn get_draft(state: State<'_, AppState>, id: String) -> Result<DraftDto, String> {
    let core = state
        .core
        .lock()
        .map_err(|_| "core lock poisoned".to_string())?;
    core.get_draft(&id)
        .map(draft_to_dto)
        .map_err(inbox_error_message)
}

#[derive(Debug, Clone, Serialize)]
pub struct RepoLabelDto {
    pub name: String,
    pub color: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct EnsuredLabelCatalogDto {
    pub owner: String,
    pub name: String,
    pub labels: Vec<RepoLabelDto>,
    pub refresh_failed: bool,
}

#[tauri::command]
pub fn ensure_label_catalog(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    repo: RepoIdDto,
) -> Result<EnsuredLabelCatalogDto, String> {
    let mut core = state
        .core
        .lock()
        .map_err(|_| "core lock poisoned".to_string())?;
    let ensured = match core.ensure_label_catalog(&RepoId::from(repo)) {
        Ok(ensured) => ensured,
        Err(err) => {
            let auth = core.auth_state();
            drop(core);
            emit_if_signed_out(&app, auth);
            return Err(label_catalog_error_message(err));
        }
    };
    Ok(EnsuredLabelCatalogDto {
        owner: ensured.repo.owner,
        name: ensured.repo.name,
        labels: ensured
            .labels
            .into_iter()
            .map(|l| RepoLabelDto {
                name: l.name,
                color: l.color,
            })
            .collect(),
        refresh_failed: ensured.refresh_failed,
    })
}

#[tauri::command]
pub fn prefetch_testing_set_label_catalogs(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let mut core = state
        .core
        .lock()
        .map_err(|_| "core lock poisoned".to_string())?;
    match core.prefetch_testing_set_label_catalogs() {
        Ok(()) => Ok(()),
        Err(err) => {
            let auth = core.auth_state();
            drop(core);
            emit_if_signed_out(&app, auth);
            Err(label_catalog_error_message(err))
        }
    }
}

#[tauri::command]
pub fn edit_draft(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: EditDraftDto,
) -> Result<DraftDto, String> {
    let mut core = state
        .core
        .lock()
        .map_err(|_| "core lock poisoned".to_string())?;
    let draft = core
        .edit_draft(EditDraftInput {
            id: input.id,
            title: input.title,
            body: input.body,
            label_names: input.label_names,
        })
        .map_err(inbox_error_message)?;
    drop(core);
    let _ = app.emit("inbox-changed", ());
    Ok(draft_to_dto(draft))
}

#[tauri::command]
pub fn publish_draft(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<DraftDto, String> {
    let mut core = state
        .core
        .lock()
        .map_err(|_| "core lock poisoned".to_string())?;
    let draft = match core.publish_draft(&id) {
        Ok(draft) => draft,
        Err(err) => {
            eprintln!("[issuebridge] publish_draft failed: {err:?}");
            let auth = core.auth_state();
            drop(core);
            emit_if_signed_out(&app, auth);
            return Err(publish_error_message(err));
        }
    };
    drop(core);
    let _ = app.emit("inbox-changed", ());
    Ok(draft_to_dto(draft))
}

/// Outcome of pushing a linked Draft — success or must-choose conflict (not a transport error).
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum UpdateLinkedOutcomeDto {
    Updated {
        draft: DraftDto,
    },
    Conflict {
        html_url: Option<String>,
        issue_number: Option<u64>,
    },
}

#[tauri::command]
pub fn update_linked_draft(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<UpdateLinkedOutcomeDto, String> {
    let mut core = state
        .core
        .lock()
        .map_err(|_| "core lock poisoned".to_string())?;
    match core.update_linked_draft(&id) {
        Ok(draft) => {
            drop(core);
            let _ = app.emit("inbox-changed", ());
            Ok(UpdateLinkedOutcomeDto::Updated {
                draft: draft_to_dto(draft),
            })
        }
        Err(UpdateError::Conflict) => {
            let draft = core.get_draft(&id).map_err(inbox_error_message)?;
            Ok(UpdateLinkedOutcomeDto::Conflict {
                html_url: draft.local_link.as_ref().map(|l| l.html_url.clone()),
                issue_number: draft.local_link.as_ref().map(|l| l.number),
            })
        }
        Err(err) => {
            eprintln!("[issuebridge] update_linked_draft failed: {err:?}");
            let auth = core.auth_state();
            drop(core);
            emit_if_signed_out(&app, auth);
            Err(update_error_message(err))
        }
    }
}

#[tauri::command]
pub fn keep_mine(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<DraftDto, String> {
    let mut core = state
        .core
        .lock()
        .map_err(|_| "core lock poisoned".to_string())?;
    let draft = core.keep_mine(&id).map_err(update_error_message)?;
    drop(core);
    let _ = app.emit("inbox-changed", ());
    Ok(draft_to_dto(draft))
}

#[tauri::command]
pub fn use_theirs(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<DraftDto, String> {
    let mut core = state
        .core
        .lock()
        .map_err(|_| "core lock poisoned".to_string())?;
    let draft = core.use_theirs(&id).map_err(update_error_message)?;
    drop(core);
    let _ = app.emit("inbox-changed", ());
    Ok(draft_to_dto(draft))
}

#[tauri::command]
pub fn last_used_repo(state: State<'_, AppState>) -> Result<Option<RepoIdDto>, String> {
    let core = state
        .core
        .lock()
        .map_err(|_| "core lock poisoned".to_string())?;
    Ok(core.last_used_repo().map(RepoIdDto::from))
}

/// Show or focus the Capture popup window.
///
/// Must be `async` on Windows: building a Webview inside a sync command deadlocks
/// WebView2 and leaves a blank frozen window.
#[tauri::command]
pub async fn show_capture(app: tauri::AppHandle) -> Result<(), String> {
    crate::adapters::capture_window::show_capture_window(&app)
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyPttInput {
    /// Current contents of the focused Capture field (Title or Body).
    pub text: String,
    /// 16-bit PCM WAV bytes (base64).
    pub wav_base64: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ApplyPttOk {
    /// Updated field text after appending the transcript.
    pub text: String,
}

/// Push-to-talk: transcribe WAV and return the updated Capture field text.
#[tauri::command]
pub async fn apply_ptt(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    input: ApplyPttInput,
) -> Result<ApplyPttOk, String> {
    use tauri::Manager;

    let temp_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|_| voice_error_message(VoiceError::SidecarFailed))?
        .join("ptt");

    let text = input.text;
    let wav_path =
        decode_and_write_wav(&temp_dir, &input.wav_base64).map_err(voice_error_message)?;
    let path_str = wav_path.to_string_lossy().to_string();
    let core = Arc::clone(&state.core);

    let result = tauri::async_runtime::spawn_blocking(move || {
        let outcome = {
            let locked = core.lock().map_err(|_| "core lock poisoned".to_string())?;
            locked
                .apply_ptt(&text, &path_str)
                .map_err(voice_error_message)
        };
        let _ = std::fs::remove_file(&path_str);
        outcome
    })
    .await
    .map_err(|err| format!("voice task failed: {err}"))?;

    result.map(|text| ApplyPttOk { text })
}

fn decode_and_write_wav(
    temp_dir: &std::path::Path,
    wav_base64: &str,
) -> Result<std::path::PathBuf, VoiceError> {
    use base64::Engine;
    let wav_bytes = base64::engine::general_purpose::STANDARD
        .decode(wav_base64.as_bytes())
        .map_err(|_| VoiceError::SidecarFailed)?;
    write_temp_wav(temp_dir, &wav_bytes)
}

#[tauri::command]
pub fn ptt_hotkey(state: State<'_, AppState>) -> Result<String, String> {
    let core = state
        .core
        .lock()
        .map_err(|_| "core lock poisoned".to_string())?;
    Ok(core.ptt_hotkey())
}

#[tauri::command]
pub fn get_timestamp_display(state: State<'_, AppState>) -> Result<TimestampDisplay, String> {
    let core = state
        .core
        .lock()
        .map_err(|_| "core lock poisoned".to_string())?;
    Ok(core.timestamp_display())
}

#[tauri::command]
pub fn save_timestamp_display(
    state: State<'_, AppState>,
    value: TimestampDisplay,
) -> Result<(), String> {
    let mut core = state
        .core
        .lock()
        .map_err(|_| "core lock poisoned".to_string())?;
    core.save_timestamp_display(value)
        .map_err(|_| "Could not save timestamp display preference.".to_string())
}

#[derive(Debug, Clone, Serialize)]
pub struct RewriteStyleDto {
    pub id: String,
    pub name: String,
    pub instruction: String,
    pub builtin: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct RewriteStylesSnapshotDto {
    pub styles: Vec<RewriteStyleDto>,
    pub last_used_id: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct RewriteProposalDto {
    pub title: String,
    pub body: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct GenerateRewriteDto {
    pub title: String,
    pub body: String,
    pub style_id: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AddRewriteStyleDto {
    pub name: String,
    pub instruction: String,
}

#[tauri::command]
pub fn list_rewrite_styles(state: State<'_, AppState>) -> Result<RewriteStylesSnapshotDto, String> {
    let core = state
        .core
        .lock()
        .map_err(|_| "core lock poisoned".to_string())?;
    let snap = core.list_rewrite_styles().map_err(rewrite_error_message)?;
    Ok(RewriteStylesSnapshotDto {
        styles: snap
            .styles
            .into_iter()
            .map(|s| RewriteStyleDto {
                id: s.id,
                name: s.name,
                instruction: s.instruction,
                builtin: s.builtin,
            })
            .collect(),
        last_used_id: snap.last_used_id,
    })
}

#[tauri::command]
pub fn add_custom_rewrite_style(
    state: State<'_, AppState>,
    input: AddRewriteStyleDto,
) -> Result<RewriteStyleDto, String> {
    let mut core = state
        .core
        .lock()
        .map_err(|_| "core lock poisoned".to_string())?;
    let style = core
        .add_custom_rewrite_style(&input.name, &input.instruction)
        .map_err(rewrite_error_message)?;
    Ok(RewriteStyleDto {
        id: style.id,
        name: style.name,
        instruction: style.instruction,
        builtin: style.builtin,
    })
}

#[tauri::command]
pub fn remove_custom_rewrite_style(
    state: State<'_, AppState>,
    style_id: String,
) -> Result<(), String> {
    let mut core = state
        .core
        .lock()
        .map_err(|_| "core lock poisoned".to_string())?;
    core.remove_custom_rewrite_style(&style_id)
        .map_err(rewrite_error_message)
}

#[tauri::command]
pub fn generate_rewrite(
    state: State<'_, AppState>,
    input: GenerateRewriteDto,
) -> Result<RewriteProposalDto, String> {
    let mut core = state
        .core
        .lock()
        .map_err(|_| "core lock poisoned".to_string())?;
    let proposal = core
        .generate_rewrite(&input.title, &input.body, &input.style_id)
        .map_err(rewrite_error_message)?;
    Ok(RewriteProposalDto {
        title: proposal.title,
        body: proposal.body,
    })
}

#[tauri::command]
pub fn cancel_rewrite(state: State<'_, AppState>) -> Result<(), String> {
    // Do not take the core lock — Generate may already hold it while the sidecar runs.
    state.rewrite_job.cancel();
    Ok(())
}

#[tauri::command]
pub fn remember_last_rewrite_style(
    state: State<'_, AppState>,
    style_id: String,
) -> Result<(), String> {
    let mut core = state
        .core
        .lock()
        .map_err(|_| "core lock poisoned".to_string())?;
    core.remember_last_rewrite_style(&style_id)
        .map_err(rewrite_error_message)
}

#[derive(Debug, Clone, Serialize)]
pub struct RewriteModelEntryDto {
    pub id: String,
    pub display_name: String,
    pub size_bytes: u64,
    pub summary: String,
    pub on_disk: bool,
    pub verified: bool,
    pub active: bool,
    pub update_available: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct RewriteHardwareSwitchPromptDto {
    pub current_model_id: String,
    pub recommended_model_id: String,
    pub reason: String,
    pub fingerprint: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct RewriteModelStatusDto {
    pub models: Vec<RewriteModelEntryDto>,
    pub active_model_id: Option<String>,
    pub recommended_model_id: String,
    pub recommended_reason: String,
    pub hardware_tier: String,
    pub quality_alt_model_id: Option<String>,
    pub hardware_switch_prompt: Option<RewriteHardwareSwitchPromptDto>,
    pub needs_setup: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RespondRewriteHardwarePromptDto {
    /// `true` = Switch to recommended (no auto-download); `false` = Keep current.
    pub switch: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RewriteModelIdDto {
    pub model_id: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct RewriteModelDownloadProgressDto {
    pub model_id: String,
    pub received_bytes: u64,
    pub total_bytes: u64,
}

#[tauri::command]
pub fn get_rewrite_model_status(
    state: State<'_, AppState>,
    skip_content_hash: Option<bool>,
) -> Result<RewriteModelStatusDto, String> {
    let core = state.core.lock().map_err(|e| e.to_string())?;
    let snap = if skip_content_hash.unwrap_or(false) {
        core.rewrite_model_help_status()
    } else {
        core.rewrite_model_status()
    }
    .map_err(rewrite_error_message)?;
    Ok(rewrite_model_status_dto(snap))
}

#[tauri::command]
pub fn respond_rewrite_hardware_prompt(
    state: State<'_, AppState>,
    input: RespondRewriteHardwarePromptDto,
) -> Result<RewriteModelStatusDto, String> {
    let mut core = state.core.lock().map_err(|e| e.to_string())?;
    let snap = core
        .respond_rewrite_hardware_prompt(input.switch)
        .map_err(rewrite_error_message)?;
    Ok(rewrite_model_status_dto(snap))
}

fn rewrite_model_status_dto(
    snap: crate::core::RewriteModelStatusSnapshot,
) -> RewriteModelStatusDto {
    RewriteModelStatusDto {
        models: snap
            .models
            .into_iter()
            .map(|m| RewriteModelEntryDto {
                id: m.id,
                display_name: m.display_name,
                size_bytes: m.size_bytes,
                summary: m.summary,
                on_disk: m.on_disk,
                verified: m.verified,
                active: m.active,
                update_available: m.update_available,
            })
            .collect(),
        active_model_id: snap.active_model_id,
        recommended_model_id: snap.recommended_model_id,
        recommended_reason: snap.recommended_reason,
        hardware_tier: snap.hardware_tier,
        quality_alt_model_id: snap.quality_alt_model_id,
        hardware_switch_prompt: snap.hardware_switch_prompt.map(|p| {
            RewriteHardwareSwitchPromptDto {
                current_model_id: p.current_model_id,
                recommended_model_id: p.recommended_model_id,
                reason: p.reason,
                fingerprint: p.fingerprint,
            }
        }),
        needs_setup: snap.needs_setup,
    }
}

#[tauri::command]
pub fn start_rewrite_model_download(
    app: AppHandle,
    state: State<'_, AppState>,
    input: RewriteModelIdDto,
) -> Result<(), String> {
    let entry = find_rewrite_model(&input.model_id)
        .ok_or_else(|| rewrite_error_message(RewriteError::NotFound))?;
    {
        let mut core = state.core.lock().map_err(|e| e.to_string())?;
        if core.auth_state() != AuthState::SignedIn {
            return Err(rewrite_error_message(RewriteError::NotSignedIn));
        }
        // Already verified on disk — set active without re-downloading (R30).
        let status = core.rewrite_model_status().map_err(rewrite_error_message)?;
        if status.models.iter().any(|m| m.id == entry.id && m.verified) {
            core.set_active_rewrite_model(entry.id)
                .map_err(rewrite_error_message)?;
            return Ok(());
        }
    }
    if !state.model_download.reset_for_start() {
        return Err("A Rewrite model download is already in progress.".into());
    }

    let model_id = entry.id.to_string();
    let url = entry.download_url.to_string();
    let filename = entry.filename.to_string();
    let size = entry.size_bytes;
    let sha = entry.sha256.to_string();
    let download = Arc::clone(&state.model_download);
    let core = Arc::clone(&state.core);

    tauri::async_runtime::spawn_blocking(move || {
        let store = FileRewriteModelStore::default();
        let app_for_progress = app.clone();
        let model_id_progress = model_id.clone();
        let result = store.download_and_verify(
            &url,
            &filename,
            size,
            &sha,
            download.cancel_flag(),
            |received, total| {
                let _ = app_for_progress.emit(
                    "rewrite-model-download-progress",
                    RewriteModelDownloadProgressDto {
                        model_id: model_id_progress.clone(),
                        received_bytes: received,
                        total_bytes: total,
                    },
                );
            },
        );
        download.finish();
        match result {
            Ok(_) => {
                if let Ok(mut core) = core.lock() {
                    let _ = core.set_active_rewrite_model(&model_id);
                }
                let _ = app.emit("rewrite-model-download-finished", model_id);
            }
            Err(ModelDownloadError::Cancelled) => {
                let _ = app.emit("rewrite-model-download-cancelled", model_id);
            }
            Err(_) => {
                let _ = app.emit("rewrite-model-download-failed", model_id);
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub fn cancel_rewrite_model_download(state: State<'_, AppState>) -> Result<(), String> {
    state.model_download.cancel();
    Ok(())
}

#[tauri::command]
pub fn set_active_rewrite_model(
    state: State<'_, AppState>,
    input: RewriteModelIdDto,
) -> Result<(), String> {
    let mut core = state.core.lock().map_err(|e| e.to_string())?;
    core.set_active_rewrite_model(&input.model_id)
        .map_err(rewrite_error_message)
}

#[tauri::command]
pub fn remove_rewrite_model(
    state: State<'_, AppState>,
    input: RewriteModelIdDto,
) -> Result<(), String> {
    let mut core = state.core.lock().map_err(|e| e.to_string())?;
    core.remove_rewrite_model(&input.model_id)
        .map_err(rewrite_error_message)
}

fn rewrite_error_message(err: RewriteError) -> String {
    match err {
        RewriteError::NotSignedIn => "Sign in to Rewrite a Draft.".into(),
        RewriteError::TooThin => "Draft is too thin to Rewrite — add more title or body.".into(),
        RewriteError::EmptyFields => "Name and instruction are required.".into(),
        RewriteError::NotFound => "That Rewrite style was not found.".into(),
        RewriteError::StorageUnavailable => "Could not update Rewrite styles.".into(),
        RewriteError::EngineFailed => "Rewrite failed. Try again.".into(),
        RewriteError::TimedOut => "Rewrite timed out. Try again.".into(),
        RewriteError::Cancelled => "Rewrite cancelled.".into(),
        RewriteError::ModelNotReady => "That Rewrite model is not ready. Download it first.".into(),
        RewriteError::DownloadFailed => "Rewrite model download failed. Try again.".into(),
        RewriteError::DownloadCancelled => "Rewrite model download cancelled.".into(),
    }
}

fn voice_error_message(err: VoiceError) -> String {
    // Stable kind tokens for the Capture UI; friendly copy lives in the webview.
    match err {
        VoiceError::PermissionDenied => "permission_denied".into(),
        VoiceError::NoDevice => "no_device".into(),
        VoiceError::SidecarFailed => "sidecar_failed".into(),
        VoiceError::EmptyTranscript => "empty_transcript".into(),
    }
}

fn capture_error_message(err: CaptureError) -> String {
    match err {
        CaptureError::NotSignedIn => "Sign in to capture a Draft.".into(),
        CaptureError::StorageUnavailable => "Could not save Draft.".into(),
    }
}

fn draft_to_dto(draft: crate::core::Draft) -> DraftDto {
    let linked = draft.is_linked();
    let dirty = draft.is_dirty();
    DraftDto {
        id: draft.id,
        owner: draft.repo.owner,
        name: draft.repo.name,
        title: draft.title,
        body: draft.body,
        label_names: draft.label_names,
        linked,
        dirty,
        issue_number: draft.local_link.as_ref().map(|l| l.number),
        html_url: draft.local_link.map(|l| l.html_url),
        created_at_millis: crate::adapters::system_time_millis(draft.created_at),
    }
}

fn inbox_error_message(err: InboxError) -> String {
    match err {
        InboxError::NotSignedIn => "Sign in to view the Inbox.".into(),
        InboxError::NotFound => "That Draft was not found.".into(),
        InboxError::StorageUnavailable => "Could not load Drafts.".into(),
    }
}

fn label_catalog_error_message(err: LabelCatalogError) -> String {
    match err {
        LabelCatalogError::NotSignedIn => "Sign in to load labels.".into(),
        LabelCatalogError::SessionExpired => {
            "GitHub rejected your sign-in. Sign in with GitHub again.".into()
        }
        LabelCatalogError::StorageUnavailable => "Could not load Label catalog.".into(),
    }
}

fn publish_error_message(err: PublishError) -> String {
    match err {
        PublishError::NotSignedIn => "Sign in to Publish a Draft.".into(),
        PublishError::TitleRequired => "Add a title before Publish.".into(),
        PublishError::AlreadyLinked => {
            "This Draft is already linked. Use Update to send changes to GitHub.".into()
        }
        PublishError::NotAppVisible => {
            "This Draft's repository is no longer App-visible. Refresh your GitHub App access before Publishing."
                .into()
        }
        PublishError::NotFound => "That Draft was not found.".into(),
        PublishError::StorageUnavailable => "Could not save Draft after Publish.".into(),
        PublishError::InvalidCredentials => {
            "GitHub rejected your sign-in. Sign out, then Sign in with GitHub again.".into()
        }
        PublishError::ProviderUnavailable => {
            "Could not create the GitHub issue. Check the terminal [issuebridge] logs and try again."
                .into()
        }
    }
}

fn update_error_message(err: UpdateError) -> String {
    match err {
        UpdateError::NotSignedIn => "Sign in to update a linked Draft.".into(),
        UpdateError::NotFound => "That Draft was not found.".into(),
        UpdateError::NotLinked => "Link this Draft with Publish before updating.".into(),
        UpdateError::TitleRequired => "Add a title before Update.".into(),
        UpdateError::Conflict => "This issue changed on GitHub since you last updated it.".into(),
        UpdateError::StorageUnavailable => "Could not save Draft after update.".into(),
        UpdateError::InvalidCredentials => {
            "GitHub rejected your sign-in. Sign out, then Sign in with GitHub again.".into()
        }
        UpdateError::ProviderUnavailable => {
            "Could not update the GitHub issue. Check the terminal [issuebridge] logs and try again."
                .into()
        }
    }
}

fn auth_error_message(err: AuthError) -> String {
    match err {
        AuthError::EmptyToken => "Enter a personal access token.".into(),
        AuthError::InvalidCredentials => "GitHub rejected those credentials.".into(),
        AuthError::StorageUnavailable => "Could not access the OS credential vault.".into(),
        AuthError::ProviderUnavailable => {
            "GitHub App sign-in could not complete the token exchange. For local `tauri dev`, set ISSUEBRIDGE_OAUTH_EXCHANGE_URL or ISSUEBRIDGE_GITHUB_CLIENT_SECRET in this terminal, restart, then try Sign in with GitHub again. Official builds use the exchange URL baked at compile time.".into()
        }
    }
}

fn install_error_message(err: InstallError) -> String {
    match err {
        InstallError::NotSignedIn => "Sign in to install the GitHub App.".into(),
        InstallError::TokenLacksInstallAccess => {
            "Continue needs a GitHub App sign-in token. Personal access tokens (even classic) cannot list App installations. Sign out, then use Sign in with GitHub. Re-installing the App is not required if it is already installed.".into()
        }
        InstallError::ProviderUnavailable => {
            "Could not refresh installations from GitHub. Check the terminal [issuebridge] logs and try again.".into()
        }
        InstallError::StorageUnavailable => "Could not save first-run progress.".into(),
    }
}

fn testing_set_error_message(err: TestingSetError) -> String {
    match err {
        TestingSetError::NotSignedIn => "Sign in to choose a Testing set.".into(),
        TestingSetError::InstallIncomplete => {
            "Finish installing the GitHub App before choosing a Testing set.".into()
        }
        TestingSetError::SettingsOnly => {
            "Finish first-run setup before changing the Testing set max in Settings.".into()
        }
        TestingSetError::LimitReached { max } => {
            format!("You can pick up to {max} repositories.")
        }
        TestingSetError::MaxBelowCurrentSet { current, requested } => {
            format!(
                "Remove repositories from the Testing set until you have {requested} or fewer (currently {current}) before lowering the max."
            )
        }
        TestingSetError::MaxOutOfRange => {
            "Testing set max must be between 1 and the number of App-visible repositories.".into()
        }
        TestingSetError::NotAppVisible => {
            "That repository is not visible to the Issuebridge App yet.".into()
        }
        TestingSetError::Empty => "Pick at least one repository for your Testing set.".into(),
        TestingSetError::StorageUnavailable => "Could not save Testing set.".into(),
    }
}

fn loopback_error_message(err: OAuthLoopbackError) -> String {
    err.to_string()
}

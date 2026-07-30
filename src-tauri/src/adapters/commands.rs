//! IPC commands — adapters that call the application core and return safe DTOs.
//! Command results never include raw access/refresh/PAT strings.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{Emitter, State};
use tauri_plugin_opener::OpenerExt;

use crate::adapters::app_core::AppCore;
use crate::adapters::github_http::APP_INSTALL_URL;
use crate::adapters::oauth_loopback::{
    authorize_url, bind_loopback, generate_pkce, generate_state, wait_for_authorization_code,
    OAuthLoopbackError,
};
use crate::adapters::whisper_voice::write_temp_wav;
use crate::core::{
    AuthError, AuthState, CaptureError, CaptureInput, EditDraftInput, FirstRunStep, InboxError,
    InstallContinueOutcome, InstallError, PublishError, RepoId, TestingSetError, UpdateError,
    VoiceError,
};

pub struct AppState {
    pub core: Arc<Mutex<AppCore>>,
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
pub fn continue_install(state: State<'_, AppState>) -> Result<InstallContinueOutcomeDto, String> {
    let mut core = state
        .core
        .lock()
        .map_err(|_| "core lock poisoned".to_string())?;
    core.continue_install()
        .map(InstallContinueOutcomeDto::from)
        .map_err(install_error_message)
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
    let draft = core.publish_draft(&id).map_err(publish_error_message)?;
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
        Err(err) => Err(update_error_message(err)),
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
    }
}

fn inbox_error_message(err: InboxError) -> String {
    match err {
        InboxError::NotSignedIn => "Sign in to view the Inbox.".into(),
        InboxError::NotFound => "That Draft was not found.".into(),
        InboxError::StorageUnavailable => "Could not load Drafts.".into(),
    }
}

fn publish_error_message(err: PublishError) -> String {
    match err {
        PublishError::NotSignedIn => "Sign in to Publish a Draft.".into(),
        PublishError::TitleRequired => "Add a title before Publish.".into(),
        PublishError::AlreadyLinked => {
            "This Draft is already linked. Use Update to send changes to GitHub.".into()
        }
        PublishError::NotFound => "That Draft was not found.".into(),
        PublishError::StorageUnavailable => "Could not save Draft after Publish.".into(),
        PublishError::ProviderUnavailable => "Could not create the GitHub issue. Try again.".into(),
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
        UpdateError::ProviderUnavailable => "Could not update the GitHub issue. Try again.".into(),
    }
}

fn auth_error_message(err: AuthError) -> String {
    match err {
        AuthError::EmptyToken => "Enter a personal access token.".into(),
        AuthError::InvalidCredentials => "GitHub rejected those credentials.".into(),
        AuthError::StorageUnavailable => "Could not access the OS credential vault.".into(),
        AuthError::ProviderUnavailable => {
            "GitHub App sign-in needs the client secret. Set ISSUEBRIDGE_GITHUB_CLIENT_SECRET in this terminal (from the issuebridge-dev App / 1Password), restart npm run tauri dev, then try Sign in with GitHub again.".into()
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
        TestingSetError::LimitReached => "You can pick up to 3 repositories.".into(),
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

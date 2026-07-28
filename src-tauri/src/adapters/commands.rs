//! IPC commands — adapters that call the application core and return safe DTOs.
//! Command results never include raw access/refresh/PAT strings.

use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::State;
use tauri_plugin_opener::OpenerExt;

use crate::adapters::github_http::APP_INSTALL_URL;
use crate::adapters::oauth_loopback::{
    authorize_url, bind_loopback, generate_pkce, generate_state, wait_for_authorization_code,
    OAuthLoopbackError,
};
use crate::adapters::app_core::AppCore;
use crate::core::{
    AuthError, AuthState, CaptureError, CaptureInput, FirstRunStep, InstallContinueOutcome,
    InstallError, RepoId, TestingSetError,
};

pub struct AppState {
    pub core: Mutex<AppCore>,
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
    Ready,
}

impl From<FirstRunStep> for FirstRunStepDto {
    fn from(value: FirstRunStep) -> Self {
        match value {
            FirstRunStep::SignIn => Self::SignIn,
            FirstRunStep::InstallApp => Self::InstallApp,
            FirstRunStep::TestingSet => Self::TestingSet,
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
pub fn sign_in_with_pat(
    state: State<'_, AppState>,
    input: PatSignInDto,
) -> Result<AuthStateDto, String> {
    let mut core = state
        .core
        .lock()
        .map_err(|_| "core lock poisoned".to_string())?;
    core.sign_in_with_pat(&input.token)
        .map(AuthStateDto::from)
        .map_err(auth_error_message)
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
    state: State<'_, AppState>,
) -> Result<InstallContinueOutcomeDto, String> {
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
    Ok(core.testing_set().into_iter().map(RepoIdDto::from).collect())
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
    Ok(core.testing_set().into_iter().map(RepoIdDto::from).collect())
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
    Ok(core.testing_set().into_iter().map(RepoIdDto::from).collect())
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
pub fn save_capture(
    state: State<'_, AppState>,
    input: CaptureInputDto,
) -> Result<(), CaptureError> {
    let mut core = state
        .core
        .lock()
        .map_err(|_| CaptureError::NotSignedIn)?;
    core.save_capture(CaptureInput {
        repo: RepoId {
            owner: input.owner,
            name: input.name,
        },
        title: input.title,
        body: input.body,
    })?;
    Ok(())
}

fn auth_error_message(err: AuthError) -> String {
    match err {
        AuthError::EmptyToken => "Enter a personal access token.".into(),
        AuthError::InvalidCredentials => "GitHub rejected those credentials.".into(),
        AuthError::StorageUnavailable => "Could not access the OS credential vault.".into(),
        AuthError::ProviderUnavailable => {
            "GitHub sign-in is unavailable (check network or app client secret).".into()
        }
    }
}

fn install_error_message(err: InstallError) -> String {
    match err {
        InstallError::NotSignedIn => "Sign in to install the GitHub App.".into(),
        InstallError::ProviderUnavailable => {
            "Could not refresh installations from GitHub. Try again.".into()
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

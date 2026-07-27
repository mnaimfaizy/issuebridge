//! IPC commands — adapters that call the application core and return safe DTOs.
//! Command results never include raw access/refresh/PAT strings.

use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::State;
use tauri_plugin_opener::OpenerExt;

use crate::adapters::oauth_loopback::{
    authorize_url, bind_loopback, generate_pkce, generate_state, wait_for_authorization_code,
    OAuthLoopbackError,
};
use crate::adapters::app_core::AppCore;
use crate::core::{AuthError, AuthState, CaptureError, CaptureInput, RepoId};

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

#[derive(Debug, Clone, serde::Deserialize)]
pub struct CaptureInputDto {
    pub owner: String,
    pub name: String,
    pub title: String,
    pub body: String,
}

#[derive(Debug, Clone, serde::Deserialize)]
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

fn loopback_error_message(err: OAuthLoopbackError) -> String {
    err.to_string()
}

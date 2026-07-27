//! IPC commands — adapters that call the application core and return safe DTOs.

use std::sync::Mutex;

use serde::Serialize;
use tauri::State;

use crate::adapters::stub_ports::StubCore;
use crate::core::{AuthState, CaptureError, CaptureInput, RepoId};

pub struct AppState {
    pub core: Mutex<StubCore>,
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

#[tauri::command]
pub fn auth_state(state: State<'_, AppState>) -> Result<AuthStateDto, String> {
    let core = state.core.lock().map_err(|_| "core lock poisoned".to_string())?;
    Ok(AuthStateDto::from(core.auth_state()))
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

//! Ports the application core depends on. Adapters and fakes implement these.

use std::time::SystemTime;

use serde::{Deserialize, Serialize};

#[cfg(test)]
pub mod fakes;

/// Target repository (`owner/name`).
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct RepoId {
    pub owner: String,
    pub name: String,
}

/// Input from Capture Save (no Publish).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CaptureInput {
    pub repo: RepoId,
    pub title: String,
    pub body: String,
}

/// Local Draft record (persistence shape for v0.1 — unlinked fields only for now).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Draft {
    pub id: String,
    pub repo: RepoId,
    pub title: String,
    pub body: String,
    pub label_names: Vec<String>,
    pub created_at: SystemTime,
    pub updated_at: SystemTime,
}

/// Credentials held only by TokenStore adapters — never returned through core IPC results.
/// Also the shape returned by a successful OAuth code exchange.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredCredentials {
    pub access_token: String,
    pub refresh_token: Option<String>,
}

/// Snapshot of GitHub App installations visible to the signed-in user.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppInstallSnapshot {
    /// True when the user has at least one installation of the maintainer App.
    pub has_install: bool,
    /// Repositories accessible through those installations.
    pub repos: Vec<RepoId>,
    /// True when any installation uses "All repositories" selection.
    pub all_repositories: bool,
}

/// Persisted first-run / Testing-set preferences (not credentials).
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct AppSettings {
    pub install_completed: bool,
    pub testing_set_completed: bool,
    pub testing_set: Vec<RepoId>,
    pub app_visible_repos: Vec<RepoId>,
    pub all_repositories_warning: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GitHubError {
    InvalidCredentials,
    Unavailable,
}

pub trait GitHub: Send + Sync {
    /// Validate a personal access token (e.g. GET /user). Does not persist it.
    fn validate_pat(&self, pat: &str) -> Result<(), GitHubError>;

    /// Exchange an authorization code + PKCE verifier for tokens.
    fn exchange_oauth_code(
        &self,
        code: &str,
        code_verifier: &str,
    ) -> Result<StoredCredentials, GitHubError>;

    /// List App installations + accessible repos for the given user token.
    fn list_app_install_snapshot(
        &self,
        token: &str,
    ) -> Result<AppInstallSnapshot, GitHubError>;
}

pub trait TokenStore: Send + Sync {
    fn load(&self) -> Result<Option<StoredCredentials>, TokenStoreError>;
    fn store(&mut self, credentials: StoredCredentials) -> Result<(), TokenStoreError>;
    fn clear(&mut self) -> Result<(), TokenStoreError>;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TokenStoreError {
    Unavailable,
}

pub trait DraftStore: Send + Sync {
    fn save(&mut self, draft: Draft) -> Result<(), DraftStoreError>;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DraftStoreError {
    Unavailable,
}

pub trait SettingsStore: Send + Sync {
    fn load(&self) -> Result<AppSettings, SettingsStoreError>;
    fn save(&mut self, settings: AppSettings) -> Result<(), SettingsStoreError>;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SettingsStoreError {
    Unavailable,
}

pub trait VoiceTranscriber: Send + Sync {}

pub trait Clock: Send + Sync {
    fn now(&self) -> SystemTime;
}

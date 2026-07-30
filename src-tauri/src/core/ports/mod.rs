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

/// This install’s association between a Draft and the remote GitHub issue it published.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LocalLink {
    pub number: u64,
    pub html_url: String,
}

/// Last-known remote title, body, labels, and `updated_at` after Publish or remote update.
/// `updated_at` is GitHub’s ISO-8601 string (exact value used for conflict compare).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RemoteSnapshot {
    pub title: String,
    pub body: String,
    pub label_names: Vec<String>,
    pub updated_at: String,
}

/// Local Draft record — linked when `local_link` is present; Dirty is derived from snapshot.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Draft {
    pub id: String,
    pub repo: RepoId,
    pub title: String,
    pub body: String,
    pub label_names: Vec<String>,
    pub created_at: SystemTime,
    pub updated_at: SystemTime,
    #[serde(default)]
    pub local_link: Option<LocalLink>,
    #[serde(default)]
    pub remote_snapshot: Option<RemoteSnapshot>,
}

impl Draft {
    pub fn is_linked(&self) -> bool {
        self.local_link.is_some()
    }

    /// Dirty when linked and working title/body/labels differ from the Remote snapshot.
    pub fn is_dirty(&self) -> bool {
        let Some(snapshot) = &self.remote_snapshot else {
            return false;
        };
        if !self.is_linked() {
            return false;
        }
        self.title != snapshot.title
            || self.body != snapshot.body
            || self.label_names != snapshot.label_names
    }
}

/// Inbox editor updates to working title, body, and ordered label names.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EditDraftInput {
    pub id: String,
    pub title: String,
    pub body: String,
    pub label_names: Vec<String>,
}

/// Result of creating a GitHub issue via the GitHub port.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CreatedIssue {
    pub number: u64,
    pub html_url: String,
    pub title: String,
    pub body: String,
    pub label_names: Vec<String>,
    /// GitHub ISO-8601 `updated_at`.
    pub updated_at: String,
}

/// One Inbox row — display fields derived from a Draft.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InboxItem {
    pub id: String,
    pub display_title: String,
    pub repo: RepoId,
    pub linked: bool,
    pub dirty: bool,
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
    /// One-shot: after Try capture Save/Skip, subsequent launches are tray-first.
    #[serde(default)]
    pub first_run_completed: bool,
    pub testing_set: Vec<RepoId>,
    pub app_visible_repos: Vec<RepoId>,
    pub all_repositories_warning: bool,
    /// Last repo chosen in Capture (chips / typeahead).
    pub last_used_repo: Option<RepoId>,
    /// Open Capture hotkey (default `Ctrl+Alt+Shift+I`).
    pub open_hotkey: Option<String>,
    /// Push-to-talk hotkey (default `Ctrl+Alt+Shift+V`).
    #[serde(default)]
    pub ptt_hotkey: Option<String>,
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
    fn list_app_install_snapshot(&self, token: &str) -> Result<AppInstallSnapshot, GitHubError>;

    /// Create a GitHub issue from Draft working fields (no rediscovery label/footer).
    fn create_issue(
        &self,
        token: &str,
        repo: &RepoId,
        title: &str,
        body: &str,
        label_names: &[String],
    ) -> Result<CreatedIssue, GitHubError>;

    /// GET a GitHub issue by number (for conflict compare and Use theirs).
    fn get_issue(
        &self,
        token: &str,
        repo: &RepoId,
        number: u64,
    ) -> Result<CreatedIssue, GitHubError>;

    /// PATCH a GitHub issue’s title, body, and labels (linked update / Keep mine).
    fn update_issue(
        &self,
        token: &str,
        repo: &RepoId,
        number: u64,
        title: &str,
        body: &str,
        label_names: &[String],
    ) -> Result<CreatedIssue, GitHubError>;
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
    fn get(&self, id: &str) -> Result<Option<Draft>, DraftStoreError>;
    fn list(&self) -> Result<Vec<Draft>, DraftStoreError>;
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

/// Failure kinds surfaced to Capture after a PTT attempt (mic or Whisper).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum VoiceError {
    PermissionDenied,
    NoDevice,
    /// Sidecar crash and timeout share one UX intent.
    SidecarFailed,
    /// Soft failure — not framed as an error in the UI.
    EmptyTranscript,
}

/// Offline speech → text from a WAV path. Mic capture stays in the Capture adapter/UI;
/// this port is the Whisper/transcription boundary the core orchestrates.
pub trait VoiceTranscriber: Send + Sync {
    fn transcribe(&self, audio_path: &str) -> Result<String, VoiceError>;
}

pub trait Clock: Send + Sync {
    fn now(&self) -> SystemTime;
}

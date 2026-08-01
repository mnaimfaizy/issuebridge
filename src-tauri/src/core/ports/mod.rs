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

/// One entry in a repository Label catalog (canonical name + color).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RepoLabel {
    pub name: String,
    /// GitHub label color hex without leading `#`.
    pub color: String,
}

/// Persisted Label catalog for one repository.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LabelCatalog {
    pub repo: RepoId,
    pub labels: Vec<RepoLabel>,
    pub refreshed_at: SystemTime,
}

/// Inbox-facing Label catalog load: may be stale/empty after a soft-failed refresh.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EnsuredLabelCatalog {
    pub repo: RepoId,
    pub labels: Vec<RepoLabel>,
    pub refreshed_at: Option<SystemTime>,
    /// True when GitHub refresh failed and the caller is seeing last-good or empty.
    pub refresh_failed: bool,
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

fn default_testing_set_max() -> usize {
    3
}

/// User-defined Rewrite style (name + instruction text).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CustomRewriteStyle {
    pub id: String,
    pub name: String,
    pub instruction: String,
}

/// Persisted first-run / Testing-set preferences (not credentials).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AppSettings {
    pub install_completed: bool,
    pub testing_set_completed: bool,
    /// One-shot: after Try capture Save/Skip, subsequent launches are tray-first.
    #[serde(default)]
    pub first_run_completed: bool,
    pub testing_set: Vec<RepoId>,
    /// Settings-only cap on Testing set size (default/recommended 3). First-run adds ignore this and hard-cap at 3.
    #[serde(default = "default_testing_set_max")]
    pub testing_set_max: usize,
    pub app_visible_repos: Vec<RepoId>,
    pub all_repositories_warning: bool,
    /// Last repo chosen in Capture (chips / typeahead).
    pub last_used_repo: Option<RepoId>,
    /// Open Capture hotkey (default `Ctrl+Alt+Shift+I`).
    pub open_hotkey: Option<String>,
    /// Push-to-talk hotkey (default `Ctrl+Alt+Shift+V`).
    #[serde(default)]
    pub ptt_hotkey: Option<String>,
    /// User-defined Rewrite styles.
    #[serde(default)]
    pub custom_rewrite_styles: Vec<CustomRewriteStyle>,
    /// Global last-used Rewrite style id (persisted on successful Generate).
    #[serde(default)]
    pub last_used_rewrite_style_id: Option<String>,
    /// Active Rewrite catalog model id (GGUF on disk). Cleared when Remove active.
    #[serde(default)]
    pub active_rewrite_model_id: Option<String>,
    /// Hardware fingerprint the user last Keep/Switch'd for (at most once per change).
    #[serde(default)]
    pub rewrite_hardware_prompt_acked_fingerprint: Option<String>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            install_completed: false,
            testing_set_completed: false,
            first_run_completed: false,
            testing_set: Vec::new(),
            testing_set_max: default_testing_set_max(),
            app_visible_repos: Vec::new(),
            all_repositories_warning: false,
            last_used_repo: None,
            open_hotkey: None,
            ptt_hotkey: None,
            custom_rewrite_styles: Vec::new(),
            last_used_rewrite_style_id: None,
            active_rewrite_model_id: None,
            rewrite_hardware_prompt_acked_fingerprint: None,
        }
    }
}

/// Per-catalog-entry disk status for Rewrite model lifecycle.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RewriteModelDiskStatus {
    pub id: String,
    pub display_name: String,
    pub size_bytes: u64,
    pub summary: String,
    pub on_disk: bool,
    pub verified: bool,
    pub active: bool,
    /// On disk but not verified against the current catalog SHA/size (R32 Update available).
    pub update_available: bool,
}

/// Soft Keep/Switch when hardware recommendation diverges from the active model.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RewriteHardwareSwitchPrompt {
    pub current_model_id: String,
    pub recommended_model_id: String,
    pub reason: String,
    pub fingerprint: String,
}

/// Snapshot for Rewrite setup / model settings.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RewriteModelStatusSnapshot {
    pub models: Vec<RewriteModelDiskStatus>,
    pub active_model_id: Option<String>,
    pub recommended_model_id: String,
    pub recommended_reason: String,
    /// Tier letter for UI/debug (`A`–`D`).
    pub hardware_tier: String,
    /// Tier D quality alternative catalog id when applicable.
    pub quality_alt_model_id: Option<String>,
    /// Present at most once per hardware fingerprint when recommendation diverges.
    pub hardware_switch_prompt: Option<RewriteHardwareSwitchPrompt>,
    pub needs_setup: bool,
}

/// Detects system RAM + usable Vulkan (+ VRAM when listed) for Rewrite recommendation.
pub trait HardwareProbe: Send + Sync {
    fn probe(&self) -> crate::core::rewrite_hardware::HardwareProfile;
}

/// Fixed profile for tests / default core wiring (tier C: Vulkan, VRAM unknown → Phi-4 mini).
#[derive(Debug, Clone)]
pub struct FixedHardwareProbe {
    pub profile: crate::core::rewrite_hardware::HardwareProfile,
}

impl Default for FixedHardwareProbe {
    fn default() -> Self {
        Self {
            profile: crate::core::rewrite_hardware::HardwareProfile {
                ram_gb: 16,
                vulkan_usable: true,
                vram_mb: None,
            },
        }
    }
}

impl HardwareProbe for FixedHardwareProbe {
    fn probe(&self) -> crate::core::rewrite_hardware::HardwareProfile {
        self.profile.clone()
    }
}

/// Local GGUF files for curated Rewrite models (download-on-demand).
pub trait RewriteModelFiles: Send + Sync {
    /// Delete orphan `*.gguf.partial` files left by cancel/fail.
    fn clean_orphan_partials(&self) -> Result<(), RewriteModelFileError>;

    /// Absolute path for a catalog filename under the models directory.
    fn path_for(&self, filename: &str) -> std::path::PathBuf;

    /// On-disk byte length when the final `.gguf` exists.
    fn on_disk_len(&self, filename: &str) -> Option<u64>;

    /// Size + SHA-256 verification for a completed download.
    fn is_verified(&self, filename: &str, expected_size: u64, expected_sha256: &str) -> bool;

    /// Remove a completed model file (no-op if missing).
    fn remove(&self, filename: &str) -> Result<(), RewriteModelFileError>;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RewriteModelFileError {
    Unavailable,
}

/// No-op model files (tests / until wired).
#[derive(Debug, Default)]
pub struct EmptyRewriteModelFiles;

impl RewriteModelFiles for EmptyRewriteModelFiles {
    fn clean_orphan_partials(&self) -> Result<(), RewriteModelFileError> {
        Ok(())
    }

    fn path_for(&self, filename: &str) -> std::path::PathBuf {
        std::path::PathBuf::from(filename)
    }

    fn on_disk_len(&self, _filename: &str) -> Option<u64> {
        None
    }

    fn is_verified(&self, _filename: &str, _expected_size: u64, _expected_sha256: &str) -> bool {
        false
    }

    fn remove(&self, _filename: &str) -> Result<(), RewriteModelFileError> {
        Ok(())
    }
}

/// Rewrite style as surfaced to Inbox (built-in or user-defined).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RewriteStyleInfo {
    pub id: String,
    pub name: String,
    pub instruction: String,
    pub builtin: bool,
}

/// Snapshot of available Rewrite styles plus the resolved last-used id.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RewriteStylesSnapshot {
    pub styles: Vec<RewriteStyleInfo>,
    pub last_used_id: String,
}

/// Input to the Rewrite engine (working title/body + resolved style).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RewriteInput {
    pub title: String,
    pub body: String,
    pub style: RewriteStyleInfo,
}

/// Proposed title + body from Rewrite (not yet Accept-ed into the Draft).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RewriteProposal {
    pub title: String,
    pub body: String,
}

/// On-device Rewrite inference boundary (stub or llama.cpp sidecar).
pub trait RewriteEngine: Send + Sync {
    fn rewrite(&self, input: &RewriteInput) -> Result<RewriteProposal, RewriteEngineError>;

    /// Stop an in-flight Generate when the engine supports process cancel.
    fn cancel(&self) {}
}

/// Failures from the Rewrite engine port (distinct from eligibility / settings).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum RewriteEngineError {
    EngineFailed,
    /// Soft ~60s Generate timeout (no auto-retry).
    TimedOut,
    /// In-flight Generate was cancelled.
    Cancelled,
}

/// Deterministic stub Rewrite engine for UX / domain demos until real inference lands.
#[derive(Debug, Default, Clone)]
pub struct StubRewriteEngine;

impl RewriteEngine for StubRewriteEngine {
    fn rewrite(&self, input: &RewriteInput) -> Result<RewriteProposal, RewriteEngineError> {
        let title = input.title.trim();
        let body = input.body.trim();
        let style_name = input.style.name.as_str();
        let proposal = match input.style.id.as_str() {
            "bug_report" => RewriteProposal {
                title: format!("{title} (bug report)"),
                body: format!(
                    "## Problem\n{body}\n\n## Steps to reproduce\n\n## Expected\n\n## Actual\n\n## Environment\n\n_(Stub Rewrite — {style_name})_"
                ),
            },
            "feature_request" => RewriteProposal {
                title: format!("{title} (feature request)"),
                body: format!(
                    "## Problem\n{body}\n\n## Proposal\n\n## Why it matters\n\n_(Stub Rewrite — {style_name})_"
                ),
            },
            "question" => RewriteProposal {
                title: format!("{title}?"),
                body: format!(
                    "## Question\n{body}\n\n## Context\n\n_(Stub Rewrite — {style_name})_"
                ),
            },
            "concise" => RewriteProposal {
                title: truncate_chars(title, 72),
                body: format!("{body}\n\n_(Stub Rewrite — Concise)_"),
            },
            _ => RewriteProposal {
                title: if title.is_empty() {
                    format!("Clear rewrite ({style_name})")
                } else {
                    title.to_string()
                },
                body: format!(
                    "{body}\n\n_(Stub Rewrite — {style_name}: cleaned for skimability; facts preserved.)_"
                ),
            },
        };
        Ok(proposal)
    }
}

fn truncate_chars(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    s.chars().take(max).collect()
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

    /// List labels that exist on a repository (Label catalog source).
    fn list_labels(&self, token: &str, repo: &RepoId) -> Result<Vec<RepoLabel>, GitHubError>;

    /// Create a label on a repository (used when Publish needs a novel Draft name).
    fn create_label(
        &self,
        token: &str,
        repo: &RepoId,
        name: &str,
        color: &str,
    ) -> Result<RepoLabel, GitHubError>;
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

pub trait LabelCatalogStore: Send + Sync {
    fn load(&self, repo: &RepoId) -> Result<Option<LabelCatalog>, LabelCatalogStoreError>;
    fn save(&mut self, catalog: LabelCatalog) -> Result<(), LabelCatalogStoreError>;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LabelCatalogStoreError {
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

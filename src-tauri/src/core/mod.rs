//! Issuebridge application core — use-cases behind injectable ports.
//! UI / Tauri IPC are adapters outside this module.

mod error;
mod ports;

use std::time::Duration;

pub use error::{
    AuthError, CaptureError, InboxError, InstallError, LabelCatalogError, PublishError,
    TestingSetError, UpdateError,
};
pub use ports::{
    AppInstallSnapshot, AppSettings, CaptureInput, Clock, CreatedIssue, Draft, DraftStore,
    DraftStoreError, EditDraftInput, EnsuredLabelCatalog, GitHub, GitHubError, InboxItem,
    LabelCatalog, LabelCatalogStore, LabelCatalogStoreError, LocalLink, RemoteSnapshot, RepoId,
    RepoLabel, SettingsStore, SettingsStoreError, StoredCredentials, TokenStore, TokenStoreError,
    VoiceError, VoiceTranscriber,
};

/// Auth state visible to callers (never includes raw tokens).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthState {
    SignedOut,
    SignedIn,
}

/// Derived first-run step for UI routing.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FirstRunStep {
    SignIn,
    InstallApp,
    TestingSet,
    TryCapture,
    Ready,
}

/// Result of Install App Continue (refresh installations).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InstallContinueOutcome {
    NoInstall,
    ZeroRepos,
    Ready { all_repositories_warning: bool },
}

/// Maximum repositories in the Testing set (product rule: up to 3).
const TESTING_SET_MAX: usize = 3;

/// Label catalog older than this is refreshed on ensure.
const LABEL_CATALOG_STALE: Duration = Duration::from_secs(15 * 60);

/// Default GitHub label color (no `#`) for novel Draft names created on Publish.
const DEFAULT_NOVEL_LABEL_COLOR: &str = "ededed";

/// Application core: auth session gating, Capture, Inbox, Publish, etc.
pub struct IssuebridgeCore<G, T, D, V, C, S, L> {
    github: G,
    token_store: T,
    draft_store: D,
    voice: V,
    clock: C,
    settings_store: S,
    label_catalog_store: L,
    /// Process-local signed-in flag. Set on successful sign-in; cleared on sign-out.
    /// Vault remains source of truth across restarts; this avoids flaky post-store re-reads
    /// leaving the UI stuck on Sign in after a successful PAT/OAuth.
    session_signed_in: bool,
}

impl<G, T, D, V, C, S, L> IssuebridgeCore<G, T, D, V, C, S, L>
where
    G: GitHub,
    T: TokenStore,
    D: DraftStore,
    V: VoiceTranscriber,
    C: Clock,
    S: SettingsStore,
    L: LabelCatalogStore,
{
    pub fn new(
        github: G,
        token_store: T,
        draft_store: D,
        voice: V,
        clock: C,
        settings_store: S,
        label_catalog_store: L,
    ) -> Self {
        let session_signed_in = matches!(token_store.load(), Ok(Some(_)));
        Self {
            github,
            token_store,
            draft_store,
            voice,
            clock,
            settings_store,
            label_catalog_store,
            session_signed_in,
        }
    }

    pub fn auth_state(&self) -> AuthState {
        if self.session_signed_in {
            return AuthState::SignedIn;
        }
        match self.token_store.load() {
            Ok(Some(_)) => AuthState::SignedIn,
            Ok(None) => AuthState::SignedOut,
            Err(_) => AuthState::SignedOut,
        }
    }

    /// Sign in with a personal access token. Validates via GitHub, then stores credentials.
    /// Never returns the token string.
    pub fn sign_in_with_pat(&mut self, pat: &str) -> Result<AuthState, AuthError> {
        let pat = pat.trim();
        if pat.is_empty() {
            return Err(AuthError::EmptyToken);
        }

        self.github.validate_pat(pat).map_err(map_github_error)?;

        self.token_store
            .store(StoredCredentials {
                access_token: pat.to_string(),
                refresh_token: None,
            })
            .map_err(|_| AuthError::StorageUnavailable)?;

        self.session_signed_in = true;
        Ok(AuthState::SignedIn)
    }

    /// Complete Authorization Code + PKCE by exchanging the code, then store tokens.
    /// Never returns token strings.
    pub fn sign_in_with_oauth(
        &mut self,
        code: &str,
        code_verifier: &str,
    ) -> Result<AuthState, AuthError> {
        if code.trim().is_empty() || code_verifier.trim().is_empty() {
            return Err(AuthError::InvalidCredentials);
        }

        let credentials = self
            .github
            .exchange_oauth_code(code, code_verifier)
            .map_err(map_github_error)?;

        self.token_store
            .store(credentials)
            .map_err(|_| AuthError::StorageUnavailable)?;

        self.session_signed_in = true;
        Ok(AuthState::SignedIn)
    }

    /// Clear stored credentials and return to signed-out state.
    /// Does not rewind Install / Testing-set / first-run-complete progress.
    pub fn sign_out(&mut self) -> Result<(), AuthError> {
        self.token_store
            .clear()
            .map_err(|_| AuthError::StorageUnavailable)?;
        self.session_signed_in = false;
        Ok(())
    }

    /// Whether the main window should open on launch (wizard still incomplete).
    /// After first-run completes, launches are tray-first (`false`).
    pub fn should_open_main_on_launch(&self) -> bool {
        !self
            .settings_store
            .load()
            .map(|s| s.first_run_completed)
            .unwrap_or(false)
    }

    /// Current first-run step (derived from auth + persisted settings).
    pub fn first_run_step(&self) -> FirstRunStep {
        if self.auth_state() != AuthState::SignedIn {
            return FirstRunStep::SignIn;
        }

        let settings = self.settings_store.load().unwrap_or_default();
        if !settings.install_completed {
            return FirstRunStep::InstallApp;
        }
        if !settings.testing_set_completed {
            return FirstRunStep::TestingSet;
        }
        if !settings.first_run_completed {
            return FirstRunStep::TryCapture;
        }
        FirstRunStep::Ready
    }

    /// Refresh App installations; advance past Install only when ≥1 App-visible repo exists.
    pub fn continue_install(&mut self) -> Result<InstallContinueOutcome, InstallError> {
        let credentials = self
            .token_store
            .load()
            .map_err(|_| InstallError::StorageUnavailable)?
            .ok_or(InstallError::NotSignedIn)?;

        let snapshot = self
            .github
            .list_app_install_snapshot(&credentials.access_token)
            .map_err(|err| match err {
                GitHubError::InvalidCredentials => InstallError::TokenLacksInstallAccess,
                GitHubError::Unavailable => InstallError::ProviderUnavailable,
            })?;

        if !snapshot.has_install {
            return Ok(InstallContinueOutcome::NoInstall);
        }
        if snapshot.repos.is_empty() {
            return Ok(InstallContinueOutcome::ZeroRepos);
        }

        let mut settings = self
            .settings_store
            .load()
            .map_err(|_| InstallError::StorageUnavailable)?;
        settings.install_completed = true;
        settings.app_visible_repos = snapshot.repos;
        settings.all_repositories_warning = snapshot.all_repositories;
        self.settings_store
            .save(settings)
            .map_err(|_| InstallError::StorageUnavailable)?;

        Ok(InstallContinueOutcome::Ready {
            all_repositories_warning: snapshot.all_repositories,
        })
    }

    pub fn testing_set(&self) -> Vec<RepoId> {
        self.settings_store
            .load()
            .map(|s| s.testing_set)
            .unwrap_or_default()
    }

    pub fn app_visible_repos(&self) -> Vec<RepoId> {
        self.settings_store
            .load()
            .map(|s| s.app_visible_repos)
            .unwrap_or_default()
    }

    pub fn all_repositories_warning(&self) -> bool {
        self.settings_store
            .load()
            .map(|s| s.all_repositories_warning)
            .unwrap_or(false)
    }

    /// Add a repo to the Testing set. At most 3; must be App-visible.
    pub fn add_testing_set_repo(&mut self, repo: RepoId) -> Result<(), TestingSetError> {
        if self.auth_state() != AuthState::SignedIn {
            return Err(TestingSetError::NotSignedIn);
        }

        let mut settings = self
            .settings_store
            .load()
            .map_err(|_| TestingSetError::StorageUnavailable)?;
        if !settings.install_completed {
            return Err(TestingSetError::InstallIncomplete);
        }
        if !settings.app_visible_repos.contains(&repo) {
            return Err(TestingSetError::NotAppVisible);
        }
        if settings.testing_set.contains(&repo) {
            return Ok(());
        }
        if settings.testing_set.len() >= TESTING_SET_MAX {
            return Err(TestingSetError::LimitReached);
        }

        settings.testing_set.push(repo);
        self.settings_store
            .save(settings)
            .map_err(|_| TestingSetError::StorageUnavailable)
    }

    pub fn remove_testing_set_repo(&mut self, repo: &RepoId) -> Result<(), TestingSetError> {
        if self.auth_state() != AuthState::SignedIn {
            return Err(TestingSetError::NotSignedIn);
        }

        let mut settings = self
            .settings_store
            .load()
            .map_err(|_| TestingSetError::StorageUnavailable)?;
        settings.testing_set.retain(|r| r != repo);
        self.settings_store
            .save(settings)
            .map_err(|_| TestingSetError::StorageUnavailable)
    }

    /// Confirm Testing set (1–3 repos) and advance first-run to Try capture.
    pub fn complete_testing_set(&mut self) -> Result<(), TestingSetError> {
        if self.auth_state() != AuthState::SignedIn {
            return Err(TestingSetError::NotSignedIn);
        }

        let mut settings = self
            .settings_store
            .load()
            .map_err(|_| TestingSetError::StorageUnavailable)?;
        if !settings.install_completed {
            return Err(TestingSetError::InstallIncomplete);
        }
        if settings.testing_set.is_empty() {
            return Err(TestingSetError::Empty);
        }
        if settings.testing_set.len() > TESTING_SET_MAX {
            return Err(TestingSetError::LimitReached);
        }

        settings.testing_set_completed = true;
        self.settings_store
            .save(settings)
            .map_err(|_| TestingSetError::StorageUnavailable)
    }

    /// Skip optional Try capture and complete first-run (no Draft required).
    pub fn skip_try_capture(&mut self) -> Result<(), TestingSetError> {
        if self.auth_state() != AuthState::SignedIn {
            return Err(TestingSetError::NotSignedIn);
        }

        let mut settings = self
            .settings_store
            .load()
            .map_err(|_| TestingSetError::StorageUnavailable)?;
        settings.first_run_completed = true;
        self.settings_store
            .save(settings)
            .map_err(|_| TestingSetError::StorageUnavailable)
    }

    /// Save a Capture into a Draft. Refused when signed out. Does not Publish.
    /// When first-run is still open after Testing set, Save also completes first-run.
    pub fn save_capture(&mut self, input: CaptureInput) -> Result<Draft, CaptureError> {
        if self.auth_state() != AuthState::SignedIn {
            return Err(CaptureError::NotSignedIn);
        }

        let now = self.clock.now();
        let draft = Draft {
            id: mint_draft_id(now),
            repo: input.repo.clone(),
            title: input.title,
            body: input.body,
            label_names: Vec::new(),
            created_at: now,
            updated_at: now,
            local_link: None,
            remote_snapshot: None,
        };

        self.draft_store
            .save(draft.clone())
            .map_err(|_| CaptureError::StorageUnavailable)?;

        let mut settings = self
            .settings_store
            .load()
            .map_err(|_| CaptureError::StorageUnavailable)?;
        settings.last_used_repo = Some(input.repo);
        if settings.testing_set_completed && !settings.first_run_completed {
            settings.first_run_completed = true;
        }
        self.settings_store
            .save(settings)
            .map_err(|_| CaptureError::StorageUnavailable)?;

        Ok(draft)
    }

    /// Flat Inbox list sorted by local `updated_at` descending.
    pub fn list_inbox(&self) -> Result<Vec<InboxItem>, InboxError> {
        if self.auth_state() != AuthState::SignedIn {
            return Err(InboxError::NotSignedIn);
        }

        let mut drafts = self
            .draft_store
            .list()
            .map_err(|_| InboxError::StorageUnavailable)?;
        drafts.sort_by_key(|b| std::cmp::Reverse(b.updated_at));

        Ok(drafts.into_iter().map(inbox_item_from_draft).collect())
    }

    /// Load a Draft for the Inbox editor.
    pub fn get_draft(&self, id: &str) -> Result<Draft, InboxError> {
        if self.auth_state() != AuthState::SignedIn {
            return Err(InboxError::NotSignedIn);
        }

        self.draft_store
            .get(id)
            .map_err(|_| InboxError::StorageUnavailable)?
            .ok_or(InboxError::NotFound)
    }

    /// Update working title, body, and ordered label names on a Draft.
    pub fn edit_draft(&mut self, input: EditDraftInput) -> Result<Draft, InboxError> {
        if self.auth_state() != AuthState::SignedIn {
            return Err(InboxError::NotSignedIn);
        }

        let mut draft = self
            .draft_store
            .get(&input.id)
            .map_err(|_| InboxError::StorageUnavailable)?
            .ok_or(InboxError::NotFound)?;

        draft.title = input.title;
        draft.body = input.body;
        draft.label_names = input.label_names;
        draft.updated_at = self.clock.now();

        self.draft_store
            .save(draft.clone())
            .map_err(|_| InboxError::StorageUnavailable)?;

        Ok(draft)
    }

    /// Load the Label catalog for a repo, refreshing from GitHub when missing or stale.
    /// On refresh failure, returns the last good catalog (or empty) with `refresh_failed`.
    pub fn ensure_label_catalog(
        &mut self,
        repo: &RepoId,
    ) -> Result<EnsuredLabelCatalog, LabelCatalogError> {
        if self.auth_state() != AuthState::SignedIn {
            return Err(LabelCatalogError::NotSignedIn);
        }

        let cached = self
            .label_catalog_store
            .load(repo)
            .map_err(|_| LabelCatalogError::StorageUnavailable)?;

        let now = self.clock.now();
        let needs_refresh = match &cached {
            None => true,
            Some(catalog) => now
                .duration_since(catalog.refreshed_at)
                .map(|age| age >= LABEL_CATALOG_STALE)
                .unwrap_or(true),
        };

        if !needs_refresh {
            let catalog = cached.expect("cached when not refreshing");
            return Ok(EnsuredLabelCatalog {
                repo: catalog.repo,
                labels: catalog.labels,
                refreshed_at: Some(catalog.refreshed_at),
                refresh_failed: false,
            });
        }

        let credentials = self
            .token_store
            .load()
            .map_err(|_| LabelCatalogError::StorageUnavailable)?
            .ok_or(LabelCatalogError::NotSignedIn)?;

        match self.github.list_labels(&credentials.access_token, repo) {
            Ok(labels) => {
                let catalog = LabelCatalog {
                    repo: repo.clone(),
                    labels,
                    refreshed_at: now,
                };
                self.label_catalog_store
                    .save(catalog.clone())
                    .map_err(|_| LabelCatalogError::StorageUnavailable)?;
                Ok(EnsuredLabelCatalog {
                    repo: catalog.repo,
                    labels: catalog.labels,
                    refreshed_at: Some(catalog.refreshed_at),
                    refresh_failed: false,
                })
            }
            Err(_) => {
                let (labels, refreshed_at) = match cached {
                    Some(catalog) => (catalog.labels, Some(catalog.refreshed_at)),
                    None => (Vec::new(), None),
                };
                Ok(EnsuredLabelCatalog {
                    repo: repo.clone(),
                    labels,
                    refreshed_at,
                    refresh_failed: true,
                })
            }
        }
    }

    /// Prefetch Label catalogs for every repo currently in the Testing set.
    pub fn prefetch_testing_set_label_catalogs(&mut self) -> Result<(), LabelCatalogError> {
        let repos = self.testing_set();
        for repo in repos {
            let _ = self.ensure_label_catalog(&repo)?;
        }
        Ok(())
    }

    /// Publish a Draft to GitHub: create the issue, store Local link + Remote snapshot.
    pub fn publish_draft(&mut self, id: &str) -> Result<Draft, PublishError> {
        if self.auth_state() != AuthState::SignedIn {
            return Err(PublishError::NotSignedIn);
        }

        let credentials = self
            .token_store
            .load()
            .map_err(|_| PublishError::StorageUnavailable)?
            .ok_or(PublishError::NotSignedIn)?;

        let mut draft = self
            .draft_store
            .get(id)
            .map_err(|_| PublishError::StorageUnavailable)?
            .ok_or(PublishError::NotFound)?;

        if draft.is_linked() {
            return Err(PublishError::AlreadyLinked);
        }

        if draft.title.trim().is_empty() {
            return Err(PublishError::TitleRequired);
        }

        let label_names = self
            .ensure_remote_labels(&credentials.access_token, &draft.repo, &draft.label_names)
            .map_err(|err| match err {
                GitHubError::InvalidCredentials | GitHubError::Unavailable => {
                    PublishError::ProviderUnavailable
                }
            })?;

        let created = self
            .github
            .create_issue(
                &credentials.access_token,
                &draft.repo,
                draft.title.trim(),
                &draft.body,
                &label_names,
            )
            .map_err(|err| match err {
                GitHubError::InvalidCredentials | GitHubError::Unavailable => {
                    PublishError::ProviderUnavailable
                }
            })?;

        // Align working fields with what GitHub accepted so Dirty stays clear after Publish.
        draft.title = created.title.clone();
        draft.body = created.body.clone();
        draft.label_names = created.label_names.clone();
        draft.local_link = Some(LocalLink {
            number: created.number,
            html_url: created.html_url,
        });
        draft.remote_snapshot = Some(RemoteSnapshot {
            title: created.title,
            body: created.body,
            label_names: created.label_names,
            updated_at: created.updated_at,
        });
        draft.updated_at = self.clock.now();

        self.draft_store
            .save(draft.clone())
            .map_err(|_| PublishError::StorageUnavailable)?;

        Ok(draft)
    }

    /// Push working fields for a linked Draft when remote `updated_at` still matches the snapshot.
    pub fn update_linked_draft(&mut self, id: &str) -> Result<Draft, UpdateError> {
        let (credentials, mut draft, number) = self.load_linked_for_update(id)?;
        if draft.title.trim().is_empty() {
            return Err(UpdateError::TitleRequired);
        }

        let remote = self
            .github
            .get_issue(&credentials.access_token, &draft.repo, number)
            .map_err(map_update_github_error)?;

        let snapshot = draft
            .remote_snapshot
            .as_ref()
            .ok_or(UpdateError::NotLinked)?;
        if remote.updated_at != snapshot.updated_at {
            return Err(UpdateError::Conflict);
        }

        let label_names = self
            .ensure_remote_labels(&credentials.access_token, &draft.repo, &draft.label_names)
            .map_err(map_update_github_error)?;

        let updated = self
            .github
            .update_issue(
                &credentials.access_token,
                &draft.repo,
                number,
                draft.title.trim(),
                &draft.body,
                &label_names,
            )
            .map_err(map_update_github_error)?;

        apply_remote_issue_to_draft(&mut draft, &updated, self.clock.now());
        self.draft_store
            .save(draft.clone())
            .map_err(|_| UpdateError::StorageUnavailable)?;
        Ok(draft)
    }

    /// Conflict resolution: PATCH local working fields to GitHub and refresh the Remote snapshot.
    pub fn keep_mine(&mut self, id: &str) -> Result<Draft, UpdateError> {
        let (credentials, mut draft, number) = self.load_linked_for_update(id)?;
        if draft.title.trim().is_empty() {
            return Err(UpdateError::TitleRequired);
        }

        let label_names = self
            .ensure_remote_labels(&credentials.access_token, &draft.repo, &draft.label_names)
            .map_err(map_update_github_error)?;

        let updated = self
            .github
            .update_issue(
                &credentials.access_token,
                &draft.repo,
                number,
                draft.title.trim(),
                &draft.body,
                &label_names,
            )
            .map_err(map_update_github_error)?;

        apply_remote_issue_to_draft(&mut draft, &updated, self.clock.now());
        self.draft_store
            .save(draft.clone())
            .map_err(|_| UpdateError::StorageUnavailable)?;
        Ok(draft)
    }

    /// Conflict resolution: replace local working fields from a fresh GET and refresh the snapshot.
    pub fn use_theirs(&mut self, id: &str) -> Result<Draft, UpdateError> {
        let (credentials, mut draft, number) = self.load_linked_for_update(id)?;
        let remote = self
            .github
            .get_issue(&credentials.access_token, &draft.repo, number)
            .map_err(map_update_github_error)?;

        apply_remote_issue_to_draft(&mut draft, &remote, self.clock.now());
        self.draft_store
            .save(draft.clone())
            .map_err(|_| UpdateError::StorageUnavailable)?;
        Ok(draft)
    }

    /// Create missing remote labels for Draft names, canonicalize casing, refresh Label catalog.
    fn ensure_remote_labels(
        &mut self,
        token: &str,
        repo: &RepoId,
        label_names: &[String],
    ) -> Result<Vec<String>, GitHubError> {
        let mut catalog_labels = self.github.list_labels(token, repo).unwrap_or_else(|_| {
            self.label_catalog_store
                .load(repo)
                .ok()
                .flatten()
                .map(|c| c.labels)
                .unwrap_or_default()
        });

        let mut canonical = Vec::with_capacity(label_names.len());

        for name in label_names {
            let trimmed = name.trim();
            if trimmed.is_empty() {
                continue;
            }
            if let Some(existing) = find_label_ci(&catalog_labels, trimmed) {
                canonical.push(existing.name.clone());
                continue;
            }
            match self
                .github
                .create_label(token, repo, trimmed, DEFAULT_NOVEL_LABEL_COLOR)
            {
                Ok(created) => {
                    catalog_labels.push(created.clone());
                    canonical.push(created.name);
                }
                Err(_) => {
                    // Soft path: list may have failed while the label already exists remotely.
                    canonical.push(trimmed.to_string());
                }
            }
        }

        let mut deduped = Vec::new();
        for name in canonical {
            if deduped
                .iter()
                .any(|existing: &String| existing.eq_ignore_ascii_case(&name))
            {
                continue;
            }
            deduped.push(name);
        }

        let catalog = LabelCatalog {
            repo: repo.clone(),
            labels: catalog_labels,
            refreshed_at: self.clock.now(),
        };
        let _ = self.label_catalog_store.save(catalog);

        Ok(deduped)
    }

    fn load_linked_for_update(
        &self,
        id: &str,
    ) -> Result<(StoredCredentials, Draft, u64), UpdateError> {
        if self.auth_state() != AuthState::SignedIn {
            return Err(UpdateError::NotSignedIn);
        }

        let credentials = self
            .token_store
            .load()
            .map_err(|_| UpdateError::StorageUnavailable)?
            .ok_or(UpdateError::NotSignedIn)?;

        let draft = self
            .draft_store
            .get(id)
            .map_err(|_| UpdateError::StorageUnavailable)?
            .ok_or(UpdateError::NotFound)?;

        let number = draft
            .local_link
            .as_ref()
            .map(|l| l.number)
            .ok_or(UpdateError::NotLinked)?;

        if draft.remote_snapshot.is_none() {
            return Err(UpdateError::NotLinked);
        }

        Ok((credentials, draft, number))
    }

    pub fn last_used_repo(&self) -> Option<RepoId> {
        self.settings_store
            .load()
            .ok()
            .and_then(|s| s.last_used_repo)
    }

    pub fn open_hotkey(&self) -> String {
        self.settings_store
            .load()
            .ok()
            .and_then(|s| s.open_hotkey)
            .unwrap_or_else(|| DEFAULT_OPEN_HOTKEY.to_string())
    }

    pub fn ptt_hotkey(&self) -> String {
        self.settings_store
            .load()
            .ok()
            .and_then(|s| s.ptt_hotkey)
            .unwrap_or_else(|| DEFAULT_PTT_HOTKEY.to_string())
    }

    /// Transcribe a PTT recording and append into the current Capture field text
    /// (Title or Body — chosen by the UI from focus). Does not persist a Draft.
    pub fn apply_ptt(&self, current_text: &str, audio_path: &str) -> Result<String, VoiceError> {
        let transcript = self.voice.transcribe(audio_path)?;
        let transcript = transcript.trim();
        if transcript.is_empty() {
            return Err(VoiceError::EmptyTranscript);
        }
        Ok(append_transcript(current_text, transcript))
    }
}

const DEFAULT_OPEN_HOTKEY: &str = "Ctrl+Alt+Shift+I";
const DEFAULT_PTT_HOTKEY: &str = "Ctrl+Alt+Shift+V";

fn append_transcript(current_text: &str, transcript: &str) -> String {
    if current_text.is_empty() {
        return transcript.to_string();
    }
    if current_text
        .chars()
        .last()
        .is_some_and(|c| c.is_whitespace())
    {
        format!("{current_text}{transcript}")
    } else {
        format!("{current_text} {transcript}")
    }
}

fn mint_draft_id(now: std::time::SystemTime) -> String {
    use std::time::UNIX_EPOCH;
    let nanos = now
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("d-{nanos}-{:016x}", rand::random::<u64>())
}

fn inbox_item_from_draft(draft: Draft) -> InboxItem {
    let display_title = if draft.title.trim().is_empty() {
        "Untitled".to_string()
    } else {
        draft.title.clone()
    };
    let linked = draft.is_linked();
    let dirty = draft.is_dirty();
    InboxItem {
        id: draft.id,
        display_title,
        repo: draft.repo,
        linked,
        dirty,
    }
}

fn map_github_error(err: GitHubError) -> AuthError {
    match err {
        GitHubError::InvalidCredentials => AuthError::InvalidCredentials,
        GitHubError::Unavailable => AuthError::ProviderUnavailable,
    }
}

fn map_update_github_error(err: GitHubError) -> UpdateError {
    match err {
        GitHubError::InvalidCredentials | GitHubError::Unavailable => {
            UpdateError::ProviderUnavailable
        }
    }
}

fn apply_remote_issue_to_draft(
    draft: &mut Draft,
    issue: &CreatedIssue,
    now: std::time::SystemTime,
) {
    draft.title = issue.title.clone();
    draft.body = issue.body.clone();
    draft.label_names = issue.label_names.clone();
    draft.remote_snapshot = Some(RemoteSnapshot {
        title: issue.title.clone(),
        body: issue.body.clone(),
        label_names: issue.label_names.clone(),
        updated_at: issue.updated_at.clone(),
    });
    draft.updated_at = now;
}

fn find_label_ci<'a>(labels: &'a [RepoLabel], name: &str) -> Option<&'a RepoLabel> {
    labels
        .iter()
        .find(|label| label.name.eq_ignore_ascii_case(name))
}

/// Resolve Draft label names against a Label catalog (case-insensitive → canonical).
pub fn canonicalize_label_names(names: &[String], catalog: &[RepoLabel]) -> Vec<String> {
    let mut out = Vec::new();
    for name in names {
        let trimmed = name.trim();
        if trimmed.is_empty() {
            continue;
        }
        let canonical = find_label_ci(catalog, trimmed)
            .map(|label| label.name.clone())
            .unwrap_or_else(|| trimmed.to_string());
        if out
            .iter()
            .any(|existing: &String| existing.eq_ignore_ascii_case(&canonical))
        {
            continue;
        }
        out.push(canonical);
    }
    out
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::*;
    use ports::fakes::{
        FakeClock, FakeDraftStore, FakeGitHub, FakeLabelCatalogStore, FakeSettingsStore,
        FakeTokenStore, FakeVoiceTranscriber,
    };

    type TestCore = IssuebridgeCore<
        FakeGitHub,
        FakeTokenStore,
        FakeDraftStore,
        FakeVoiceTranscriber,
        FakeClock,
        FakeSettingsStore,
        FakeLabelCatalogStore,
    >;

    fn fresh_core() -> TestCore {
        IssuebridgeCore::new(
            FakeGitHub::default(),
            FakeTokenStore::default(),
            FakeDraftStore::default(),
            FakeVoiceTranscriber::default(),
            FakeClock::default(),
            FakeSettingsStore::default(),
            FakeLabelCatalogStore::default(),
        )
    }

    fn signed_in_core(github: FakeGitHub, settings: FakeSettingsStore) -> TestCore {
        signed_in_core_with_voice(github, settings, FakeVoiceTranscriber::default())
    }

    fn signed_in_core_with_voice(
        github: FakeGitHub,
        settings: FakeSettingsStore,
        voice: FakeVoiceTranscriber,
    ) -> TestCore {
        let mut core = IssuebridgeCore::new(
            github,
            FakeTokenStore::default(),
            FakeDraftStore::default(),
            voice,
            FakeClock::default(),
            settings,
            FakeLabelCatalogStore::default(),
        );
        core.sign_in_with_pat("ghp_test_token_not_a_secret")
            .expect("PAT sign-in");
        core
    }

    fn repo(owner: &str, name: &str) -> RepoId {
        RepoId {
            owner: owner.into(),
            name: name.into(),
        }
    }

    #[test]
    fn freshly_constructed_core_is_signed_out_and_refuses_capture_save() {
        let mut core = fresh_core();

        assert_eq!(core.auth_state(), AuthState::SignedOut);

        let err = core
            .save_capture(CaptureInput {
                repo: repo("acme", "widgets"),
                title: "Broken button".into(),
                body: "Clicking Save does nothing.".into(),
            })
            .expect_err("Capture Save must be refused while signed out");

        assert_eq!(err, CaptureError::NotSignedIn);
    }

    #[test]
    fn sign_in_with_pat_then_sign_out_transitions_auth_state() {
        let mut core = fresh_core();

        assert_eq!(core.auth_state(), AuthState::SignedOut);

        let state = core
            .sign_in_with_pat("ghp_test_token_not_a_secret")
            .expect("PAT sign-in should succeed against FakeGitHub");
        assert_eq!(state, AuthState::SignedIn);
        assert_eq!(core.auth_state(), AuthState::SignedIn);

        core.sign_out().expect("sign-out should clear credentials");
        assert_eq!(core.auth_state(), AuthState::SignedOut);
    }

    #[test]
    fn sign_in_with_empty_pat_is_rejected_and_stays_signed_out() {
        let mut core = fresh_core();

        let err = core
            .sign_in_with_pat("   ")
            .expect_err("empty PAT must be rejected");
        assert_eq!(err, AuthError::EmptyToken);
        assert_eq!(core.auth_state(), AuthState::SignedOut);
    }

    #[test]
    fn sign_in_with_invalid_pat_is_rejected_and_stays_signed_out() {
        let mut core = IssuebridgeCore::new(
            FakeGitHub {
                reject_pat: true,
                ..FakeGitHub::default()
            },
            FakeTokenStore::default(),
            FakeDraftStore::default(),
            FakeVoiceTranscriber::default(),
            FakeClock::default(),
            FakeSettingsStore::default(),
            FakeLabelCatalogStore::default(),
        );

        let err = core
            .sign_in_with_pat("ghp_bad")
            .expect_err("invalid PAT must be rejected");
        assert_eq!(err, AuthError::InvalidCredentials);
        assert_eq!(core.auth_state(), AuthState::SignedOut);
    }

    #[test]
    fn sign_in_with_oauth_then_sign_out_transitions_auth_state() {
        let mut core = IssuebridgeCore::new(
            FakeGitHub {
                oauth_result: Ok(StoredCredentials {
                    access_token: "ghu_access".into(),
                    refresh_token: Some("ghr_refresh".into()),
                }),
                ..FakeGitHub::default()
            },
            FakeTokenStore::default(),
            FakeDraftStore::default(),
            FakeVoiceTranscriber::default(),
            FakeClock::default(),
            FakeSettingsStore::default(),
            FakeLabelCatalogStore::default(),
        );

        assert_eq!(core.auth_state(), AuthState::SignedOut);

        let state = core
            .sign_in_with_oauth("auth_code", "pkce_verifier")
            .expect("OAuth sign-in should succeed against FakeGitHub");
        assert_eq!(state, AuthState::SignedIn);
        assert_eq!(core.auth_state(), AuthState::SignedIn);

        core.sign_out().expect("sign-out should clear credentials");
        assert_eq!(core.auth_state(), AuthState::SignedOut);
    }

    #[test]
    fn failed_oauth_exchange_leaves_signed_out() {
        let mut core = IssuebridgeCore::new(
            FakeGitHub {
                oauth_result: Err(GitHubError::InvalidCredentials),
                ..FakeGitHub::default()
            },
            FakeTokenStore::default(),
            FakeDraftStore::default(),
            FakeVoiceTranscriber::default(),
            FakeClock::default(),
            FakeSettingsStore::default(),
            FakeLabelCatalogStore::default(),
        );

        let err = core
            .sign_in_with_oauth("bad_code", "verifier")
            .expect_err("failed exchange must reject sign-in");
        assert_eq!(err, AuthError::InvalidCredentials);
        assert_eq!(core.auth_state(), AuthState::SignedOut);
    }

    #[test]
    fn signed_in_with_empty_settings_is_on_install_app_step() {
        let core = signed_in_core(FakeGitHub::default(), FakeSettingsStore::default());
        assert_eq!(core.first_run_step(), FirstRunStep::InstallApp);
    }

    #[test]
    fn signed_out_first_run_step_is_sign_in() {
        let core = fresh_core();
        assert_eq!(core.first_run_step(), FirstRunStep::SignIn);
    }

    #[test]
    fn continue_install_with_no_install_stays_on_install_step() {
        let mut core = signed_in_core(
            FakeGitHub {
                install_snapshot: Ok(AppInstallSnapshot {
                    has_install: false,
                    repos: Vec::new(),
                    all_repositories: false,
                }),
                ..FakeGitHub::default()
            },
            FakeSettingsStore::default(),
        );

        let outcome = core.continue_install().expect("refresh should succeed");
        assert_eq!(outcome, InstallContinueOutcome::NoInstall);
        assert_eq!(core.first_run_step(), FirstRunStep::InstallApp);
    }

    #[test]
    fn continue_install_with_zero_repos_stays_on_install_step() {
        let mut core = signed_in_core(
            FakeGitHub {
                install_snapshot: Ok(AppInstallSnapshot {
                    has_install: true,
                    repos: Vec::new(),
                    all_repositories: false,
                }),
                ..FakeGitHub::default()
            },
            FakeSettingsStore::default(),
        );

        let outcome = core.continue_install().expect("refresh should succeed");
        assert_eq!(outcome, InstallContinueOutcome::ZeroRepos);
        assert_eq!(core.first_run_step(), FirstRunStep::InstallApp);
    }

    #[test]
    fn continue_install_with_repos_advances_to_testing_set_and_persists_visible_repos() {
        let settings = FakeSettingsStore::default();
        let mut core = signed_in_core(
            FakeGitHub {
                install_snapshot: Ok(AppInstallSnapshot {
                    has_install: true,
                    repos: vec![repo("acme", "widgets"), repo("acme", "gadgets")],
                    all_repositories: false,
                }),
                ..FakeGitHub::default()
            },
            settings.clone(),
        );

        let outcome = core.continue_install().expect("refresh should succeed");
        assert_eq!(
            outcome,
            InstallContinueOutcome::Ready {
                all_repositories_warning: false
            }
        );
        assert_eq!(core.first_run_step(), FirstRunStep::TestingSet);
        assert_eq!(
            core.app_visible_repos(),
            vec![repo("acme", "widgets"), repo("acme", "gadgets")]
        );

        // Persistence: reconstructed core resumes Testing set, not Install.
        let resumed = IssuebridgeCore::new(
            FakeGitHub::default(),
            FakeTokenStore {
                credentials: Some(StoredCredentials {
                    access_token: "ghp_test_token_not_a_secret".into(),
                    refresh_token: None,
                }),
            },
            FakeDraftStore::default(),
            FakeVoiceTranscriber::default(),
            FakeClock::default(),
            settings,
            FakeLabelCatalogStore::default(),
        );
        assert_eq!(resumed.first_run_step(), FirstRunStep::TestingSet);
    }

    #[test]
    fn continue_install_with_all_repositories_allows_continue_with_soft_warning() {
        let mut core = signed_in_core(
            FakeGitHub {
                install_snapshot: Ok(AppInstallSnapshot {
                    has_install: true,
                    repos: vec![repo("acme", "widgets")],
                    all_repositories: true,
                }),
                ..FakeGitHub::default()
            },
            FakeSettingsStore::default(),
        );

        let outcome = core.continue_install().expect("refresh should succeed");
        assert_eq!(
            outcome,
            InstallContinueOutcome::Ready {
                all_repositories_warning: true
            }
        );
        assert!(core.all_repositories_warning());
        assert_eq!(core.first_run_step(), FirstRunStep::TestingSet);
    }

    #[test]
    fn testing_set_accepts_up_to_three_app_visible_repos_and_refuses_a_fourth() {
        let mut core = signed_in_core(
            FakeGitHub::default(),
            FakeSettingsStore::with_settings(AppSettings {
                install_completed: true,
                app_visible_repos: vec![
                    repo("acme", "one"),
                    repo("acme", "two"),
                    repo("acme", "three"),
                    repo("acme", "four"),
                ],
                ..AppSettings::default()
            }),
        );

        core.add_testing_set_repo(repo("acme", "one")).expect("1");
        core.add_testing_set_repo(repo("acme", "two")).expect("2");
        core.add_testing_set_repo(repo("acme", "three")).expect("3");

        let err = core
            .add_testing_set_repo(repo("acme", "four"))
            .expect_err("4th must be refused");
        assert_eq!(err, TestingSetError::LimitReached);
        assert_eq!(core.testing_set().len(), 3);
    }

    #[test]
    fn testing_set_refuses_repos_not_app_visible() {
        let mut core = signed_in_core(
            FakeGitHub::default(),
            FakeSettingsStore::with_settings(AppSettings {
                install_completed: true,
                app_visible_repos: vec![repo("acme", "widgets")],
                ..AppSettings::default()
            }),
        );

        let err = core
            .add_testing_set_repo(repo("other", "secret"))
            .expect_err("non-visible must be refused");
        assert_eq!(err, TestingSetError::NotAppVisible);
    }

    #[test]
    fn complete_testing_set_with_one_to_three_repos_reaches_try_capture() {
        let settings = FakeSettingsStore::with_settings(AppSettings {
            install_completed: true,
            app_visible_repos: vec![repo("acme", "widgets")],
            ..AppSettings::default()
        });
        let mut core = signed_in_core(FakeGitHub::default(), settings.clone());

        core.add_testing_set_repo(repo("acme", "widgets"))
            .expect("add");
        core.complete_testing_set().expect("complete");
        assert_eq!(core.first_run_step(), FirstRunStep::TryCapture);

        let resumed = IssuebridgeCore::new(
            FakeGitHub::default(),
            FakeTokenStore {
                credentials: Some(StoredCredentials {
                    access_token: "ghp_test_token_not_a_secret".into(),
                    refresh_token: None,
                }),
            },
            FakeDraftStore::default(),
            FakeVoiceTranscriber::default(),
            FakeClock::default(),
            settings,
            FakeLabelCatalogStore::default(),
        );
        assert_eq!(resumed.first_run_step(), FirstRunStep::TryCapture);
        assert_eq!(resumed.testing_set(), vec![repo("acme", "widgets")]);
    }

    #[test]
    fn dismiss_without_save_leaves_try_capture_incomplete() {
        let settings = FakeSettingsStore::with_settings(AppSettings {
            install_completed: true,
            testing_set_completed: true,
            testing_set: vec![repo("acme", "widgets")],
            app_visible_repos: vec![repo("acme", "widgets")],
            ..AppSettings::default()
        });
        let core = signed_in_core(FakeGitHub::default(), settings.clone());
        assert_eq!(core.first_run_step(), FirstRunStep::TryCapture);
        assert!(core.should_open_main_on_launch());
        // Dismiss/cancel is adapter-only (hide Capture); core is unchanged until Save or Skip.
        assert!(!settings.snapshot().first_run_completed);
        assert_eq!(core.first_run_step(), FirstRunStep::TryCapture);
    }

    #[test]
    fn save_capture_during_try_capture_completes_first_run_including_untitled() {
        let settings = FakeSettingsStore::with_settings(AppSettings {
            install_completed: true,
            testing_set_completed: true,
            testing_set: vec![repo("acme", "widgets")],
            app_visible_repos: vec![repo("acme", "widgets")],
            ..AppSettings::default()
        });
        let mut core = signed_in_core(FakeGitHub::default(), settings.clone());
        assert_eq!(core.first_run_step(), FirstRunStep::TryCapture);
        assert!(core.should_open_main_on_launch());

        core.save_capture(CaptureInput {
            repo: repo("acme", "widgets"),
            title: "   ".into(),
            body: "first capture from try step".into(),
        })
        .expect("untitled save");

        assert_eq!(core.first_run_step(), FirstRunStep::Ready);
        assert!(settings.snapshot().first_run_completed);
        assert!(!core.should_open_main_on_launch());

        let inbox = core.list_inbox().expect("inbox");
        assert_eq!(inbox.len(), 1);
        assert_eq!(inbox[0].display_title, "Untitled");
    }

    #[test]
    fn skip_try_capture_completes_first_run_to_ready_without_draft() {
        let settings = FakeSettingsStore::with_settings(AppSettings {
            install_completed: true,
            testing_set_completed: true,
            testing_set: vec![repo("acme", "widgets")],
            app_visible_repos: vec![repo("acme", "widgets")],
            ..AppSettings::default()
        });
        let mut core = signed_in_core(FakeGitHub::default(), settings.clone());
        assert_eq!(core.first_run_step(), FirstRunStep::TryCapture);

        core.skip_try_capture().expect("skip");
        assert_eq!(core.first_run_step(), FirstRunStep::Ready);
        assert!(settings.snapshot().first_run_completed);
        assert!(core.list_inbox().expect("inbox").is_empty());

        let resumed = IssuebridgeCore::new(
            FakeGitHub::default(),
            FakeTokenStore {
                credentials: Some(StoredCredentials {
                    access_token: "ghp_test_token_not_a_secret".into(),
                    refresh_token: None,
                }),
            },
            FakeDraftStore::default(),
            FakeVoiceTranscriber::default(),
            FakeClock::default(),
            settings,
            FakeLabelCatalogStore::default(),
        );
        assert_eq!(resumed.first_run_step(), FirstRunStep::Ready);
        assert!(!resumed.should_open_main_on_launch());
    }

    #[test]
    fn complete_testing_set_with_empty_set_is_rejected() {
        let mut core = signed_in_core(
            FakeGitHub::default(),
            FakeSettingsStore::with_settings(AppSettings {
                install_completed: true,
                app_visible_repos: vec![repo("acme", "widgets")],
                ..AppSettings::default()
            }),
        );

        let err = core
            .complete_testing_set()
            .expect_err("empty Testing set must be rejected");
        assert_eq!(err, TestingSetError::Empty);
        assert_eq!(core.first_run_step(), FirstRunStep::TestingSet);
    }

    #[test]
    fn sign_out_does_not_rewind_install_or_testing_set_progress() {
        let settings = FakeSettingsStore::with_settings(AppSettings {
            install_completed: true,
            testing_set_completed: true,
            first_run_completed: true,
            testing_set: vec![repo("acme", "widgets")],
            app_visible_repos: vec![repo("acme", "widgets")],
            ..AppSettings::default()
        });
        let mut core = signed_in_core(FakeGitHub::default(), settings.clone());
        assert_eq!(core.first_run_step(), FirstRunStep::Ready);

        core.sign_out().expect("sign-out");
        assert_eq!(core.first_run_step(), FirstRunStep::SignIn);
        assert!(settings.snapshot().install_completed);
        assert!(settings.snapshot().testing_set_completed);
        assert!(settings.snapshot().first_run_completed);
        assert_eq!(
            settings.snapshot().testing_set,
            vec![repo("acme", "widgets")]
        );
    }

    fn ready_settings() -> FakeSettingsStore {
        FakeSettingsStore::with_settings(AppSettings {
            install_completed: true,
            testing_set_completed: true,
            first_run_completed: true,
            testing_set: vec![repo("acme", "widgets")],
            app_visible_repos: vec![repo("acme", "widgets"), repo("acme", "gadgets")],
            ..AppSettings::default()
        })
    }

    fn ready_core() -> TestCore {
        signed_in_core(FakeGitHub::default(), ready_settings())
    }

    /// Ready core plus a shared FakeGitHub handle for controlling remote `updated_at`.
    fn ready_core_with_github() -> (TestCore, FakeGitHub) {
        let github = FakeGitHub::default();
        let handle = github.clone();
        (signed_in_core(github, ready_settings()), handle)
    }

    #[test]
    fn signed_in_save_capture_persists_draft_retrievable_from_inbox() {
        let mut core = ready_core();

        let saved = core
            .save_capture(CaptureInput {
                repo: repo("acme", "widgets"),
                title: "Broken button".into(),
                body: "Clicking Save does nothing.".into(),
            })
            .expect("Capture Save should persist a Draft when signed in");

        assert_eq!(saved.repo, repo("acme", "widgets"));
        assert_eq!(saved.title, "Broken button");
        assert_eq!(saved.body, "Clicking Save does nothing.");
        assert!(saved.label_names.is_empty());
        assert_eq!(saved.created_at, saved.updated_at);

        let inbox = core.list_inbox().expect("Inbox list");
        assert_eq!(inbox.len(), 1);
        assert_eq!(inbox[0].id, saved.id);
        assert_eq!(inbox[0].display_title, "Broken button");
        assert_eq!(inbox[0].repo, repo("acme", "widgets"));
        assert!(!inbox[0].linked);
        assert!(!inbox[0].dirty);
    }

    #[test]
    fn save_capture_with_empty_title_lists_as_untitled() {
        let mut core = ready_core();

        core.save_capture(CaptureInput {
            repo: repo("acme", "widgets"),
            title: "   ".into(),
            body: "Body without a title yet.".into(),
        })
        .expect("empty title is allowed");

        let inbox = core.list_inbox().expect("Inbox list");
        assert_eq!(inbox.len(), 1);
        assert_eq!(inbox[0].display_title, "Untitled");
        assert!(!inbox[0].linked);
        assert!(!inbox[0].dirty);
    }

    #[test]
    fn inbox_lists_drafts_by_local_updated_at_descending() {
        let clock = FakeClock::default();
        let drafts = FakeDraftStore::default();
        let settings = FakeSettingsStore::with_settings(AppSettings {
            install_completed: true,
            testing_set_completed: true,
            testing_set: vec![repo("acme", "widgets")],
            app_visible_repos: vec![repo("acme", "widgets")],
            ..AppSettings::default()
        });
        let mut core = IssuebridgeCore::new(
            FakeGitHub::default(),
            FakeTokenStore::default(),
            drafts,
            FakeVoiceTranscriber::default(),
            clock.clone(),
            settings,
            FakeLabelCatalogStore::default(),
        );
        core.sign_in_with_pat("ghp_test_token_not_a_secret")
            .expect("PAT sign-in");

        core.save_capture(CaptureInput {
            repo: repo("acme", "widgets"),
            title: "Older".into(),
            body: "first".into(),
        })
        .expect("first save");

        clock.advance(Duration::from_secs(60));

        core.save_capture(CaptureInput {
            repo: repo("acme", "widgets"),
            title: "Newer".into(),
            body: "second".into(),
        })
        .expect("second save");

        let inbox = core.list_inbox().expect("Inbox list");
        assert_eq!(inbox.len(), 2);
        assert_eq!(inbox[0].display_title, "Newer");
        assert_eq!(inbox[1].display_title, "Older");
    }

    #[test]
    fn inbox_editor_can_change_title_body_and_label_names() {
        let mut core = ready_core();
        let saved = core
            .save_capture(CaptureInput {
                repo: repo("acme", "widgets"),
                title: "Rough title".into(),
                body: "Rough body".into(),
            })
            .expect("capture");

        let edited = core
            .edit_draft(EditDraftInput {
                id: saved.id.clone(),
                title: "Polished title".into(),
                body: "Polished body".into(),
                label_names: vec!["bug".into(), "ui".into()],
            })
            .expect("edit");

        assert_eq!(edited.title, "Polished title");
        assert_eq!(edited.body, "Polished body");
        assert_eq!(
            edited.label_names,
            vec!["bug".to_string(), "ui".to_string()]
        );

        let loaded = core.get_draft(&saved.id).expect("get");
        assert_eq!(loaded.title, "Polished title");
        assert_eq!(loaded.body, "Polished body");
        assert_eq!(
            loaded.label_names,
            vec!["bug".to_string(), "ui".to_string()]
        );

        let inbox = core.list_inbox().expect("inbox");
        assert_eq!(inbox[0].display_title, "Polished title");
        assert!(!inbox[0].linked);
        assert!(!inbox[0].dirty);
    }

    #[test]
    fn publish_without_title_is_refused() {
        let mut core = ready_core();
        let saved = core
            .save_capture(CaptureInput {
                repo: repo("acme", "widgets"),
                title: "   ".into(),
                body: "Needs a title before Publish.".into(),
            })
            .expect("capture");

        let err = core
            .publish_draft(&saved.id)
            .expect_err("Publish without title must be refused");
        assert_eq!(err, PublishError::TitleRequired);

        let loaded = core.get_draft(&saved.id).expect("get");
        assert!(loaded.local_link.is_none());
        assert!(loaded.remote_snapshot.is_none());
    }

    #[test]
    fn publish_with_title_creates_issue_and_stores_local_link_and_snapshot() {
        let mut core = ready_core();
        let saved = core
            .save_capture(CaptureInput {
                repo: repo("acme", "widgets"),
                title: "Broken button".into(),
                body: "Clicking Save does nothing.".into(),
            })
            .expect("capture");
        core.edit_draft(EditDraftInput {
            id: saved.id.clone(),
            title: "Broken button".into(),
            body: "Clicking Save does nothing.".into(),
            label_names: vec!["bug".into()],
        })
        .expect("labels");

        let published = core.publish_draft(&saved.id).expect("Publish");

        let link = published.local_link.expect("Local link");
        assert_eq!(link.number, 1);
        assert_eq!(link.html_url, "https://github.com/acme/widgets/issues/1");

        let snapshot = published.remote_snapshot.expect("Remote snapshot");
        assert_eq!(snapshot.title, "Broken button");
        assert_eq!(snapshot.body, "Clicking Save does nothing.");
        assert_eq!(snapshot.label_names, vec!["bug".to_string()]);
        assert_eq!(snapshot.updated_at, "2024-01-15T12:00:00Z");

        let inbox = core.list_inbox().expect("inbox");
        assert_eq!(inbox.len(), 1);
        assert!(inbox[0].linked);
        assert!(!inbox[0].dirty);

        let err = core
            .publish_draft(&saved.id)
            .expect_err("second Publish must not create another issue");
        assert_eq!(err, PublishError::AlreadyLinked);
    }

    #[test]
    fn linked_draft_is_dirty_when_working_fields_diverge_from_remote_snapshot() {
        let mut core = ready_core();
        let saved = core
            .save_capture(CaptureInput {
                repo: repo("acme", "widgets"),
                title: "Original".into(),
                body: "Body".into(),
            })
            .expect("capture");
        core.publish_draft(&saved.id).expect("Publish");

        core.edit_draft(EditDraftInput {
            id: saved.id.clone(),
            title: "Changed title".into(),
            body: "Body".into(),
            label_names: Vec::new(),
        })
        .expect("edit after Publish");

        let inbox = core.list_inbox().expect("inbox");
        assert!(inbox[0].linked);
        assert!(inbox[0].dirty);

        // Align working fields with snapshot again → clean.
        core.edit_draft(EditDraftInput {
            id: saved.id.clone(),
            title: "Original".into(),
            body: "Body".into(),
            label_names: Vec::new(),
        })
        .expect("realign");

        let inbox = core.list_inbox().expect("inbox");
        assert!(inbox[0].linked);
        assert!(!inbox[0].dirty);
    }

    #[test]
    fn updating_linked_draft_when_snapshot_matches_refreshes_remote_snapshot() {
        let (mut core, _github) = ready_core_with_github();
        let saved = core
            .save_capture(CaptureInput {
                repo: repo("acme", "widgets"),
                title: "Original".into(),
                body: "Body".into(),
            })
            .expect("capture");
        core.publish_draft(&saved.id).expect("Publish");

        core.edit_draft(EditDraftInput {
            id: saved.id.clone(),
            title: "Updated title".into(),
            body: "Updated body".into(),
            label_names: vec!["bug".into()],
        })
        .expect("edit");

        let inbox = core.list_inbox().expect("inbox");
        assert!(inbox[0].dirty);

        let updated = core
            .update_linked_draft(&saved.id)
            .expect("matched update should succeed");

        let snapshot = updated.remote_snapshot.as_ref().expect("Remote snapshot");
        assert_eq!(snapshot.title, "Updated title");
        assert_eq!(snapshot.body, "Updated body");
        assert_eq!(snapshot.label_names, vec!["bug".to_string()]);
        assert_eq!(snapshot.updated_at, "2024-01-16T12:01:00Z");
        assert!(!updated.is_dirty());

        let inbox = core.list_inbox().expect("inbox");
        assert!(inbox[0].linked);
        assert!(!inbox[0].dirty);
    }

    #[test]
    fn updating_linked_draft_when_remote_updated_at_mismatches_is_conflict() {
        let (mut core, github) = ready_core_with_github();
        let saved = core
            .save_capture(CaptureInput {
                repo: repo("acme", "widgets"),
                title: "Original".into(),
                body: "Body".into(),
            })
            .expect("capture");
        core.publish_draft(&saved.id).expect("Publish");

        core.edit_draft(EditDraftInput {
            id: saved.id.clone(),
            title: "Local edit".into(),
            body: "Body".into(),
            label_names: Vec::new(),
        })
        .expect("edit");

        github.set_remote_updated_at(&repo("acme", "widgets"), 1, "2024-01-20T09:00:00Z");

        let err = core
            .update_linked_draft(&saved.id)
            .expect_err("mismatch must surface Conflict");
        assert_eq!(err, UpdateError::Conflict);

        // Working fields stay as local edits; Dirty remains.
        let loaded = core.get_draft(&saved.id).expect("get");
        assert_eq!(loaded.title, "Local edit");
        assert!(loaded.is_dirty());
        assert_eq!(
            loaded.remote_snapshot.expect("snapshot").updated_at,
            "2024-01-15T12:00:00Z"
        );
    }

    #[test]
    fn keep_mine_patches_working_fields_and_refreshes_snapshot() {
        let (mut core, github) = ready_core_with_github();
        let saved = core
            .save_capture(CaptureInput {
                repo: repo("acme", "widgets"),
                title: "Original".into(),
                body: "Body".into(),
            })
            .expect("capture");
        core.publish_draft(&saved.id).expect("Publish");

        core.edit_draft(EditDraftInput {
            id: saved.id.clone(),
            title: "Keep this".into(),
            body: "Mine".into(),
            label_names: vec!["ui".into()],
        })
        .expect("edit");

        github.set_remote_updated_at(&repo("acme", "widgets"), 1, "2024-01-20T09:00:00Z");
        assert_eq!(
            core.update_linked_draft(&saved.id).expect_err("conflict"),
            UpdateError::Conflict
        );

        let resolved = core.keep_mine(&saved.id).expect("Keep mine");
        assert_eq!(resolved.title, "Keep this");
        assert_eq!(resolved.body, "Mine");
        assert_eq!(resolved.label_names, vec!["ui".to_string()]);
        let snapshot = resolved.remote_snapshot.as_ref().expect("snapshot");
        assert_eq!(snapshot.title, "Keep this");
        assert_eq!(snapshot.body, "Mine");
        assert_eq!(snapshot.label_names, vec!["ui".to_string()]);
        assert_eq!(snapshot.updated_at, "2024-01-16T12:01:00Z");
        assert!(!resolved.is_dirty());
    }

    #[test]
    fn use_theirs_replaces_local_fields_from_remote_and_refreshes_snapshot() {
        let (mut core, github) = ready_core_with_github();
        let saved = core
            .save_capture(CaptureInput {
                repo: repo("acme", "widgets"),
                title: "Original".into(),
                body: "Body".into(),
            })
            .expect("capture");
        core.publish_draft(&saved.id).expect("Publish");

        github.set_remote_issue(
            &repo("acme", "widgets"),
            1,
            "Theirs title",
            "Theirs body",
            &["remote".into()],
            "2024-01-20T09:00:00Z",
        );

        core.edit_draft(EditDraftInput {
            id: saved.id.clone(),
            title: "Local only".into(),
            body: "Will be discarded".into(),
            label_names: vec!["local".into()],
        })
        .expect("edit");

        assert_eq!(
            core.update_linked_draft(&saved.id).expect_err("conflict"),
            UpdateError::Conflict
        );

        let resolved = core.use_theirs(&saved.id).expect("Use theirs");
        assert_eq!(resolved.title, "Theirs title");
        assert_eq!(resolved.body, "Theirs body");
        assert_eq!(resolved.label_names, vec!["remote".to_string()]);
        let snapshot = resolved.remote_snapshot.as_ref().expect("snapshot");
        assert_eq!(snapshot.title, "Theirs title");
        assert_eq!(snapshot.updated_at, "2024-01-20T09:00:00Z");
        assert!(!resolved.is_dirty());
    }

    #[test]
    fn apply_ptt_appends_transcript_to_nonempty_body() {
        let voice = FakeVoiceTranscriber::with_result(Ok("spoken bug details".into()));
        let core = signed_in_core_with_voice(FakeGitHub::default(), ready_settings(), voice);

        let body = core.apply_ptt("Steps:", "unused.wav").expect("PTT success");

        assert_eq!(body, "Steps: spoken bug details");
    }

    #[test]
    fn apply_ptt_sets_body_when_empty() {
        let voice = FakeVoiceTranscriber::with_result(Ok("  hello world  ".into()));
        let core = signed_in_core_with_voice(FakeGitHub::default(), ready_settings(), voice);

        let body = core.apply_ptt("", "unused.wav").expect("PTT success");

        assert_eq!(body, "hello world");
    }

    #[test]
    fn apply_ptt_permission_denied_leaves_body_unchanged_path() {
        let voice = FakeVoiceTranscriber::with_result(Err(VoiceError::PermissionDenied));
        let core = signed_in_core_with_voice(FakeGitHub::default(), ready_settings(), voice);

        let err = core
            .apply_ptt("keep me", "unused.wav")
            .expect_err("permission denied");

        assert_eq!(err, VoiceError::PermissionDenied);
    }

    #[test]
    fn apply_ptt_no_device_returns_typed_failure() {
        let voice = FakeVoiceTranscriber::with_result(Err(VoiceError::NoDevice));
        let core = signed_in_core_with_voice(FakeGitHub::default(), ready_settings(), voice);

        assert_eq!(
            core.apply_ptt("", "unused.wav").expect_err("no device"),
            VoiceError::NoDevice
        );
    }

    #[test]
    fn apply_ptt_sidecar_failed_returns_typed_failure() {
        let voice = FakeVoiceTranscriber::with_result(Err(VoiceError::SidecarFailed));
        let core = signed_in_core_with_voice(FakeGitHub::default(), ready_settings(), voice);

        assert_eq!(
            core.apply_ptt("", "unused.wav").expect_err("sidecar"),
            VoiceError::SidecarFailed
        );
    }

    #[test]
    fn apply_ptt_empty_transcript_is_soft_failure() {
        let voice = FakeVoiceTranscriber::with_result(Ok("   ".into()));
        let core = signed_in_core_with_voice(FakeGitHub::default(), ready_settings(), voice);

        assert_eq!(
            core.apply_ptt("body", "unused.wav")
                .expect_err("empty transcript"),
            VoiceError::EmptyTranscript
        );
    }

    #[test]
    fn text_save_succeeds_after_voice_failure() {
        let voice = FakeVoiceTranscriber::with_result(Err(VoiceError::SidecarFailed));
        let mut core = signed_in_core_with_voice(FakeGitHub::default(), ready_settings(), voice);

        assert_eq!(
            core.apply_ptt("", "unused.wav").expect_err("voice failed"),
            VoiceError::SidecarFailed
        );

        let saved = core
            .save_capture(CaptureInput {
                repo: repo("acme", "widgets"),
                title: "Typed instead".into(),
                body: "Voice failed but text still works.".into(),
            })
            .expect("text Save must succeed after voice failure");

        assert_eq!(saved.title, "Typed instead");
        assert_eq!(saved.body, "Voice failed but text still works.");
    }

    #[test]
    fn ptt_hotkey_defaults_to_ctrl_alt_shift_v() {
        let core = ready_core();
        assert_eq!(core.ptt_hotkey(), "Ctrl+Alt+Shift+V");
    }

    #[test]
    fn ptt_hotkey_uses_configured_setting() {
        let settings = FakeSettingsStore::with_settings(AppSettings {
            ptt_hotkey: Some("Ctrl+Alt+Shift+P".into()),
            ..ready_settings().snapshot()
        });
        let core = signed_in_core(FakeGitHub::default(), settings);
        assert_eq!(core.ptt_hotkey(), "Ctrl+Alt+Shift+P");
    }

    #[test]
    fn ensure_label_catalog_fetches_and_persists_name_and_color() {
        let github = FakeGitHub::default();
        github.set_repo_labels(
            &repo("acme", "widgets"),
            vec![RepoLabel {
                name: "Bug".into(),
                color: "d73a4a".into(),
            }],
        );
        let mut core = signed_in_core(github, ready_settings());

        let ensured = core
            .ensure_label_catalog(&repo("acme", "widgets"))
            .expect("catalog");

        assert!(!ensured.refresh_failed);
        assert_eq!(
            ensured.labels,
            vec![RepoLabel {
                name: "Bug".into(),
                color: "d73a4a".into(),
            }]
        );
    }

    #[test]
    fn ensure_label_catalog_skips_github_when_fresh_cache_exists() {
        let github = FakeGitHub::default();
        github.set_repo_labels(
            &repo("acme", "widgets"),
            vec![RepoLabel {
                name: "Bug".into(),
                color: "d73a4a".into(),
            }],
        );
        let mut core = signed_in_core(github.clone(), ready_settings());
        core.ensure_label_catalog(&repo("acme", "widgets"))
            .expect("initial fetch");

        github.set_repo_labels(&repo("acme", "widgets"), Vec::new());
        let ensured = core
            .ensure_label_catalog(&repo("acme", "widgets"))
            .expect("cached");

        assert_eq!(ensured.labels.len(), 1);
        assert_eq!(ensured.labels[0].name, "Bug");
        assert!(!ensured.refresh_failed);
    }

    #[test]
    fn ensure_label_catalog_soft_fails_to_last_good_when_github_unavailable() {
        let github = FakeGitHub::default();
        github.set_repo_labels(
            &repo("acme", "widgets"),
            vec![RepoLabel {
                name: "Bug".into(),
                color: "d73a4a".into(),
            }],
        );
        let clock = FakeClock::default();
        let catalogs = FakeLabelCatalogStore::default();
        let mut core = IssuebridgeCore::new(
            github.clone(),
            FakeTokenStore::default(),
            FakeDraftStore::default(),
            FakeVoiceTranscriber::default(),
            clock.clone(),
            ready_settings(),
            catalogs.clone(),
        );
        core.sign_in_with_pat("ghp_test_token_not_a_secret")
            .expect("PAT sign-in");
        core.ensure_label_catalog(&repo("acme", "widgets"))
            .expect("seed");

        clock.advance(Duration::from_secs(15 * 60 + 1));
        *github.list_labels_unavailable.lock().expect("flag") = true;

        let ensured = core
            .ensure_label_catalog(&repo("acme", "widgets"))
            .expect("soft fail");

        assert!(ensured.refresh_failed);
        assert_eq!(ensured.labels[0].name, "Bug");
        assert!(catalogs.snapshot(&repo("acme", "widgets")).is_some());
    }

    #[test]
    fn publish_creates_novel_labels_with_default_color_and_updates_catalog() {
        let github = FakeGitHub::default();
        github.set_repo_labels(
            &repo("acme", "widgets"),
            vec![RepoLabel {
                name: "Bug".into(),
                color: "d73a4a".into(),
            }],
        );
        let catalogs = FakeLabelCatalogStore::default();
        let mut core = IssuebridgeCore::new(
            github.clone(),
            FakeTokenStore::default(),
            FakeDraftStore::default(),
            FakeVoiceTranscriber::default(),
            FakeClock::default(),
            ready_settings(),
            catalogs.clone(),
        );
        core.sign_in_with_pat("ghp_test_token_not_a_secret")
            .expect("PAT sign-in");

        let draft = core
            .save_capture(CaptureInput {
                repo: repo("acme", "widgets"),
                title: "Broken button".into(),
                body: "details".into(),
            })
            .expect("capture");

        core.edit_draft(EditDraftInput {
            id: draft.id.clone(),
            title: draft.title,
            body: draft.body,
            label_names: vec!["bug".into(), "needs-triage".into()],
        })
        .expect("edit");

        let published = core.publish_draft(&draft.id).expect("publish");

        assert_eq!(
            published.label_names,
            vec!["Bug".to_string(), "needs-triage".to_string()]
        );

        let labels = github
            .repo_labels
            .lock()
            .expect("labels")
            .get("acme/widgets")
            .cloned()
            .unwrap_or_default();
        assert!(labels
            .iter()
            .any(|l| l.name == "Bug" && l.color == "d73a4a"));
        assert!(labels
            .iter()
            .any(|l| { l.name == "needs-triage" && l.color == DEFAULT_NOVEL_LABEL_COLOR }));

        let catalog = catalogs
            .snapshot(&repo("acme", "widgets"))
            .expect("catalog after publish");
        assert!(catalog.labels.iter().any(|l| l.name == "needs-triage"));
    }

    #[test]
    fn canonicalize_label_names_uses_catalog_casing() {
        let catalog = vec![RepoLabel {
            name: "Bug".into(),
            color: "d73a4a".into(),
        }];
        assert_eq!(
            canonicalize_label_names(&["bug".into(), "novel".into()], &catalog),
            vec!["Bug".to_string(), "novel".to_string()]
        );
    }

    #[test]
    fn prefetch_testing_set_label_catalogs_covers_each_testing_repo() {
        let github = FakeGitHub::default();
        github.set_repo_labels(
            &repo("acme", "widgets"),
            vec![RepoLabel {
                name: "Bug".into(),
                color: "d73a4a".into(),
            }],
        );
        github.set_repo_labels(
            &repo("acme", "api"),
            vec![RepoLabel {
                name: "docs".into(),
                color: "0075ca".into(),
            }],
        );
        let catalogs = FakeLabelCatalogStore::default();
        let settings = FakeSettingsStore::with_settings(AppSettings {
            install_completed: true,
            testing_set_completed: true,
            testing_set: vec![repo("acme", "widgets"), repo("acme", "api")],
            app_visible_repos: vec![repo("acme", "widgets"), repo("acme", "api")],
            ..AppSettings::default()
        });
        let mut core = IssuebridgeCore::new(
            github,
            FakeTokenStore::default(),
            FakeDraftStore::default(),
            FakeVoiceTranscriber::default(),
            FakeClock::default(),
            settings,
            catalogs.clone(),
        );
        core.sign_in_with_pat("ghp_test_token_not_a_secret")
            .expect("PAT sign-in");

        core.prefetch_testing_set_label_catalogs()
            .expect("prefetch");

        assert_eq!(
            catalogs
                .snapshot(&repo("acme", "widgets"))
                .expect("widgets")
                .labels[0]
                .name,
            "Bug"
        );
        assert_eq!(
            catalogs.snapshot(&repo("acme", "api")).expect("api").labels[0].name,
            "docs"
        );
    }
}

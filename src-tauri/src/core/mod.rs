//! Issuebridge application core — use-cases behind injectable ports.
//! UI / Tauri IPC are adapters outside this module.

mod error;
mod ports;
mod rewrite;
pub mod rewrite_hardware;
pub mod rewrite_model_catalog;

use std::time::Duration;

pub use error::{
    AuthError, CaptureError, InboxError, InstallError, LabelCatalogError, PublishError,
    RewriteError, TestingSetError, UpdateError,
};
pub use ports::{
    AppInstallSnapshot, AppSettings, CaptureInput, Clock, CreatedIssue, CustomRewriteStyle, Draft,
    DraftStore, DraftStoreError, EditDraftInput, EmptyRewriteModelFiles, EnsuredLabelCatalog,
    FixedHardwareProbe, GitHub, GitHubError, HardwareProbe, InboxItem, LabelCatalog,
    LabelCatalogStore, LabelCatalogStoreError, LocalLink, RemoteSnapshot, RepoId, RepoLabel,
    RewriteEngine, RewriteEngineError, RewriteHardwareSwitchPrompt, RewriteInput,
    RewriteModelDiskStatus, RewriteModelFileError, RewriteModelFiles, RewriteModelStatusSnapshot,
    RewriteProposal, RewriteStyleInfo, RewriteStylesSnapshot, SettingsStore, SettingsStoreError,
    StoredCredentials, StubRewriteEngine, TimestampDisplay, TokenStore, TokenStoreError,
    VoiceError, VoiceTranscriber,
};
pub use rewrite::{is_too_thin_for_rewrite, CLEAR_STYLE_ID};
pub use rewrite_hardware::{
    recommend_rewrite_model_for, HardwareProfile, HardwareTier, RewriteModelRecommendation,
};
pub use rewrite_model_catalog::{
    find_rewrite_model, rewrite_model_catalog, DEFAULT_REWRITE_MODEL_ID,
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

/// Recommended Testing set size (first-run hard cap; Settings default).
const TESTING_SET_RECOMMENDED_MAX: usize = 3;

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
    rewrite: Box<dyn RewriteEngine>,
    rewrite_models: Box<dyn RewriteModelFiles>,
    hardware: Box<dyn HardwareProbe>,
    /// Process-local session decision. `Unknown` defers to vault presence, which is all a
    /// fresh launch knows — so [`Self::validate_session`] must still confirm it against
    /// GitHub. `SignedIn` / `SignedOut` are decisions this process made and outrank the
    /// vault: a decision must survive a vault write that fails, or a failed clear would
    /// leave the app insisting it is signed in against a token GitHub already rejected.
    session: SessionDecision,
}

/// What this process knows about the session, relative to the vault.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SessionDecision {
    /// Nothing decided yet this process — fall back to vault presence.
    Unknown,
    /// Signed in here (PAT/OAuth accepted, or validation passed).
    SignedIn,
    /// Signed out here. Overrides vault presence even if clearing the vault failed.
    SignedOut,
}

/// What the vault holds for session validation, read without touching the network.
/// See [`IssuebridgeCore::probe_session`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SessionProbe {
    /// Validate this token out of band, then feed the result to
    /// [`IssuebridgeCore::apply_session_validation`].
    Token(String),
    /// Nothing vaulted — already signed out, no request needed.
    SignedOut,
    /// Vault unreadable; not proof the token is bad, so change nothing.
    Unreadable,
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
        Self {
            github,
            token_store,
            draft_store,
            voice,
            clock,
            settings_store,
            label_catalog_store,
            rewrite: Box::new(StubRewriteEngine),
            rewrite_models: Box::new(EmptyRewriteModelFiles),
            hardware: Box::new(FixedHardwareProbe::default()),
            // A fresh process has decided nothing; vault presence answers until
            // validate_session proves the token is still accepted.
            session: SessionDecision::Unknown,
        }
    }

    /// Replace the Rewrite engine (tests / future llama.cpp sidecar).
    pub fn with_rewrite_engine(mut self, engine: Box<dyn RewriteEngine>) -> Self {
        self.rewrite = engine;
        self
    }

    /// Replace the Rewrite model files port (download-on-demand GGUFs).
    pub fn with_rewrite_model_files(mut self, files: Box<dyn RewriteModelFiles>) -> Self {
        self.rewrite_models = files;
        self
    }

    /// Replace the hardware probe (RAM + Vulkan) used for Rewrite model recommendation.
    pub fn with_hardware_probe(mut self, probe: Box<dyn HardwareProbe>) -> Self {
        self.hardware = probe;
        self
    }

    /// Cheap, synchronous view of the session — never calls GitHub.
    /// Use [`Self::validate_session`] to prove the vaulted token is still accepted.
    pub fn auth_state(&self) -> AuthState {
        match self.session {
            SessionDecision::SignedIn => AuthState::SignedIn,
            SessionDecision::SignedOut => AuthState::SignedOut,
            SessionDecision::Unknown => match self.token_store.load() {
                Ok(Some(_)) => AuthState::SignedIn,
                Ok(None) => AuthState::SignedOut,
                Err(_) => AuthState::SignedOut,
            },
        }
    }

    /// Check the vaulted credentials against GitHub (launch, or on demand).
    ///
    /// Rejected credentials force a Sign out so the UI routes to Sign in instead of
    /// showing the Inbox against a dead token. A valid token keeps the session across a
    /// machine restart, and a transient/offline failure leaves the session untouched.
    pub fn validate_session(&mut self) -> AuthState {
        let token = match self.probe_session() {
            SessionProbe::Token(token) => token,
            SessionProbe::SignedOut => return AuthState::SignedOut,
            SessionProbe::Unreadable => return self.auth_state(),
        };
        let result = self.github.validate_pat(&token);
        self.apply_session_validation(&token, result)
    }

    /// Read the vault for validation without calling GitHub.
    ///
    /// Pair with [`Self::apply_session_validation`] to validate a session without holding
    /// the core lock across the request — launch validation does this so a slow or hanging
    /// `GET /user` cannot stall every other command behind the mutex.
    pub fn probe_session(&mut self) -> SessionProbe {
        match self.token_store.load() {
            Ok(Some(credentials)) => SessionProbe::Token(credentials.access_token),
            Ok(None) => {
                self.session = SessionDecision::SignedOut;
                SessionProbe::SignedOut
            }
            // Vault unreadable right now: not proof the token is bad.
            Err(_) => SessionProbe::Unreadable,
        }
    }

    /// Apply an out-of-band `validate_pat` outcome for `token`.
    ///
    /// Discards the answer when the vault no longer holds `token`: the user signed in or
    /// out while the request was in flight, and that newer decision must win.
    pub fn apply_session_validation(
        &mut self,
        token: &str,
        result: Result<(), GitHubError>,
    ) -> AuthState {
        match self.token_store.load() {
            Ok(Some(current)) if current.access_token == token => {}
            _ => return self.auth_state(),
        }

        match result {
            Ok(()) => {
                self.session = SessionDecision::SignedIn;
                AuthState::SignedIn
            }
            Err(GitHubError::InvalidCredentials) => {
                let _ = self.sign_out();
                AuthState::SignedOut
            }
            // Offline / GitHub down: keep the session, retry on the next authenticated call.
            Err(GitHubError::Unavailable) => self.auth_state(),
        }
    }

    /// Re-check the vaulted token after an authenticated call failed with 401/403.
    ///
    /// Only a `GET /user` rejection proves the credentials are dead — a 403 on a single
    /// endpoint usually means missing scope / not App-visible, and must not evict the user.
    /// Signs out (clearing the vault) and returns `true` when the token really is rejected.
    fn credentials_rejected(&mut self) -> bool {
        let credentials = match self.token_store.load() {
            Ok(Some(credentials)) => credentials,
            Ok(None) => {
                self.session = SessionDecision::SignedOut;
                return true;
            }
            Err(_) => return false,
        };

        match self.github.validate_pat(&credentials.access_token) {
            Err(GitHubError::InvalidCredentials) => {
                let _ = self.sign_out();
                true
            }
            _ => false,
        }
    }

    /// Publish-side GitHub failure mapping; forces Sign out when the token is rejected.
    fn publish_error_for(&mut self, err: GitHubError) -> PublishError {
        match err {
            GitHubError::InvalidCredentials => {
                self.credentials_rejected();
                PublishError::InvalidCredentials
            }
            GitHubError::Unavailable => PublishError::ProviderUnavailable,
        }
    }

    /// Update-side GitHub failure mapping; forces Sign out when the token is rejected.
    fn update_error_for(&mut self, err: GitHubError) -> UpdateError {
        match err {
            GitHubError::InvalidCredentials => {
                self.credentials_rejected();
                UpdateError::InvalidCredentials
            }
            GitHubError::Unavailable => UpdateError::ProviderUnavailable,
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

        self.session = SessionDecision::SignedIn;
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

        self.session = SessionDecision::SignedIn;
        Ok(AuthState::SignedIn)
    }

    /// Clear stored credentials and return to signed-out state.
    /// Does not rewind Install / Testing-set / first-run-complete progress.
    pub fn sign_out(&mut self) -> Result<(), AuthError> {
        // Drop the process-local flag even when the vault clear fails. Returning early
        // here would leave the session SignedIn while callers that ignore the error
        // (validate_session, credentials_rejected) report SignedOut — so `auth_state`
        // would still say SignedIn and the shell would bounce straight back into the
        // Inbox against a token GitHub has already rejected.
        let cleared = self.token_store.clear();
        self.session = SessionDecision::SignedOut;
        cleared.map_err(|_| AuthError::StorageUnavailable)
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

        let fetched = self
            .github
            .list_app_install_snapshot(&credentials.access_token);
        let snapshot = match fetched {
            Ok(snapshot) => snapshot,
            Err(GitHubError::Unavailable) => return Err(InstallError::ProviderUnavailable),
            // 403 here is the identity-only PAT path, not a dead token: only a rejected
            // `GET /user` forces Sign out; otherwise keep the session and the PAT guidance.
            Err(GitHubError::InvalidCredentials) => {
                if self.credentials_rejected() {
                    return Err(InstallError::NotSignedIn);
                }
                return Err(InstallError::TokenLacksInstallAccess);
            }
        };

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
        reconcile_testing_set_with_app_visible(&mut settings);
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

    pub fn testing_set_max(&self) -> usize {
        self.settings_store
            .load()
            .map(|s| s.testing_set_max)
            .unwrap_or(TESTING_SET_RECOMMENDED_MAX)
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

    /// Clamp Testing set membership and max to current App-visible repos. Settings load path.
    pub fn reconcile_testing_set_with_app_visible(&mut self) -> Result<bool, TestingSetError> {
        if self.auth_state() != AuthState::SignedIn {
            return Err(TestingSetError::NotSignedIn);
        }
        let mut settings = self
            .settings_store
            .load()
            .map_err(|_| TestingSetError::StorageUnavailable)?;
        let changed = reconcile_testing_set_with_app_visible(&mut settings);
        if changed {
            self.settings_store
                .save(settings)
                .map_err(|_| TestingSetError::StorageUnavailable)?;
        }
        Ok(changed)
    }

    /// Settings-only: set Testing set max (1..=App-visible count). Blocked if set is larger.
    pub fn set_testing_set_max(&mut self, max: usize) -> Result<(), TestingSetError> {
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
        if !settings.first_run_completed {
            return Err(TestingSetError::SettingsOnly);
        }
        let ceiling = settings.app_visible_repos.len();
        if max < 1 || ceiling == 0 || max > ceiling {
            return Err(TestingSetError::MaxOutOfRange);
        }
        if max < settings.testing_set.len() {
            return Err(TestingSetError::MaxBelowCurrentSet {
                current: settings.testing_set.len(),
                requested: max,
            });
        }
        settings.testing_set_max = max;
        self.settings_store
            .save(settings)
            .map_err(|_| TestingSetError::StorageUnavailable)
    }

    /// Settings-only: set max to App-visible count and fill the Testing set with all of them.
    pub fn add_all_app_visible_to_testing_set(&mut self) -> Result<(), TestingSetError> {
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
        if !settings.first_run_completed {
            return Err(TestingSetError::SettingsOnly);
        }
        if settings.app_visible_repos.is_empty() {
            return Err(TestingSetError::Empty);
        }
        settings.testing_set_max = settings.app_visible_repos.len();
        settings.testing_set = settings.app_visible_repos.clone();
        self.settings_store
            .save(settings)
            .map_err(|_| TestingSetError::StorageUnavailable)
    }

    /// Add a repo to the Testing set. Must be App-visible. First-run hard-caps at 3; after first-run uses Settings max.
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
        let limit = effective_testing_set_add_limit(&settings);
        if settings.testing_set.len() >= limit {
            return Err(TestingSetError::LimitReached { max: limit });
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
        if settings.testing_set.len() > TESTING_SET_RECOMMENDED_MAX {
            return Err(TestingSetError::LimitReached {
                max: TESTING_SET_RECOMMENDED_MAX,
            });
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

        let fetched = self.github.list_labels(&credentials.access_token, repo);
        match fetched {
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
            // A rejected token is not a soft refresh failure: sign out instead of looping 401s
            // behind an Inbox that looks signed-in.
            Err(GitHubError::InvalidCredentials) if self.credentials_rejected() => {
                Err(LabelCatalogError::SessionExpired)
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

        let settings = self
            .settings_store
            .load()
            .map_err(|_| PublishError::StorageUnavailable)?;
        if !settings.app_visible_repos.contains(&draft.repo) {
            return Err(PublishError::NotAppVisible);
        }

        let labels =
            self.ensure_remote_labels(&credentials.access_token, &draft.repo, &draft.label_names);
        let label_names = match labels {
            Ok(names) => names,
            Err(err) => return Err(self.publish_error_for(err)),
        };

        let minted = self.github.create_issue(
            &credentials.access_token,
            &draft.repo,
            draft.title.trim(),
            &draft.body,
            &label_names,
        );
        let created = match minted {
            Ok(issue) => issue,
            Err(err) => return Err(self.publish_error_for(err)),
        };

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

        let fetched = self
            .github
            .get_issue(&credentials.access_token, &draft.repo, number);
        let remote = match fetched {
            Ok(issue) => issue,
            Err(err) => return Err(self.update_error_for(err)),
        };

        let snapshot = draft
            .remote_snapshot
            .as_ref()
            .ok_or(UpdateError::NotLinked)?;
        if remote.updated_at != snapshot.updated_at {
            return Err(UpdateError::Conflict);
        }

        let labels =
            self.ensure_remote_labels(&credentials.access_token, &draft.repo, &draft.label_names);
        let label_names = match labels {
            Ok(names) => names,
            Err(err) => return Err(self.update_error_for(err)),
        };

        let pushed = self.github.update_issue(
            &credentials.access_token,
            &draft.repo,
            number,
            draft.title.trim(),
            &draft.body,
            &label_names,
        );
        let updated = match pushed {
            Ok(issue) => issue,
            Err(err) => return Err(self.update_error_for(err)),
        };

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

        let labels =
            self.ensure_remote_labels(&credentials.access_token, &draft.repo, &draft.label_names);
        let label_names = match labels {
            Ok(names) => names,
            Err(err) => return Err(self.update_error_for(err)),
        };

        let pushed = self.github.update_issue(
            &credentials.access_token,
            &draft.repo,
            number,
            draft.title.trim(),
            &draft.body,
            &label_names,
        );
        let updated = match pushed {
            Ok(issue) => issue,
            Err(err) => return Err(self.update_error_for(err)),
        };

        apply_remote_issue_to_draft(&mut draft, &updated, self.clock.now());
        self.draft_store
            .save(draft.clone())
            .map_err(|_| UpdateError::StorageUnavailable)?;
        Ok(draft)
    }

    /// Conflict resolution: replace local working fields from a fresh GET and refresh the snapshot.
    pub fn use_theirs(&mut self, id: &str) -> Result<Draft, UpdateError> {
        let (credentials, mut draft, number) = self.load_linked_for_update(id)?;
        let fetched = self
            .github
            .get_issue(&credentials.access_token, &draft.repo, number);
        let remote = match fetched {
            Ok(issue) => issue,
            Err(err) => return Err(self.update_error_for(err)),
        };

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

    pub fn timestamp_display(&self) -> TimestampDisplay {
        self.settings_store
            .load()
            .map(|s| s.timestamp_display)
            .unwrap_or_default()
    }

    pub fn save_timestamp_display(
        &mut self,
        display: TimestampDisplay,
    ) -> Result<(), SettingsStoreError> {
        let mut settings = self.settings_store.load().unwrap_or_default();
        settings.timestamp_display = display;
        self.settings_store.save(settings)
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

    /// Built-in + user-defined Rewrite styles and the resolved last-used id (Clear fallback).
    pub fn list_rewrite_styles(&self) -> Result<RewriteStylesSnapshot, RewriteError> {
        self.require_signed_in_for_rewrite()?;
        let settings = self
            .settings_store
            .load()
            .map_err(|_| RewriteError::StorageUnavailable)?;
        let last_used_id = rewrite::resolve_last_used_style_id(
            settings.last_used_rewrite_style_id.as_deref(),
            &settings.custom_rewrite_styles,
        );
        Ok(RewriteStylesSnapshot {
            styles: rewrite::all_rewrite_styles(&settings.custom_rewrite_styles),
            last_used_id,
        })
    }

    /// Add a user-defined Rewrite style (name + instruction).
    pub fn add_custom_rewrite_style(
        &mut self,
        name: &str,
        instruction: &str,
    ) -> Result<RewriteStyleInfo, RewriteError> {
        self.require_signed_in_for_rewrite()?;
        let name = name.trim();
        let instruction = instruction.trim();
        if name.is_empty() || instruction.is_empty() {
            return Err(RewriteError::EmptyFields);
        }
        let mut settings = self
            .settings_store
            .load()
            .map_err(|_| RewriteError::StorageUnavailable)?;
        let id = format!(
            "custom-{}",
            self.clock
                .now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis())
                .unwrap_or(0)
        );
        let custom = CustomRewriteStyle {
            id: id.clone(),
            name: name.to_string(),
            instruction: instruction.to_string(),
        };
        settings.custom_rewrite_styles.push(custom);
        self.settings_store
            .save(settings)
            .map_err(|_| RewriteError::StorageUnavailable)?;
        Ok(RewriteStyleInfo {
            id,
            name: name.to_string(),
            instruction: instruction.to_string(),
            builtin: false,
        })
    }

    /// Remove a user-defined Rewrite style. Built-ins cannot be removed.
    pub fn remove_custom_rewrite_style(&mut self, style_id: &str) -> Result<(), RewriteError> {
        self.require_signed_in_for_rewrite()?;
        let mut settings = self
            .settings_store
            .load()
            .map_err(|_| RewriteError::StorageUnavailable)?;
        let before = settings.custom_rewrite_styles.len();
        settings.custom_rewrite_styles.retain(|s| s.id != style_id);
        if settings.custom_rewrite_styles.len() == before {
            return Err(RewriteError::NotFound);
        }
        if settings.last_used_rewrite_style_id.as_deref() == Some(style_id) {
            settings.last_used_rewrite_style_id = Some(CLEAR_STYLE_ID.into());
        }
        self.settings_store
            .save(settings)
            .map_err(|_| RewriteError::StorageUnavailable)?;
        Ok(())
    }

    /// Run Rewrite via the engine port. Does **not** persist last-used — call
    /// `remember_last_rewrite_style` only after the UI accepts the Generate result
    /// (so Cancel / close mid-generate does not change last-used).
    pub fn generate_rewrite(
        &mut self,
        title: &str,
        body: &str,
        style_id: &str,
    ) -> Result<RewriteProposal, RewriteError> {
        self.require_signed_in_for_rewrite()?;
        if is_too_thin_for_rewrite(title, body) {
            return Err(RewriteError::TooThin);
        }
        let settings = self
            .settings_store
            .load()
            .map_err(|_| RewriteError::StorageUnavailable)?;
        let resolved_id = rewrite::find_rewrite_style(style_id, &settings.custom_rewrite_styles)
            .map(|s| s.id)
            .unwrap_or_else(|| CLEAR_STYLE_ID.to_string());
        let style = rewrite::find_rewrite_style(&resolved_id, &settings.custom_rewrite_styles)
            .expect("Clear is always present");
        self.rewrite
            .rewrite(&RewriteInput {
                title: title.to_string(),
                body: body.to_string(),
                style,
            })
            .map_err(|err| match err {
                RewriteEngineError::TimedOut => RewriteError::TimedOut,
                RewriteEngineError::Cancelled => RewriteError::Cancelled,
                RewriteEngineError::EngineFailed => RewriteError::EngineFailed,
            })
    }

    /// Persist global last-used Rewrite style after a successful, non-cancelled Generate.
    pub fn remember_last_rewrite_style(&mut self, style_id: &str) -> Result<(), RewriteError> {
        self.require_signed_in_for_rewrite()?;
        let mut settings = self
            .settings_store
            .load()
            .map_err(|_| RewriteError::StorageUnavailable)?;
        let resolved_id = rewrite::find_rewrite_style(style_id, &settings.custom_rewrite_styles)
            .map(|s| s.id)
            .unwrap_or_else(|| CLEAR_STYLE_ID.to_string());
        settings.last_used_rewrite_style_id = Some(resolved_id);
        self.settings_store
            .save(settings)
            .map_err(|_| RewriteError::StorageUnavailable)?;
        Ok(())
    }

    /// Catalog + disk status for Rewrite setup / model settings. Cleans orphan partials.
    /// Detects hardware and pre-selects the tier A–D catalog default (user may override).
    pub fn rewrite_model_status(&self) -> Result<RewriteModelStatusSnapshot, RewriteError> {
        self.rewrite_model_status_with(true, true, true)
    }

    /// Read-only Help snapshot: no sign-in gate, no orphan cleanup, no content hash.
    /// Opening Help must not stream-hash multi-GB GGUFs while holding the Core lock.
    pub fn rewrite_model_help_status(&self) -> Result<RewriteModelStatusSnapshot, RewriteError> {
        self.rewrite_model_status_with(false, false, false)
    }

    fn rewrite_model_status_with(
        &self,
        require_signed_in: bool,
        clean_orphans: bool,
        hash_contents: bool,
    ) -> Result<RewriteModelStatusSnapshot, RewriteError> {
        if require_signed_in {
            self.require_signed_in_for_rewrite()?;
        }
        if clean_orphans {
            self.rewrite_models
                .clean_orphan_partials()
                .map_err(|_| RewriteError::StorageUnavailable)?;
        }
        let settings = self
            .settings_store
            .load()
            .map_err(|_| RewriteError::StorageUnavailable)?;
        let active = settings.active_rewrite_model_id.clone();
        let profile = self.hardware.probe();
        let fingerprint = profile.fingerprint();
        let recommendation = recommend_rewrite_model_for(&profile);
        let models: Vec<RewriteModelDiskStatus> = rewrite_model_catalog()
            .iter()
            .map(|entry| {
                let on_disk_bytes = self.rewrite_models.on_disk_len(entry.filename);
                let on_disk = on_disk_bytes.is_some();
                let verified = if hash_contents {
                    self.rewrite_models
                        .is_verified(entry.filename, entry.size_bytes, entry.sha256)
                } else {
                    self.rewrite_models.is_verified_cached(
                        entry.filename,
                        entry.size_bytes,
                        entry.sha256,
                    )
                };
                let is_active = active.as_deref() == Some(entry.id) && verified;
                RewriteModelDiskStatus {
                    id: entry.id.into(),
                    display_name: entry.display_name.into(),
                    size_bytes: entry.size_bytes,
                    summary: entry.summary.into(),
                    on_disk,
                    on_disk_bytes,
                    verified,
                    active: is_active,
                    update_available: on_disk && !verified,
                }
            })
            .collect();
        let active_verified = active
            .as_ref()
            .is_some_and(|id| models.iter().any(|m| m.id == *id && m.verified && m.active));
        let active_model_id = if active_verified {
            active.clone()
        } else {
            None
        };
        let show_prompt = rewrite_hardware::hardware_switch_prompt_needed(
            active_model_id.as_deref(),
            recommendation.model_id,
            &fingerprint,
            settings
                .rewrite_hardware_prompt_acked_fingerprint
                .as_deref(),
        );
        let hardware_switch_prompt = if show_prompt {
            Some(RewriteHardwareSwitchPrompt {
                current_model_id: active_model_id.clone().unwrap_or_default(),
                recommended_model_id: recommendation.model_id.into(),
                reason: recommendation.reason.into(),
                fingerprint,
            })
        } else {
            None
        };
        let hardware_tier = match recommendation.tier {
            HardwareTier::A => "A",
            HardwareTier::B => "B",
            HardwareTier::C => "C",
            HardwareTier::D => "D",
        };
        Ok(RewriteModelStatusSnapshot {
            models,
            active_model_id,
            recommended_model_id: recommendation.model_id.into(),
            recommended_reason: recommendation.reason.into(),
            hardware_tier: hardware_tier.into(),
            quality_alt_model_id: recommendation.quality_alt_model_id.map(str::to_string),
            hardware_switch_prompt,
            needs_setup: !active_verified,
        })
    }

    /// Keep or Switch after a hardware-recommendation soft prompt. Never downloads.
    /// Switch activates the recommended model when verified; otherwise clears active so
    /// setup pre-selects it for an explicit Download.
    pub fn respond_rewrite_hardware_prompt(
        &mut self,
        switch: bool,
    ) -> Result<RewriteModelStatusSnapshot, RewriteError> {
        self.require_signed_in_for_rewrite()?;
        let profile = self.hardware.probe();
        let fingerprint = profile.fingerprint();
        let recommendation = recommend_rewrite_model_for(&profile);
        let mut settings = self
            .settings_store
            .load()
            .map_err(|_| RewriteError::StorageUnavailable)?;
        settings.rewrite_hardware_prompt_acked_fingerprint = Some(fingerprint);
        if switch {
            let entry =
                find_rewrite_model(recommendation.model_id).ok_or(RewriteError::NotFound)?;
            if self
                .rewrite_models
                .is_verified(entry.filename, entry.size_bytes, entry.sha256)
            {
                settings.active_rewrite_model_id = Some(entry.id.into());
            } else {
                // No auto-download — clear active so setup shows the new recommendation.
                settings.active_rewrite_model_id = None;
            }
        }
        self.settings_store
            .save(settings)
            .map_err(|_| RewriteError::StorageUnavailable)?;
        self.rewrite_model_status()
    }

    /// Mark a verified on-disk catalog model as active (keeps prior downloads).
    pub fn set_active_rewrite_model(&mut self, model_id: &str) -> Result<(), RewriteError> {
        self.require_signed_in_for_rewrite()?;
        let entry = find_rewrite_model(model_id).ok_or(RewriteError::NotFound)?;
        if !self
            .rewrite_models
            .is_verified(entry.filename, entry.size_bytes, entry.sha256)
        {
            return Err(RewriteError::ModelNotReady);
        }
        let mut settings = self
            .settings_store
            .load()
            .map_err(|_| RewriteError::StorageUnavailable)?;
        settings.active_rewrite_model_id = Some(entry.id.into());
        self.settings_store
            .save(settings)
            .map_err(|_| RewriteError::StorageUnavailable)?;
        Ok(())
    }

    /// Remove a downloaded model. Active remove clears active (next Rewrite re-enters setup).
    pub fn remove_rewrite_model(&mut self, model_id: &str) -> Result<(), RewriteError> {
        self.require_signed_in_for_rewrite()?;
        let entry = find_rewrite_model(model_id).ok_or(RewriteError::NotFound)?;
        self.rewrite_models
            .remove(entry.filename)
            .map_err(|_| RewriteError::StorageUnavailable)?;
        let mut settings = self
            .settings_store
            .load()
            .map_err(|_| RewriteError::StorageUnavailable)?;
        if settings.active_rewrite_model_id.as_deref() == Some(entry.id) {
            settings.active_rewrite_model_id = None;
        }
        self.settings_store
            .save(settings)
            .map_err(|_| RewriteError::StorageUnavailable)?;
        Ok(())
    }

    /// Absolute path of the active verified GGUF when ready (for llama.cpp sidecar).
    pub fn active_rewrite_model_path(&self) -> Option<std::path::PathBuf> {
        let settings = self.settings_store.load().ok()?;
        let id = settings.active_rewrite_model_id.as_deref()?;
        let entry = find_rewrite_model(id)?;
        if !self
            .rewrite_models
            .is_verified(entry.filename, entry.size_bytes, entry.sha256)
        {
            return None;
        }
        Some(self.rewrite_models.path_for(entry.filename))
    }

    fn require_signed_in_for_rewrite(&self) -> Result<(), RewriteError> {
        if self.auth_state() != AuthState::SignedIn {
            return Err(RewriteError::NotSignedIn);
        }
        Ok(())
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

fn effective_testing_set_add_limit(settings: &AppSettings) -> usize {
    if !settings.first_run_completed {
        TESTING_SET_RECOMMENDED_MAX
    } else {
        settings.testing_set_max
    }
}

/// Drop non-App-visible Testing set repos and clamp max to App-visible count. Returns whether anything changed.
fn reconcile_testing_set_with_app_visible(settings: &mut AppSettings) -> bool {
    let before_set = settings.testing_set.clone();
    let before_max = settings.testing_set_max;
    let visible = settings.app_visible_repos.clone();
    settings.testing_set.retain(|r| visible.contains(r));
    let ceiling = visible.len();
    if settings.testing_set_max > ceiling {
        settings.testing_set_max = ceiling;
    }
    settings.testing_set != before_set || settings.testing_set_max != before_max
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
        created_at: draft.created_at,
    }
}

fn map_github_error(err: GitHubError) -> AuthError {
    match err {
        GitHubError::InvalidCredentials => AuthError::InvalidCredentials,
        GitHubError::Unavailable => AuthError::ProviderUnavailable,
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
        FakeClock, FakeDraftStore, FakeGitHub, FakeLabelCatalogStore, FakeRewriteModelFiles,
        FakeSettingsStore, FakeTokenStore, FakeVoiceTranscriber,
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
            FakeGitHub::rejecting_pat(),
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
                ..FakeTokenStore::default()
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
        assert_eq!(err, TestingSetError::LimitReached { max: 3 });
        assert_eq!(core.testing_set().len(), 3);
    }

    #[test]
    fn after_first_run_settings_max_allows_more_than_three() {
        let mut core = signed_in_core(
            FakeGitHub::default(),
            FakeSettingsStore::with_settings(AppSettings {
                install_completed: true,
                first_run_completed: true,
                testing_set_max: 4,
                app_visible_repos: vec![
                    repo("acme", "one"),
                    repo("acme", "two"),
                    repo("acme", "three"),
                    repo("acme", "four"),
                ],
                ..AppSettings::default()
            }),
        );

        for name in ["one", "two", "three", "four"] {
            core.add_testing_set_repo(repo("acme", name)).expect(name);
        }
        assert_eq!(core.testing_set().len(), 4);
    }

    #[test]
    fn set_testing_set_max_refuses_below_current_set_size() {
        let mut core = signed_in_core(
            FakeGitHub::default(),
            FakeSettingsStore::with_settings(AppSettings {
                install_completed: true,
                first_run_completed: true,
                testing_set_max: 4,
                testing_set: vec![
                    repo("acme", "one"),
                    repo("acme", "two"),
                    repo("acme", "three"),
                    repo("acme", "four"),
                ],
                app_visible_repos: vec![
                    repo("acme", "one"),
                    repo("acme", "two"),
                    repo("acme", "three"),
                    repo("acme", "four"),
                ],
                ..AppSettings::default()
            }),
        );

        let err = core
            .set_testing_set_max(3)
            .expect_err("must refuse while oversized");
        assert_eq!(
            err,
            TestingSetError::MaxBelowCurrentSet {
                current: 4,
                requested: 3,
            }
        );
        assert_eq!(core.testing_set_max(), 4);
    }

    #[test]
    fn add_all_app_visible_fills_testing_set_and_raises_max() {
        let mut core = signed_in_core(
            FakeGitHub::default(),
            FakeSettingsStore::with_settings(AppSettings {
                install_completed: true,
                first_run_completed: true,
                testing_set_max: 3,
                testing_set: vec![repo("acme", "one")],
                app_visible_repos: vec![
                    repo("acme", "one"),
                    repo("acme", "two"),
                    repo("acme", "three"),
                    repo("acme", "four"),
                ],
                ..AppSettings::default()
            }),
        );

        core.add_all_app_visible_to_testing_set().expect("add all");
        assert_eq!(core.testing_set_max(), 4);
        assert_eq!(core.testing_set().len(), 4);
    }

    #[test]
    fn reconcile_clamps_max_and_prunes_non_visible_repos() {
        let mut core = signed_in_core(
            FakeGitHub::default(),
            FakeSettingsStore::with_settings(AppSettings {
                install_completed: true,
                first_run_completed: true,
                testing_set_max: 5,
                testing_set: vec![
                    repo("acme", "one"),
                    repo("acme", "gone"),
                    repo("acme", "two"),
                ],
                app_visible_repos: vec![repo("acme", "one"), repo("acme", "two")],
                ..AppSettings::default()
            }),
        );

        let changed = core
            .reconcile_testing_set_with_app_visible()
            .expect("reconcile");
        assert!(changed);
        assert_eq!(core.testing_set_max(), 2);
        assert_eq!(
            core.testing_set(),
            vec![repo("acme", "one"), repo("acme", "two")]
        );
    }

    #[test]
    fn set_testing_set_max_and_add_all_refuse_before_first_run_complete() {
        let mut core = signed_in_core(
            FakeGitHub::default(),
            FakeSettingsStore::with_settings(AppSettings {
                install_completed: true,
                first_run_completed: false,
                app_visible_repos: vec![repo("acme", "one"), repo("acme", "two")],
                ..AppSettings::default()
            }),
        );

        assert_eq!(
            core.set_testing_set_max(2).expect_err("settings only"),
            TestingSetError::SettingsOnly
        );
        assert_eq!(
            core.add_all_app_visible_to_testing_set()
                .expect_err("settings only"),
            TestingSetError::SettingsOnly
        );
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
                ..FakeTokenStore::default()
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
                ..FakeTokenStore::default()
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

    /// Simulates a machine restart: a fresh core over a vault that already holds credentials.
    fn restarted_core(github: FakeGitHub, settings: FakeSettingsStore) -> TestCore {
        IssuebridgeCore::new(
            github,
            FakeTokenStore {
                credentials: Some(StoredCredentials {
                    access_token: "ghu_vaulted_token_not_a_secret".into(),
                    refresh_token: None,
                }),
                ..FakeTokenStore::default()
            },
            FakeDraftStore::default(),
            FakeVoiceTranscriber::default(),
            FakeClock::default(),
            settings,
            FakeLabelCatalogStore::default(),
        )
    }

    #[test]
    fn validate_session_keeps_signed_in_after_restart_when_token_is_still_valid() {
        let mut core = restarted_core(FakeGitHub::default(), ready_settings());

        assert_eq!(core.validate_session(), AuthState::SignedIn);
        assert_eq!(core.auth_state(), AuthState::SignedIn);
        assert_eq!(core.first_run_step(), FirstRunStep::Ready);
        assert!(core.token_store.load().expect("vault").is_some());
    }

    #[test]
    fn validate_session_signs_out_and_clears_vault_when_github_rejects_the_token() {
        let mut core = restarted_core(FakeGitHub::rejecting_pat(), ready_settings());
        assert_eq!(core.auth_state(), AuthState::SignedIn);

        assert_eq!(core.validate_session(), AuthState::SignedOut);
        assert_eq!(core.auth_state(), AuthState::SignedOut);
        assert_eq!(core.first_run_step(), FirstRunStep::SignIn);
        assert!(core.token_store.load().expect("vault").is_none());
    }

    #[test]
    fn validate_session_keeps_the_session_when_github_is_unavailable() {
        let github = FakeGitHub::default();
        github.set_validate_pat_error(Some(GitHubError::Unavailable));
        let mut core = restarted_core(github, ready_settings());

        assert_eq!(core.validate_session(), AuthState::SignedIn);
        assert!(core.token_store.load().expect("vault").is_some());
    }

    #[test]
    fn validate_session_on_an_empty_vault_is_signed_out() {
        let mut core = fresh_core();

        assert_eq!(core.validate_session(), AuthState::SignedOut);
        assert_eq!(core.auth_state(), AuthState::SignedOut);
    }

    #[test]
    fn forced_sign_out_drops_the_session_even_when_the_vault_clear_fails() {
        let mut core = IssuebridgeCore::new(
            FakeGitHub::rejecting_pat(),
            FakeTokenStore {
                credentials: Some(StoredCredentials {
                    access_token: "ghu_vaulted_token_not_a_secret".into(),
                    refresh_token: None,
                }),
                clear_fails: true,
            },
            FakeDraftStore::default(),
            FakeVoiceTranscriber::default(),
            FakeClock::default(),
            ready_settings(),
            FakeLabelCatalogStore::default(),
        );

        assert_eq!(core.validate_session(), AuthState::SignedOut);

        // A locked keychain left the rejected token in the vault. The session decision
        // must still outrank vault presence — otherwise `auth_state` says SignedIn, the
        // next focus refresh bounces the user back into the Inbox against a dead token,
        // and `emit_if_signed_out` never fires because it reads `auth_state`.
        assert!(core.token_store.load().expect("vault").is_some());
        assert_eq!(core.auth_state(), AuthState::SignedOut);
        assert_eq!(core.first_run_step(), FirstRunStep::SignIn);
    }

    #[test]
    fn apply_session_validation_ignores_a_verdict_for_a_token_the_vault_no_longer_holds() {
        let mut core = restarted_core(FakeGitHub::default(), ready_settings());

        // Launch validation runs off-lock, so the user can sign in again while the
        // request is in flight. A rejection for the superseded token must not evict
        // the newer session.
        let auth = core.apply_session_validation(
            "ghu_superseded_token_not_a_secret",
            Err(GitHubError::InvalidCredentials),
        );

        assert_eq!(auth, AuthState::SignedIn);
        assert!(core.token_store.load().expect("vault").is_some());
    }

    #[test]
    fn forced_sign_out_from_a_rejected_token_does_not_rewind_first_run_progress() {
        let settings = ready_settings();
        let mut core = restarted_core(FakeGitHub::rejecting_pat(), settings.clone());

        assert_eq!(core.validate_session(), AuthState::SignedOut);

        assert!(settings.snapshot().install_completed);
        assert!(settings.snapshot().testing_set_completed);
        assert!(settings.snapshot().first_run_completed);
        assert_eq!(
            settings.snapshot().testing_set,
            vec![repo("acme", "widgets")]
        );
    }

    #[test]
    fn ensure_label_catalog_signs_out_when_github_rejects_the_token() {
        let github = FakeGitHub::default();
        github.set_list_labels_error(Some(GitHubError::InvalidCredentials));
        github.set_validate_pat_error(Some(GitHubError::InvalidCredentials));
        let mut core = restarted_core(github, ready_settings());

        let err = core
            .ensure_label_catalog(&repo("acme", "widgets"))
            .expect_err("a rejected token must not soft-fail to an empty catalog");

        assert_eq!(err, LabelCatalogError::SessionExpired);
        assert_eq!(core.auth_state(), AuthState::SignedOut);
        assert!(core.token_store.load().expect("vault").is_none());
    }

    #[test]
    fn prefetch_testing_set_label_catalogs_propagates_a_rejected_token() {
        let github = FakeGitHub::default();
        github.set_list_labels_error(Some(GitHubError::InvalidCredentials));
        github.set_validate_pat_error(Some(GitHubError::InvalidCredentials));
        let mut core = restarted_core(github, ready_settings());

        let err = core
            .prefetch_testing_set_label_catalogs()
            .expect_err("prefetch must surface the expired session");

        assert_eq!(err, LabelCatalogError::SessionExpired);
        assert_eq!(core.auth_state(), AuthState::SignedOut);
    }

    #[test]
    fn ensure_label_catalog_keeps_the_session_when_only_this_repo_is_forbidden() {
        let github = FakeGitHub::default();
        github.set_list_labels_error(Some(GitHubError::InvalidCredentials));
        let mut core = restarted_core(github, ready_settings());

        let ensured = core
            .ensure_label_catalog(&repo("acme", "widgets"))
            .expect("a still-valid token keeps the soft-fail behaviour");

        assert!(ensured.refresh_failed);
        assert_eq!(core.auth_state(), AuthState::SignedIn);
        assert!(core.token_store.load().expect("vault").is_some());
    }

    #[test]
    fn publish_with_a_rejected_token_clears_the_session() {
        let github = FakeGitHub {
            create_issue_result: Some(Err(GitHubError::InvalidCredentials)),
            ..FakeGitHub::default()
        };
        github.set_validate_pat_error(Some(GitHubError::InvalidCredentials));
        let mut core = restarted_core(github, ready_settings());
        let saved = core
            .save_capture(CaptureInput {
                repo: repo("acme", "widgets"),
                title: "Broken button".into(),
                body: "Clicking Save does nothing.".into(),
            })
            .expect("capture");

        let err = core
            .publish_draft(&saved.id)
            .expect_err("Publish with a dead token must fail");

        assert_eq!(err, PublishError::InvalidCredentials);
        assert_eq!(core.auth_state(), AuthState::SignedOut);
        assert!(core.token_store.load().expect("vault").is_none());
    }

    #[test]
    fn publish_forbidden_with_a_still_valid_token_keeps_the_session() {
        let mut core = restarted_core(
            FakeGitHub {
                create_issue_result: Some(Err(GitHubError::InvalidCredentials)),
                ..FakeGitHub::default()
            },
            ready_settings(),
        );
        let saved = core
            .save_capture(CaptureInput {
                repo: repo("acme", "widgets"),
                title: "Broken button".into(),
                body: "Clicking Save does nothing.".into(),
            })
            .expect("capture");

        let err = core
            .publish_draft(&saved.id)
            .expect_err("Publish still fails");

        assert_eq!(err, PublishError::InvalidCredentials);
        assert_eq!(core.auth_state(), AuthState::SignedIn);
        assert!(core.token_store.load().expect("vault").is_some());
    }

    #[test]
    fn update_linked_draft_with_a_rejected_token_clears_the_session() {
        let github = FakeGitHub::default();
        let mut core = restarted_core(github.clone(), ready_settings());
        let saved = core
            .save_capture(CaptureInput {
                repo: repo("acme", "widgets"),
                title: "Broken button".into(),
                body: "Clicking Save does nothing.".into(),
            })
            .expect("capture");
        core.publish_draft(&saved.id).expect("Publish");

        github.set_issue_error(Some(GitHubError::InvalidCredentials));
        github.set_validate_pat_error(Some(GitHubError::InvalidCredentials));

        let err = core
            .update_linked_draft(&saved.id)
            .expect_err("Update with a dead token must fail");

        assert_eq!(err, UpdateError::InvalidCredentials);
        assert_eq!(core.auth_state(), AuthState::SignedOut);
        assert!(core.token_store.load().expect("vault").is_none());
    }

    #[test]
    fn continue_install_keeps_the_session_for_an_identity_only_pat() {
        let mut core = restarted_core(
            FakeGitHub {
                install_snapshot: Err(GitHubError::InvalidCredentials),
                ..FakeGitHub::default()
            },
            FakeSettingsStore::default(),
        );

        let err = core
            .continue_install()
            .expect_err("PAT cannot list installs");

        assert_eq!(err, InstallError::TokenLacksInstallAccess);
        assert_eq!(core.auth_state(), AuthState::SignedIn);
        assert!(core.token_store.load().expect("vault").is_some());
    }

    #[test]
    fn continue_install_with_a_rejected_token_clears_the_session() {
        let github = FakeGitHub {
            install_snapshot: Err(GitHubError::InvalidCredentials),
            ..FakeGitHub::default()
        };
        github.set_validate_pat_error(Some(GitHubError::InvalidCredentials));
        let mut core = restarted_core(github, FakeSettingsStore::default());

        let err = core
            .continue_install()
            .expect_err("Continue with a dead token must fail");

        assert_eq!(err, InstallError::NotSignedIn);
        assert_eq!(core.auth_state(), AuthState::SignedOut);
        assert!(core.token_store.load().expect("vault").is_none());
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
    fn publish_outside_app_visible_repos_is_refused_before_github_write() {
        let (mut core, github) = ready_core_with_github();
        let outside_repo = repo("acme", "private-admin");
        let saved = core
            .save_capture(CaptureInput {
                repo: outside_repo.clone(),
                title: "Unexpected Publish target".into(),
                body: "This Draft must remain local.".into(),
            })
            .expect("capture");

        let err = core
            .publish_draft(&saved.id)
            .expect_err("Publish outside App-visible repos must be refused");

        assert_eq!(err, PublishError::NotAppVisible);
        assert!(github.issues.lock().expect("FakeGitHub issues").is_empty());
        let loaded = core.get_draft(&saved.id).expect("get");
        assert!(loaded.local_link.is_none());
        assert!(loaded.remote_snapshot.is_none());
    }

    #[test]
    fn publish_with_invalid_credentials_maps_to_invalid_credentials() {
        let mut core = signed_in_core(
            FakeGitHub {
                create_issue_result: Some(Err(GitHubError::InvalidCredentials)),
                ..FakeGitHub::default()
            },
            ready_settings(),
        );
        let saved = core
            .save_capture(CaptureInput {
                repo: repo("acme", "widgets"),
                title: "Broken button".into(),
                body: "Clicking Save does nothing.".into(),
            })
            .expect("capture");

        let err = core
            .publish_draft(&saved.id)
            .expect_err("Publish with bad credentials must fail");
        assert_eq!(err, PublishError::InvalidCredentials);

        let loaded = core.get_draft(&saved.id).expect("get");
        assert!(loaded.local_link.is_none());
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
        github.set_list_labels_error(Some(GitHubError::Unavailable));

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

    #[test]
    fn draft_is_too_thin_for_rewrite_when_title_and_body_below_thresholds() {
        assert!(is_too_thin_for_rewrite("short", "tiny"));
        assert!(is_too_thin_for_rewrite("  ab  ", "   "));
        assert!(!is_too_thin_for_rewrite("long enough title", "short body",));
        assert!(!is_too_thin_for_rewrite(
            "short",
            "this body is definitely longer than forty characters total",
        ));
        assert!(!is_too_thin_for_rewrite(
            "long enough title here",
            "this body is definitely longer than forty characters total",
        ));
    }

    #[test]
    fn list_rewrite_styles_includes_builtins_and_defaults_last_used_to_clear() {
        let core = signed_in_core(FakeGitHub::default(), FakeSettingsStore::default());
        let snap = core.list_rewrite_styles().expect("styles");
        assert_eq!(snap.last_used_id, CLEAR_STYLE_ID);
        let names: Vec<_> = snap.styles.iter().map(|s| s.name.as_str()).collect();
        assert_eq!(
            names,
            vec![
                "Clear",
                "Bug report",
                "Feature request",
                "Question",
                "Concise"
            ]
        );
        assert!(snap.styles.iter().all(|s| s.builtin));
    }

    #[test]
    fn generate_rewrite_rejects_too_thin_and_does_not_persist_last_used() {
        let settings = FakeSettingsStore::default();
        let mut core = signed_in_core(FakeGitHub::default(), settings.clone());
        let err = core
            .generate_rewrite("short", "tiny", CLEAR_STYLE_ID)
            .expect_err("too thin");
        assert_eq!(err, RewriteError::TooThin);
        assert!(settings.snapshot().last_used_rewrite_style_id.is_none());
    }

    #[test]
    fn generate_rewrite_uses_stub_engine_without_persisting_last_used() {
        let settings = FakeSettingsStore::default();
        let mut core = signed_in_core(FakeGitHub::default(), settings.clone());
        let title = "login btn broke on staging";
        let body = "clicked login on staging after deploy, spinner forever. chrome. saw 500.";
        let proposal = core
            .generate_rewrite(title, body, "bug_report")
            .expect("generate");
        assert!(proposal.title.contains("bug report"));
        assert!(proposal.body.contains("## Problem"));
        assert!(settings.snapshot().last_used_rewrite_style_id.is_none());
    }

    #[test]
    fn remember_last_rewrite_style_persists_globally_after_successful_generate() {
        let settings = FakeSettingsStore::default();
        let mut core = signed_in_core(FakeGitHub::default(), settings.clone());
        core.remember_last_rewrite_style("bug_report")
            .expect("remember");
        assert_eq!(
            settings.snapshot().last_used_rewrite_style_id.as_deref(),
            Some("bug_report")
        );
        let snap = core.list_rewrite_styles().expect("styles");
        assert_eq!(snap.last_used_id, "bug_report");
    }

    #[test]
    fn missing_custom_rewrite_last_used_falls_back_to_clear() {
        let settings = FakeSettingsStore::with_settings(AppSettings {
            last_used_rewrite_style_id: Some("custom-gone".into()),
            ..AppSettings::default()
        });
        let core = signed_in_core(FakeGitHub::default(), settings);
        let snap = core.list_rewrite_styles().expect("styles");
        assert_eq!(snap.last_used_id, CLEAR_STYLE_ID);
    }

    #[test]
    fn user_defined_rewrite_styles_can_be_added_and_removed() {
        let settings = FakeSettingsStore::default();
        let mut core = signed_in_core(FakeGitHub::default(), settings.clone());
        let custom = core
            .add_custom_rewrite_style("Release notes", "Make it sound like release notes.")
            .expect("add");
        assert!(!custom.builtin);
        assert_eq!(custom.name, "Release notes");
        let snap = core.list_rewrite_styles().expect("styles");
        assert_eq!(snap.styles.len(), 6);
        assert!(snap.styles.iter().any(|s| s.id == custom.id));

        core.generate_rewrite(
            "login btn broke on staging",
            "clicked login on staging after deploy, spinner forever. chrome.",
            &custom.id,
        )
        .expect("generate with custom");
        core.remember_last_rewrite_style(&custom.id)
            .expect("remember custom");
        assert_eq!(
            settings.snapshot().last_used_rewrite_style_id.as_deref(),
            Some(custom.id.as_str())
        );

        core.remove_custom_rewrite_style(&custom.id)
            .expect("remove");
        let snap = core.list_rewrite_styles().expect("styles");
        assert_eq!(snap.styles.len(), 5);
        assert_eq!(snap.last_used_id, CLEAR_STYLE_ID);
        assert!(core.remove_custom_rewrite_style(CLEAR_STYLE_ID).is_err());
    }

    #[test]
    fn generate_rewrite_with_unknown_style_id_uses_clear_engine_path() {
        let settings = FakeSettingsStore::default();
        let mut core = signed_in_core(FakeGitHub::default(), settings.clone());
        let proposal = core
            .generate_rewrite(
                "login btn broke on staging",
                "clicked login on staging after deploy, spinner forever. chrome.",
                "custom-missing",
            )
            .expect("fallback generate");
        assert!(proposal.body.contains("Clear") || proposal.body.contains("skimability"));
        core.remember_last_rewrite_style("custom-missing")
            .expect("remember falls back");
        assert_eq!(
            settings.snapshot().last_used_rewrite_style_id.as_deref(),
            Some(CLEAR_STYLE_ID)
        );
    }

    #[test]
    fn rewrite_model_status_needs_setup_until_active_verified_model() {
        #[derive(Clone)]
        struct OnDiskVerified {
            inner: FakeRewriteModelFiles,
        }
        impl RewriteModelFiles for OnDiskVerified {
            fn clean_orphan_partials(&self) -> Result<(), RewriteModelFileError> {
                self.inner.clean_orphan_partials()
            }
            fn path_for(&self, filename: &str) -> std::path::PathBuf {
                self.inner.path_for(filename)
            }
            fn on_disk_len(&self, filename: &str) -> Option<u64> {
                self.inner.on_disk_len(filename)
            }
            fn is_verified(
                &self,
                filename: &str,
                _expected_size: u64,
                _expected_sha256: &str,
            ) -> bool {
                self.inner.on_disk_len(filename).is_some()
            }
            fn is_verified_cached(
                &self,
                filename: &str,
                expected_size: u64,
                expected_sha256: &str,
            ) -> bool {
                self.is_verified(filename, expected_size, expected_sha256)
            }
            fn remove(&self, filename: &str) -> Result<(), RewriteModelFileError> {
                self.inner.remove(filename)
            }
        }

        let settings = FakeSettingsStore::default();
        let files = FakeRewriteModelFiles::default();
        let core = signed_in_core(FakeGitHub::default(), settings.clone())
            .with_rewrite_model_files(Box::new(OnDiskVerified {
                inner: files.clone(),
            }));
        let snap = core.rewrite_model_status().expect("status");
        assert!(snap.needs_setup);
        assert_eq!(snap.models.len(), 5);
        assert_eq!(snap.recommended_model_id, DEFAULT_REWRITE_MODEL_ID);
        assert!(snap.models.iter().all(|m| !m.on_disk && !m.active));
        assert!(snap
            .models
            .iter()
            .all(|m| m.id != "qwen25-3b" && !m.display_name.contains("Qwen2.5 3B")));

        let entry = find_rewrite_model(DEFAULT_REWRITE_MODEL_ID).unwrap();
        files.put(entry.filename, b"phi4-fixture-bytes".to_vec());
        let mut core = signed_in_core(FakeGitHub::default(), settings.clone())
            .with_rewrite_model_files(Box::new(OnDiskVerified {
                inner: files.clone(),
            }));
        core.set_active_rewrite_model(DEFAULT_REWRITE_MODEL_ID)
            .expect("activate");
        assert_eq!(
            settings.snapshot().active_rewrite_model_id.as_deref(),
            Some(DEFAULT_REWRITE_MODEL_ID)
        );
        let snap = core.rewrite_model_status().expect("ready");
        assert!(!snap.needs_setup);
        assert_eq!(
            snap.active_model_id.as_deref(),
            Some(DEFAULT_REWRITE_MODEL_ID)
        );
        core.remove_rewrite_model(DEFAULT_REWRITE_MODEL_ID)
            .expect("remove active");
        assert!(settings.snapshot().active_rewrite_model_id.is_none());
        assert!(core.rewrite_model_status().expect("again").needs_setup);
    }

    #[test]
    fn rewrite_model_status_marks_update_available_when_on_disk_but_unverified() {
        let files = FakeRewriteModelFiles::default();
        let entry = find_rewrite_model(DEFAULT_REWRITE_MODEL_ID).unwrap();
        // Wrong bytes → on disk but not verified against catalog SHA/size.
        files.put(entry.filename, b"stale-gguf-bytes".to_vec());
        let core = signed_in_core(FakeGitHub::default(), FakeSettingsStore::default())
            .with_rewrite_model_files(Box::new(files));
        let snap = core.rewrite_model_status().expect("status");
        let model = snap
            .models
            .iter()
            .find(|m| m.id == DEFAULT_REWRITE_MODEL_ID)
            .expect("default model");
        assert!(model.on_disk);
        assert!(!model.verified);
        assert!(model.update_available);
        assert!(snap
            .models
            .iter()
            .filter(|m| m.id != DEFAULT_REWRITE_MODEL_ID)
            .all(|m| !m.update_available));
    }

    #[test]
    fn rewrite_model_help_status_works_signed_out() {
        let core = fresh_core();
        assert!(
            core.rewrite_model_status().is_err(),
            "Settings status stays signed-in"
        );
        let snap = core
            .rewrite_model_help_status()
            .expect("Help status is readable signed out");
        assert!(!snap.hardware_tier.is_empty());
        assert_eq!(snap.models.len(), 5);
    }

    #[test]
    fn rewrite_model_help_status_does_not_inherit_hashing_or_catalog_size() {
        #[derive(Clone)]
        struct OnDiskHashOkNoMarker {
            inner: FakeRewriteModelFiles,
        }
        impl RewriteModelFiles for OnDiskHashOkNoMarker {
            fn clean_orphan_partials(&self) -> Result<(), RewriteModelFileError> {
                self.inner.clean_orphan_partials()
            }
            fn path_for(&self, filename: &str) -> std::path::PathBuf {
                self.inner.path_for(filename)
            }
            fn on_disk_len(&self, filename: &str) -> Option<u64> {
                self.inner.on_disk_len(filename)
            }
            fn is_verified(
                &self,
                filename: &str,
                _expected_size: u64,
                _expected_sha256: &str,
            ) -> bool {
                self.inner.on_disk_len(filename).is_some()
            }
            fn is_verified_cached(
                &self,
                _filename: &str,
                _expected_size: u64,
                _expected_sha256: &str,
            ) -> bool {
                false
            }
            fn remove(&self, filename: &str) -> Result<(), RewriteModelFileError> {
                self.inner.remove(filename)
            }
        }

        let files = FakeRewriteModelFiles::default();
        let entry = find_rewrite_model(DEFAULT_REWRITE_MODEL_ID).unwrap();
        files.put(entry.filename, vec![0u8; 200]);
        let settings = FakeSettingsStore::with_settings(AppSettings {
            active_rewrite_model_id: Some(DEFAULT_REWRITE_MODEL_ID.into()),
            ..AppSettings::default()
        });
        let core = signed_in_core(FakeGitHub::default(), settings)
            .with_rewrite_model_files(Box::new(OnDiskHashOkNoMarker { inner: files }));

        let help = core.rewrite_model_help_status().expect("help status");
        let help_model = help
            .models
            .iter()
            .find(|m| m.id == DEFAULT_REWRITE_MODEL_ID)
            .expect("default model");
        assert!(help_model.on_disk);
        assert!(!help_model.verified, "marker-only path must not hash");
        assert_eq!(help_model.on_disk_bytes, Some(200));
        assert_ne!(help_model.on_disk_bytes, Some(help_model.size_bytes));
        assert!(help_model.update_available);
        assert!(
            help.active_model_id.is_none(),
            "Active model stays verified-only"
        );

        let settings_snap = core.rewrite_model_status().expect("settings status");
        let settings_model = settings_snap
            .models
            .iter()
            .find(|m| m.id == DEFAULT_REWRITE_MODEL_ID)
            .expect("default model");
        assert!(settings_model.verified);
        assert_eq!(settings_model.on_disk_bytes, Some(200));
        assert_eq!(
            settings_snap.active_model_id.as_deref(),
            Some(DEFAULT_REWRITE_MODEL_ID)
        );
    }

    #[test]
    fn set_active_rewrite_model_refuses_unverified_and_keeps_prior_on_switch() {
        #[derive(Clone)]
        struct OnDiskVerified {
            inner: FakeRewriteModelFiles,
        }
        impl RewriteModelFiles for OnDiskVerified {
            fn clean_orphan_partials(&self) -> Result<(), RewriteModelFileError> {
                self.inner.clean_orphan_partials()
            }
            fn path_for(&self, filename: &str) -> std::path::PathBuf {
                self.inner.path_for(filename)
            }
            fn on_disk_len(&self, filename: &str) -> Option<u64> {
                self.inner.on_disk_len(filename)
            }
            fn is_verified(
                &self,
                filename: &str,
                _expected_size: u64,
                _expected_sha256: &str,
            ) -> bool {
                self.inner.on_disk_len(filename).is_some()
            }
            fn is_verified_cached(
                &self,
                filename: &str,
                expected_size: u64,
                expected_sha256: &str,
            ) -> bool {
                self.is_verified(filename, expected_size, expected_sha256)
            }
            fn remove(&self, filename: &str) -> Result<(), RewriteModelFileError> {
                self.inner.remove(filename)
            }
        }

        let settings = FakeSettingsStore::default();
        let files = FakeRewriteModelFiles::default();
        let phi = find_rewrite_model("phi4-mini").unwrap();
        let qwen = find_rewrite_model("qwen25-1.5b").unwrap();
        files.put(phi.filename, b"phi".to_vec());
        files.put(qwen.filename, b"qwen".to_vec());
        let mut core = signed_in_core(FakeGitHub::default(), settings.clone())
            .with_rewrite_model_files(Box::new(OnDiskVerified {
                inner: files.clone(),
            }));

        assert_eq!(
            core.set_active_rewrite_model("missing-id"),
            Err(RewriteError::NotFound)
        );
        core.set_active_rewrite_model("phi4-mini").expect("phi");
        core.set_active_rewrite_model("qwen25-1.5b")
            .expect("switch");
        assert_eq!(
            settings.snapshot().active_rewrite_model_id.as_deref(),
            Some("qwen25-1.5b")
        );
        assert!(RewriteModelFiles::on_disk_len(&files, phi.filename).is_some());
        core.remove_rewrite_model("phi4-mini")
            .expect("remove prior");
        assert!(RewriteModelFiles::on_disk_len(&files, phi.filename).is_none());
        assert_eq!(
            settings.snapshot().active_rewrite_model_id.as_deref(),
            Some("qwen25-1.5b")
        );
    }

    #[test]
    fn rewrite_model_status_recommends_from_hardware_tier() {
        let settings = FakeSettingsStore::default();
        let core = signed_in_core(FakeGitHub::default(), settings).with_hardware_probe(Box::new(
            FixedHardwareProbe {
                profile: HardwareProfile {
                    ram_gb: 8,
                    vulkan_usable: false,
                    vram_mb: None,
                },
            },
        ));
        let snap = core.rewrite_model_status().expect("status");
        assert_eq!(snap.recommended_model_id, "qwen25-1.5b");
        assert_eq!(snap.hardware_tier, "A");
        assert!(snap.quality_alt_model_id.is_none());
        assert!(snap.hardware_switch_prompt.is_none());
        assert!(
            snap.recommended_reason.contains("RAM") || snap.recommended_reason.contains("Vulkan")
        );
    }

    #[test]
    fn hardware_switch_prompt_keep_and_switch_once_per_fingerprint() {
        #[derive(Clone)]
        struct OnDiskVerified {
            inner: FakeRewriteModelFiles,
        }
        impl RewriteModelFiles for OnDiskVerified {
            fn clean_orphan_partials(&self) -> Result<(), RewriteModelFileError> {
                self.inner.clean_orphan_partials()
            }
            fn path_for(&self, filename: &str) -> std::path::PathBuf {
                self.inner.path_for(filename)
            }
            fn on_disk_len(&self, filename: &str) -> Option<u64> {
                self.inner.on_disk_len(filename)
            }
            fn is_verified(
                &self,
                filename: &str,
                _expected_size: u64,
                _expected_sha256: &str,
            ) -> bool {
                self.inner.on_disk_len(filename).is_some()
            }
            fn is_verified_cached(
                &self,
                filename: &str,
                expected_size: u64,
                expected_sha256: &str,
            ) -> bool {
                self.is_verified(filename, expected_size, expected_sha256)
            }
            fn remove(&self, filename: &str) -> Result<(), RewriteModelFileError> {
                self.inner.remove(filename)
            }
        }

        let settings = FakeSettingsStore::default();
        let files = FakeRewriteModelFiles::default();
        let qwen = find_rewrite_model("qwen25-1.5b").unwrap();
        let granite = find_rewrite_model("granite-3.3-2b").unwrap();
        files.put(qwen.filename, b"qwen-bytes".to_vec());
        files.put(granite.filename, b"granite-bytes".to_vec());

        let mut core = signed_in_core(FakeGitHub::default(), settings.clone())
            .with_rewrite_model_files(Box::new(OnDiskVerified {
                inner: files.clone(),
            }))
            .with_hardware_probe(Box::new(FixedHardwareProbe {
                profile: HardwareProfile {
                    ram_gb: 8,
                    vulkan_usable: false,
                    vram_mb: None,
                },
            }));
        core.set_active_rewrite_model("qwen25-1.5b")
            .expect("active");

        // Upgrade RAM → tier B recommends Granite; soft prompt once.
        let mut core = signed_in_core(FakeGitHub::default(), settings.clone())
            .with_rewrite_model_files(Box::new(OnDiskVerified {
                inner: files.clone(),
            }))
            .with_hardware_probe(Box::new(FixedHardwareProbe {
                profile: HardwareProfile {
                    ram_gb: 16,
                    vulkan_usable: false,
                    vram_mb: None,
                },
            }));
        let snap = core.rewrite_model_status().expect("prompt");
        assert_eq!(snap.recommended_model_id, "granite-3.3-2b");
        let prompt = snap.hardware_switch_prompt.expect("soft prompt");
        assert_eq!(prompt.current_model_id, "qwen25-1.5b");
        assert_eq!(prompt.recommended_model_id, "granite-3.3-2b");

        let snap = core.respond_rewrite_hardware_prompt(false).expect("keep");
        assert!(snap.hardware_switch_prompt.is_none());
        assert_eq!(
            settings.snapshot().active_rewrite_model_id.as_deref(),
            Some("qwen25-1.5b")
        );
        // Same fingerprint — no second prompt.
        assert!(core
            .rewrite_model_status()
            .expect("again")
            .hardware_switch_prompt
            .is_none());

        // New fingerprint + Switch activates recommended when on disk (no download).
        let mut settings_mut = settings.clone();
        settings_mut
            .save(AppSettings {
                rewrite_hardware_prompt_acked_fingerprint: None,
                ..settings.snapshot()
            })
            .expect("reset ack");
        let mut core = signed_in_core(FakeGitHub::default(), settings.clone())
            .with_rewrite_model_files(Box::new(OnDiskVerified {
                inner: files.clone(),
            }))
            .with_hardware_probe(Box::new(FixedHardwareProbe {
                profile: HardwareProfile {
                    ram_gb: 32,
                    vulkan_usable: false,
                    vram_mb: None,
                },
            }));
        let snap = core.respond_rewrite_hardware_prompt(true).expect("switch");
        assert_eq!(snap.active_model_id.as_deref(), Some("granite-3.3-2b"));
        assert!(snap.hardware_switch_prompt.is_none());
        assert!(!snap.needs_setup);
    }

    #[test]
    fn hardware_switch_never_auto_downloads() {
        #[derive(Clone)]
        struct OnDiskVerified {
            inner: FakeRewriteModelFiles,
        }
        impl RewriteModelFiles for OnDiskVerified {
            fn clean_orphan_partials(&self) -> Result<(), RewriteModelFileError> {
                self.inner.clean_orphan_partials()
            }
            fn path_for(&self, filename: &str) -> std::path::PathBuf {
                self.inner.path_for(filename)
            }
            fn on_disk_len(&self, filename: &str) -> Option<u64> {
                self.inner.on_disk_len(filename)
            }
            fn is_verified(
                &self,
                filename: &str,
                _expected_size: u64,
                _expected_sha256: &str,
            ) -> bool {
                self.inner.on_disk_len(filename).is_some()
            }
            fn is_verified_cached(
                &self,
                filename: &str,
                expected_size: u64,
                expected_sha256: &str,
            ) -> bool {
                self.is_verified(filename, expected_size, expected_sha256)
            }
            fn remove(&self, filename: &str) -> Result<(), RewriteModelFileError> {
                self.inner.remove(filename)
            }
        }

        let settings = FakeSettingsStore::default();
        let files = FakeRewriteModelFiles::default();
        let qwen = find_rewrite_model("qwen25-1.5b").unwrap();
        files.put(qwen.filename, b"qwen-only".to_vec());
        let mut core = signed_in_core(FakeGitHub::default(), settings.clone())
            .with_rewrite_model_files(Box::new(OnDiskVerified {
                inner: files.clone(),
            }))
            .with_hardware_probe(Box::new(FixedHardwareProbe {
                profile: HardwareProfile {
                    ram_gb: 8,
                    vulkan_usable: false,
                    vram_mb: None,
                },
            }));
        core.set_active_rewrite_model("qwen25-1.5b")
            .expect("active");

        let mut core = signed_in_core(FakeGitHub::default(), settings.clone())
            .with_rewrite_model_files(Box::new(OnDiskVerified { inner: files }))
            .with_hardware_probe(Box::new(FixedHardwareProbe {
                profile: HardwareProfile {
                    ram_gb: 16,
                    vulkan_usable: true,
                    vram_mb: Some(8 * 1024),
                },
            }));
        let snap = core
            .respond_rewrite_hardware_prompt(true)
            .expect("switch without download");
        assert!(snap.needs_setup);
        assert!(snap.active_model_id.is_none());
        assert_eq!(snap.recommended_model_id, "phi4-mini");
        assert_eq!(snap.quality_alt_model_id.as_deref(), Some("qwen3-4b"));
        assert!(settings.snapshot().active_rewrite_model_id.is_none());
    }
}

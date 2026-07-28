//! Issuebridge application core — use-cases behind injectable ports.
//! UI / Tauri IPC are adapters outside this module.

mod error;
mod ports;

pub use error::{AuthError, CaptureError, InstallError, TestingSetError};
pub use ports::{
    AppInstallSnapshot, AppSettings, CaptureInput, Clock, Draft, DraftStore, DraftStoreError,
    GitHub, GitHubError, RepoId, SettingsStore, SettingsStoreError, StoredCredentials, TokenStore,
    TokenStoreError, VoiceTranscriber,
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

/// Application core: auth session gating, Capture, Inbox, Publish, etc.
pub struct IssuebridgeCore<G, T, D, V, C, S> {
    github: G,
    token_store: T,
    #[allow(dead_code)] // exercised when Capture Save persists Drafts
    draft_store: D,
    #[allow(dead_code)] // exercised by PTT transcription use-cases
    voice: V,
    #[allow(dead_code)] // exercised when assigning Draft timestamps
    clock: C,
    settings_store: S,
}

impl<G, T, D, V, C, S> IssuebridgeCore<G, T, D, V, C, S>
where
    G: GitHub,
    T: TokenStore,
    D: DraftStore,
    V: VoiceTranscriber,
    C: Clock,
    S: SettingsStore,
{
    pub fn new(
        github: G,
        token_store: T,
        draft_store: D,
        voice: V,
        clock: C,
        settings_store: S,
    ) -> Self {
        Self {
            github,
            token_store,
            draft_store,
            voice,
            clock,
            settings_store,
        }
    }

    pub fn auth_state(&self) -> AuthState {
        match self.token_store.load() {
            Ok(Some(_)) => AuthState::SignedIn,
            Ok(None) | Err(_) => AuthState::SignedOut,
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

        Ok(AuthState::SignedIn)
    }

    /// Clear stored credentials and return to signed-out state.
    /// Does not rewind Install / Testing-set progress.
    pub fn sign_out(&mut self) -> Result<(), AuthError> {
        self.token_store
            .clear()
            .map_err(|_| AuthError::StorageUnavailable)
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
                GitHubError::InvalidCredentials | GitHubError::Unavailable => {
                    InstallError::ProviderUnavailable
                }
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

    /// Confirm Testing set (1–3 repos) and advance first-run to Ready.
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

    /// Save a Capture into a Draft. Refused when signed out.
    pub fn save_capture(&mut self, _input: CaptureInput) -> Result<Draft, CaptureError> {
        if self.auth_state() != AuthState::SignedIn {
            return Err(CaptureError::NotSignedIn);
        }
        // Draft persistence is a later slice; this ticket only proves the auth gate.
        Err(CaptureError::NotAvailableYet)
    }
}

fn map_github_error(err: GitHubError) -> AuthError {
    match err {
        GitHubError::InvalidCredentials => AuthError::InvalidCredentials,
        GitHubError::Unavailable => AuthError::ProviderUnavailable,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ports::fakes::{
        FakeClock, FakeDraftStore, FakeGitHub, FakeSettingsStore, FakeTokenStore,
        FakeVoiceTranscriber,
    };

    type TestCore = IssuebridgeCore<
        FakeGitHub,
        FakeTokenStore,
        FakeDraftStore,
        FakeVoiceTranscriber,
        FakeClock,
        FakeSettingsStore,
    >;

    fn fresh_core() -> TestCore {
        IssuebridgeCore::new(
            FakeGitHub::default(),
            FakeTokenStore::default(),
            FakeDraftStore::default(),
            FakeVoiceTranscriber::default(),
            FakeClock::default(),
            FakeSettingsStore::default(),
        )
    }

    fn signed_in_core(github: FakeGitHub, settings: FakeSettingsStore) -> TestCore {
        let mut core = IssuebridgeCore::new(
            github,
            FakeTokenStore::default(),
            FakeDraftStore::default(),
            FakeVoiceTranscriber::default(),
            FakeClock::default(),
            settings,
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
    fn complete_testing_set_with_one_to_three_repos_reaches_ready() {
        let settings = FakeSettingsStore::with_settings(AppSettings {
            install_completed: true,
            app_visible_repos: vec![repo("acme", "widgets")],
            ..AppSettings::default()
        });
        let mut core = signed_in_core(FakeGitHub::default(), settings.clone());

        core.add_testing_set_repo(repo("acme", "widgets"))
            .expect("add");
        core.complete_testing_set().expect("complete");
        assert_eq!(core.first_run_step(), FirstRunStep::Ready);

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
        );
        assert_eq!(resumed.first_run_step(), FirstRunStep::Ready);
        assert_eq!(resumed.testing_set(), vec![repo("acme", "widgets")]);
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
        assert_eq!(settings.snapshot().testing_set, vec![repo("acme", "widgets")]);
    }
}

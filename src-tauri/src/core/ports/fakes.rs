//! In-memory fakes for core-level tests.

use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};

use super::{
    AppInstallSnapshot, AppSettings, Clock, CreatedIssue, Draft, DraftStore, DraftStoreError,
    GitHub, GitHubError, RepoId, SettingsStore, SettingsStoreError, StoredCredentials, TokenStore,
    TokenStoreError, VoiceTranscriber,
};

#[derive(Debug, Clone)]
pub struct FakeGitHub {
    /// When true, `validate_pat` fails with InvalidCredentials.
    pub reject_pat: bool,
    /// Result returned by `exchange_oauth_code`.
    pub oauth_result: Result<StoredCredentials, GitHubError>,
    /// Result returned by `list_app_install_snapshot`.
    pub install_snapshot: Result<AppInstallSnapshot, GitHubError>,
    /// Optional override for `create_issue`; when `None`, issues are minted successfully.
    pub create_issue_result: Option<Result<CreatedIssue, GitHubError>>,
    pub next_issue_number: Arc<Mutex<u64>>,
}

impl Default for FakeGitHub {
    fn default() -> Self {
        Self {
            reject_pat: false,
            oauth_result: Err(GitHubError::Unavailable),
            install_snapshot: Ok(AppInstallSnapshot {
                has_install: false,
                repos: Vec::new(),
                all_repositories: false,
            }),
            create_issue_result: None,
            next_issue_number: Arc::new(Mutex::new(0)),
        }
    }
}

impl GitHub for FakeGitHub {
    fn validate_pat(&self, pat: &str) -> Result<(), GitHubError> {
        if pat.is_empty() || self.reject_pat {
            return Err(GitHubError::InvalidCredentials);
        }
        Ok(())
    }

    fn exchange_oauth_code(
        &self,
        _code: &str,
        _code_verifier: &str,
    ) -> Result<StoredCredentials, GitHubError> {
        self.oauth_result.clone()
    }

    fn list_app_install_snapshot(
        &self,
        _token: &str,
    ) -> Result<AppInstallSnapshot, GitHubError> {
        self.install_snapshot.clone()
    }

    fn create_issue(
        &self,
        _token: &str,
        repo: &RepoId,
        title: &str,
        body: &str,
        label_names: &[String],
    ) -> Result<CreatedIssue, GitHubError> {
        if let Some(result) = &self.create_issue_result {
            return result.clone();
        }
        let mut next = self
            .next_issue_number
            .lock()
            .map_err(|_| GitHubError::Unavailable)?;
        *next += 1;
        let number = *next;
        Ok(CreatedIssue {
            number,
            html_url: format!(
                "https://github.com/{}/{}/issues/{number}",
                repo.owner, repo.name
            ),
            title: title.to_string(),
            body: body.to_string(),
            label_names: label_names.to_vec(),
            updated_at: "2024-01-15T12:00:00Z".into(),
        })
    }
}

#[derive(Debug, Default)]
pub struct FakeTokenStore {
    pub credentials: Option<StoredCredentials>,
}

impl TokenStore for FakeTokenStore {
    fn load(&self) -> Result<Option<StoredCredentials>, TokenStoreError> {
        Ok(self.credentials.clone())
    }

    fn store(&mut self, credentials: StoredCredentials) -> Result<(), TokenStoreError> {
        self.credentials = Some(credentials);
        Ok(())
    }

    fn clear(&mut self) -> Result<(), TokenStoreError> {
        self.credentials = None;
        Ok(())
    }
}

#[derive(Debug, Clone, Default)]
pub struct FakeDraftStore {
    inner: Arc<Mutex<Vec<Draft>>>,
}

impl DraftStore for FakeDraftStore {
    fn save(&mut self, draft: Draft) -> Result<(), DraftStoreError> {
        let mut drafts = self
            .inner
            .lock()
            .map_err(|_| DraftStoreError::Unavailable)?;
        if let Some(existing) = drafts.iter_mut().find(|d| d.id == draft.id) {
            *existing = draft;
        } else {
            drafts.push(draft);
        }
        Ok(())
    }

    fn get(&self, id: &str) -> Result<Option<Draft>, DraftStoreError> {
        Ok(self
            .inner
            .lock()
            .map_err(|_| DraftStoreError::Unavailable)?
            .iter()
            .find(|d| d.id == id)
            .cloned())
    }

    fn list(&self) -> Result<Vec<Draft>, DraftStoreError> {
        Ok(self
            .inner
            .lock()
            .map_err(|_| DraftStoreError::Unavailable)?
            .clone())
    }
}

/// Shared in-memory settings so a reconstructed core can resume first-run progress.
#[derive(Debug, Clone, Default)]
pub struct FakeSettingsStore {
    inner: Arc<Mutex<AppSettings>>,
}

impl FakeSettingsStore {
    pub fn with_settings(settings: AppSettings) -> Self {
        Self {
            inner: Arc::new(Mutex::new(settings)),
        }
    }

    pub fn snapshot(&self) -> AppSettings {
        self.inner
            .lock()
            .expect("FakeSettingsStore lock")
            .clone()
    }
}

impl SettingsStore for FakeSettingsStore {
    fn load(&self) -> Result<AppSettings, SettingsStoreError> {
        Ok(self
            .inner
            .lock()
            .map_err(|_| SettingsStoreError::Unavailable)?
            .clone())
    }

    fn save(&mut self, settings: AppSettings) -> Result<(), SettingsStoreError> {
        *self
            .inner
            .lock()
            .map_err(|_| SettingsStoreError::Unavailable)? = settings;
        Ok(())
    }
}

#[derive(Debug, Default)]
pub struct FakeVoiceTranscriber;

impl VoiceTranscriber for FakeVoiceTranscriber {}

#[derive(Debug, Clone)]
pub struct FakeClock {
    now: Arc<Mutex<SystemTime>>,
}

impl Default for FakeClock {
    fn default() -> Self {
        Self {
            now: Arc::new(Mutex::new(
                SystemTime::UNIX_EPOCH + Duration::from_secs(1_700_000_000),
            )),
        }
    }
}

impl FakeClock {
    pub fn advance(&self, by: Duration) {
        let mut now = self.now.lock().expect("FakeClock lock");
        *now += by;
    }
}

impl Clock for FakeClock {
    fn now(&self) -> SystemTime {
        *self.now.lock().expect("FakeClock lock")
    }
}

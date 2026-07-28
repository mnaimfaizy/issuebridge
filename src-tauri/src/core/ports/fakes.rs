//! In-memory fakes for core-level tests.

use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};

use super::{
    AppInstallSnapshot, AppSettings, Clock, Draft, DraftStore, DraftStoreError, GitHub, GitHubError,
    SettingsStore, SettingsStoreError, StoredCredentials, TokenStore, TokenStoreError,
    VoiceTranscriber,
};

#[derive(Debug)]
pub struct FakeGitHub {
    /// When true, `validate_pat` fails with InvalidCredentials.
    pub reject_pat: bool,
    /// Result returned by `exchange_oauth_code`.
    pub oauth_result: Result<StoredCredentials, GitHubError>,
    /// Result returned by `list_app_install_snapshot`.
    pub install_snapshot: Result<AppInstallSnapshot, GitHubError>,
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

#[derive(Debug, Default)]
pub struct FakeDraftStore {
    pub drafts: Vec<Draft>,
}

impl DraftStore for FakeDraftStore {
    fn save(&mut self, draft: Draft) -> Result<(), DraftStoreError> {
        self.drafts.push(draft);
        Ok(())
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

#[derive(Debug)]
pub struct FakeClock {
    now: SystemTime,
}

impl Default for FakeClock {
    fn default() -> Self {
        Self {
            now: SystemTime::UNIX_EPOCH + Duration::from_secs(1_700_000_000),
        }
    }
}

impl Clock for FakeClock {
    fn now(&self) -> SystemTime {
        self.now
    }
}

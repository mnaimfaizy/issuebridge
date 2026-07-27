//! In-memory fakes for core-level tests.

use std::time::{Duration, SystemTime};

use super::{
    Clock, Draft, DraftStore, DraftStoreError, GitHub, GitHubError, StoredCredentials, TokenStore,
    TokenStoreError, VoiceTranscriber,
};

#[derive(Debug)]
pub struct FakeGitHub {
    /// When true, `validate_pat` fails with InvalidCredentials.
    pub reject_pat: bool,
    /// Result returned by `exchange_oauth_code`.
    pub oauth_result: Result<StoredCredentials, GitHubError>,
}

impl Default for FakeGitHub {
    fn default() -> Self {
        Self {
            reject_pat: false,
            oauth_result: Err(GitHubError::Unavailable),
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

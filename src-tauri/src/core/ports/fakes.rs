//! In-memory fakes for core-level tests.

use std::time::{Duration, SystemTime};

use super::{
    Clock, Draft, DraftStore, DraftStoreError, GitHub, StoredCredentials, TokenStore,
    TokenStoreError, VoiceTranscriber,
};

#[derive(Debug, Default)]
pub struct FakeGitHub;

impl GitHub for FakeGitHub {}

#[derive(Debug, Default)]
pub struct FakeTokenStore {
    pub credentials: Option<StoredCredentials>,
}

impl TokenStore for FakeTokenStore {
    fn load(&self) -> Result<Option<StoredCredentials>, TokenStoreError> {
        Ok(self.credentials.clone())
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

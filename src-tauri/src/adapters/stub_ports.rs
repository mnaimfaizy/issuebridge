//! In-process stub port adapters for the Tauri shell until real adapters land.

use std::time::SystemTime;

use crate::core::{
    Clock, Draft, DraftStore, DraftStoreError, GitHub, IssuebridgeCore, StoredCredentials,
    TokenStore, TokenStoreError, VoiceTranscriber,
};

#[derive(Debug, Default)]
pub struct StubGitHub;

impl GitHub for StubGitHub {}

#[derive(Debug, Default)]
pub struct StubTokenStore;

impl TokenStore for StubTokenStore {
    fn load(&self) -> Result<Option<StoredCredentials>, TokenStoreError> {
        Ok(None)
    }
}

#[derive(Debug, Default)]
pub struct StubDraftStore {
    drafts: Vec<Draft>,
}

impl DraftStore for StubDraftStore {
    fn save(&mut self, draft: Draft) -> Result<(), DraftStoreError> {
        self.drafts.push(draft);
        Ok(())
    }
}

#[derive(Debug, Default)]
pub struct StubVoiceTranscriber;

impl VoiceTranscriber for StubVoiceTranscriber {}

#[derive(Debug, Default)]
pub struct SystemClock;

impl Clock for SystemClock {
    fn now(&self) -> SystemTime {
        SystemTime::now()
    }
}

pub type StubCore =
    IssuebridgeCore<StubGitHub, StubTokenStore, StubDraftStore, StubVoiceTranscriber, SystemClock>;

pub fn build_stub_core() -> StubCore {
    IssuebridgeCore::new(
        StubGitHub,
        StubTokenStore,
        StubDraftStore::default(),
        StubVoiceTranscriber,
        SystemClock,
    )
}

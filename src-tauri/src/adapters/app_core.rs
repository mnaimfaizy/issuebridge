//! Wires real auth / settings adapters with stub DraftStore / Voice / Clock until later slices.

use std::time::SystemTime;

use crate::core::{
    Clock, Draft, DraftStore, DraftStoreError, IssuebridgeCore, VoiceTranscriber,
};

use super::file_settings_store::FileSettingsStore;
use super::github_http::HttpGitHub;
use super::keyring_token_store::KeyringTokenStore;

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

pub type AppCore = IssuebridgeCore<
    HttpGitHub,
    KeyringTokenStore,
    StubDraftStore,
    StubVoiceTranscriber,
    SystemClock,
    FileSettingsStore,
>;

pub fn build_app_core() -> AppCore {
    IssuebridgeCore::new(
        HttpGitHub::default(),
        KeyringTokenStore::default(),
        StubDraftStore::default(),
        StubVoiceTranscriber,
        SystemClock,
        FileSettingsStore::default(),
    )
}

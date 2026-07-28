//! Wires real auth / settings / Draft adapters with stub Voice until later slices.

use std::time::SystemTime;

use crate::core::{Clock, IssuebridgeCore, VoiceTranscriber};

use super::file_draft_store::FileDraftStore;
use super::file_settings_store::FileSettingsStore;
use super::github_http::HttpGitHub;
use super::keyring_token_store::KeyringTokenStore;

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
    FileDraftStore,
    StubVoiceTranscriber,
    SystemClock,
    FileSettingsStore,
>;

pub fn build_app_core() -> AppCore {
    IssuebridgeCore::new(
        HttpGitHub::default(),
        KeyringTokenStore::default(),
        FileDraftStore::default(),
        StubVoiceTranscriber,
        SystemClock,
        FileSettingsStore::default(),
    )
}

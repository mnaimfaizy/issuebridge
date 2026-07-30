//! Wires real auth / settings / Draft adapters with Whisper voice when available.

use std::time::SystemTime;

use crate::core::{Clock, IssuebridgeCore};

use super::file_draft_store::FileDraftStore;
use super::file_label_catalog_store::FileLabelCatalogStore;
use super::file_settings_store::FileSettingsStore;
use super::github_http::HttpGitHub;
use super::keyring_token_store::KeyringTokenStore;
use super::whisper_voice::WhisperVoiceTranscriber;

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
    WhisperVoiceTranscriber,
    SystemClock,
    FileSettingsStore,
    FileLabelCatalogStore,
>;

pub fn build_app_core() -> AppCore {
    IssuebridgeCore::new(
        HttpGitHub::default(),
        KeyringTokenStore::default(),
        FileDraftStore::default(),
        WhisperVoiceTranscriber::default(),
        SystemClock,
        FileSettingsStore::default(),
        FileLabelCatalogStore::default(),
    )
}

//! Wires real auth / settings / Draft adapters with Whisper voice when available.

use std::sync::Arc;
use std::time::SystemTime;

use crate::core::{Clock, IssuebridgeCore};

use super::file_draft_store::FileDraftStore;
use super::file_label_catalog_store::FileLabelCatalogStore;
use super::file_rewrite_model_store::FileRewriteModelStore;
use super::file_settings_store::FileSettingsStore;
use super::github_http::HttpGitHub;
use super::keyring_token_store::KeyringTokenStore;
use super::llama_rewrite::{PreferLlamaRewriteEngine, RewriteJobHandle};
use super::system_hardware_probe::SystemHardwareProbe;
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

pub fn build_app_core(rewrite_job: Arc<RewriteJobHandle>) -> AppCore {
    IssuebridgeCore::new(
        HttpGitHub::default(),
        KeyringTokenStore::default(),
        FileDraftStore::default(),
        WhisperVoiceTranscriber::default(),
        SystemClock,
        FileSettingsStore::default(),
        FileLabelCatalogStore::default(),
    )
    .with_rewrite_engine(Box::new(PreferLlamaRewriteEngine::new(rewrite_job)))
    .with_rewrite_model_files(Box::new(FileRewriteModelStore::default()))
    .with_hardware_probe(Box::new(SystemHardwareProbe))
}

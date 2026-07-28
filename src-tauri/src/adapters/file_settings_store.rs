//! JSON settings under the OS app-data directory (first-run + Testing set).

use std::fs;
use std::path::PathBuf;

use crate::core::{AppSettings, SettingsStore, SettingsStoreError};

const SETTINGS_FILE: &str = "settings.json";

#[derive(Debug)]
pub struct FileSettingsStore {
    path: PathBuf,
}

impl FileSettingsStore {
    pub fn in_app_data() -> Result<Self, SettingsStoreError> {
        let dir = dirs_app_data().ok_or(SettingsStoreError::Unavailable)?;
        fs::create_dir_all(&dir).map_err(|_| SettingsStoreError::Unavailable)?;
        Ok(Self {
            path: dir.join(SETTINGS_FILE),
        })
    }

    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }
}

impl Default for FileSettingsStore {
    fn default() -> Self {
        Self::in_app_data().unwrap_or_else(|_| {
            Self::new(
                std::env::temp_dir()
                    .join("issuebridge")
                    .join(SETTINGS_FILE),
            )
        })
    }
}

impl SettingsStore for FileSettingsStore {
    fn load(&self) -> Result<AppSettings, SettingsStoreError> {
        if !self.path.exists() {
            return Ok(AppSettings::default());
        }
        let bytes = fs::read(&self.path).map_err(|_| SettingsStoreError::Unavailable)?;
        serde_json::from_slice(&bytes).map_err(|_| SettingsStoreError::Unavailable)
    }

    fn save(&mut self, settings: AppSettings) -> Result<(), SettingsStoreError> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).map_err(|_| SettingsStoreError::Unavailable)?;
        }
        let bytes = serde_json::to_vec_pretty(&settings)
            .map_err(|_| SettingsStoreError::Unavailable)?;
        fs::write(&self.path, bytes).map_err(|_| SettingsStoreError::Unavailable)
    }
}

fn dirs_app_data() -> Option<PathBuf> {
    // Prefer LOCALAPPDATA on Windows; fall back to home-based path.
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        if !local.is_empty() {
            return Some(PathBuf::from(local).join("Issuebridge"));
        }
    }
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(|home| PathBuf::from(home).join(".issuebridge"))
}

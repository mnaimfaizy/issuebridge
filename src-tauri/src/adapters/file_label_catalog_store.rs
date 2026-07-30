//! JSON Label catalog store under the OS app-data directory.

use std::fs;
use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::core::{
    LabelCatalog, LabelCatalogStore, LabelCatalogStoreError, RepoId, RepoLabel,
};

const CATALOG_FILE: &str = "label_catalog.json";

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct CatalogFile {
    catalogs: Vec<CatalogRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct CatalogRecord {
    repo: RepoId,
    labels: Vec<RepoLabel>,
    refreshed_at_millis: u64,
}

impl From<&LabelCatalog> for CatalogRecord {
    fn from(catalog: &LabelCatalog) -> Self {
        Self {
            repo: catalog.repo.clone(),
            labels: catalog.labels.clone(),
            refreshed_at_millis: system_time_millis(catalog.refreshed_at),
        }
    }
}

impl From<CatalogRecord> for LabelCatalog {
    fn from(record: CatalogRecord) -> Self {
        Self {
            repo: record.repo,
            labels: record.labels,
            refreshed_at: millis_to_system_time(record.refreshed_at_millis),
        }
    }
}

#[derive(Debug)]
pub struct FileLabelCatalogStore {
    path: PathBuf,
}

impl FileLabelCatalogStore {
    pub fn in_app_data() -> Result<Self, LabelCatalogStoreError> {
        let dir = dirs_app_data().ok_or(LabelCatalogStoreError::Unavailable)?;
        fs::create_dir_all(&dir).map_err(|_| LabelCatalogStoreError::Unavailable)?;
        Ok(Self {
            path: dir.join(CATALOG_FILE),
        })
    }

    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    fn read_all(&self) -> Result<CatalogFile, LabelCatalogStoreError> {
        if !self.path.exists() {
            return Ok(CatalogFile::default());
        }
        let bytes = fs::read(&self.path).map_err(|_| LabelCatalogStoreError::Unavailable)?;
        serde_json::from_slice(&bytes).map_err(|_| LabelCatalogStoreError::Unavailable)
    }

    fn write_all(&self, file: &CatalogFile) -> Result<(), LabelCatalogStoreError> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).map_err(|_| LabelCatalogStoreError::Unavailable)?;
        }
        let bytes = serde_json::to_vec_pretty(file).map_err(|_| LabelCatalogStoreError::Unavailable)?;
        fs::write(&self.path, bytes).map_err(|_| LabelCatalogStoreError::Unavailable)
    }
}

impl Default for FileLabelCatalogStore {
    fn default() -> Self {
        Self::in_app_data().unwrap_or_else(|_| {
            Self::new(std::env::temp_dir().join("issuebridge").join(CATALOG_FILE))
        })
    }
}

impl LabelCatalogStore for FileLabelCatalogStore {
    fn load(&self, repo: &RepoId) -> Result<Option<LabelCatalog>, LabelCatalogStoreError> {
        Ok(self
            .read_all()?
            .catalogs
            .into_iter()
            .find(|c| c.repo == *repo)
            .map(LabelCatalog::from))
    }

    fn save(&mut self, catalog: LabelCatalog) -> Result<(), LabelCatalogStoreError> {
        let mut file = self.read_all()?;
        let record = CatalogRecord::from(&catalog);
        if let Some(existing) = file.catalogs.iter_mut().find(|c| c.repo == catalog.repo) {
            *existing = record;
        } else {
            file.catalogs.push(record);
        }
        self.write_all(&file)
    }
}

fn system_time_millis(time: SystemTime) -> u64 {
    time.duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn millis_to_system_time(millis: u64) -> SystemTime {
    UNIX_EPOCH + Duration::from_millis(millis)
}

fn dirs_app_data() -> Option<PathBuf> {
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        if !local.is_empty() {
            return Some(PathBuf::from(local).join("Issuebridge"));
        }
    }
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(|home| PathBuf::from(home).join(".issuebridge"))
}

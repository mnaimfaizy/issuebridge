//! JSON Draft store under the OS app-data directory.

use std::fs;
use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::core::{Draft, DraftStore, DraftStoreError, LocalLink, RemoteSnapshot, RepoId};

const DRAFTS_FILE: &str = "drafts.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
struct LocalLinkRecord {
    number: u64,
    html_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct RemoteSnapshotRecord {
    title: String,
    body: String,
    label_names: Vec<String>,
    updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct DraftRecord {
    id: String,
    repo: RepoId,
    title: String,
    body: String,
    label_names: Vec<String>,
    created_at_millis: u64,
    updated_at_millis: u64,
    #[serde(default)]
    local_link: Option<LocalLinkRecord>,
    #[serde(default)]
    remote_snapshot: Option<RemoteSnapshotRecord>,
}

impl From<&Draft> for DraftRecord {
    fn from(draft: &Draft) -> Self {
        Self {
            id: draft.id.clone(),
            repo: draft.repo.clone(),
            title: draft.title.clone(),
            body: draft.body.clone(),
            label_names: draft.label_names.clone(),
            created_at_millis: system_time_millis(draft.created_at),
            updated_at_millis: system_time_millis(draft.updated_at),
            local_link: draft.local_link.as_ref().map(|link| LocalLinkRecord {
                number: link.number,
                html_url: link.html_url.clone(),
            }),
            remote_snapshot: draft
                .remote_snapshot
                .as_ref()
                .map(|snap| RemoteSnapshotRecord {
                    title: snap.title.clone(),
                    body: snap.body.clone(),
                    label_names: snap.label_names.clone(),
                    updated_at: snap.updated_at.clone(),
                }),
        }
    }
}

impl From<DraftRecord> for Draft {
    fn from(record: DraftRecord) -> Self {
        Self {
            id: record.id,
            repo: record.repo,
            title: record.title,
            body: record.body,
            label_names: record.label_names,
            created_at: millis_to_system_time(record.created_at_millis),
            updated_at: millis_to_system_time(record.updated_at_millis),
            local_link: record.local_link.map(|link| LocalLink {
                number: link.number,
                html_url: link.html_url,
            }),
            remote_snapshot: record.remote_snapshot.map(|snap| RemoteSnapshot {
                title: snap.title,
                body: snap.body,
                label_names: snap.label_names,
                updated_at: snap.updated_at,
            }),
        }
    }
}

#[derive(Debug)]
pub struct FileDraftStore {
    path: PathBuf,
}

impl FileDraftStore {
    pub fn in_app_data() -> Result<Self, DraftStoreError> {
        let dir = dirs_app_data().ok_or(DraftStoreError::Unavailable)?;
        fs::create_dir_all(&dir).map_err(|_| DraftStoreError::Unavailable)?;
        Ok(Self {
            path: dir.join(DRAFTS_FILE),
        })
    }

    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    fn read_all(&self) -> Result<Vec<DraftRecord>, DraftStoreError> {
        if !self.path.exists() {
            return Ok(Vec::new());
        }
        let bytes = fs::read(&self.path).map_err(|_| DraftStoreError::Unavailable)?;
        serde_json::from_slice(&bytes).map_err(|_| DraftStoreError::Unavailable)
    }

    fn write_all(&self, drafts: &[DraftRecord]) -> Result<(), DraftStoreError> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).map_err(|_| DraftStoreError::Unavailable)?;
        }
        let bytes = serde_json::to_vec_pretty(drafts).map_err(|_| DraftStoreError::Unavailable)?;
        fs::write(&self.path, bytes).map_err(|_| DraftStoreError::Unavailable)
    }
}

impl Default for FileDraftStore {
    fn default() -> Self {
        Self::in_app_data().unwrap_or_else(|_| {
            Self::new(std::env::temp_dir().join("issuebridge").join(DRAFTS_FILE))
        })
    }
}

impl DraftStore for FileDraftStore {
    fn save(&mut self, draft: Draft) -> Result<(), DraftStoreError> {
        let mut drafts = self.read_all()?;
        let record = DraftRecord::from(&draft);
        if let Some(existing) = drafts.iter_mut().find(|d| d.id == record.id) {
            *existing = record;
        } else {
            drafts.push(record);
        }
        self.write_all(&drafts)
    }

    fn get(&self, id: &str) -> Result<Option<Draft>, DraftStoreError> {
        Ok(self
            .read_all()?
            .into_iter()
            .find(|d| d.id == id)
            .map(Draft::from))
    }

    fn list(&self) -> Result<Vec<Draft>, DraftStoreError> {
        Ok(self.read_all()?.into_iter().map(Draft::from).collect())
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

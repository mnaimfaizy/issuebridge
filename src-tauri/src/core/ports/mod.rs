//! Ports the application core depends on. Adapters and fakes implement these.

use std::time::SystemTime;

use serde::{Deserialize, Serialize};

#[cfg(test)]
pub mod fakes;

/// Target repository (`owner/name`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RepoId {
    pub owner: String,
    pub name: String,
}

/// Input from Capture Save (no Publish).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CaptureInput {
    pub repo: RepoId,
    pub title: String,
    pub body: String,
}

/// Local Draft record (persistence shape for v0.1 — unlinked fields only for now).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Draft {
    pub id: String,
    pub repo: RepoId,
    pub title: String,
    pub body: String,
    pub label_names: Vec<String>,
    pub created_at: SystemTime,
    pub updated_at: SystemTime,
}

/// Credentials held only by TokenStore adapters — never returned through core IPC results.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredCredentials {
    pub access_token: String,
}

pub trait GitHub: Send + Sync {}

pub trait TokenStore: Send + Sync {
    fn load(&self) -> Result<Option<StoredCredentials>, TokenStoreError>;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TokenStoreError {
    Unavailable,
}

pub trait DraftStore: Send + Sync {
    fn save(&mut self, draft: Draft) -> Result<(), DraftStoreError>;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DraftStoreError {
    Unavailable,
}

pub trait VoiceTranscriber: Send + Sync {}

pub trait Clock: Send + Sync {
    fn now(&self) -> SystemTime;
}

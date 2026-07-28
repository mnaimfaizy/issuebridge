//! Errors returned by the application core (observable to adapters/tests).

use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum CaptureError {
    NotSignedIn,
    StorageUnavailable,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum InboxError {
    NotSignedIn,
    StorageUnavailable,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AuthError {
    EmptyToken,
    InvalidCredentials,
    StorageUnavailable,
    ProviderUnavailable,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum InstallError {
    NotSignedIn,
    ProviderUnavailable,
    StorageUnavailable,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum TestingSetError {
    NotSignedIn,
    InstallIncomplete,
    LimitReached,
    NotAppVisible,
    Empty,
    StorageUnavailable,
}

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
    NotFound,
    StorageUnavailable,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PublishError {
    NotSignedIn,
    TitleRequired,
    AlreadyLinked,
    NotFound,
    StorageUnavailable,
    ProviderUnavailable,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum UpdateError {
    NotSignedIn,
    NotFound,
    NotLinked,
    TitleRequired,
    /// Remote `updated_at` no longer matches the Remote snapshot — caller must resolve.
    Conflict,
    StorageUnavailable,
    ProviderUnavailable,
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

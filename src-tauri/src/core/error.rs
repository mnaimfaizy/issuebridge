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
    /// Token cannot list App installations (PATs are rejected; needs GitHub App user token).
    TokenLacksInstallAccess,
    ProviderUnavailable,
    StorageUnavailable,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum TestingSetError {
    NotSignedIn,
    InstallIncomplete,
    /// First-run unfinished — Settings-only Testing set max / Add all are refused.
    SettingsOnly,
    /// Add refused because the Testing set already has `max` repos.
    LimitReached {
        max: usize,
    },
    /// Lowering max refused while the Testing set still has more than `requested` repos.
    MaxBelowCurrentSet {
        current: usize,
        requested: usize,
    },
    /// Max not in 1..=App-visible count.
    MaxOutOfRange,
    NotAppVisible,
    Empty,
    StorageUnavailable,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum LabelCatalogError {
    NotSignedIn,
    StorageUnavailable,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum RewriteError {
    NotSignedIn,
    /// Trimmed title < 8 and trimmed body < 40.
    TooThin,
    /// Name or instruction was empty when adding a user-defined Rewrite style.
    EmptyFields,
    /// User-defined Rewrite style id was not found (or was a built-in remove attempt).
    NotFound,
    StorageUnavailable,
    EngineFailed,
    /// Soft ~60s Generate timeout (no auto-retry).
    TimedOut,
    /// In-flight Generate was cancelled.
    Cancelled,
}

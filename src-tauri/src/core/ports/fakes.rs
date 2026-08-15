//! In-memory fakes for core-level tests.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};

use super::{
    AppInstallSnapshot, AppSettings, Clock, CreatedIssue, Draft, DraftStore, DraftStoreError,
    GitHub, GitHubError, LabelCatalog, LabelCatalogStore, LabelCatalogStoreError, RepoId,
    RepoLabel, RewriteModelFileError, RewriteModelFiles, SettingsStore, SettingsStoreError,
    StoredCredentials, TokenStore, TokenStoreError, VoiceError, VoiceTranscriber,
};

fn issue_key(repo: &RepoId, number: u64) -> String {
    format!("{}/{}/{number}", repo.owner, repo.name)
}

fn repo_key(repo: &RepoId) -> String {
    format!("{}/{}", repo.owner, repo.name)
}

#[derive(Debug, Clone)]
pub struct FakeGitHub {
    /// Scripted `validate_pat` failure; shared across clones so tests can flip it mid-run
    /// (e.g. a vaulted token that GitHub revokes between launches).
    pub validate_pat_error: Arc<Mutex<Option<GitHubError>>>,
    /// Result returned by `exchange_oauth_code`.
    pub oauth_result: Result<StoredCredentials, GitHubError>,
    /// Result returned by `list_app_install_snapshot`.
    pub install_snapshot: Result<AppInstallSnapshot, GitHubError>,
    /// Optional override for `create_issue`; when `None`, issues are minted successfully.
    pub create_issue_result: Option<Result<CreatedIssue, GitHubError>>,
    pub next_issue_number: Arc<Mutex<u64>>,
    /// Stored issues for get/update; shared across clones so tests can mutate `updated_at`.
    pub issues: Arc<Mutex<HashMap<String, CreatedIssue>>>,
    /// Bumps on each successful `update_issue` to mint a fresh `updated_at`.
    pub update_seq: Arc<Mutex<u64>>,
    /// Labels per `owner/name` for `list_labels` / `create_label`.
    pub repo_labels: Arc<Mutex<HashMap<String, Vec<RepoLabel>>>>,
    /// Scripted `list_labels` failure (401 vs offline), shared across clones.
    pub list_labels_error: Arc<Mutex<Option<GitHubError>>>,
    /// Scripted failure for `get_issue` / `update_issue`, shared across clones.
    pub issue_error: Arc<Mutex<Option<GitHubError>>>,
}

impl Default for FakeGitHub {
    fn default() -> Self {
        Self {
            validate_pat_error: Arc::new(Mutex::new(None)),
            oauth_result: Err(GitHubError::Unavailable),
            install_snapshot: Ok(AppInstallSnapshot {
                has_install: false,
                repos: Vec::new(),
                all_repositories: false,
            }),
            create_issue_result: None,
            next_issue_number: Arc::new(Mutex::new(0)),
            issues: Arc::new(Mutex::new(HashMap::new())),
            update_seq: Arc::new(Mutex::new(0)),
            repo_labels: Arc::new(Mutex::new(HashMap::new())),
            list_labels_error: Arc::new(Mutex::new(None)),
            issue_error: Arc::new(Mutex::new(None)),
        }
    }
}

impl FakeGitHub {
    /// Override remote `updated_at` for conflict mismatch tests (shared across core clones).
    pub fn set_remote_updated_at(&self, repo: &RepoId, number: u64, updated_at: &str) {
        let key = issue_key(repo, number);
        if let Ok(mut issues) = self.issues.lock() {
            if let Some(issue) = issues.get_mut(&key) {
                issue.updated_at = updated_at.to_string();
            }
        }
    }

    /// Replace remote issue fields (simulates edits on GitHub outside Issuebridge).
    pub fn set_remote_issue(
        &self,
        repo: &RepoId,
        number: u64,
        title: &str,
        body: &str,
        label_names: &[String],
        updated_at: &str,
    ) {
        let key = issue_key(repo, number);
        if let Ok(mut issues) = self.issues.lock() {
            if let Some(issue) = issues.get_mut(&key) {
                issue.title = title.to_string();
                issue.body = body.to_string();
                issue.label_names = label_names.to_vec();
                issue.updated_at = updated_at.to_string();
            }
        }
    }

    pub fn set_repo_labels(&self, repo: &RepoId, labels: Vec<RepoLabel>) {
        let mut map = self.repo_labels.lock().expect("FakeGitHub repo_labels");
        map.insert(repo_key(repo), labels);
    }

    /// Script the next `validate_pat` outcome (`None` = accept the token).
    pub fn set_validate_pat_error(&self, error: Option<GitHubError>) {
        *self
            .validate_pat_error
            .lock()
            .expect("FakeGitHub validate_pat_error") = error;
    }

    /// Script the next `list_labels` outcome (`None` = return stored labels).
    pub fn set_list_labels_error(&self, error: Option<GitHubError>) {
        *self
            .list_labels_error
            .lock()
            .expect("FakeGitHub list_labels_error") = error;
    }

    /// Script the next `get_issue` / `update_issue` outcome (`None` = use stored issues).
    pub fn set_issue_error(&self, error: Option<GitHubError>) {
        *self.issue_error.lock().expect("FakeGitHub issue_error") = error;
    }

    /// Convenience for "GitHub rejects the vaulted token" scenarios.
    pub fn rejecting_pat() -> Self {
        let github = Self::default();
        github.set_validate_pat_error(Some(GitHubError::InvalidCredentials));
        github
    }
}

impl GitHub for FakeGitHub {
    fn validate_pat(&self, pat: &str) -> Result<(), GitHubError> {
        if pat.is_empty() {
            return Err(GitHubError::InvalidCredentials);
        }
        match self
            .validate_pat_error
            .lock()
            .map_err(|_| GitHubError::Unavailable)?
            .clone()
        {
            Some(err) => Err(err),
            None => Ok(()),
        }
    }

    fn exchange_oauth_code(
        &self,
        _code: &str,
        _code_verifier: &str,
    ) -> Result<StoredCredentials, GitHubError> {
        self.oauth_result.clone()
    }

    fn list_app_install_snapshot(&self, _token: &str) -> Result<AppInstallSnapshot, GitHubError> {
        self.install_snapshot.clone()
    }

    fn create_issue(
        &self,
        _token: &str,
        repo: &RepoId,
        title: &str,
        body: &str,
        label_names: &[String],
    ) -> Result<CreatedIssue, GitHubError> {
        if let Some(result) = &self.create_issue_result {
            if let Ok(issue) = result {
                let mut issues = self.issues.lock().map_err(|_| GitHubError::Unavailable)?;
                issues.insert(issue_key(repo, issue.number), issue.clone());
            }
            return result.clone();
        }
        let mut next = self
            .next_issue_number
            .lock()
            .map_err(|_| GitHubError::Unavailable)?;
        *next += 1;
        let number = *next;
        let issue = CreatedIssue {
            number,
            html_url: format!(
                "https://github.com/{}/{}/issues/{number}",
                repo.owner, repo.name
            ),
            title: title.to_string(),
            body: body.to_string(),
            label_names: label_names.to_vec(),
            updated_at: "2024-01-15T12:00:00Z".into(),
        };
        let mut issues = self.issues.lock().map_err(|_| GitHubError::Unavailable)?;
        issues.insert(issue_key(repo, number), issue.clone());
        Ok(issue)
    }

    fn get_issue(
        &self,
        _token: &str,
        repo: &RepoId,
        number: u64,
    ) -> Result<CreatedIssue, GitHubError> {
        if let Some(err) = self
            .issue_error
            .lock()
            .map_err(|_| GitHubError::Unavailable)?
            .clone()
        {
            return Err(err);
        }
        let issues = self.issues.lock().map_err(|_| GitHubError::Unavailable)?;
        issues
            .get(&issue_key(repo, number))
            .cloned()
            .ok_or(GitHubError::Unavailable)
    }

    fn update_issue(
        &self,
        _token: &str,
        repo: &RepoId,
        number: u64,
        title: &str,
        body: &str,
        label_names: &[String],
    ) -> Result<CreatedIssue, GitHubError> {
        if let Some(err) = self
            .issue_error
            .lock()
            .map_err(|_| GitHubError::Unavailable)?
            .clone()
        {
            return Err(err);
        }
        let mut issues = self.issues.lock().map_err(|_| GitHubError::Unavailable)?;
        let issue = issues
            .get_mut(&issue_key(repo, number))
            .ok_or(GitHubError::Unavailable)?;
        issue.title = title.to_string();
        issue.body = body.to_string();
        issue.label_names = label_names.to_vec();
        let mut seq = self
            .update_seq
            .lock()
            .map_err(|_| GitHubError::Unavailable)?;
        *seq += 1;
        issue.updated_at = format!("2024-01-16T12:{:02}:00Z", *seq);
        Ok(issue.clone())
    }

    fn list_labels(&self, _token: &str, repo: &RepoId) -> Result<Vec<RepoLabel>, GitHubError> {
        if let Some(err) = self
            .list_labels_error
            .lock()
            .map_err(|_| GitHubError::Unavailable)?
            .clone()
        {
            return Err(err);
        }
        let map = self
            .repo_labels
            .lock()
            .map_err(|_| GitHubError::Unavailable)?;
        Ok(map.get(&repo_key(repo)).cloned().unwrap_or_default())
    }

    fn create_label(
        &self,
        _token: &str,
        repo: &RepoId,
        name: &str,
        color: &str,
    ) -> Result<RepoLabel, GitHubError> {
        let label = RepoLabel {
            name: name.to_string(),
            color: color.to_string(),
        };
        let mut map = self
            .repo_labels
            .lock()
            .map_err(|_| GitHubError::Unavailable)?;
        let entry = map.entry(repo_key(repo)).or_default();
        if let Some(existing) = entry.iter_mut().find(|l| l.name.eq_ignore_ascii_case(name)) {
            *existing = label.clone();
        } else {
            entry.push(label.clone());
        }
        Ok(label)
    }
}

#[derive(Debug, Default)]
pub struct FakeTokenStore {
    pub credentials: Option<StoredCredentials>,
    /// When true, `clear` fails and leaves the credentials in place — a locked OS
    /// keychain / unavailable keyring daemon. The session must still drop.
    pub clear_fails: bool,
}

impl TokenStore for FakeTokenStore {
    fn load(&self) -> Result<Option<StoredCredentials>, TokenStoreError> {
        Ok(self.credentials.clone())
    }

    fn store(&mut self, credentials: StoredCredentials) -> Result<(), TokenStoreError> {
        self.credentials = Some(credentials);
        Ok(())
    }

    fn clear(&mut self) -> Result<(), TokenStoreError> {
        if self.clear_fails {
            return Err(TokenStoreError::Unavailable);
        }
        self.credentials = None;
        Ok(())
    }
}

#[derive(Debug, Clone, Default)]
pub struct FakeDraftStore {
    inner: Arc<Mutex<Vec<Draft>>>,
}

impl DraftStore for FakeDraftStore {
    fn save(&mut self, draft: Draft) -> Result<(), DraftStoreError> {
        let mut drafts = self
            .inner
            .lock()
            .map_err(|_| DraftStoreError::Unavailable)?;
        if let Some(existing) = drafts.iter_mut().find(|d| d.id == draft.id) {
            *existing = draft;
        } else {
            drafts.push(draft);
        }
        Ok(())
    }

    fn get(&self, id: &str) -> Result<Option<Draft>, DraftStoreError> {
        Ok(self
            .inner
            .lock()
            .map_err(|_| DraftStoreError::Unavailable)?
            .iter()
            .find(|d| d.id == id)
            .cloned())
    }

    fn list(&self) -> Result<Vec<Draft>, DraftStoreError> {
        Ok(self
            .inner
            .lock()
            .map_err(|_| DraftStoreError::Unavailable)?
            .clone())
    }
}

/// Shared in-memory settings so a reconstructed core can resume first-run progress.
#[derive(Debug, Clone, Default)]
pub struct FakeSettingsStore {
    inner: Arc<Mutex<AppSettings>>,
}

impl FakeSettingsStore {
    pub fn with_settings(settings: AppSettings) -> Self {
        Self {
            inner: Arc::new(Mutex::new(settings)),
        }
    }

    pub fn snapshot(&self) -> AppSettings {
        self.inner.lock().expect("FakeSettingsStore lock").clone()
    }
}

impl SettingsStore for FakeSettingsStore {
    fn load(&self) -> Result<AppSettings, SettingsStoreError> {
        Ok(self
            .inner
            .lock()
            .map_err(|_| SettingsStoreError::Unavailable)?
            .clone())
    }

    fn save(&mut self, settings: AppSettings) -> Result<(), SettingsStoreError> {
        *self
            .inner
            .lock()
            .map_err(|_| SettingsStoreError::Unavailable)? = settings;
        Ok(())
    }
}

#[derive(Debug, Clone, Default)]
pub struct FakeLabelCatalogStore {
    inner: Arc<Mutex<HashMap<String, LabelCatalog>>>,
}

impl FakeLabelCatalogStore {
    pub fn snapshot(&self, repo: &RepoId) -> Option<LabelCatalog> {
        self.inner
            .lock()
            .expect("FakeLabelCatalogStore lock")
            .get(&repo_key(repo))
            .cloned()
    }
}

impl LabelCatalogStore for FakeLabelCatalogStore {
    fn load(&self, repo: &RepoId) -> Result<Option<LabelCatalog>, LabelCatalogStoreError> {
        Ok(self
            .inner
            .lock()
            .map_err(|_| LabelCatalogStoreError::Unavailable)?
            .get(&repo_key(repo))
            .cloned())
    }

    fn save(&mut self, catalog: LabelCatalog) -> Result<(), LabelCatalogStoreError> {
        self.inner
            .lock()
            .map_err(|_| LabelCatalogStoreError::Unavailable)?
            .insert(repo_key(&catalog.repo), catalog);
        Ok(())
    }
}

/// Scriptable voice port — set `next_result` before each PTT call.
#[derive(Debug, Clone)]
pub struct FakeVoiceTranscriber {
    pub next_result: Arc<Mutex<Result<String, VoiceError>>>,
}

impl Default for FakeVoiceTranscriber {
    fn default() -> Self {
        Self {
            next_result: Arc::new(Mutex::new(Ok(String::new()))),
        }
    }
}

impl FakeVoiceTranscriber {
    pub fn with_result(result: Result<String, VoiceError>) -> Self {
        Self {
            next_result: Arc::new(Mutex::new(result)),
        }
    }
}

impl VoiceTranscriber for FakeVoiceTranscriber {
    fn transcribe(&self, _audio_path: &str) -> Result<String, VoiceError> {
        self.next_result
            .lock()
            .expect("FakeVoiceTranscriber lock")
            .clone()
    }
}

#[derive(Debug, Clone)]
pub struct FakeClock {
    now: Arc<Mutex<SystemTime>>,
}

impl Default for FakeClock {
    fn default() -> Self {
        Self {
            now: Arc::new(Mutex::new(
                SystemTime::UNIX_EPOCH + Duration::from_secs(1_700_000_000),
            )),
        }
    }
}

impl FakeClock {
    pub fn advance(&self, by: Duration) {
        let mut now = self.now.lock().expect("FakeClock lock");
        *now += by;
    }
}

impl Clock for FakeClock {
    fn now(&self) -> SystemTime {
        *self.now.lock().expect("FakeClock lock")
    }
}

/// In-memory Rewrite model files keyed by catalog filename.
#[derive(Debug, Clone, Default)]
pub struct FakeRewriteModelFiles {
    /// filename → raw bytes (verified via catalog helpers in tests).
    pub files: Arc<Mutex<HashMap<String, Vec<u8>>>>,
    pub partials: Arc<Mutex<Vec<String>>>,
}

impl FakeRewriteModelFiles {
    pub fn put(&self, filename: &str, bytes: Vec<u8>) {
        self.files
            .lock()
            .expect("FakeRewriteModelFiles lock")
            .insert(filename.to_string(), bytes);
    }
}

impl RewriteModelFiles for FakeRewriteModelFiles {
    fn clean_orphan_partials(&self) -> Result<(), RewriteModelFileError> {
        self.partials
            .lock()
            .map_err(|_| RewriteModelFileError::Unavailable)?
            .clear();
        Ok(())
    }

    fn path_for(&self, filename: &str) -> std::path::PathBuf {
        std::path::PathBuf::from("fake-models").join(filename)
    }

    fn on_disk_len(&self, filename: &str) -> Option<u64> {
        self.files
            .lock()
            .ok()?
            .get(filename)
            .map(|b| b.len() as u64)
    }

    fn is_verified(&self, filename: &str, expected_size: u64, expected_sha256: &str) -> bool {
        let Ok(guard) = self.files.lock() else {
            return false;
        };
        let Some(bytes) = guard.get(filename) else {
            return false;
        };
        super::super::rewrite_model_catalog::verify_model_bytes(
            bytes,
            expected_size,
            expected_sha256,
        )
    }

    fn is_verified_cached(
        &self,
        _filename: &str,
        _expected_size: u64,
        _expected_sha256: &str,
    ) -> bool {
        // In-memory fake has no sidecar marker; Help must not inherit hashing.
        false
    }

    fn remove(&self, filename: &str) -> Result<(), RewriteModelFileError> {
        self.files
            .lock()
            .map_err(|_| RewriteModelFileError::Unavailable)?
            .remove(filename);
        Ok(())
    }
}

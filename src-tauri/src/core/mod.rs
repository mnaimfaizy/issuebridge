//! Issuebridge application core — use-cases behind injectable ports.
//! UI / Tauri IPC are adapters outside this module.

mod error;
mod ports;

pub use error::{AuthError, CaptureError};
pub use ports::{
    CaptureInput, Clock, Draft, DraftStore, DraftStoreError, GitHub, GitHubError, RepoId,
    StoredCredentials, TokenStore, TokenStoreError, VoiceTranscriber,
};

/// Auth state visible to callers (never includes raw tokens).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthState {
    SignedOut,
    SignedIn,
}

/// Application core: auth session gating, Capture, Inbox, Publish, etc.
pub struct IssuebridgeCore<G, T, D, V, C> {
    github: G,
    token_store: T,
    #[allow(dead_code)] // exercised when Capture Save persists Drafts
    draft_store: D,
    #[allow(dead_code)] // exercised by PTT transcription use-cases
    voice: V,
    #[allow(dead_code)] // exercised when assigning Draft timestamps
    clock: C,
}

impl<G, T, D, V, C> IssuebridgeCore<G, T, D, V, C>
where
    G: GitHub,
    T: TokenStore,
    D: DraftStore,
    V: VoiceTranscriber,
    C: Clock,
{
    pub fn new(github: G, token_store: T, draft_store: D, voice: V, clock: C) -> Self {
        Self {
            github,
            token_store,
            draft_store,
            voice,
            clock,
        }
    }

    pub fn auth_state(&self) -> AuthState {
        match self.token_store.load() {
            Ok(Some(_)) => AuthState::SignedIn,
            Ok(None) | Err(_) => AuthState::SignedOut,
        }
    }

    /// Sign in with a personal access token. Validates via GitHub, then stores credentials.
    /// Never returns the token string.
    pub fn sign_in_with_pat(&mut self, pat: &str) -> Result<AuthState, AuthError> {
        let pat = pat.trim();
        if pat.is_empty() {
            return Err(AuthError::EmptyToken);
        }

        self.github.validate_pat(pat).map_err(map_github_error)?;

        self.token_store
            .store(StoredCredentials {
                access_token: pat.to_string(),
                refresh_token: None,
            })
            .map_err(|_| AuthError::StorageUnavailable)?;

        Ok(AuthState::SignedIn)
    }

    /// Complete Authorization Code + PKCE by exchanging the code, then store tokens.
    /// Never returns token strings.
    pub fn sign_in_with_oauth(
        &mut self,
        code: &str,
        code_verifier: &str,
    ) -> Result<AuthState, AuthError> {
        if code.trim().is_empty() || code_verifier.trim().is_empty() {
            return Err(AuthError::InvalidCredentials);
        }

        let credentials = self
            .github
            .exchange_oauth_code(code, code_verifier)
            .map_err(map_github_error)?;

        self.token_store
            .store(credentials)
            .map_err(|_| AuthError::StorageUnavailable)?;

        Ok(AuthState::SignedIn)
    }

    /// Clear stored credentials and return to signed-out state.
    pub fn sign_out(&mut self) -> Result<(), AuthError> {
        self.token_store
            .clear()
            .map_err(|_| AuthError::StorageUnavailable)
    }

    /// Save a Capture into a Draft. Refused when signed out.
    pub fn save_capture(&mut self, _input: CaptureInput) -> Result<Draft, CaptureError> {
        if self.auth_state() != AuthState::SignedIn {
            return Err(CaptureError::NotSignedIn);
        }
        // Draft persistence is a later slice; this ticket only proves the auth gate.
        Err(CaptureError::NotAvailableYet)
    }
}

fn map_github_error(err: GitHubError) -> AuthError {
    match err {
        GitHubError::InvalidCredentials => AuthError::InvalidCredentials,
        GitHubError::Unavailable => AuthError::ProviderUnavailable,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ports::fakes::{
        FakeClock, FakeDraftStore, FakeGitHub, FakeTokenStore, FakeVoiceTranscriber,
    };

    fn fresh_core() -> IssuebridgeCore<
        FakeGitHub,
        FakeTokenStore,
        FakeDraftStore,
        FakeVoiceTranscriber,
        FakeClock,
    > {
        IssuebridgeCore::new(
            FakeGitHub::default(),
            FakeTokenStore::default(),
            FakeDraftStore::default(),
            FakeVoiceTranscriber::default(),
            FakeClock::default(),
        )
    }

    #[test]
    fn freshly_constructed_core_is_signed_out_and_refuses_capture_save() {
        let mut core = fresh_core();

        assert_eq!(core.auth_state(), AuthState::SignedOut);

        let err = core
            .save_capture(CaptureInput {
                repo: RepoId {
                    owner: "acme".into(),
                    name: "widgets".into(),
                },
                title: "Broken button".into(),
                body: "Clicking Save does nothing.".into(),
            })
            .expect_err("Capture Save must be refused while signed out");

        assert_eq!(err, CaptureError::NotSignedIn);
    }

    #[test]
    fn sign_in_with_pat_then_sign_out_transitions_auth_state() {
        let mut core = fresh_core();

        assert_eq!(core.auth_state(), AuthState::SignedOut);

        let state = core
            .sign_in_with_pat("ghp_test_token_not_a_secret")
            .expect("PAT sign-in should succeed against FakeGitHub");
        assert_eq!(state, AuthState::SignedIn);
        assert_eq!(core.auth_state(), AuthState::SignedIn);

        core.sign_out().expect("sign-out should clear credentials");
        assert_eq!(core.auth_state(), AuthState::SignedOut);
    }

    #[test]
    fn sign_in_with_empty_pat_is_rejected_and_stays_signed_out() {
        let mut core = fresh_core();

        let err = core
            .sign_in_with_pat("   ")
            .expect_err("empty PAT must be rejected");
        assert_eq!(err, AuthError::EmptyToken);
        assert_eq!(core.auth_state(), AuthState::SignedOut);
    }

    #[test]
    fn sign_in_with_invalid_pat_is_rejected_and_stays_signed_out() {
        let mut core = IssuebridgeCore::new(
            FakeGitHub {
                reject_pat: true,
                ..FakeGitHub::default()
            },
            FakeTokenStore::default(),
            FakeDraftStore::default(),
            FakeVoiceTranscriber::default(),
            FakeClock::default(),
        );

        let err = core
            .sign_in_with_pat("ghp_bad")
            .expect_err("invalid PAT must be rejected");
        assert_eq!(err, AuthError::InvalidCredentials);
        assert_eq!(core.auth_state(), AuthState::SignedOut);
    }

    #[test]
    fn sign_in_with_oauth_then_sign_out_transitions_auth_state() {
        let mut core = IssuebridgeCore::new(
            FakeGitHub {
                oauth_result: Ok(StoredCredentials {
                    access_token: "ghu_access".into(),
                    refresh_token: Some("ghr_refresh".into()),
                }),
                ..FakeGitHub::default()
            },
            FakeTokenStore::default(),
            FakeDraftStore::default(),
            FakeVoiceTranscriber::default(),
            FakeClock::default(),
        );

        assert_eq!(core.auth_state(), AuthState::SignedOut);

        let state = core
            .sign_in_with_oauth("auth_code", "pkce_verifier")
            .expect("OAuth sign-in should succeed against FakeGitHub");
        assert_eq!(state, AuthState::SignedIn);
        assert_eq!(core.auth_state(), AuthState::SignedIn);

        core.sign_out().expect("sign-out should clear credentials");
        assert_eq!(core.auth_state(), AuthState::SignedOut);
    }

    #[test]
    fn failed_oauth_exchange_leaves_signed_out() {
        let mut core = IssuebridgeCore::new(
            FakeGitHub {
                oauth_result: Err(GitHubError::InvalidCredentials),
                ..FakeGitHub::default()
            },
            FakeTokenStore::default(),
            FakeDraftStore::default(),
            FakeVoiceTranscriber::default(),
            FakeClock::default(),
        );

        let err = core
            .sign_in_with_oauth("bad_code", "verifier")
            .expect_err("failed exchange must reject sign-in");
        assert_eq!(err, AuthError::InvalidCredentials);
        assert_eq!(core.auth_state(), AuthState::SignedOut);
    }
}

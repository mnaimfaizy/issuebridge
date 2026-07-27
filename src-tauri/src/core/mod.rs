//! Issuebridge application core — use-cases behind injectable ports.
//! UI / Tauri IPC are adapters outside this module.

mod error;
mod ports;

pub use error::CaptureError;
pub use ports::{
    CaptureInput, Clock, Draft, DraftStore, DraftStoreError, GitHub, RepoId, StoredCredentials,
    TokenStore, TokenStoreError, VoiceTranscriber,
};

/// Auth state visible to callers (never includes raw tokens).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthState {
    SignedOut,
    SignedIn,
}

/// Application core: auth session gating, Capture, Inbox, Publish, etc.
pub struct IssuebridgeCore<G, T, D, V, C> {
    #[allow(dead_code)] // exercised by later slices (GitHub API use-cases)
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

    /// Save a Capture into a Draft. Refused when signed out.
    pub fn save_capture(&mut self, _input: CaptureInput) -> Result<Draft, CaptureError> {
        if self.auth_state() != AuthState::SignedIn {
            return Err(CaptureError::NotSignedIn);
        }
        // Draft persistence is a later slice; this ticket only proves the auth gate.
        unimplemented!("signed-in Capture Save")
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
}

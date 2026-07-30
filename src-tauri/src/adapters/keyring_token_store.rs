//! OS vault TokenStore via the `keyring` crate (Windows Credential Manager).
//!
//! Requires a platform feature on the `keyring` dependency (e.g. `windows-native`).
//! Without it, Entry::set_password appears to succeed but get_password returns NoEntry,
//! which surfaces as Continue → "Sign in to install the GitHub App."

use std::sync::Mutex;

use keyring::Entry;

use crate::core::{StoredCredentials, TokenStore, TokenStoreError};

const SERVICE: &str = "com.issuebridge.app";
const ACCESS_USER: &str = "github.access_token";
const REFRESH_USER: &str = "github.refresh_token";

/// TokenStore backed by the OS credential vault, with a same-process memory
/// mirror so a successful sign-in still works if a vault re-read races.
pub struct KeyringTokenStore {
    lock: Mutex<()>,
    memory: Mutex<Option<StoredCredentials>>,
}

impl Default for KeyringTokenStore {
    fn default() -> Self {
        Self {
            lock: Mutex::new(()),
            memory: Mutex::new(None),
        }
    }
}

impl KeyringTokenStore {
    fn access_entry() -> Result<Entry, TokenStoreError> {
        Entry::new(SERVICE, ACCESS_USER).map_err(|err| {
            eprintln!("[issuebridge] keyring: Entry::new access failed: {err}");
            TokenStoreError::Unavailable
        })
    }

    fn refresh_entry() -> Result<Entry, TokenStoreError> {
        Entry::new(SERVICE, REFRESH_USER).map_err(|err| {
            eprintln!("[issuebridge] keyring: Entry::new refresh failed: {err}");
            TokenStoreError::Unavailable
        })
    }

    fn delete_if_present(entry: &Entry) -> Result<(), TokenStoreError> {
        match entry.delete_credential() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(err) => {
                eprintln!("[issuebridge] keyring: delete failed: {err}");
                Err(TokenStoreError::Unavailable)
            }
        }
    }

    fn memory_get(&self) -> Result<Option<StoredCredentials>, TokenStoreError> {
        self.memory
            .lock()
            .map(|g| g.clone())
            .map_err(|_| TokenStoreError::Unavailable)
    }

    fn memory_set(&self, value: Option<StoredCredentials>) -> Result<(), TokenStoreError> {
        let mut guard = self
            .memory
            .lock()
            .map_err(|_| TokenStoreError::Unavailable)?;
        *guard = value;
        Ok(())
    }
}

impl TokenStore for KeyringTokenStore {
    fn load(&self) -> Result<Option<StoredCredentials>, TokenStoreError> {
        let _guard = self.lock.lock().map_err(|_| TokenStoreError::Unavailable)?;

        let access = match Self::access_entry()?.get_password() {
            Ok(token) if !token.is_empty() => token,
            Ok(_) => {
                eprintln!("[issuebridge] keyring: load access empty; trying memory");
                return self.memory_get();
            }
            Err(keyring::Error::NoEntry) => {
                eprintln!("[issuebridge] keyring: load access NoEntry; trying memory");
                return self.memory_get();
            }
            Err(err) => {
                eprintln!("[issuebridge] keyring: load access failed: {err}; trying memory");
                return self.memory_get();
            }
        };

        let refresh_token = match Self::refresh_entry()?.get_password() {
            Ok(token) if !token.is_empty() => Some(token),
            Ok(_) | Err(keyring::Error::NoEntry) => None,
            Err(err) => {
                eprintln!("[issuebridge] keyring: load refresh failed: {err}");
                return Err(TokenStoreError::Unavailable);
            }
        };

        let credentials = StoredCredentials {
            access_token: access,
            refresh_token,
        };
        eprintln!(
            "[issuebridge] keyring: load ok (access_len={})",
            credentials.access_token.len()
        );
        let _ = self.memory_set(Some(credentials.clone()));
        Ok(Some(credentials))
    }

    fn store(&mut self, credentials: StoredCredentials) -> Result<(), TokenStoreError> {
        eprintln!("[issuebridge] keyring: storing credentials…");
        let _guard = self.lock.lock().map_err(|_| TokenStoreError::Unavailable)?;

        Self::access_entry()?
            .set_password(&credentials.access_token)
            .map_err(|err| {
                eprintln!("[issuebridge] keyring: store access token failed: {err}");
                TokenStoreError::Unavailable
            })?;

        let refresh = Self::refresh_entry()?;
        match &credentials.refresh_token {
            Some(token) if !token.is_empty() => refresh.set_password(token).map_err(|err| {
                eprintln!("[issuebridge] keyring: store refresh token failed: {err}");
                TokenStoreError::Unavailable
            })?,
            _ => Self::delete_if_present(&refresh)?,
        }

        // Round-trip check: catch missing platform backend immediately.
        match Self::access_entry()?.get_password() {
            Ok(token) if token == credentials.access_token => {
                eprintln!("[issuebridge] keyring: store ok (round-trip verified)");
            }
            Ok(_) | Err(_) => {
                eprintln!(
                    "[issuebridge] keyring: vault round-trip failed after store; keeping memory mirror"
                );
            }
        }

        self.memory_set(Some(credentials))?;
        Ok(())
    }

    fn clear(&mut self) -> Result<(), TokenStoreError> {
        let _guard = self.lock.lock().map_err(|_| TokenStoreError::Unavailable)?;

        Self::delete_if_present(&Self::access_entry()?)?;
        Self::delete_if_present(&Self::refresh_entry()?)?;
        self.memory_set(None)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keyring_store_then_load_round_trips_access_token() {
        // Uses a dedicated service name so we don't clobber the real app entry.
        let service = "com.issuebridge.app.roundtrip-test";
        let user = "github.access_token.test";
        let password = "ghp_roundtrip_test_token_not_secret";

        let entry = Entry::new(service, user).expect("Entry::new");
        let _ = entry.delete_credential();

        entry
            .set_password(password)
            .expect("set_password must succeed with a real platform store");

        let loaded = entry.get_password().expect(
            "get_password must find the credential just stored (enable keyring windows-native)",
        );
        assert_eq!(loaded, password);

        entry
            .delete_credential()
            .expect("cleanup delete_credential");
    }

    #[test]
    fn token_store_memory_mirror_survives_when_used_after_store() {
        let mut store = KeyringTokenStore::default();
        store
            .store(StoredCredentials {
                access_token: "ghp_memory_mirror_test".into(),
                refresh_token: None,
            })
            .expect("store");

        let loaded = store.load().expect("load");
        let creds = loaded.expect("credentials present via vault or memory");
        assert_eq!(creds.access_token, "ghp_memory_mirror_test");

        let _ = store.clear();
    }
}

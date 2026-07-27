//! OS vault TokenStore via the `keyring` crate (Windows Credential Manager).

use std::sync::Mutex;

use keyring::Entry;

use crate::core::{StoredCredentials, TokenStore, TokenStoreError};

const SERVICE: &str = "com.issuebridge.app";
const ACCESS_USER: &str = "github.access_token";
const REFRESH_USER: &str = "github.refresh_token";

/// TokenStore backed by the OS credential vault. Access is serialized (Windows
/// store is not reliably ordered across threads on one entry).
pub struct KeyringTokenStore {
    lock: Mutex<()>,
}

impl Default for KeyringTokenStore {
    fn default() -> Self {
        Self {
            lock: Mutex::new(()),
        }
    }
}

impl KeyringTokenStore {
    fn access_entry() -> Result<Entry, TokenStoreError> {
        Entry::new(SERVICE, ACCESS_USER).map_err(|_| TokenStoreError::Unavailable)
    }

    fn refresh_entry() -> Result<Entry, TokenStoreError> {
        Entry::new(SERVICE, REFRESH_USER).map_err(|_| TokenStoreError::Unavailable)
    }

    fn delete_if_present(entry: &Entry) -> Result<(), TokenStoreError> {
        match entry.delete_credential() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err(TokenStoreError::Unavailable),
        }
    }
}

impl TokenStore for KeyringTokenStore {
    fn load(&self) -> Result<Option<StoredCredentials>, TokenStoreError> {
        let _guard = self.lock.lock().map_err(|_| TokenStoreError::Unavailable)?;

        let access = match Self::access_entry()?.get_password() {
            Ok(token) if !token.is_empty() => token,
            Ok(_) | Err(keyring::Error::NoEntry) => return Ok(None),
            Err(_) => return Err(TokenStoreError::Unavailable),
        };

        let refresh_token = match Self::refresh_entry()?.get_password() {
            Ok(token) if !token.is_empty() => Some(token),
            Ok(_) | Err(keyring::Error::NoEntry) => None,
            Err(_) => return Err(TokenStoreError::Unavailable),
        };

        Ok(Some(StoredCredentials {
            access_token: access,
            refresh_token,
        }))
    }

    fn store(&mut self, credentials: StoredCredentials) -> Result<(), TokenStoreError> {
        let _guard = self.lock.lock().map_err(|_| TokenStoreError::Unavailable)?;

        Self::access_entry()?
            .set_password(&credentials.access_token)
            .map_err(|_| TokenStoreError::Unavailable)?;

        let refresh = Self::refresh_entry()?;
        match &credentials.refresh_token {
            Some(token) if !token.is_empty() => refresh
                .set_password(token)
                .map_err(|_| TokenStoreError::Unavailable)?,
            _ => Self::delete_if_present(&refresh)?,
        }

        Ok(())
    }

    fn clear(&mut self) -> Result<(), TokenStoreError> {
        let _guard = self.lock.lock().map_err(|_| TokenStoreError::Unavailable)?;

        Self::delete_if_present(&Self::access_entry()?)?;
        Self::delete_if_present(&Self::refresh_entry()?)?;
        Ok(())
    }
}

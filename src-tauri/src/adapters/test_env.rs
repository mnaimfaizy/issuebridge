//! Test-only helpers for code that reads process environment variables.
//!
//! `setenv` mutates state shared by every thread in the process, so a test that
//! touches it has to serialise against every other such test — not only against
//! tests of its own module — and has to restore what it found even when an
//! assertion panics part way through. One lock lives here so that separate
//! modules cannot each hold their own and race anyway.

use std::ffi::OsString;
use std::sync::{Mutex, MutexGuard, OnceLock};

/// Serialises tests that read or write process environment variables.
pub fn env_lock() -> MutexGuard<'static, ()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Sets or removes one variable, restoring the previous value when dropped.
pub struct EnvGuard {
    key: &'static str,
    prev: Option<OsString>,
}

impl EnvGuard {
    pub fn set(key: &'static str, value: &str) -> Self {
        let prev = std::env::var_os(key);
        std::env::set_var(key, value);
        Self { key, prev }
    }

    pub fn remove(key: &'static str) -> Self {
        let prev = std::env::var_os(key);
        std::env::remove_var(key);
        Self { key, prev }
    }
}

impl Drop for EnvGuard {
    fn drop(&mut self) {
        match &self.prev {
            Some(value) => std::env::set_var(self.key, value),
            None => std::env::remove_var(self.key),
        }
    }
}

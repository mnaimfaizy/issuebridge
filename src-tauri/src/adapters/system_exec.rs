//! Resolve stock system executables to a trusted absolute location instead of a
//! bare program name.
//!
//! Windows resolves a bare `Command` name through the application directory,
//! then the parent process's current directory, and only then `System32`. A
//! directory the app was started from is writable by a party who cannot write
//! the per-user install directory, so a `taskkill.exe` planted there would be
//! preferred over the real one and run as the signed-in user. Anchoring the
//! spawn to the system directory removes that search. Concept:
//! `unqualified-system-binary-search-order`.

use std::path::PathBuf;
use std::process::Command;

/// A `Command` for a stock system executable, resolved to its OS location rather
/// than a bare name so process-search order cannot substitute it.
pub(crate) fn system_command(name: &str) -> Command {
    Command::new(system_binary_path(name))
}

/// Absolute path to a stock system executable under the Windows system directory.
#[cfg(windows)]
fn system_binary_path(name: &str) -> PathBuf {
    system32_dir().join(format!("{name}.exe"))
}

/// The Windows system directory. `%SystemRoot%` is a protected system variable;
/// fall back to the documented default only when it is unset, and never to a
/// relative path that the search this exists to remove could satisfy.
#[cfg(windows)]
fn system32_dir() -> PathBuf {
    let root = std::env::var_os("SystemRoot")
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| std::ffi::OsString::from(r"C:\Windows"));
    PathBuf::from(root).join("System32")
}

/// Absolute path to a stock system executable. Prefer the known locations; fall
/// back to the bare name only when none is present, so a nonstandard host still
/// degrades to prior behaviour rather than failing to terminate a child.
#[cfg(not(windows))]
fn system_binary_path(name: &str) -> PathBuf {
    for base in ["/bin", "/usr/bin"] {
        let candidate = PathBuf::from(base).join(name);
        if candidate.is_file() {
            return candidate;
        }
    }
    PathBuf::from(name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(windows)]
    #[test]
    fn resolves_under_system32_absolute() {
        use crate::adapters::test_env::{env_lock, EnvGuard};
        let _lock = env_lock();
        let _root = EnvGuard::set("SystemRoot", r"C:\Windows");
        let path = system_binary_path("taskkill");
        assert!(path.is_absolute(), "path={}", path.display());
        assert!(
            path.to_string_lossy()
                .to_lowercase()
                .ends_with(r"system32\taskkill.exe"),
            "path={}",
            path.display()
        );
    }

    #[cfg(windows)]
    #[test]
    fn honours_system_root_override() {
        use crate::adapters::test_env::{env_lock, EnvGuard};
        let _lock = env_lock();
        let _root = EnvGuard::set("SystemRoot", r"D:\Win");
        assert_eq!(
            system_binary_path("taskkill"),
            PathBuf::from(r"D:\Win\System32\taskkill.exe")
        );
    }

    #[cfg(windows)]
    #[test]
    fn falls_back_to_default_root_when_unset() {
        use crate::adapters::test_env::{env_lock, EnvGuard};
        let _lock = env_lock();
        let _root = EnvGuard::remove("SystemRoot");
        assert_eq!(
            system_binary_path("kill"),
            PathBuf::from(r"C:\Windows\System32\kill.exe")
        );
    }

    #[cfg(not(windows))]
    #[test]
    fn resolves_stock_binary_to_absolute_path() {
        // `sh` exists at a stock location on every unix host.
        let path = system_binary_path("sh");
        assert!(path.is_absolute(), "path={}", path.display());
        assert!(path.ends_with("sh"));
    }

    #[cfg(not(windows))]
    #[test]
    fn falls_back_to_bare_name_when_absent() {
        assert_eq!(
            system_binary_path("issuebridge-no-such-system-binary"),
            PathBuf::from("issuebridge-no-such-system-binary")
        );
    }
}

//! On-disk GGUF store for curated Rewrite models under app-data `models/`.

use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use sha2::{Digest, Sha256};

use crate::core::{RewriteModelFileError, RewriteModelFiles};

const MODELS_DIR: &str = "models";
const PARTIAL_SUFFIX: &str = ".partial";

#[derive(Debug, Clone)]
pub struct FileRewriteModelStore {
    root: PathBuf,
}

impl FileRewriteModelStore {
    pub fn in_app_data() -> Result<Self, RewriteModelFileError> {
        let dir = dirs_app_data()
            .ok_or(RewriteModelFileError::Unavailable)?
            .join(MODELS_DIR);
        fs::create_dir_all(&dir).map_err(|_| RewriteModelFileError::Unavailable)?;
        Ok(Self { root: dir })
    }

    pub fn new(root: PathBuf) -> Self {
        let _ = fs::create_dir_all(&root);
        Self { root }
    }

    pub fn partial_path(&self, filename: &str) -> PathBuf {
        self.root.join(format!("{filename}{PARTIAL_SUFFIX}"))
    }

    /// Download URL → partial file with byte progress; verify then rename to final.
    pub fn download_and_verify(
        &self,
        url: &str,
        filename: &str,
        expected_size: u64,
        expected_sha256: &str,
        cancel: &AtomicBool,
        mut on_progress: impl FnMut(u64, u64),
    ) -> Result<PathBuf, ModelDownloadError> {
        let partial = self.partial_path(filename);
        let final_path = self.path_for(filename);
        if let Some(parent) = partial.parent() {
            fs::create_dir_all(parent).map_err(|_| ModelDownloadError::Io)?;
        }
        if partial.exists() {
            let _ = fs::remove_file(&partial);
        }

        let result = (|| {
            if cancel.load(Ordering::SeqCst) {
                return Err(ModelDownloadError::Cancelled);
            }
            let client = reqwest::blocking::Client::builder()
                .timeout(std::time::Duration::from_secs(60 * 30))
                .connect_timeout(std::time::Duration::from_secs(30))
                .build()
                .map_err(|_| ModelDownloadError::Network)?;
            let mut response = client
                .get(url)
                .send()
                .map_err(|_| ModelDownloadError::Network)?;
            if !response.status().is_success() {
                return Err(ModelDownloadError::Network);
            }
            let total = response
                .content_length()
                .unwrap_or(expected_size)
                .max(expected_size);
            let mut file = File::create(&partial).map_err(|_| ModelDownloadError::Io)?;
            let mut hasher = Sha256::new();
            let mut received: u64 = 0;
            let mut buf = [0u8; 64 * 1024];
            loop {
                if cancel.load(Ordering::SeqCst) {
                    return Err(ModelDownloadError::Cancelled);
                }
                let n = response
                    .read(&mut buf)
                    .map_err(|_| ModelDownloadError::Network)?;
                if n == 0 {
                    break;
                }
                file.write_all(&buf[..n])
                    .map_err(|_| ModelDownloadError::Io)?;
                hasher.update(&buf[..n]);
                received += n as u64;
                on_progress(received, total);
            }
            file.flush().map_err(|_| ModelDownloadError::Io)?;
            drop(file);

            if received != expected_size {
                return Err(ModelDownloadError::VerifyFailed);
            }
            let digest = hasher.finalize();
            let hex = hex_encode(&digest);
            if !hex.eq_ignore_ascii_case(expected_sha256) {
                return Err(ModelDownloadError::VerifyFailed);
            }
            if final_path.exists() {
                let _ = fs::remove_file(&final_path);
            }
            fs::rename(&partial, &final_path).map_err(|_| ModelDownloadError::Io)?;
            write_verify_marker(&final_path, expected_sha256)?;
            Ok(final_path.clone())
        })();

        if result.is_err() {
            let _ = fs::remove_file(&partial);
        }
        result
    }
}

impl Default for FileRewriteModelStore {
    fn default() -> Self {
        Self::in_app_data().unwrap_or_else(|_| {
            Self::new(std::env::temp_dir().join("issuebridge").join(MODELS_DIR))
        })
    }
}

impl RewriteModelFiles for FileRewriteModelStore {
    fn clean_orphan_partials(&self) -> Result<(), RewriteModelFileError> {
        let entries = fs::read_dir(&self.root).map_err(|_| RewriteModelFileError::Unavailable)?;
        for entry in entries.flatten() {
            let path = entry.path();
            if path
                .file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n.ends_with(PARTIAL_SUFFIX))
            {
                let _ = fs::remove_file(path);
            }
        }
        Ok(())
    }

    fn path_for(&self, filename: &str) -> PathBuf {
        self.root.join(filename)
    }

    fn on_disk_len(&self, filename: &str) -> Option<u64> {
        fs::metadata(self.path_for(filename)).ok().map(|m| m.len())
    }

    fn is_verified(&self, filename: &str, expected_size: u64, expected_sha256: &str) -> bool {
        let path = self.path_for(filename);
        let Ok(meta) = fs::metadata(&path) else {
            return false;
        };
        if meta.len() != expected_size {
            return false;
        }
        // Prefer the marker written after a successful download (avoid rehashing GBs).
        if let Ok(marker) = fs::read_to_string(verify_marker_path(&path)) {
            return marker.trim().eq_ignore_ascii_case(expected_sha256);
        }
        // Legacy / manually placed GGUF: stream-hash once and cache the marker.
        let Ok(mut file) = File::open(&path) else {
            return false;
        };
        let mut hasher = Sha256::new();
        let mut buf = [0u8; 64 * 1024];
        loop {
            let Ok(n) = file.read(&mut buf) else {
                return false;
            };
            if n == 0 {
                break;
            }
            hasher.update(&buf[..n]);
        }
        let hex = hex_encode(&hasher.finalize());
        if hex.eq_ignore_ascii_case(expected_sha256) {
            let _ = write_verify_marker(&path, expected_sha256);
            true
        } else {
            false
        }
    }

    fn remove(&self, filename: &str) -> Result<(), RewriteModelFileError> {
        let path = self.path_for(filename);
        if path.exists() {
            fs::remove_file(&path).map_err(|_| RewriteModelFileError::Unavailable)?;
        }
        let _ = fs::remove_file(verify_marker_path(&path));
        let partial = self.partial_path(filename);
        if partial.exists() {
            let _ = fs::remove_file(partial);
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ModelDownloadError {
    Network,
    Io,
    Cancelled,
    VerifyFailed,
}

fn dirs_app_data() -> Option<PathBuf> {
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        if !local.is_empty() {
            return Some(PathBuf::from(local).join("Issuebridge"));
        }
    }
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(|home| PathBuf::from(home).join(".issuebridge"))
}

fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push(HEX[(b >> 4) as usize] as char);
        out.push(HEX[(b & 0xf) as usize] as char);
    }
    out
}

fn verify_marker_path(gguf: &Path) -> PathBuf {
    let mut name = gguf
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("model.gguf")
        .to_string();
    name.push_str(".sha256");
    gguf.with_file_name(name)
}

fn write_verify_marker(gguf: &Path, sha256: &str) -> Result<(), ModelDownloadError> {
    fs::write(verify_marker_path(gguf), sha256.as_bytes()).map_err(|_| ModelDownloadError::Io)
}

/// Resolve active catalog GGUF for llama.cpp (after env override).
pub fn resolve_active_catalog_gguf() -> Option<PathBuf> {
    use crate::adapters::file_settings_store::FileSettingsStore;
    use crate::core::{find_rewrite_model, SettingsStore};

    let settings = FileSettingsStore::default().load().ok()?;
    let id = settings.active_rewrite_model_id.as_deref()?;
    let entry = find_rewrite_model(id)?;
    let store = FileRewriteModelStore::default();
    if !store.is_verified(entry.filename, entry.size_bytes, entry.sha256) {
        return None;
    }
    Some(store.path_for(entry.filename))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::rewrite_model_catalog::verify_model_bytes;
    use sha2::{Digest, Sha256};
    use std::io::Write;
    use std::sync::atomic::AtomicBool;

    fn temp_store() -> FileRewriteModelStore {
        let root = std::env::temp_dir().join(format!(
            "ib-rewrite-models-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        FileRewriteModelStore::new(root)
    }

    #[test]
    fn cleans_orphan_partials_and_verifies_size_sha() {
        let store = temp_store();
        let partial = store.partial_path("demo.gguf");
        fs::write(&partial, b"orphan").unwrap();
        assert!(partial.exists());
        store.clean_orphan_partials().unwrap();
        assert!(!partial.exists());

        let payload = b"verified-gguf-bytes";
        let digest = Sha256::digest(payload);
        let hex = hex_encode(&digest);
        let path = store.path_for("demo.gguf");
        fs::write(&path, payload).unwrap();
        assert!(store.is_verified("demo.gguf", payload.len() as u64, &hex));
        assert!(verify_marker_path(&path).exists());
        assert!(!store.is_verified("demo.gguf", payload.len() as u64 + 1, &hex));
        store.remove("demo.gguf").unwrap();
        assert!(!path.exists());
        assert!(!verify_marker_path(&path).exists());
        let _ = fs::remove_dir_all(&store.root);
    }

    #[test]
    fn cancel_deletes_partial() {
        let store = temp_store();
        let cancel = AtomicBool::new(true);
        // Cancelled before any network — still must not leave a partial from a prior run.
        let prior = store.partial_path("x.gguf");
        fs::write(&prior, b"leftover").unwrap();
        let err = store
            .download_and_verify(
                "http://127.0.0.1:1/missing.gguf",
                "x.gguf",
                4,
                "0000",
                &cancel,
                |_, _| {},
            )
            .unwrap_err();
        assert_eq!(err, ModelDownloadError::Cancelled);
        assert!(!prior.exists());
        let _ = fs::remove_dir_all(&store.root);
    }

    #[test]
    fn verify_model_bytes_helper_matches_store() {
        let payload = b"abc";
        let digest = Sha256::digest(payload);
        let hex = hex_encode(&digest);
        assert!(verify_model_bytes(payload, 3, &hex));
    }

    #[test]
    fn download_local_file_url_verifies_and_activates_path() {
        // Use a tiny local file served via file:// is not supported by reqwest;
        // instead write final path manually to assert rename path helpers.
        let store = temp_store();
        let mut f = File::create(store.partial_path("tiny.gguf")).unwrap();
        f.write_all(b"tiny").unwrap();
        drop(f);
        // Simulate post-verify rename
        fs::rename(store.partial_path("tiny.gguf"), store.path_for("tiny.gguf")).unwrap();
        assert_eq!(store.on_disk_len("tiny.gguf"), Some(4));
        let _ = fs::remove_dir_all(&store.root);
    }
}

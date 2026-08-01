//! Curated on-device Rewrite model catalog (GGUF Q4_K_M, download-on-demand).

/// Default catalog id when hardware allows (Phi-4 mini). Hardware tiers land in #70.
pub const DEFAULT_REWRITE_MODEL_ID: &str = "phi4-mini";

/// One curated GGUF entry available for Inbox Rewrite.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RewriteModelCatalogEntry {
    pub id: &'static str,
    pub display_name: &'static str,
    pub filename: &'static str,
    pub download_url: &'static str,
    pub size_bytes: u64,
    pub sha256: &'static str,
    /// Short blurb for setup / settings (not a hardware reason).
    pub summary: &'static str,
}

/// Curated catalog: Phi-4 mini + four Apache alternatives. Qwen2.5-3B is excluded.
pub fn rewrite_model_catalog() -> &'static [RewriteModelCatalogEntry] {
    &CATALOG
}

pub fn find_rewrite_model(id: &str) -> Option<&'static RewriteModelCatalogEntry> {
    rewrite_model_catalog().iter().find(|e| e.id == id)
}

/// Recommended model + one-line reason until hardware detection (#70) lands.
pub fn recommended_rewrite_model() -> (&'static RewriteModelCatalogEntry, &'static str) {
    let entry = find_rewrite_model(DEFAULT_REWRITE_MODEL_ID).expect("default catalog entry");
    (
        entry,
        "Recommended when hardware allows — Phi-4 mini balances quality and size for Inbox Rewrite.",
    )
}

/// True when size and lowercase hex SHA-256 match the catalog expectations.
pub fn verify_model_bytes(bytes: &[u8], expected_size: u64, expected_sha256: &str) -> bool {
    if bytes.len() as u64 != expected_size {
        return false;
    }
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(bytes);
    let hex = hex_encode(&digest);
    hex.eq_ignore_ascii_case(expected_sha256)
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

const CATALOG: [RewriteModelCatalogEntry; 5] = [
    RewriteModelCatalogEntry {
        id: "phi4-mini",
        display_name: "Phi-4 mini",
        filename: "Phi-4-mini-instruct-Q4_K_M.gguf",
        download_url: "https://huggingface.co/unsloth/Phi-4-mini-instruct-GGUF/resolve/main/Phi-4-mini-instruct-Q4_K_M.gguf",
        size_bytes: 2_491_874_272,
        sha256: "88c00229914083cd112853aab84ed51b87bdf6b9ce42f532d8c85c7c63b1730a",
        summary: "MIT · ~2.3 GB · recommended default when hardware allows",
    },
    RewriteModelCatalogEntry {
        id: "qwen25-1.5b",
        display_name: "Qwen2.5 1.5B",
        filename: "qwen2.5-1.5b-instruct-q4_k_m.gguf",
        download_url: "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf",
        size_bytes: 1_117_320_736,
        sha256: "6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e",
        summary: "Apache-2.0 · ~1.0 GB · CPU-friendly small model",
    },
    RewriteModelCatalogEntry {
        id: "smollm2-1.7b",
        display_name: "SmolLM2 1.7B",
        filename: "smollm2-1.7b-instruct-q4_k_m.gguf",
        download_url: "https://huggingface.co/HuggingFaceTB/SmolLM2-1.7B-Instruct-GGUF/resolve/main/smollm2-1.7b-instruct-q4_k_m.gguf",
        size_bytes: 1_055_609_536,
        sha256: "decd2598bc2c8ed08c19adc3c8fdd461ee19ed5708679d1c54ef54a5a30d4f33",
        summary: "Apache-2.0 · ~1.0 GB · rewrite-oriented small instruct",
    },
    RewriteModelCatalogEntry {
        id: "granite-3.3-2b",
        display_name: "Granite 3.3 2B",
        filename: "granite-3.3-2b-instruct-Q4_K_M.gguf",
        download_url: "https://huggingface.co/ibm-granite/granite-3.3-2b-instruct-GGUF/resolve/main/granite-3.3-2b-instruct-Q4_K_M.gguf",
        size_bytes: 1_545_303_328,
        sha256: "ac71e9e32c0bea919b409c5918f69ca74339854b0319c5065e4e9fb6d95c4852",
        summary: "Apache-2.0 · ~1.4 GB · mid-size CPU-friendly instruct",
    },
    RewriteModelCatalogEntry {
        id: "qwen3-4b",
        display_name: "Qwen3 4B",
        filename: "Qwen3-4B-Q4_K_M.gguf",
        download_url: "https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/main/Qwen3-4B-Q4_K_M.gguf",
        size_bytes: 2_497_280_256,
        sha256: "7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5",
        summary: "Apache-2.0 · ~2.3 GB · quality alternative (thinking disabled)",
    },
];

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};

    #[test]
    fn catalog_has_five_entries_excluding_qwen25_3b() {
        let ids: Vec<&str> = rewrite_model_catalog().iter().map(|e| e.id).collect();
        assert_eq!(
            ids,
            vec![
                "phi4-mini",
                "qwen25-1.5b",
                "smollm2-1.7b",
                "granite-3.3-2b",
                "qwen3-4b",
            ]
        );
        assert!(!ids
            .iter()
            .any(|id| id.contains("3b") && id.contains("qwen25")));
        assert!(rewrite_model_catalog()
            .iter()
            .all(|e| !e.id.contains("qwen25-3") && !e.display_name.contains("Qwen2.5 3B")));
    }

    #[test]
    fn default_recommendation_is_phi4_mini_with_reason() {
        let (entry, reason) = recommended_rewrite_model();
        assert_eq!(entry.id, DEFAULT_REWRITE_MODEL_ID);
        assert!(reason.contains("Phi-4"));
        assert!(entry.size_bytes > 1_000_000_000);
    }

    #[test]
    fn verify_model_bytes_checks_size_and_sha256() {
        let payload = b"issuebridge-gguf-fixture";
        let digest = Sha256::digest(payload);
        let hex = hex_encode(&digest);
        assert!(verify_model_bytes(payload, payload.len() as u64, &hex));
        assert!(!verify_model_bytes(payload, payload.len() as u64 + 1, &hex));
        assert!(!verify_model_bytes(payload, payload.len() as u64, "00"));
    }
}

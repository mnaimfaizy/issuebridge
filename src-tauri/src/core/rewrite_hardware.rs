//! Hardware-aware Rewrite model recommendation (tiers A–D).
//!
//! Detection signals: system RAM + usable Vulkan (+ VRAM when listed).
//! Vendor GPU APIs outside Vulkan are out of scope for v1 recommendations.

/// Measured machine signals used for Rewrite model pre-select.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HardwareProfile {
    /// Total system RAM in whole GiB (floor of bytes / 1024³).
    pub ram_gb: u64,
    /// True when a usable Vulkan ICD/device is present.
    pub vulkan_usable: bool,
    /// Device-local VRAM in MiB when listed; `None` if unknown.
    pub vram_mb: Option<u64>,
}

impl HardwareProfile {
    /// Stable fingerprint for Keep/Switch “once per change” tracking.
    pub fn fingerprint(&self) -> String {
        let vram = self
            .vram_mb
            .map(|mb| mb.to_string())
            .unwrap_or_else(|| "unknown".into());
        format!(
            "ram_gb={};vulkan={};vram_mb={}",
            self.ram_gb,
            u8::from(self.vulkan_usable),
            vram
        )
    }
}

/// PRD recommendation classes A–D.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HardwareTier {
    /// No Vulkan; RAM < 16 GB → Qwen2.5 1.5B.
    A,
    /// No Vulkan + RAM ≥ 16 GB, or Vulkan with VRAM < 4 GB → Granite 3.3 2B.
    B,
    /// Vulkan with ≥ ~4 GB VRAM (or VRAM unknown) → Phi-4 mini.
    C,
    /// Vulkan with ≥ ~8 GB VRAM → Phi-4 mini; surface Qwen3 4B as quality alt.
    D,
}

/// Catalog pre-select + one-line reason (+ optional quality alternative for tier D).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RewriteModelRecommendation {
    pub tier: HardwareTier,
    pub model_id: &'static str,
    pub reason: &'static str,
    pub quality_alt_model_id: Option<&'static str>,
}

const VRAM_4_GB_MB: u64 = 4 * 1024;
const VRAM_8_GB_MB: u64 = 8 * 1024;
const RAM_COMFORTABLE_GB: u64 = 16;

/// Map measured hardware to a catalog default (and optional quality alt).
pub fn recommend_rewrite_model_for(profile: &HardwareProfile) -> RewriteModelRecommendation {
    let tier = classify_hardware(profile);
    match tier {
        HardwareTier::A => RewriteModelRecommendation {
            tier,
            model_id: "qwen25-1.5b",
            reason: "No usable Vulkan and under 16 GB RAM — Qwen2.5 1.5B stays light on CPU.",
            quality_alt_model_id: None,
        },
        HardwareTier::B => {
            let reason = if profile.vulkan_usable {
                "Vulkan GPU has under 4 GB VRAM — Granite 3.3 2B is the default (GPU accel still available)."
            } else {
                "No usable Vulkan with 16 GB+ RAM — Granite 3.3 2B fits comfortable CPU Rewrite."
            };
            RewriteModelRecommendation {
                tier,
                model_id: "granite-3.3-2b",
                reason,
                quality_alt_model_id: None,
            }
        }
        HardwareTier::C => RewriteModelRecommendation {
            tier,
            model_id: "phi4-mini",
            reason: "Usable Vulkan GPU — Phi-4 mini balances Rewrite quality and size.",
            quality_alt_model_id: None,
        },
        HardwareTier::D => RewriteModelRecommendation {
            tier,
            model_id: "phi4-mini",
            reason: "High-VRAM Vulkan GPU — Phi-4 mini is recommended; Qwen3 4B is a quality alternative.",
            quality_alt_model_id: Some("qwen3-4b"),
        },
    }
}

fn classify_hardware(profile: &HardwareProfile) -> HardwareTier {
    if !profile.vulkan_usable {
        return if profile.ram_gb < RAM_COMFORTABLE_GB {
            HardwareTier::A
        } else {
            HardwareTier::B
        };
    }
    match profile.vram_mb {
        Some(mb) if mb < VRAM_4_GB_MB => HardwareTier::B,
        Some(mb) if mb >= VRAM_8_GB_MB => HardwareTier::D,
        Some(_) | None => HardwareTier::C,
    }
}

/// Soft Keep/Switch when an active selection diverges from the hardware recommendation
/// after a fingerprint the user has not yet acknowledged.
pub fn hardware_switch_prompt_needed(
    active_model_id: Option<&str>,
    recommended_model_id: &str,
    fingerprint: &str,
    acked_fingerprint: Option<&str>,
) -> bool {
    let Some(active) = active_model_id else {
        return false;
    };
    if active == recommended_model_id {
        return false;
    }
    acked_fingerprint != Some(fingerprint)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn profile(ram_gb: u64, vulkan: bool, vram_mb: Option<u64>) -> HardwareProfile {
        HardwareProfile {
            ram_gb,
            vulkan_usable: vulkan,
            vram_mb,
        }
    }

    #[test]
    fn tier_a_no_vulkan_low_ram_selects_qwen15() {
        let rec = recommend_rewrite_model_for(&profile(8, false, None));
        assert_eq!(rec.tier, HardwareTier::A);
        assert_eq!(rec.model_id, "qwen25-1.5b");
        assert!(rec.quality_alt_model_id.is_none());
        assert!(rec.reason.contains("Vulkan") || rec.reason.contains("RAM"));
    }

    #[test]
    fn tier_b_no_vulkan_comfortable_ram_selects_granite() {
        let rec = recommend_rewrite_model_for(&profile(16, false, None));
        assert_eq!(rec.tier, HardwareTier::B);
        assert_eq!(rec.model_id, "granite-3.3-2b");
        assert!(rec.quality_alt_model_id.is_none());
    }

    #[test]
    fn vulkan_under_4gb_vram_treated_as_tier_b() {
        let rec = recommend_rewrite_model_for(&profile(32, true, Some(3 * 1024)));
        assert_eq!(rec.tier, HardwareTier::B);
        assert_eq!(rec.model_id, "granite-3.3-2b");
        assert!(rec.reason.contains("4 GB") || rec.reason.contains("VRAM"));
    }

    #[test]
    fn tier_c_vulkan_unknown_vram_selects_phi4() {
        let rec = recommend_rewrite_model_for(&profile(8, true, None));
        assert_eq!(rec.tier, HardwareTier::C);
        assert_eq!(rec.model_id, "phi4-mini");
        assert!(rec.quality_alt_model_id.is_none());
    }

    #[test]
    fn tier_c_vulkan_mid_vram_selects_phi4() {
        let rec = recommend_rewrite_model_for(&profile(16, true, Some(6 * 1024)));
        assert_eq!(rec.tier, HardwareTier::C);
        assert_eq!(rec.model_id, "phi4-mini");
    }

    #[test]
    fn tier_d_high_vram_phi4_with_qwen3_alt() {
        let rec = recommend_rewrite_model_for(&profile(32, true, Some(8 * 1024)));
        assert_eq!(rec.tier, HardwareTier::D);
        assert_eq!(rec.model_id, "phi4-mini");
        assert_eq!(rec.quality_alt_model_id, Some("qwen3-4b"));
        assert!(rec.reason.contains("Qwen3") || rec.reason.contains("quality"));
    }

    #[test]
    fn fingerprint_stable_for_same_profile() {
        let a = profile(16, true, Some(8192));
        let b = profile(16, true, Some(8192));
        assert_eq!(a.fingerprint(), b.fingerprint());
        assert_ne!(a.fingerprint(), profile(16, true, None).fingerprint());
    }

    #[test]
    fn switch_prompt_once_per_fingerprint_when_active_diverges() {
        assert!(!hardware_switch_prompt_needed(
            None,
            "phi4-mini",
            "fp1",
            None
        ));
        assert!(!hardware_switch_prompt_needed(
            Some("phi4-mini"),
            "phi4-mini",
            "fp1",
            None
        ));
        assert!(hardware_switch_prompt_needed(
            Some("qwen25-1.5b"),
            "phi4-mini",
            "fp1",
            None
        ));
        assert!(!hardware_switch_prompt_needed(
            Some("qwen25-1.5b"),
            "phi4-mini",
            "fp1",
            Some("fp1")
        ));
        assert!(hardware_switch_prompt_needed(
            Some("qwen25-1.5b"),
            "phi4-mini",
            "fp2",
            Some("fp1")
        ));
    }
}

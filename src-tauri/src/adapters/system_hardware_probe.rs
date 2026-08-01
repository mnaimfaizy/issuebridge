//! System RAM + usable Vulkan (+ VRAM when listed) for Rewrite recommendation.
//!
//! v1 uses Vulkan presence only (not other GPU runtimes). On Windows, VRAM is taken
//! from DXGI dedicated video memory when available; otherwise VRAM is unknown (tier C).

use crate::core::{HardwareProbe, HardwareProfile};

/// Production hardware probe for Inbox Rewrite model pre-select.
#[derive(Debug, Default, Clone, Copy)]
pub struct SystemHardwareProbe;

impl HardwareProbe for SystemHardwareProbe {
    fn probe(&self) -> HardwareProfile {
        let vulkan = vulkan_usable();
        HardwareProfile {
            ram_gb: detect_ram_gb(),
            vulkan_usable: vulkan,
            vram_mb: if vulkan { detect_vram_mb() } else { None },
        }
    }
}

fn detect_ram_gb() -> u64 {
    #[cfg(windows)]
    {
        windows_ram_gb().unwrap_or(8)
    }
    #[cfg(not(windows))]
    {
        unix_ram_gb().unwrap_or(8)
    }
}

fn vulkan_usable() -> bool {
    #[cfg(windows)]
    {
        windows_vulkan_loaded()
    }
    #[cfg(not(windows))]
    {
        [
            "/usr/lib/libvulkan.so.1",
            "/usr/lib/x86_64-linux-gnu/libvulkan.so.1",
            "/usr/lib64/libvulkan.so.1",
            "/lib/x86_64-linux-gnu/libvulkan.so.1",
        ]
        .iter()
        .any(|p| std::path::Path::new(p).exists())
    }
}

fn detect_vram_mb() -> Option<u64> {
    #[cfg(windows)]
    {
        windows_dxgi_max_dedicated_vram_mb()
    }
    #[cfg(not(windows))]
    {
        None
    }
}

#[cfg(windows)]
fn windows_ram_gb() -> Option<u64> {
    use windows::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};

    unsafe {
        let mut status = MEMORYSTATUSEX {
            dwLength: std::mem::size_of::<MEMORYSTATUSEX>() as u32,
            ..Default::default()
        };
        GlobalMemoryStatusEx(&mut status).ok()?;
        Some((status.ullTotalPhys / (1024 * 1024 * 1024)).max(1))
    }
}

#[cfg(windows)]
fn windows_vulkan_loaded() -> bool {
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::FreeLibrary;
    use windows::Win32::System::LibraryLoader::LoadLibraryW;

    let name: Vec<u16> = "vulkan-1.dll"
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    unsafe {
        let Ok(handle) = LoadLibraryW(PCWSTR(name.as_ptr())) else {
            return false;
        };
        let _ = FreeLibrary(handle);
        true
    }
}

#[cfg(windows)]
fn windows_dxgi_max_dedicated_vram_mb() -> Option<u64> {
    use windows::Win32::Graphics::Dxgi::{CreateDXGIFactory, IDXGIFactory};

    unsafe {
        let factory: IDXGIFactory = CreateDXGIFactory().ok()?;
        let mut max_bytes: u64 = 0;
        let mut index = 0u32;
        while index <= 16 {
            let Ok(adapter) = factory.EnumAdapters(index) else {
                break;
            };
            if let Ok(desc) = adapter.GetDesc() {
                let dedicated = desc.DedicatedVideoMemory as u64;
                if dedicated > max_bytes {
                    max_bytes = dedicated;
                }
            }
            index += 1;
        }
        if max_bytes == 0 {
            None
        } else {
            Some(max_bytes / (1024 * 1024))
        }
    }
}

#[cfg(not(windows))]
fn unix_ram_gb() -> Option<u64> {
    let text = std::fs::read_to_string("/proc/meminfo").ok()?;
    for line in text.lines() {
        if let Some(rest) = line.strip_prefix("MemTotal:") {
            let kb: u64 = rest.split_whitespace().next()?.parse().ok()?;
            return Some((kb / (1024 * 1024)).max(1));
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn probe_returns_positive_ram() {
        let profile = SystemHardwareProbe.probe();
        assert!(profile.ram_gb >= 1);
        assert_eq!(profile.fingerprint(), profile.fingerprint());
    }
}

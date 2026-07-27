---
type: research
blocked_by: []
claimed_by: research-windows-installer
claimed_at: 2026-07-27T09:07:00Z
assets:
  - .plan/issuebridge-v0.1/assets/windows-installer-format.md
---

# Windows installer packaging format

## Question

For a Tauri 2 Windows v0.1 public deliverable (unsigned; signing and auto-update out of scope), what installer/bundle formats does Tauri support and which is the recommended default for a tray-first desktop app — MSI, NSIS, or other? Note distribution trade-offs (SmartScreen, per-user vs per-machine, size) that should inform the product choice. Cite primary Tauri/docs sources.

## Answer

**Ship NSIS (`*-setup.exe`) only**, with default **`installMode: "currentUser"`** (no Admin; install under `%LOCALAPPDATA%`). Tauri’s Windows installers are MSI (WiX) or NSIS; there is no first-class portable ZIP bundle target. NSIS fits a tray-first personal app; MSI is the enterprise/WiX path and is Windows-host-only to build.

**Trade-offs:** Unsigned browser downloads get **SmartScreen** for either format — signing (out of scope) is the fix, not MSI vs NSIS. Prefer `targets: ["nsis"]` and keep WebView2 on `downloadBootstrapper` so size stays dominated by the ~142 MiB Whisper model (NSIS default **LZMA** helps). Avoid `perMachine`/`both` unless you want UAC.

Full notes and citations: [.plan/issuebridge-v0.1/assets/windows-installer-format.md](../assets/windows-installer-format.md).

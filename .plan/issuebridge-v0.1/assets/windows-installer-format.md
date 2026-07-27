# Windows installer packaging format (Tauri 2, unsigned v0.1)

Research notes for Issuebridge v0.1 public Windows deliverable. Primary sources only. Signing and auto-update are out of scope for this ticket; Whisper model (~142 MiB) is bundled, so the installer is large either way.

## Recommendation (decision-ready)

**Ship NSIS (`*-setup.exe`) as the sole v0.1 Windows public installer**, with Tauri’s default **`installMode: "currentUser"`** (no Admin UAC; install under `%LOCALAPPDATA%`).

Do **not** make MSI the product default for a tray-first personal app. Keep MSI optional later (enterprise / FIPS / Store-adjacent workflows) if needed — it is not the better default here.

Config shape:

```json
{
  "bundle": {
    "targets": ["nsis"],
    "windows": {
      "nsis": {
        "installMode": "currentUser",
        "compression": "lzma"
      },
      "webviewInstallMode": {
        "type": "downloadBootstrapper",
        "silent": true
      }
    }
  }
}
```

`compression: "lzma"` and `installMode: "currentUser"` are already the documented defaults; listing them makes the product choice explicit. Prefer `targets: ["nsis"]` over `"all"` so CI does not also emit an MSI users might confuse with the supported path.

---

## 1. What Tauri 2 supports on Windows

Tauri’s Windows Installer guide states applications are distributed as either:

| Format | Artifact | Tooling |
| --- | --- | --- |
| **MSI** | `.msi` | WiX Toolset v3 |
| **NSIS** | `-setup.exe` | NSIS |

([Windows Installer](https://v2.tauri.app/distribute/windows-installer/))

Config `BundleType` lists the same two Windows installer kinds: `"msi"` and `"nsis"` (alongside Linux/macOS types). Default `bundle.targets` is `"all"`, which builds every platform-applicable target — on Windows that means **both** MSI and NSIS unless you narrow it ([Configuration → BundleTarget / BundleType](https://v2.tauri.app/reference/config/#bundletype)).

There is **no** first-class portable ZIP / bare-exe Windows *bundle* target in `BundleType`. The release binary still exists under `target/.../release/`, but the documented public installer paths are MSI and NSIS. Microsoft Store distribution still starts from those EXE/MSI installers (Store packaging is a separate guide) ([Microsoft Store](https://v2.tauri.app/distribute/microsoft-store/); [Distribute](https://v2.tauri.app/distribute/)).

**Build host constraint:** `.msi` can **only** be built on Windows (WiX). NSIS can be cross-compiled from Linux/macOS with caveats (`cargo-xwin`); Tauri marks that path as last-resort / less tested ([Windows Installer — Build on Linux and macOS](https://v2.tauri.app/distribute/windows-installer/)).

---

## 2. Why NSIS is the better default for a tray-first app

### Per-user install without elevation (NSIS only, first-class)

NSIS exposes `bundle.windows.nsis.installMode` ([NsisConfig](https://v2.tauri.app/reference/config/#nsisconfig)):

| Mode | Behavior | Admin? |
| --- | --- | --- |
| **`currentUser`** (default) | Install under `%LOCALAPPDATA%`; metadata in `HKCU` | No |
| **`perMachine`** | Install under Program Files; metadata in `HKLM` | Yes |
| **`both`** | User chooses at install time | Yes (even if they pick current user) |

([Windows Installer — Install Modes](https://v2.tauri.app/distribute/windows-installer/); [NSISInstallerMode](https://v2.tauri.app/reference/config/#nsisinstallermode))

A tray-first desktop app is a **personal** install: users expect “download → next → tray icon,” not a UAC prompt into Program Files. **`currentUser` matches that.**

WiX/`WixConfig` has **no** equivalent `installMode` knob in the config reference (banner, fragments, language, upgradeCode, elevated update task, etc. — not per-user vs per-machine) ([WixConfig](https://v2.tauri.app/reference/config/#wixconfig)). MSI remains the enterprise / WiX-customization path; NSIS owns the simple per-user story.

### Cross-compile / CI flexibility

If release CI is not always Windows-native, NSIS is the format Tauri documents as cross-compilable; MSI is not ([Windows Installer](https://v2.tauri.app/distribute/windows-installer/)).

### Compression vs large Whisper payload

NSIS compression defaults to **`lzma`** (“very good compression ratios”) ([NsisCompression](https://v2.tauri.app/reference/config/#nsiscompression)). With a ~142 MiB GGML model already in the bundle, staying on LZMA is the right default; do not set `"none"` for public downloads.

Installer size is still dominated by app + model. WebView2 mode matters at the margins:

| `webviewInstallMode` | Extra size | Notes |
| --- | --- | --- |
| `downloadBootstrapper` (default) | ~0 MB | Needs network if WebView2 missing |
| `embedBootstrapper` | ~1.8 MB | Better Win7 MSI story |
| `offlineInstaller` | ~127 MB | Offline WebView2 install |
| `fixedRuntime` | ~180 MB | Bundled fixed runtime |

([Windows Installer — WebView2 Installation Options](https://v2.tauri.app/distribute/windows-installer/))

For v0.1 on modern Windows, keep **`downloadBootstrapper`** so you do not add another ~127–180 MB on top of Whisper. Offline-first for *PTT* is about the model, not about embedding WebView2.

---

## 3. Distribution trade-offs (unsigned v0.1)

### SmartScreen

Tauri’s signing guide: code signing is required to **prevent a SmartScreen warning** that the app is untrusted when **downloaded from the browser**. Signing is **not** required for the app to run if the user dismisses SmartScreen or did not download via the browser ([Windows Code Signing](https://v2.tauri.app/distribute/sign/windows/)).

**Implication for unsigned v0.1:** expect SmartScreen friction for browser downloads of **either** `.msi` or `-setup.exe`. Choosing NSIS vs MSI does **not** remove that; only signing (out of scope) does. Product copy / GitHub Releases notes should warn users about the “More info → Run anyway” path.

### Per-user vs per-machine

- **NSIS `currentUser`:** no Admin; `%LOCALAPPDATA%\<ProductName>` — preferred for tray app ([Install Modes](https://v2.tauri.app/distribute/windows-installer/)).
- **NSIS `perMachine` / `both`:** Admin UAC; only choose if you explicitly want machine-wide install.
- **MSI:** WiX path without a documented first-class current-user mode in `WixConfig`; better reserved for orgs that demand MSI, not for the default tray download.

### Size

- Payload floor ≈ app + Whisper base (~142 MiB) + resources/sidecars.
- NSIS LZMA reduces download size vs uncompressed; exact ratio depends on content entropy (models compress modestly).
- Avoid `offlineInstaller` / `fixedRuntime` for v0.1 unless offline WebView2 is a hard requirement.
- Building `"all"` produces **two** large artifacts (MSI + NSIS); prefer a single NSIS artifact for the public link.

### Other MSI-specific notes (why not default)

- Windows-only bundling host ([Windows Installer](https://v2.tauri.app/distribute/windows-installer/)).
- Optional VBScript feature needed for WiX `light.exe` on some hosts ([prerequisites note in installer guide / docs source](https://github.com/tauri-apps/tauri-docs/blob/v2/src/content/docs/distribute/windows-installer.mdx)).
- FIPS / elevated update task / WiX fragments are MSI strengths when you need them ([FIPS](https://v2.tauri.app/distribute/windows-installer/); [WixConfig](https://v2.tauri.app/reference/config/#wixconfig)) — not tray-app v0.1 needs.

---

## 4. What not to do for v0.1

1. **Do not** rely on unsigned status being “fixed” by picking MSI over NSIS — SmartScreen is a signing problem ([Windows Code Signing](https://v2.tauri.app/distribute/sign/windows/)).
2. **Do not** default to `perMachine` or `both` for a tray-first consumer install.
3. **Do not** ship `"targets": "all"` as the marketing download if only NSIS is supported in docs/support.
4. **Do not** embed offline/fixed WebView2 unless required — Whisper already owns the size budget.
5. Signing / updater artifacts remain a later milestone (`createUpdaterArtifacts`, certificates, etc.) — out of scope here ([BundleConfig](https://v2.tauri.app/reference/config/#bundleconfig); [Windows Code Signing](https://v2.tauri.app/distribute/sign/windows/)).

---

## Sources (primary)

| Claim area | Source |
| --- | --- |
| MSI vs NSIS formats | [Windows Installer](https://v2.tauri.app/distribute/windows-installer/) |
| Bundle types / default `targets: "all"` | [Configuration → BundleType / BundleTarget](https://v2.tauri.app/reference/config/#bundletype) |
| NSIS install modes + LOCALAPPDATA / Program Files | [Windows Installer — Install Modes](https://v2.tauri.app/distribute/windows-installer/); [NSISInstallerMode](https://v2.tauri.app/reference/config/#nsisinstallermode) |
| NSIS compression default LZMA | [NsisCompression](https://v2.tauri.app/reference/config/#nsiscompression) |
| WebView2 install modes / size table | [Windows Installer — WebView2](https://v2.tauri.app/distribute/windows-installer/) |
| MSI Windows-only; NSIS cross-compile | [Windows Installer](https://v2.tauri.app/distribute/windows-installer/) |
| SmartScreen ↔ code signing | [Windows Code Signing](https://v2.tauri.app/distribute/sign/windows/) |
| Distribute overview / Store pointer | [Distribute](https://v2.tauri.app/distribute/); [Microsoft Store](https://v2.tauri.app/distribute/microsoft-store/) |
| Docs source (VBScript / MSI note) | [tauri-docs `windows-installer.mdx`](https://github.com/tauri-apps/tauri-docs/blob/v2/src/content/docs/distribute/windows-installer.mdx) |
| NSIS bundler default `CurrentUser` | [tauri-bundler `nsis/mod.rs`](https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-bundler/src/bundle/windows/nsis/mod.rs) |

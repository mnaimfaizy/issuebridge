# Issuebridge

Windows-first Tauri app for capturing GitHub issues while testing (hotkey + voice), keeping local Drafts, then publishing them on GitHub.

## Develop

Requires Rust (MSVC), Node.js, and WebView2.

```bash
npm install
npm run tauri dev
```

Core-level tests (application seam with faked ports):

```bash
npm run test:core
```

Packaging contract (NSIS per-user installer + Whisper bundle + release credential rules):

```bash
npm run test:packaging
```

## Release (Windows NSIS)

v0.1 ships a **per-user NSIS** installer (`*-setup.exe`) only — `installMode: currentUser` (no Admin). **MSI is not a v0.1 deliverable.** The installer bundles the app, `whisper-cli` sidecar, and `ggml-base.bin` so offline PTT works after install without a separate model download.

The build is **unsigned** for v0.1. Browser downloads may show a Windows SmartScreen warning; that is expected until code signing is added. Users can proceed via “More info → Run anyway.”

### Official release build (inject credentials; never commit secrets)

Set GitHub App credentials in the environment (or as GitHub Actions secrets with the same names), then:

```powershell
$env:ISSUEBRIDGE_GITHUB_CLIENT_ID = "<client-id>"
$env:ISSUEBRIDGE_GITHUB_CLIENT_SECRET = "<client-secret>"
powershell -ExecutionPolicy Bypass -File scripts/release-build.ps1
```

`scripts/release-build.ps1` checks the packaging contract, refuses to build without both env vars, fetches Whisper assets (unless `-SkipWhisperFetch`), and runs `npm run tauri -- build`. CI: `.github/workflows/release-windows.yml` (tag `v*` or workflow_dispatch).

Dev/`tauri build` without those env vars still works for local packaging; OAuth secret stays unset (`option_env!`) so forks can use PAT or a BYO App.

## Architecture

- `src-tauri/src/core` — Issuebridge application core (use-cases + ports)
- `src-tauri/src/adapters` — Tauri IPC, tray, and stub port adapters
- `src` — webview UI (adapter surface only; no secrets / domain logic)

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

## Architecture

- `src-tauri/src/core` — Issuebridge application core (use-cases + ports)
- `src-tauri/src/adapters` — Tauri IPC, tray, and stub port adapters
- `src` — webview UI (adapter surface only; no secrets / domain logic)

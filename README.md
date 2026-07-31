<p align="center">
  <img src="brand/mark.png" alt="Issuebridge" width="220" />
</p>

<h1 align="center">Issuebridge</h1>

<p align="center">
  Desktop app to Capture GitHub issues while testing—hotkey and voice, local Drafts, then Publish.
</p>

Windows-first Tauri shell (NSIS per-user installer for official Releases).

## Develop

Requires Rust (MSVC), Node.js, and WebView2.

```bash
npm install
npm run tauri dev
```

**Important:** Fully quit the previous Issuebridge process before restarting `tauri dev` (tray icon → Quit, or end the process). A hung sign-in or a frozen Capture window can linger until Quit.

### Sign in with GitHub (required for Install App)

**Sign in with GitHub** (App OAuth + PKCE) is the supported path for first-run. Local `tauri dev` needs the App **client secret** or the browser can succeed while the app still fails the token exchange:

```powershell
$env:ISSUEBRIDGE_GITHUB_CLIENT_SECRET = "<secret from issuebridge-dev App / 1Password>"
# optional; default client id is already set for issuebridge-dev
# $env:ISSUEBRIDGE_GITHUB_CLIENT_ID = "Iv23li6Ao8URyrvbNZOq"
npm run tauri dev
```

Terminal should show `OAuth exchange ok`, then Install App → **Continue**.

**PAT is identity-only.** Fine-grained and classic PATs can sign in (`GET /user`) but **cannot** call `GET /user/installations`. Continue will fail until you use App OAuth. Prefer **Sign in with GitHub**; do not reinstall the App if it is already installed — fix sign-in, then Continue.

Credentials use the OS vault (`keyring` with `windows-native`). After a successful sign-in, an in-process session flag keeps the UI signed in even if a vault re-read is slow.

### Voice / Hold to talk (local)

1. Fetch Whisper assets (CLI + Windows DLLs + `ggml-base.bin`) once:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/fetch-whisper-assets.ps1
```

Fully quit Issuebridge first if Windows reports `ggml-base.bin` is locked.

2. In Capture: click **Title** or **Body** first (transcript goes into the focused field). **Hold** the button or hold `Ctrl+Alt+Shift+V`, speak, then **release** to stop (max ~60s). Button shows **Release to stop**, then **Transcribing…**.

3. Offline Whisper **base** is approximate (English forced via `-l en` by default; override with `ISSUEBRIDGE_WHISPER_LANGUAGE`). Edit the text afterward. Text **Save Draft** always works if voice fails.

Windows needs companion DLLs next to `whisper-cli` (`ggml.dll`, `whisper.dll`, `ggml-cpu-*.dll`, …). The fetch script copies them into `src-tauri/binaries/`; the NSIS bundle maps those DLLs to the install root beside `whisper-cli.exe`. At runtime, spawn sets cwd to the directory that contains the DLLs and passes **absolute** model/audio paths.

### Capture window (Windows)

Creating the Capture webview from a **sync** Tauri command or tray/hotkey handler can deadlock WebView2 and leave a blank white window. The app opens Capture via an **async** command (and a detached thread from tray/hotkey). If you ever see a frozen white Capture, Quit fully and reopen.

### Debugging

In `npm run tauri dev` (debug builds):

1. **DevTools** open on main and Capture windows.
2. **Terminal** shows `[issuebridge]` logs: OAuth, keyring, installations, `whisper: …`.
3. Webview console shows PAT / PTT lines (`target: "title" | "body"`, etc.).

To re-test the first-run progress strip from scratch (Sign out does not rewind it), see [`docs/dev-first-run-reset.md`](docs/dev-first-run-reset.md). Chromium `Chrome_WidgetWin_0` / Error `1412` lines on Quit are usually harmless WebView2 teardown noise — ignore unless Quit hangs or crashes.

```bash
npm run test:core
npm run test:packaging
```

## Release (Windows NSIS)

v0.1 ships a **per-user NSIS** installer (`*-setup.exe`) only — `installMode: currentUser` (no Admin). **MSI is not a v0.1 deliverable.** The installer bundles the app, `whisper-cli` (+ DLLs), and `ggml-base.bin` so offline PTT works after install without a separate model download.

The build is **unsigned** for v0.1. Browser downloads may show a Windows SmartScreen warning; that is expected until code signing is added. Users can proceed via “More info → Run anyway.”

### Official release build (inject credentials; never commit secrets)

```powershell
$env:ISSUEBRIDGE_GITHUB_CLIENT_ID = "<client-id>"
$env:ISSUEBRIDGE_GITHUB_CLIENT_SECRET = "<client-secret>"
powershell -ExecutionPolicy Bypass -File scripts/release-build.ps1
```

`scripts/release-build.ps1` checks the packaging contract, refuses to build without both env vars, fetches Whisper assets (unless `-SkipWhisperFetch`), and runs `npm run tauri -- build`. CI: `.github/workflows/release-windows.yml` (tag `v*` or workflow_dispatch).

Dev/`tauri build` without those env vars still packages; OAuth secret can also be supplied at **runtime** via `ISSUEBRIDGE_GITHUB_CLIENT_SECRET` for local `tauri dev` (compile-time `option_env!` remains for release injection).

## Architecture

- `src-tauri/src/core` — Issuebridge application core (use-cases + ports)
- `src-tauri/src/adapters` — Tauri IPC, tray, and stub port adapters
- `src` — webview UI (adapter surface only; no secrets / domain logic)

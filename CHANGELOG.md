# Changelog

All notable changes to Issuebridge are documented here. Release notes are user-facing; see git history for full commit detail.

## [0.2.1] - 2026-08-10

### Security
- Official Windows Releases no longer embed the GitHub App client secret in the installer. Sign in with GitHub exchanges tokens via a maintained OAuth exchange service.

## [0.2.0] - 2026-08-06

### Added
- Rewrite in Inbox: propose a clearer Draft title and body, then Accept or Discard
- Real Rewrite Generate via a bundled llama.cpp sidecar (Windows-hardened)
- Rewrite model catalog with download lifecycle
- Hardware-tier recommendations for Rewrite models
- Rewrite model settings section
- Localized timestamps for Drafts

### Fixed
- Hardened llama.cpp Rewrite Generate on Windows
- Publish: clearer GitHub failure logging and surface invalid credentials to the user
- Backdrop click no longer closes the Rewrite dialog or confirm dialogs

## [0.2.0-rc.2] - 2026-08-03

### Fixed
- Publish: clearer GitHub failure logging and surface invalid credentials to the user

## [0.2.0-rc.1] - 2026-08-01

### Added
- Rewrite in Inbox: propose a clearer Draft title and body, then Accept or Discard
- Real Rewrite Generate via a bundled llama.cpp sidecar (Windows-hardened)
- Rewrite model catalog with download lifecycle
- Hardware-tier recommendations for Rewrite models
- Rewrite model settings section

### Fixed
- Hardened llama.cpp Rewrite Generate on Windows

## [0.1.1] - 2026-07-31

### Fixed
- Voice Capture (hold-to-talk) on installed Windows builds: Whisper DLLs are installed next to whisper-cli so transcription can find them (#55)
- No console window flash when Whisper runs after releasing the mic

## [0.1.0] - 2026-07-30

### Added
- GitHub sign-in (App OAuth + PKCE) with PAT identity fallback
- First-run Install App and Testing set, with configurable Testing set max in Settings
- Fluent main-window shell with Inbox Draft workbench, Settings, and Help
- First-run as a Fluent progress strip; Inbox chrome gated until ready
- Capture popup for text and voice-first Drafts (offline Whisper hold-to-talk)
- Publish Drafts to GitHub with Local link; update linked issues and resolve conflicts via a must-choose Conflict dialog
- Label catalog sync for Draft editing
- Tray-first completion and Try capture on first run
- Per-user Windows NSIS installer bundling the app, Whisper CLI, and base model
- Issuebridge logo across the app, README, and repo

### Fixed
- Hardened first-run auth, Capture window behavior, and Whisper PTT after QA
- Status MessageBars wrap instead of scrolling sideways

### Changed
- NSIS installer attaches to GitHub Releases automatically on version tags

## [0.1.0-rc.1] - 2026-07-28

### Added
- GitHub sign-in (App OAuth + PKCE) with PAT identity fallback
- First-run Install App and Testing set (up to three repos)
- Capture popup for text Drafts, plus Inbox list and editor
- Publish Drafts to GitHub with Local link; update linked issues and resolve conflicts
- Hold-to-talk Capture (offline Whisper) with failure UX that still allows saving Drafts
- Tray-first completion and Try capture on first run
- Per-user Windows NSIS installer bundling the app, Whisper CLI, and base model

### Fixed
- Hardened first-run auth, Capture window behavior, and Whisper PTT after QA

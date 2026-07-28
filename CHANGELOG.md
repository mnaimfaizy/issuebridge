# Changelog

All notable changes to Issuebridge are documented here. Release notes are user-facing; see git history for full commit detail.

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

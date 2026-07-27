# 01 — Tauri shell + application core seam

**What to build:** A Windows Tauri app that boots with a tray and a main window, and an Issuebridge application core behind faked ports that can be exercised by at least one core-level test — so later slices plug into a proven seam instead of inventing structure ad hoc.

**Blocked by:** None — can start immediately.

**Status:** done

- [x] App launches on Windows with tray present and a main window that can be shown/hidden.
- [x] Issuebridge application core module exists with injectable ports (at least stubs/fakes for GitHub, TokenStore, DraftStore, VoiceTranscriber, clock as needed).
- [x] At least one core-level test asserts observable behavior through that seam (not UI internals).
- [x] UI/Tauri IPC are clearly adapters outside the core (no raw secrets or domain logic trapped only in the webview).

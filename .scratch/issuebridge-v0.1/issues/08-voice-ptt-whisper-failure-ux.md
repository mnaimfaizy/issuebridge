# 08 — Voice PTT (Whisper sidecar) + failure UX

**What to build:** In Capture, push-to-talk (separate hotkey) records offline speech through a bundled `whisper-cli` sidecar and `ggml-base.bin` model into the focused Draft field (Title or Body). Mic/sidecar/empty-transcript failures show friendly inline messages near PTT after an attempt; text Save always remains available.

**Blocked by:** 04 — Capture text Draft + Inbox list

**Status:** implemented

- [x] PTT hotkey default `Ctrl+Alt+Shift+V` (configurable, distinct from Open) drives voice capture in the Capture popup.
- [x] Offline transcription uses bundled Whisper `base` (`ggml-base.bin` as a resource) and `whisper-cli` as a Tauri sidecar — works without a first-run model download.
- [x] Successful transcript appends into the **focused** Capture field (Title or Body); hold/release UX with timer (max ~60s).
- [x] Failure messages appear only after a PTT attempt; inline near PTT; PTT stays enabled for retry; text fields and Save never blocked.
- [x] Distinct friendly intents: permission denied, no device, sidecar crash/timeout (shared), empty transcript (soft, not “error”).
- [x] Messages clear on next PTT or when Capture closes (not on typing; no timer; no dismiss × required).
- [x] Core-level tests cover voice success and each failure kind with a fake VoiceTranscriber; text Save still succeeds when voice fails.

### QA notes (local Windows)

- Run `scripts/fetch-whisper-assets.ps1` before PTT or release packaging. It must copy **DLLs** (`ggml.dll`, `whisper.dll`, `ggml-cpu-*.dll`, …) next to the CLI — exe alone exits with missing-DLL (`0xC0000135`).
- Pass **absolute** `-m` / `-f` paths: spawn uses the binaries directory as cwd for DLL loading; relative `resources/models/ggml-base.bin` fails to open.
- Prefer PCM → WAV in the webview (avoid MediaRecorder WebM + `decodeAudioData`); WebM decode often fails on the second take (`EncodingError`).
- Default language `-l en` (override `ISSUEBRIDGE_WHISPER_LANGUAGE`). Multilingual `base` without a language hint is weaker; still edit after — larger models are out of v0.1 scope.
- Click Title or Body before holding PTT so the snapshot target is correct (the PTT button steals focus).

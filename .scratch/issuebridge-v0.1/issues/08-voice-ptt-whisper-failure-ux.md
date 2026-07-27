# 08 — Voice PTT (Whisper sidecar) + failure UX

**What to build:** In Capture, push-to-talk (separate hotkey) records offline speech through a bundled `whisper-cli` sidecar and `ggml-base.bin` model into the Draft body. Mic/sidecar/empty-transcript failures show friendly inline messages near PTT after an attempt; text Save always remains available.

**Blocked by:** 04 — Capture text Draft + Inbox list

**Status:** ready-for-agent

- [ ] PTT hotkey default `Ctrl+Alt+Shift+V` (configurable, distinct from Open) drives voice capture in the Capture popup.
- [ ] Offline transcription uses bundled Whisper `base` (`ggml-base.bin` as a resource) and `whisper-cli` as a Tauri sidecar — works without a first-run model download.
- [ ] Successful transcript lands in the body per product rules for Capture.
- [ ] Failure messages appear only after a PTT attempt; inline near PTT; PTT stays enabled for retry; text fields and Save never blocked.
- [ ] Distinct friendly intents: permission denied, no device, sidecar crash/timeout (shared), empty transcript (soft, not “error”).
- [ ] Messages clear on next PTT or when Capture closes (not on typing; no timer; no dismiss × required).
- [ ] Core-level tests cover voice success and each failure kind with a fake VoiceTranscriber; text Save still succeeds when voice fails.

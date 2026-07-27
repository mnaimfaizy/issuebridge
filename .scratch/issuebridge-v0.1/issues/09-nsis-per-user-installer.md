# 09 — NSIS per-user release installer

**What to build:** A shippable per-user NSIS `*-setup.exe` that installs Issuebridge under the current user (no Admin), including the Whisper sidecar and base model resources, with release builds able to inject GitHub App credentials without committing secrets.

**Blocked by:** 01 — Tauri shell + application core seam; 08 — Voice PTT (Whisper sidecar) + failure UX

**Status:** ready-for-agent

- [ ] Release packaging targets NSIS only (`*-setup.exe`) with `installMode: currentUser`.
- [ ] Installer bundles app + `whisper-cli` sidecar + `ggml-base.bin` so offline PTT works after install without a separate model download.
- [ ] Official release build path can inject `client_id` + `client_secret` (env/CI); secrets are not committed to the repo.
- [ ] Documented/verified that MSI is not a v0.1 deliverable; unsigned SmartScreen behavior is accepted for this slice.

---
type: research
blocked_by: []
claimed_by: research-whisper-sidecar
claimed_at: 2026-07-27T08:09:07Z
assets:
  - .plan/issuebridge-v0.1/assets/whisper-sidecar-packaging.md
---

# whisper.cpp sidecar + base model packaging on Windows

## Question

How should a Tauri 2 Windows x64 app bundle whisper.cpp as a sidecar/binary and ship or place a Whisper **base** model so push-to-talk works offline on first run? Cover sidecar patterns from Tauri docs, model file location (installer vs app data), version pinning/checksum expectations, and rough size implications for v0.1. Cite primary docs and upstream whisper.cpp packaging guidance where available.

## Answer

Ship **`whisper-cli` as a Tauri sidecar** (`bundle.externalBin: ["binaries/whisper-cli"]` → `whisper-cli-x86_64-pc-windows-msvc.exe`) and ship **`ggml-base.bin` as a Tauri resource** in the installer (`bundle.resources`), then resolve it with `BaseDirectory::Resource` and pass `-m <absolute-path>` to the sidecar. That is the only layout that satisfies offline PTT on first run; first-run Hugging Face download does not.

Pin whisper.cpp to a release tag (start at **v1.9.1**), verify the model against upstream’s published SHA for `base` (**142 MiB**, `465707469ff3a37a2b9b8d8f89f2f99de7299dac`), and expect roughly **~150–180 MiB** installer delta (model dominates). Do not put the model in AppData as the primary store for v0.1; keep AppLocalData for drafts/temp WAV only. Optional later: copy resource → AppLocalData if you need an updatable model tree.

Full notes and citations: [.plan/issuebridge-v0.1/assets/whisper-sidecar-packaging.md](../assets/whisper-sidecar-packaging.md).

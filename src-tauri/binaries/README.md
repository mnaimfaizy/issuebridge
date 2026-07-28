# Whisper sidecar (`whisper-cli`)

Tauri `bundle.externalBin` expects:

`whisper-cli-x86_64-pc-windows-msvc.exe`

Windows also needs companion DLLs next to that binary (or on `PATH`):

- `ggml.dll`, `ggml-base.dll`, `whisper.dll`
- `ggml-cpu-*.dll` (CPU backends)

Fetch a real binary + DLLs + model (whisper.cpp **v1.9.1**) before packaging or local PTT:

```powershell
pwsh ../scripts/fetch-whisper-assets.ps1
```

Or set `ISSUEBRIDGE_WHISPER_CLI` / `ISSUEBRIDGE_WHISPER_MODEL` to absolute paths for local overrides.

**Do not commit** the large fetched `.dll` / model blobs — they are gitignored; CI and `release-build.ps1` run the fetch script. Fully quit Issuebridge before re-fetching if `ggml-base.bin` is locked.

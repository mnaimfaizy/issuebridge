# Whisper + llama.cpp sidecars

Tauri `bundle.externalBin` expects:

- `whisper-cli-x86_64-pc-windows-msvc.exe`
- `llama-cli-x86_64-pc-windows-msvc.exe`

## Whisper (PTT)

Windows also needs companion DLLs next to that binary (exe directory or cwd — ggml CPU backends are not found via `PATH` alone):

- `ggml.dll`, `ggml-base.dll`, `whisper.dll`
- `ggml-cpu-*.dll` (CPU backends)

```powershell
pwsh ../scripts/fetch-whisper-assets.ps1
```

Or set `ISSUEBRIDGE_WHISPER_CLI` / `ISSUEBRIDGE_WHISPER_MODEL` to absolute paths for local overrides.

## llama.cpp Rewrite (Generate)

CPU + **Vulkan** Windows build (not CUDA/HIP). Companion DLLs colocated like Whisper:

- `llama.dll`, `llama-common.dll`, `llama-cli-impl.dll`, `llama-server-impl.dll`, `mtmd.dll`
- `ggml.dll`, `ggml-base.dll`, `ggml-cpu-*.dll`, `ggml-vulkan.dll`
- `libomp140.x86_64.dll`

(`llama-cli` is a tiny stub; without `llama-server-impl.dll` / `mtmd.dll` Windows exits with `STATUS_DLL_NOT_FOUND` / `-1073741515`.)

```powershell
pwsh ../scripts/fetch-llama-assets.ps1
```

**GGUF models are not fetched or committed** — they download on demand from Inbox **Rewrite…** (app-data `models/`). Optional `ISSUEBRIDGE_REWRITE_GGUF` / `ISSUEBRIDGE_REWRITE_CLI` override for local/dev. NSIS must not bundle `.gguf` files.

Release packaging maps `binaries/*.dll` to the install root so DLLs sit beside both sidecars (see #55 / #68). Fully quit Issuebridge before re-fetching if DLLs are locked.

**Do not commit** the large fetched `.dll` / model blobs — they are gitignored; CI and `release-build.ps1` run the fetch scripts.

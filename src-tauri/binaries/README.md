# Whisper sidecar (`whisper-cli`)

Tauri `bundle.externalBin` expects:

`whisper-cli-x86_64-pc-windows-msvc.exe`

Fetch a real binary (whisper.cpp **v1.9.1**) before release packaging:

```powershell
pwsh ../scripts/fetch-whisper-assets.ps1
```

Or set `ISSUEBRIDGE_WHISPER_CLI` to an absolute path for local dev.

The placeholder `.exe` in this folder exists so `tauri build` can resolve `externalBin`; replace it with a real `whisper-cli` for offline PTT.

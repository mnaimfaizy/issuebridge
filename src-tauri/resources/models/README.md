# Whisper `base` model

Ship `ggml-base.bin` (Whisper **base**, ~142 MiB) as a Tauri resource so PTT works offline on first run.

Upstream identity (whisper.cpp models table):

- File: `ggml-base.bin`
- SHA: `465707469ff3a37a2b9b8d8f89f2f99de7299dac`

```powershell
pwsh ../../scripts/fetch-whisper-assets.ps1
```

Or set `ISSUEBRIDGE_WHISPER_MODEL` to an absolute path for local dev.

The placeholder `ggml-base.bin` keeps the resource path valid for bundling; replace it with the verified upstream model before release.

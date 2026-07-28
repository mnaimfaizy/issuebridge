# Whisper `base` model

Ship `ggml-base.bin` (Whisper **base**, ~142 MiB) as a Tauri resource so PTT works offline on first run.

Upstream identity (whisper.cpp models table):

- File: `ggml-base.bin`
- SHA: `465707469ff3a37a2b9b8d8f89f2f99de7299dac`

```powershell
pwsh ../../scripts/fetch-whisper-assets.ps1
```

Or set `ISSUEBRIDGE_WHISPER_MODEL` to an absolute path for local dev.

The fetched model is **gitignored** (large). A tiny placeholder may exist for path validity; replace it via the fetch script before PTT or release. Runtime passes an **absolute** model path into `whisper-cli` (cwd is the binaries dir for DLL loading).

Default language hint is English (`-l en`); override with `ISSUEBRIDGE_WHISPER_LANGUAGE`.

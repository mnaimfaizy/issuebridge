# whisper.cpp sidecar + base model packaging (Windows x64, Tauri 2)

Research notes for Issuebridge v0.1 offline push-to-talk. Primary sources only.

## Recommendation (decision-ready)

For Windows x64 v0.1:

1. **Ship `whisper-cli` as a Tauri sidecar** via `bundle.externalBin`, named with the Windows target triple.
2. **Ship the Whisper `base` GGML model in the installer** via `bundle.resources` so PTT works offline on first run (no first-run download).
3. **At runtime**, resolve the model path with Tauri’s Resource base directory and pass it to the sidecar as `-m <absolute-path>`.
4. **Pin** whisper.cpp to a release tag for the binary build, and **verify** the model against the upstream SHA table (and optionally a full SHA-256 recorded in CI).

Do **not** treat the model as a sidecar (sidecars are executables). Do **not** rely on first-run Hugging Face download if offline-first is a hard gate.

---

## 1. Sidecar pattern (Tauri 2)

### Config

Tauri embeds external executables through `tauri.conf.json` → `bundle.externalBin` ([Embedding External Binaries](https://v2.tauri.app/develop/sidecar/)):

```json
{
  "bundle": {
    "externalBin": ["binaries/whisper-cli"]
  }
}
```

For each target, a file with a `-$TARGET_TRIPLE` suffix must exist at that path. Config reference spells the Windows pattern explicitly ([Configuration → externalBin](https://v2.tauri.app/reference/config/#externalbin)):

| Platform | Filename |
| --- | --- |
| Windows x64 | `whisper-cli-x86_64-pc-windows-msvc.exe` |
| macOS Intel | `whisper-cli-x86_64-apple-darwin` |
| Linux x64 | `whisper-cli-x86_64-unknown-linux-gnu` |

Place the Windows binary at:

`src-tauri/binaries/whisper-cli-x86_64-pc-windows-msvc.exe`

Discover the host triple with `rustc --print host-tuple` (docs also show a rename script that appends the triple and `.exe` on Windows) ([sidecar docs](https://v2.tauri.app/develop/sidecar/)).

### Permissions + invoke

Grant shell execute/spawn for the sidecar in capabilities (`shell:allow-execute` / spawn with `"sidecar": true` and `"name": "binaries/whisper-cli"`). Prefer an **args allowlist** (static flags + validators for paths) rather than open-ended args ([sidecar docs — Passing arguments](https://v2.tauri.app/develop/sidecar/)).

Invoke from Rust via `app.shell().sidecar("whisper-cli")` (`tauri_plugin_shell::ShellExt`) or from JS via `Command.sidecar('binaries/whisper-cli', [...])` ([same page](https://v2.tauri.app/develop/sidecar/); [Node.js sidecar tutorial](https://v2.tauri.app/learn/sidecar-nodejs/) confirms the CLI renames/bundles `my-sidecar-<triple>` when `externalBin` lists the stem).

### What binary to ship

Upstream whisper.cpp’s supported CLI is **`whisper-cli`** (built from `examples/cli`):

```bash
cmake -B build
cmake --build build -j --config Release
./build/bin/whisper-cli -f samples/jfk.wav
```

([whisper.cpp README — Quick start](https://github.com/ggml-org/whisper.cpp/blob/master/README.md))

Windows is a first-class supported platform (MSVC and MinGW) ([README — Supported platforms](https://github.com/ggml-org/whisper.cpp/blob/master/README.md)). Stable release at research time: **v1.9.1** (2026-06-19), which publishes Windows x64 zip assets such as `whisper-bin-x64.zip` (~7.6 MB download) and `whisper-blas-bin-x64.zip` (~19.8 MB) ([v1.9.1 release](https://github.com/ggml-org/whisper.cpp/releases/tag/v1.9.1)).

**v0.1 pinning approach:** pin CI to tag `v1.9.1` (or a later chosen tag) and either (a) build `whisper-cli` with MSVC Release in CI, or (b) extract `whisper-cli.exe` from the matching official Windows asset and rename to the Tauri triple form. Prefer a **self-built, checksummed** artifact in your own release pipeline so the sidecar is reproducible even if GitHub release assets change.

Note: `whisper-cli` currently expects **16-bit WAV** input ([README](https://github.com/ggml-org/whisper.cpp/blob/master/README.md)); the app must convert mic capture to that format before invoking the sidecar (implementation detail, not packaging).

---

## 2. Model file: ship in installer (not app-data download)

### Offline-first constraint

Product gate: PTT must work **offline on first run**. Upstream model acquisition is a **download** of a pre-converted `ggml-*.bin` from Hugging Face (`https://huggingface.co/ggerganov/whisper.cpp`) via `models/download-ggml-model.sh` / `.cmd` ([models/README.md](https://github.com/ggml-org/whisper.cpp/blob/master/models/README.md); [download-ggml-model.sh](https://raw.githubusercontent.com/ggml-org/whisper.cpp/master/models/download-ggml-model.sh)). That path requires network and is therefore **not** acceptable as the sole first-run strategy.

### Bundle as Tauri resources

Tauri’s mechanism for non-frontend files (including large ones) is `bundle.resources` ([Embedding Additional Files](https://v2.tauri.app/develop/resources/)):

```json
{
  "bundle": {
    "resources": [
      "resources/models/ggml-base.bin"
    ]
  }
}
```

Bundled files land under `$RESOURCE/` with structure preserved. Resolve at runtime:

```rust
let model = app.path().resolve("resources/models/ggml-base.bin", BaseDirectory::Resource)?;
```

(JS: `resolveResource(...)` — [resources docs](https://v2.tauri.app/develop/resources/); [path API](https://v2.tauri.app/reference/javascript/api/namespacepath/)).

**Windows resource location:** `resourceDir()` resolves to **the directory that contains the main executable** ([path → resourceDir](https://v2.tauri.app/reference/javascript/api/namespacepath/)). So the model is installed next to the app binary by the NSIS/MSI layout Tauri produces — installer-shipped, available immediately.

Pass that absolute path to the sidecar:

```text
whisper-cli -m <resource>/resources/models/ggml-base.bin -f <temp.wav> ...
```

(Usage pattern from [models/README.md](https://github.com/ggml-org/whisper.cpp/blob/master/models/README.md): `whisper-cli -m models/ggml-base.en.bin -f samples/jfk.wav`.)

### Why not AppData as the primary location

| Approach | Offline first run? | Notes |
| --- | --- | --- |
| **`$RESOURCE` (installer)** | Yes | Matches Tauri resources API; no copy step. Preferred for v0.1. |
| **Download to AppData/LocalData on first run** | No (needs network) | Conflicts with offline gate. |
| **Installer → copy once into AppLocalData** | Yes | Optional later if you need a writable/updatable model tree; doubles disk (~142 MiB) and adds first-launch I/O. Not required for v0.1. |

`appLocalDataDir` / `appDataDir` remain useful for drafts, settings, and temp WAV files ([path API](https://v2.tauri.app/reference/javascript/api/namespacepath/)), but the **canonical model for v0.1 should be the bundled resource**.

---

## 3. Version pinning and checksums

### Model identity

Upstream documents Whisper **`base`** as:

| Field | Value | Source |
| --- | --- | --- |
| File | `ggml-base.bin` | [models/README.md](https://github.com/ggml-org/whisper.cpp/blob/master/models/README.md) |
| Disk | **142 MiB** | same |
| SHA | `465707469ff3a37a2b9b8d8f89f2f99de7299dac` | same; mirrored on [Hugging Face model card](https://huggingface.co/ggerganov/whisper.cpp) |

Multilingual `base` (not `base.en`) matches the locked product choice “Whisper base”.

### Sidecar identity

Pin whisper.cpp to a **git tag** (recommend starting at **v1.9.1** — current Stable in upstream README) and record:

- tag / commit SHA used to build `whisper-cli`
- SHA-256 of the final `whisper-cli-x86_64-pc-windows-msvc.exe` artifact your CI produces

### Checksum expectations

- Upstream `download-ggml-model.sh` **downloads but does not verify** the SHA table after fetch ([script source](https://raw.githubusercontent.com/ggml-org/whisper.cpp/master/models/download-ggml-model.sh)). Issuebridge CI/release packaging **should** verify the published SHA (and ideally a full SHA-256 of the bytes you ship) before embedding the file in `resources/`.
- Treat the 40-hex SHA in the models table as the **upstream-published integrity id** for that model revision; re-check it whenever you bump the model file.
- Do not commit multi-hundred-MB model blobs to git history if avoidable: fetch + verify in CI, then inject into the Tauri resource tree for the bundle step.

---

## 4. Rough size implications for v0.1

| Component | Rough size | Source |
| --- | --- | --- |
| `ggml-base.bin` | **~142 MiB** | [models/README.md](https://github.com/ggml-org/whisper.cpp/blob/master/models/README.md) |
| Windows `whisper-cli` (+ deps) | ~tens of MB unpacked; official `whisper-bin-x64.zip` **~7.6 MB** compressed, BLAS variant **~19.8 MB** | [v1.9.1 assets](https://github.com/ggml-org/whisper.cpp/releases/tag/v1.9.1) |
| **Installer delta for voice** | **~150–180 MiB** class | Model dominates |

Accept this installer weight for v0.1; quantized `base-q5_1` (57 MiB) or `base-q8_0` (78 MiB) exist upstream ([HF README](https://huggingface.co/ggerganov/whisper.cpp)) but would be a **product change** away from locked “base”, not a packaging tweak.

---

## 5. Concrete v0.1 layout sketch

```text
src-tauri/
  binaries/
    whisper-cli-x86_64-pc-windows-msvc.exe   # pinned whisper.cpp build
  resources/
    models/
      ggml-base.bin                          # verified SHA, 142 MiB
  tauri.conf.json
    bundle.externalBin: ["binaries/whisper-cli"]
    bundle.resources: ["resources/models/ggml-base.bin"]
  capabilities/
    … shell:allow-execute for binaries/whisper-cli (sidecar: true, args constrained)
```

Runtime: resolve resource path → write PTT WAV under temp/AppLocalData → `sidecar("whisper-cli").args(["-m", modelPath, "-f", wavPath, …])` → read transcript from stdout.

---

## Sources

1. [Tauri 2 — Embedding External Binaries](https://v2.tauri.app/develop/sidecar/)
2. [Tauri 2 — Configuration (`externalBin`)](https://v2.tauri.app/reference/config/#externalbin)
3. [Tauri 2 — Embedding Additional Files (resources)](https://v2.tauri.app/develop/resources/)
4. [Tauri 2 — path API (`resourceDir`, `appDataDir`, `resolveResource`)](https://v2.tauri.app/reference/javascript/api/namespacepath/)
5. [Tauri 2 — Node.js as a sidecar (rename + externalBin walkthrough)](https://v2.tauri.app/learn/sidecar-nodejs/)
6. [ggml-org/whisper.cpp README](https://github.com/ggml-org/whisper.cpp/blob/master/README.md)
7. [ggml-org/whisper.cpp models/README.md](https://github.com/ggml-org/whisper.cpp/blob/master/models/README.md)
8. [download-ggml-model.sh](https://raw.githubusercontent.com/ggml-org/whisper.cpp/master/models/download-ggml-model.sh)
9. [whisper.cpp v1.9.1 release](https://github.com/ggml-org/whisper.cpp/releases/tag/v1.9.1)
10. [Hugging Face ggerganov/whisper.cpp model card](https://huggingface.co/ggerganov/whisper.cpp)

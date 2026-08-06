# Issuebridge threat model (security-audit)

Desktop **Windows-first** Tauri app: Capture → local **Drafts** → **Publish** to GitHub. Attackers are usually **local malware/user**, **malicious repo/issue content**, or **stolen OAuth tokens** — not a classic internet-facing web server.

## Assets

| Asset | Where it tends to live |
|-------|-------------------------|
| GitHub user OAuth tokens / refresh material | OS keyring via adapters (`keyring_token_store`, OAuth loopback) |
| GitHub App client credentials | Release/CI env only — must not appear in tracked source |
| Draft title/body/labels (may be sensitive) | Local draft store files |
| Label catalog / settings / rewrite models | Local file stores under app data |
| Sidecar binaries (Whisper, llama.cpp) + model weights | Bundled/fetched paths; process spawn args |
| Testing set / installed-repo metadata | Settings / GitHub API responses |

## Trust boundaries

1. **Webview UI (`src/`) → Tauri commands (`adapters/commands.rs`)** — every `#[tauri::command]` is a privilege gate; assume the frontend can be coerced (XSS, compromised extension, malicious HTML in rendered Markdown if ever rendered unsafely).
2. **App → OS keyring / filesystem** — path construction and file IO must not follow untrusted relative segments.
3. **App → GitHub HTTPS** — tokens in headers; error/log paths must not leak secrets; scope/installation boundaries matter for Publish.
4. **App → sidecars** — argv and working directories must be controlled; no shell concatenation of Draft/user strings.
5. **OAuth loopback** — PKCE + state; bind localhost carefully; code exchange must not log verifier/code.

## High-value hunt areas (code)

- `src-tauri/src/adapters/commands.rs` — IPC surface; authz assumptions
- `src-tauri/src/adapters/oauth_loopback.rs`, `keyring_token_store.rs`, `github_http.rs`
- `src-tauri/src/adapters/file_*_store.rs` — path join, symlink, traversal
- `src-tauri/src/adapters/whisper_voice.rs`, `llama_rewrite.rs` — spawn, paths, env
- Frontend paths that render untrusted Markdown/HTML or pass strings into `invoke`
- `.github/workflows/*` — secret handling, `pull_request_target`, injectable `run:` blocks
- Release / packaging config — credential injection assumptions

## Common false positives (discard unless concrete)

- “App can read its own Drafts” (by design)
- Missing web rate limits on localhost UI
- Generic “Tauri is dangerous” without a command/data flow
- Dependency advisories with no reachable feature in this app
- Theoretical side channels without an Issuebridge trigger

## Attacker sketches (use when rating)

- **Local unprivileged process** on the same Windows user session
- **Malicious Draft / issue body** content processed or rendered by the app
- **CSRF-ish OAuth** if redirect/state/PKCE weakened
- **Stolen laptop** unlocked session (keyring unlock semantics — only if code makes it worse than OS default)

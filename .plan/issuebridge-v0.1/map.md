## Destination

Every product and auth decision needed to write a buildable **v0.1 first-public-release** plan is locked — text + voice + local drafts + publish/edit/labels — so we can hand off to `/to-spec` → `/to-tickets` → `/implement`. This map produces **decisions**, not the scaffold or the app.

## Notes

- **Domain:** Issuebridge — capture-first GitHub issue inbox (see root `CONTEXT.md`).
- **Skills:** `/grilling`, `/domain-modeling`, `/research`; after the map clears → `/to-spec` (do not skip straight to `/implement`).
- **Tracker:** local-markdown under `.plan/issuebridge-v0.1/` (no remote issue tracker wired yet).
- **Standing decisions (locked in charting):**
  - Voice (Whisper `base` + PTT) is a **hard v0.1 public gate**; text-only is an internal milestone only.
  - Primary auth: maintainer **GitHub App + Authorization Code + PKCE** with fixed loopback `http://127.0.0.1:17863/oauth/callback`; **PAT fallback**; **no Device Flow in v0.1** (custom scheme deferred).
  - App credentials: never commit; official releases inject `client_id` + `client_secret` via CI; forks/dev use PAT or BYO App; shipped secret treated as extractable. Maintainer App: [issuebridge-dev](https://github.com/settings/apps/issuebridge-dev); client ID `Iv23li6Ao8URyrvbNZOq`; secret in 1Password.
  - Tokens: Rust **`keyring`** (`v1`) → OS vault only; webview never receives raw access/refresh tokens.
  - Sign-in required before capture; every Draft targets exactly one repo; testing set ≤3 + last-used + typeahead beyond the set.
  - Guide users to GitHub App install on **selected repositories** only.
  - “Created by this app” = **local link only** (no GitHub label/footer rediscovery in v0.1).
  - Capture popup: Save draft only (repo + title + body + PTT); Publish, labels, conflict UX in main Inbox/editor.
  - Conflict: Keep mine / Use theirs only (both sync); modal must-choose; no leave-dirty Cancel; View on GitHub allowed.
  - Tray-first on Windows; open hotkey separate from PTT.
  - Defaults: Open `Ctrl+Alt+Shift+I`, PTT `Ctrl+Alt+Shift+V` (configurable).
  - Empty title allowed on Save (show Untitled); Publish requires a title; no auto-title in v0.1.
  - First-run: linear Sign-in → Install → Testing set (required) → optional Try capture; open main window until complete; one-shot; no wizard replay in v0.1.
  - Repo root: `D:\Projects\issuebridge`.
  - Build order: Scaffold → Auth/repos/testing set → Drafts/capture (text) → Publish/edit/labels/conflict → Voice.
- **Handoff superseded on auth:** Device Flow primary / “never ship client secret” is replaced by PKCE-first (see above). Source notes: `C:\Users\mnaim\AppData\Local\Temp\issuebridge-handoff.md`.

## Decisions so far

<!-- the index — one line per closed ticket -->

- [whisper.cpp sidecar + base model packaging on Windows](./tickets/03-whisper-sidecar-packaging.md) — Sidecar `whisper-cli` + installer-bundled `ggml-base.bin` via Tauri resources (~142 MiB); no first-run download; pin tag + verify SHA.
- [PKCE callback strategy for Tauri 2 on Windows](./tickets/01-pkce-callback-for-tauri.md) — Fixed loopback `http://127.0.0.1:17863/oauth/callback` + PKCE S256; ship extractable `client_secret`; defer custom scheme.
- [OS keychain token storage from Tauri 2 / Rust](./tickets/02-keychain-token-storage.md) — Rust `keyring` (`v1`) in OS vault (Windows Credential Manager now; macOS/Linux later); never return raw tokens to the webview; skip Stronghold and secret-returning JS plugins. Notes: [assets/keychain-token-storage.md](./assets/keychain-token-storage.md).
- [Register the maintainer GitHub App](./tickets/04-register-github-app.md) — App `issuebridge-dev` live; client ID `Iv23li6Ao8URyrvbNZOq`; secret in 1Password; callback must stay `http://127.0.0.1:17863/oauth/callback`.
- [Draft persistence fields for v0.1](./tickets/05-draft-persistence-shape.md) — Unlinked vs linked + derived dirty; always id/repo/title/body/label-names/local timestamps; link = number+URL; snapshot = title/body/labels/`updated_at`; conflict via `updated_at` only (no ETag).
- [Windows installer packaging format](./tickets/10-windows-installer-format.md) — NSIS `*-setup.exe` only, `installMode: currentUser`; not MSI; SmartScreen unchanged without signing. Notes: [assets/windows-installer-format.md](./assets/windows-installer-format.md).
- [Conflict UI copy and body-diff](./tickets/06-conflict-ui-copy.md) — Choices only; Keep mine / Use theirs (both restore sync); modal must-choose; no Cancel-as-leave-dirty; View on GitHub link; copy intent locked.
- [Main Inbox information architecture](./tickets/07-inbox-information-architecture.md) — Flat list by local `updated_at` desc; title+repo+linked/dirty cues; comfortable two-line rows; simple empty state; no filters/segments/sorts/density toggle.
- [First-run onboarding flow](./tickets/08-first-run-onboarding.md) — Linear Sign-in → Install (selected repos; API Continue; All-repos soft warn; zero repos stay) → Testing set (≥1–≤3 App-visible) → optional real Try capture; main window while incomplete; one-shot flag; no replay; PAT secondary on sign-in.
- [Mic and Whisper failure UX](./tickets/09-mic-whisper-failure-ux.md) — Text always available; voice errors only after PTT; friendly inline near PTT (PTT stays enabled); distinct intents for permission / no device / sidecar / empty transcript; clear on next PTT or popup close.

## Not yet specified

<!-- fog cleared — map complete; hand off to /to-spec -->

## Out of scope

- Local polish LLM (post–v0.1).
- macOS/Linux as v0.1 release targets (keep buildable later; don’t gate v0.1).
- OAuth Device Flow; classic OAuth App as primary.
- Issue deletion; full GitHub Issues client (browse all issues, milestones, assignees).
- Cross-machine rediscovery of app-created issues.
- Cloud STT/LLM; GHES support in v0.1 docs/promises.
- Signed installers and auto-update (hardening later).

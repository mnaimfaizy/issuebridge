# 02 — GitHub sign-in (PKCE + keyring) + PAT fallback

**What to build:** A user can sign in with the maintainer GitHub App via Authorization Code + PKCE (fixed loopback callback) or via personal access token, sign out, and see only auth state in the UI — tokens live in the OS vault on the Rust side. Capture and Inbox stay unavailable until signed in.

**Blocked by:** 01 — Tauri shell + application core seam

**Status:** done

- [x] Primary “Sign in with GitHub” completes OAuth against `http://127.0.0.1:17863/oauth/callback` with PKCE S256.
- [x] Secondary “Use a personal access token” sign-in works for advanced/fork/dev **identity** use.
- [x] Access/refresh (or PAT) credentials are stored via Rust `keyring` in the OS vault; command results never return raw token strings to the webview.
- [x] Sign-out clears keyring entries and returns the app to signed-out state.
- [x] Signed-out users cannot use Capture or the Inbox draft flows (gated on signed-in).
- [x] Core-level tests cover sign-in state transitions with faked GitHub + TokenStore (no live OAuth required in CI).

### QA notes (local Windows)

- OAuth token exchange requires `ISSUEBRIDGE_GITHUB_CLIENT_SECRET` (runtime env and/or compile-time inject). Browser “success” without the secret still leaves the app signed out.
- `keyring` must enable `windows-native` (and peers); without it, store appears to succeed but load returns `NoEntry` after restart.
- In-process session + keyring memory mirror keep the UI signed in across flaky vault re-reads in the same process.
- **PAT cannot complete Install App Continue** — `GET /user/installations` requires a GitHub App user token. Prefer Sign in with GitHub for first-run.

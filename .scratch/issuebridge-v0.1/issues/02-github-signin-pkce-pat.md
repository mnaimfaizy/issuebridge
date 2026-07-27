# 02 — GitHub sign-in (PKCE + keyring) + PAT fallback

**What to build:** A user can sign in with the maintainer GitHub App via Authorization Code + PKCE (fixed loopback callback) or via personal access token, sign out, and see only auth state in the UI — tokens live in the OS vault on the Rust side. Capture and Inbox stay unavailable until signed in.

**Blocked by:** 01 — Tauri shell + application core seam

**Status:** ready-for-agent

- [ ] Primary “Sign in with GitHub” completes OAuth against `http://127.0.0.1:17863/oauth/callback` with PKCE S256.
- [ ] Secondary “Use a personal access token” sign-in works for advanced/fork/dev use.
- [ ] Access/refresh (or PAT) credentials are stored via Rust `keyring` in the OS vault; command results never return raw token strings to the webview.
- [ ] Sign-out clears keyring entries and returns the app to signed-out state.
- [ ] Signed-out users cannot use Capture or the Inbox draft flows (gated on signed-in).
- [ ] Core-level tests cover sign-in state transitions with faked GitHub + TokenStore (no live OAuth required in CI).

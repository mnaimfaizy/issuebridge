---
type: research
blocked_by: []
claimed_by: research-keychain
claimed_at: 2026-07-27T08:08:14Z
assets:
  - .plan/issuebridge-v0.1/assets/keychain-token-storage.md
---

# OS keychain token storage from Tauri 2 / Rust

## Question

What is the recommended way in Tauri 2 (Rust side) to store GitHub user access tokens and refresh tokens in the OS keychain on Windows (Credential Manager), with a path that can later extend to macOS Keychain and Linux Secret Service? Identify the preferred crate/plugin, threat notes (webview must not hold raw tokens), and any v0.1 gotchas. Cite primary docs/source.

## Answer

Use the Rust **`keyring`** crate (default **`v1`** feature) from the Tauri backend only. On Windows that writes **generic credentials** into Credential Manager; the same `Entry` API later targets macOS Keychain Services and Linux Secret Service without changing the app’s storage interface.

Do **not** start with `tauri-plugin-stronghold`: it is a passworded snapshot file rather than the OS keychain, and Tauri has deprecated the plugin (no Tauri v3; replacement direction is OS keychains). Community plugins such as `tauri-plugin-keyring-store` sit on the same native stores but are not vouched by Tauri maintainers; their JS/IPC APIs can put secrets in the webview, which we reject for tokens.

Threat rule for v0.1: load, refresh, and use tokens only in Rust; frontend commands return auth **state** (signed-in, login, scopes), never raw access/refresh strings. Keep secrets out of `localStorage`, frontend stores, and plaintext app-data files. Capabilities cannot fix a command that returns a bearer token.

Gotchas worth locking in: credential blob max **2560** bytes; serialize keyring access (Windows store is not reliably ordered across threads on one entry); confirm `keyring` 4.x MSRV against the toolchain (or pin an older line if needed); Linux later needs a Secret Service session; delete entries on sign-out; prefer `Local` persistence if Enterprise roaming is undesirable.

Full citations and layout notes: [keychain-token-storage.md](../assets/keychain-token-storage.md).

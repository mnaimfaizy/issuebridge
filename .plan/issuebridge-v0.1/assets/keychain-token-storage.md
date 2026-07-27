# OS keychain token storage (Tauri 2 / Rust)

Research notes for Issuebridge v0.1: where GitHub user **access** and **refresh** tokens live on disk/OS vault, how the webview is kept away from raw secrets, and what to avoid.

## Recommendation (decision-ready)

**Prefer the Rust [`keyring`](https://crates.io/crates/keyring) crate (default `v1` feature) from the Tauri backend only.** Do **not** adopt `tauri-plugin-stronghold` for new work. Do **not** expose raw tokens to the webview via IPC (including community keyring plugins’ JS APIs).

Concrete shape for v0.1:

1. Add `keyring` to `src-tauri` with the default feature set (`v1`), which wires platform native stores automatically.
2. Wrap a small Rust module (e.g. `token_store`) that reads/writes two entries under a stable **service** name (bundle identifier or `com.issuebridge.app`) and distinct **user**/account labels (e.g. `github.access_token`, `github.refresh_token`).
3. Perform OAuth code exchange, refresh, and GitHub API calls in Rust (or a Rust-owned HTTP client). Commands the UI may call return **auth state only** (`signed_in`, login, scopes, expiry-ish metadata) — never the token strings.
4. On sign-out, delete both credential entries.

This path is Windows Credential Manager today and the same API later maps to macOS Keychain Services and Linux Secret Service without a plugin swap.

## Why not Stronghold / official Tauri secret plugin

Tauri’s Stronghold plugin stores secrets in a **password-derived encrypted snapshot file**, not the OS keychain, and is used heavily from JavaScript in the documented flow ([Stronghold plugin docs](https://v2.tauri.app/plugin/stronghold/)).

As of 2026-07-16, Tauri maintainers **deprecated** the Stronghold plugin: upstream Stronghold is unmaintained, the plugin will **not** ship in Tauri v3, and the stated replacement direction is **OS keychains** (plus possibly encryption helpers). Meanwhile they say community keychain/keyring plugins exist but **“we cannot vouch for any”** ([plugins-workspace#3494](https://github.com/tauri-apps/plugins-workspace/issues/3494)).

For Issuebridge’s requirement (“OS keychain on Windows, extensible to macOS/Linux”), Stronghold is the wrong abstraction even before deprecation.

## Preferred crate: `keyring` (Rust)

| Fact | Source |
|------|--------|
| Crate | [`keyring`](https://crates.io/crates/keyring) 4.x (docs: [docs.rs/keyring](https://docs.rs/keyring/latest/keyring/)) |
| Default feature `v1` | Cross-platform `Entry` API for set/get/delete text or binary secrets |
| Windows | Windows Credential Manager via [`windows-native-keyring-store`](https://docs.rs/windows-native-keyring-store/latest/windows_native_keyring_store/) |
| macOS | Keychain Services (`apple-native-keyring-store` / keychain) |
| Linux (`v1` default) | Secret Service over zbus (`zbus-secret-service-keyring-store`) |
| Naming model | **service** + **user** identify an entry ([Keyring wiki](https://github.com/open-source-cooperative/keyring-rs/wiki/Keyring)) |

`Entry::new(service, username)` then `set_password` / `get_password` / `delete_credential` (or binary `set_secret` / `get_secret`) is the v1 surface ([`keyring::v1::Entry`](https://docs.rs/keyring/latest/keyring/v1/struct.Entry.html)).

Windows mapping details ([windows-native-keyring-store](https://docs.rs/windows-native-keyring-store/latest/windows_native_keyring_store/)):

- Each entry is a **generic credential** in Credential Manager; identity is a `target_name` string.
- Default `target_name` is `user` + `.` + `service` (configurable prefix/delimiter/suffix).
- Default persistence is **Enterprise** (`CRED_PERSIST_ENTERPRISE`); can be overridden with a `persistence` modifier (`Session` / `Local` / `Enterprise`).
- Microsoft defines generic credentials as securely stored opaque blobs with no auth-package semantics ([`CREDENTIALW` / `CRED_TYPE_GENERIC`](https://learn.microsoft.com/en-us/windows/win32/api/wincred/ns-wincred-credentialw)).
- Blob size must be ≤ `CRED_MAX_CREDENTIAL_BLOB_SIZE` (**5×512 = 2560 bytes**) — fine for normal GitHub OAuth token strings; do not stuff large JSON blobs into one credential.

For apps that want tighter control later, the ecosystem documents depending on `keyring-core` + specific store crates instead of the all-in-one `keyring` wrapper ([crates.io README](https://crates.io/crates/keyring)); v0.1 does not need that split.

## Community Tauri plugin (optional, not preferred for tokens)

[`tauri-plugin-keyring-store`](https://github.com/s00d/tauri-plugin-keyring-store) wraps the same keyring-core / OS stores and offers a **Rust-first** `app.keyring()` / `KeyringStore` API. It also ships a Stronghold-shaped **JavaScript** API and bulk `get_passwords` / plaintext export commands that move secrets across IPC.

Tauri maintainers explicitly do not vouch for community keyring plugins ([#3494](https://github.com/tauri-apps/plugins-workspace/issues/3494)). Using the plugin’s JS/IPC surface conflicts with “webview must not hold raw tokens.” If ever adopted, use **only** the Rust store path and **deny** guest permissions that return secrets — at which point the plugin adds little over depending on `keyring` directly.

**v0.1 preference:** `keyring` in Rust, no keyring plugin capability granted to the webview.

## Threat model: keep raw tokens out of the webview

Tauri’s capabilities system exists to **constrain what the frontend WebView can invoke** on the Rust core ([Capabilities](https://v2.tauri.app/security/capabilities/)). It can reduce impact of frontend compromise; it does **not** protect against commands that willingly return secrets, nor against malicious/insecure Rust.

Implications for Issuebridge:

| Do | Don’t |
|----|--------|
| Store/load tokens only in Rust | `invoke('get_access_token')` returning the secret |
| HTTP to `api.github.com` from Rust with the token | Put `Authorization: Bearer …` together in JS |
| UI commands: `auth_status`, `sign_in`, `sign_out`, `list_repos`, … | Persist tokens in `localStorage`, frontend store, or app data files |
| Log only redacted auth errors | Log full token / `CredentialBlob` values |
| Zeroize / drop token strings when done (where practical) | Cache tokens in webview memory “for convenience” |

Isolation pattern / CSP harden IPC against *tampering*; they are **not** a substitute for never shipping the secret to JS ([Isolation](https://v2.tauri.app/concept/inter-process-communication/isolation/)).

Any process running as the same Windows user can typically read that user’s Credential Manager entries (OS vault ≠ hardware enclave). Goal is: no plaintext tokens in the app data directory, and a compromised or XSS’d webview cannot `invoke` its way to the bearer token.

## Suggested entry layout

```text
service  = <tauri identifier / reverse-DNS>   # e.g. com.issuebridge.app
user    = github.access_token                 # Entry A
user    = github.refresh_token                # Entry B
```

Optional third entry for PAT-fallback mode (`github.pat`) if PAT and App-user tokens should not overwrite each other — product choice, not forced by the crate.

Serialize nothing else into the credential blob beyond the token string (or a tiny versioned envelope still well under 2560 bytes).

## v0.1 gotchas

1. **Stronghold is deprecated / wrong store** — encrypted snapshot ≠ OS keychain; do not start there ([#3494](https://github.com/tauri-apps/plugins-workspace/issues/3494), [plugin docs](https://v2.tauri.app/plugin/stronghold/)).
2. **MSRV** — `keyring` 4.1.5 advertises MSRV **1.88.0** on crates.io; confirm the Tauri toolchain’s Rust version before pinning latest 4.x (older 3.6.x line still widely used if MSRV bites).
3. **Windows size limit** — 2560-byte credential blob max ([`CREDENTIALW`](https://learn.microsoft.com/en-us/windows/win32/api/wincred/ns-wincred-credentialw)).
4. **Threading** — windows-native store docs warn concurrent ops on the **same** entry from multiple threads are not reliably ordered; serialize access behind a mutex or single async worker ([docs](https://docs.rs/windows-native-keyring-store/latest/windows_native_keyring_store/)).
5. **Linux later** — Secret Service requires a running session keyring (GNOME Keyring / KWallet / etc.); headless CI often has none. Plan mocks or `#[ignore]` integration tests (same issue called out by keyring-store plugin docs).
6. **macOS later** — Login Keychain; sandboxing/notarization may add entitlements when you leave Windows-only v0.1. Not a v0.1 ship gate per map Out of scope.
7. **Persistence** — default Enterprise persistence may roam with a roaming profile; if that is undesirable for tokens, set `Local` persistence via store modifiers when writing ([windows-native-keyring-store](https://docs.rs/windows-native-keyring-store/latest/windows_native_keyring_store/)).
8. **Do not grant secret-returning plugin permissions** — Tauri defaults block dangerous plugin commands until capabilities allow them ([Stronghold permissions pattern](https://v2.tauri.app/plugin/stronghold/); [Capabilities](https://v2.tauri.app/security/capabilities/)). Custom commands that return tokens bypass that safety net — don’t write them.
9. **Sign-out / uninstall** — delete keyring entries on sign-out; OS credentials survive app uninstall unless you clean them up.
10. **PAT fallback** — same vault and same “never to webview” rule as App user tokens (map standing decision).

## Minimal Rust sketch (illustrative)

```rust
use keyring::Entry;

const SERVICE: &str = "com.issuebridge.app";

fn access_entry() -> keyring::Result<Entry> {
    Entry::new(SERVICE, "github.access_token")
}

pub fn save_access_token(token: &str) -> keyring::Result<()> {
    access_entry()?.set_password(token)
}

pub fn load_access_token() -> keyring::Result<String> {
    access_entry()?.get_password()
}

pub fn clear_access_token() -> keyring::Result<()> {
    access_entry()?.delete_credential()
}
```

Call these only from Rust auth/HTTP code paths. Frontend `sign_out` command should clear both access and refresh entries and clear any in-memory auth handle.

## Sources

- Tauri Stronghold deprecation: [tauri-apps/plugins-workspace#3494](https://github.com/tauri-apps/plugins-workspace/issues/3494)
- Tauri Stronghold plugin (snapshot + JS API): [v2.tauri.app/plugin/stronghold](https://v2.tauri.app/plugin/stronghold/)
- Tauri capabilities (webview ↔ core boundary): [v2.tauri.app/security/capabilities](https://v2.tauri.app/security/capabilities/)
- `keyring` crate / README: [crates.io/crates/keyring](https://crates.io/crates/keyring), [github.com/open-source-cooperative/keyring-rs](https://github.com/open-source-cooperative/keyring-rs)
- `keyring::v1` platform mapping: [docs.rs/keyring/latest/keyring/v1](https://docs.rs/keyring/latest/keyring/v1/index.html)
- Keyring naming (service / user): [Keyring wiki](https://github.com/open-source-cooperative/keyring-rs/wiki/Keyring)
- Windows store backend: [docs.rs/windows-native-keyring-store](https://docs.rs/windows-native-keyring-store/latest/windows_native_keyring_store/)
- Windows `CREDENTIALW` (generic type, persistence, 2560-byte blob): [learn.microsoft.com … ns-wincred-credentialw](https://learn.microsoft.com/en-us/windows/win32/api/wincred/ns-wincred-credentialw)
- Community OS-keychain Tauri plugin (not vouched by Tauri): [s00d/tauri-plugin-keyring-store](https://github.com/s00d/tauri-plugin-keyring-store)

# PKCE callback strategy for Tauri 2 on Windows (GitHub App)

Research for [ticket 01](../tickets/01-pkce-callback-for-tauri.md). Primary sources only: GitHub Docs, Tauri 2 docs, RFC 8252 / RFC 7636.

## Recommendation (v0.1)

**Use Authorization Code + PKCE (`S256`) with a fixed loopback callback:**

`http://127.0.0.1:17863/oauth/callback`

| Item | Choice |
| --- | --- |
| Callback approach | Loopback HTTP on `127.0.0.1` (not `localhost`) |
| Port | Fixed `17863` (register exact URL; do not rely on ephemeral ports) |
| Custom URI scheme | **Defer** (optional later second Callback URL) |
| GitHub App Callback URL | Exactly `http://127.0.0.1:17863/oauth/callback` |
| Device Flow | **Off** (already standing decision; GitHub prefers PKCE web flow for public clients) |
| `client_secret` | Still **required** on code exchange; ship via CI injection; treat as extractable; mitigate with PKCE + `state` |

Port `17863` is an arbitrary high port in the dynamic/private range for uniqueness; any unused fixed port is fine if the registered Callback URL matches what the app binds and sends as `redirect_uri`.

---

## 1. GitHub App web flow requirements

### Flow

1. Open the system browser to `https://github.com/login/oauth/authorize` with `client_id`, `redirect_uri`, `state`, `code_challenge`, `code_challenge_method=S256`.
2. After consent, GitHub redirects to the callback with `code` (and `state`).
3. Exchange via `POST https://github.com/login/oauth/access_token` with `client_id`, **`client_secret` (required)**, `code`, `redirect_uri`, and `code_verifier`.

Sources:

- [Generating a user access token for a GitHub App — web application flow](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app#using-the-web-application-flow-to-generate-a-user-access-token)
- PKCE challenge method must be `S256`; `plain` is not supported ([same page](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app#using-the-web-application-flow-to-generate-a-user-access-token); [RFC 7636](https://datatracker.ietf.org/doc/html/rfc7636))

### Callback URL registration

- Register up to **10** Callback URLs on the GitHub App.
- For GitHub Apps, `redirect_uri` must be an **exact match** to one registered Callback URL and must not include extra query parameters. Mismatch → `redirect_uri_mismatch`.

Sources:

- [About the user authorization callback URL](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/about-the-user-authorization-callback-url)
- [Registering a GitHub App](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app) (Callback URL field; Device Flow checkbox)
- [Generating a user access token — redirect_uri / troubleshooting](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app)

### Loopback port flexibility: OAuth Apps vs GitHub Apps

Classic **OAuth Apps** document a loopback exception: register e.g. `http://127.0.0.1/path`, then `redirect_uri` may use a different port (`http://127.0.0.1:1234/path`). They also cite RFC 8252’s preference for `127.0.0.1` over `localhost`.

- [Authorizing OAuth apps — Loopback redirect urls](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#loopback-redirect-urls)

**GitHub Apps docs do not document that port exception.** They require exact Callback URL match. For v0.1, assume **exact match including port**: bind the fixed registered port; if the port is busy, fail clearly (do not silently pick another port unless that exact URL is also registered).

### Non-HTTP (custom scheme) callbacks

GitHub’s authorize docs note the account picker appears when the app has a **non-HTTP redirect URI**, which implies custom schemes are acceptable as Callback URLs.

- [Generating a user access token — `prompt` parameter](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app#using-the-web-application-flow-to-generate-a-user-access-token)

---

## 2. Public / native clients and `client_secret`

GitHub’s best practices state:

- Client secrets are **required** to generate user access tokens unless the app uses **device flow**.
- For a **public client** (native app on the user’s device), you **cannot** secure the client secret; you **must ship** it in the app; you **should use PKCE**.
- Prefer **authorization code + PKCE** over device flow when the concern is shipping a secret: device flow has no redirect URI binding and enables remote phishing impersonation. Do **not** enable device flow unless the app is in a constrained environment (CLI / IoT / headless).
- Native apps should use **user** access tokens (not installation tokens / private key). Store tokens with the platform’s recommended mechanism; assume storage may not be fully secure.

Source: [Best practices for creating a GitHub App — Client secrets / Don’t enable device flow](https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps/best-practices-for-creating-a-github-app)

**Implications for Issuebridge v0.1 (already aligned with standing map decisions):**

- Injecting `client_id` + `client_secret` via CI for official builds is consistent with GitHub’s public-client guidance.
- PKCE does **not** remove the need for `client_secret` on GitHub’s token endpoint; it mitigates authorization-code interception.
- Anyone who extracts `client_id`/`client_secret` can run the same OAuth client; do not gate *your own* backend resources solely on “issued by this App” without further checks. For Issuebridge (local app talking to GitHub API as the user), the practical risk is impersonating the OAuth client / phishing users into authorizing a lookalike flow — mitigated by registered redirect URIs + PKCE + not enabling device flow.
- Never ship the GitHub App **private key** with the desktop client.

---

## 3. Loopback vs custom URI scheme

### RFC 8252 (OAuth 2.0 for Native Apps)

- Native apps should use an external user-agent (system browser) and PKCE.
- **Loopback interface redirection** (`http://127.0.0.1:{port}/…` or `http://[::1]:{port}/…`) is appropriate for desktop apps that can bind a loopback port.
- Prefer loopback IP literals over `localhost` (hostname resolution / unintended interfaces).
- Private-use URI schemes are valid but have a known limitation: multiple apps can register the same scheme, making delivery indeterminate; PKCE mitigates stolen codes.
- On **Windows**, traditional desktop apps typically use loopback; listening on loopback is allowed by default firewall rules. Prefer exclusive bind (`SO_EXCLUSIVEADDRUSE` guidance in the RFC).

Sources:

- [RFC 8252 §7.3 Loopback Interface Redirection](https://datatracker.ietf.org/doc/html/rfc8252#section-7.3)
- [RFC 8252 §8.1 / localhost NOT RECOMMENDED](https://datatracker.ietf.org/doc/html/rfc8252#section-8.3) (localhost discussion)
- [RFC 8252 Appendix B.3 Windows](https://datatracker.ietf.org/doc/html/rfc8252#appendix-B.3)

Note: RFC 8252 says authorization servers **MUST** allow any port for loopback redirects. GitHub **OAuth Apps** implement a form of this; **GitHub Apps** docs still require exact registered Callback URL match — hence the fixed-port choice.

### Tauri 2 custom schemes (deep-link plugin)

Tauri 2 supports desktop custom schemes via `@tauri-apps/plugin-deep-link` / `tauri-plugin-deep-link`:

- Configure `plugins.deep-link.desktop.schemes` (e.g. `issuebridge`).
- On **Windows/Linux**, a deep link is delivered as a CLI argument to a **new** process unless integrated with **single-instance** (`deep-link` feature).
- Deep links are only triggered for **installed** apps on desktop; for `tauri dev`, use `register` / `register_all` at runtime on Windows/Linux.
- Listening APIs: `getCurrent` on startup, `onOpenUrl` while running.

Source: [Deep Linking | Tauri 2](https://v2.tauri.app/plugin/deep-linking/)

Loopback does **not** require the deep-link or single-instance plugins: start a short-lived HTTP listener bound to `127.0.0.1` only, open the authorize URL in the system browser, capture `code`/`state`, then exchange.

### Comparison (Windows + GitHub App)

| Criterion | Loopback `127.0.0.1` | Custom scheme `issuebridge://…` |
| --- | --- | --- |
| Spec preference (desktop) | Preferred (RFC 8252) | Allowed; scheme collision risk |
| GitHub App registration | Exact Callback URL incl. port | Exact Callback URL (non-HTTP OK) |
| Tauri surface | Local HTTP listener only | deep-link + usually single-instance |
| `tauri dev` | Works without install | Needs runtime `register` / install |
| Port conflicts | Possible (fixed port) | None |
| Code interception | Other local listeners; PKCE helps | Other apps claiming scheme; PKCE helps |

---

## 4. Concrete GitHub App settings for v0.1

When creating/modifying the maintainer App ([registering](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app) / ticket 04):

1. **Callback URL:** `http://127.0.0.1:17863/oauth/callback` (and pass the same string as `redirect_uri`).
2. **Expire user authorization tokens:** leave enabled (GitHub strongly recommends).
3. **Enable Device Flow:** leave **unchecked**.
4. **Request user authorization (OAuth) during installation:** optional; if enabled, redirects use the **first** Callback URL — keep the loopback URL first, or leave this off and drive a full web flow with explicit `redirect_uri`.
5. Generate a **client secret**; do not commit it. Official releases inject `client_id` + `client_secret` (standing map decision).
6. Do **not** distribute the App **private key** with the desktop binary.

Optional later: add a second Callback URL such as `issuebridge://oauth/callback` if packaging/OS integration makes a custom scheme worth the deep-link complexity.

---

## 5. Implementation checklist (for later `/implement`, not this ticket)

1. Bind `127.0.0.1:17863` exclusively for the duration of sign-in; serve a minimal success/failure page after capturing query params.
2. Generate `state` + PKCE verifier/challenge (`S256`); abort if returned `state` mismatches.
3. Open authorize URL in the **system** browser (external user-agent).
4. Exchange code with `client_id`, `client_secret`, `code`, `code_verifier`, `redirect_uri`.
5. Persist tokens via the platform keychain approach from ticket 02; refresh per GitHub’s refresh-token docs.
6. On port-in-use or bind failure: show a clear error (do not change port without a registered Callback URL).

---

## Sources (index)

1. https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app
2. https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps/best-practices-for-creating-a-github-app
3. https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/about-the-user-authorization-callback-url
4. https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app
5. https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#loopback-redirect-urls
6. https://v2.tauri.app/plugin/deep-linking/
7. https://datatracker.ietf.org/doc/html/rfc8252
8. https://datatracker.ietf.org/doc/html/rfc7636

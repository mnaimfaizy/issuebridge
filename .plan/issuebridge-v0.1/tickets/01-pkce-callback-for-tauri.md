---
type: research
blocked_by: []
claimed_by: research-pkce-callback
claimed_at: 2026-07-27T08:07:37Z
assets: [.plan/issuebridge-v0.1/assets/pkce-callback-tauri.md]
---

# PKCE callback strategy for Tauri 2 on Windows

## Question

For a Tauri 2 Windows desktop app using a maintainer GitHub App with Authorization Code + PKCE, what is the best callback approach (loopback `http://127.0.0.1:<port>/…` vs custom URI scheme such as `issuebridge://…`), what must be registered on the GitHub App, and what are the implications of GitHub still requiring `client_secret` on the code exchange for a public/native client? Recommend a concrete v0.1 choice with citations from GitHub and Tauri primary docs.

## Answer

**v0.1 choice: Authorization Code + PKCE (`S256`) with fixed loopback callback `http://127.0.0.1:17863/oauth/callback`.** Register that exact URL as the GitHub App Callback URL; leave Device Flow off; keep expiring user tokens on. Prefer loopback over a custom scheme for Windows desktop (RFC 8252; simpler Tauri surface—no deep-link/single-instance). GitHub Apps require an exact `redirect_uri` match (unlike classic OAuth Apps’ documented loopback port flexibility), so do not use an ephemeral port unless it is also registered. `client_secret` remains required on the token exchange even with PKCE; ship it via CI injection and treat it as extractable—PKCE mitigates code interception, not secret extraction. Custom scheme (`issuebridge://…`) is a valid later add-on (second Callback URL) via Tauri’s deep-link plugin.

Full findings + citations: [.plan/issuebridge-v0.1/assets/pkce-callback-tauri.md](../assets/pkce-callback-tauri.md)

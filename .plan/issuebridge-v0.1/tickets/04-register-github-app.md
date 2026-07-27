---
type: task
blocked_by: [01]
claimed_by: wayfinder-session
claimed_at: 2026-07-27T08:16:00Z
---

# Register the maintainer GitHub App

## Question

Create the maintainer GitHub App for Issuebridge once the PKCE callback strategy is decided: enable permissions **Issues read/write** + **Metadata read**; do **not** enable Device Flow; register the callback URL(s) from ticket 01; opt into expiring user tokens if appropriate; record where `client_id` / `client_secret` will live for local dev vs CI release injection (never commit secrets). Capture the resulting facts (App URL, client_id location, callback URLs configured) in the answer — not the secret values.

## Answer

Maintainer GitHub App **issuebridge-dev** is registered.

| Fact | Value |
| --- | --- |
| App settings | https://github.com/settings/apps/issuebridge-dev |
| Client ID | `Iv23li6Ao8URyrvbNZOq` (public; safe to inject in builds) |
| Client secret | Generated; stored in **1Password** (never commit; CI secret later, e.g. `ISSUEBRIDGE_GITHUB_CLIENT_SECRET`) |
| Required Callback URL | `http://127.0.0.1:17863/oauth/callback` (must remain exact — from PKCE ticket) |
| Device Flow | Must stay **off** |
| Permissions | Issues R/W + Metadata read |

Local/dev: read `client_id` + `client_secret` from env or gitignored config. Official releases: CI injects both. Do not put the secret in the repo.

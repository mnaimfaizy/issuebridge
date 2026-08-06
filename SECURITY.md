# Security Policy

## Supported versions

Security fixes target the latest Issuebridge Release on the default branch. Older installers may not receive backports unless a maintainer explicitly says so in a published advisory.

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Prefer one of:

1. **GitHub private vulnerability reporting** — Repository **Security** → **Advisories** → **Report a vulnerability** (if enabled for this repo).
2. Contact the repository owner via a private channel if private reporting is unavailable.

Include:

- Affected version / install method (if known)
- Description of the issue and impact
- Steps to reproduce **without** a weaponized exploit payload

We aim to acknowledge reports and keep draft discussion private until a fix is ready or we explain why the report is out of scope.

## Our process (summary)

1. Validate privately (draft Security Advisory).
2. Fix and, when credentials are involved, rotate them.
3. Ship a Release when end users must upgrade.
4. Publish an advisory with affected/fixed versions — impact narrative only, no exploit recipes.

Maintainer detail: [docs/security-response.md](./docs/security-response.md).

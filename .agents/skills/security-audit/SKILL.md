---
name: security-audit
description: >-
  Deep security and vulnerability audit for Issuebridge (Medium+ only). Use when
  the user asks for a security audit, vulnerability review, threat hunt, weekly
  security scan, or to audit a PR for dangerous flaws (auth, secrets, IPC,
  injection, path traversal, XSS→native bridge). Produces a private draft GitHub
  Security Advisory — never dump exploit detail into public issues/PR comments.
disable-model-invocation: true
---

# Security audit (Issuebridge)

Threat-led audit that prefers **reachable, dangerous** flaws over checklist noise.
Severity floor: **Medium**. Discard Low / informational / style.

Pilot skill lives in this repo; later extract to a shared skills repository with a thinner per-product threat pack.

## Modes

| Mode | When | Scope |
|------|------|--------|
| `full` | Weekly schedule, `workflow_dispatch`, Cursor “audit the repo” | Whole tree + threat pack |
| `pr` | PR labeled `agent:security-audit`, or Cursor “audit this PR” | Diff vs base + adjacent call sites |
| `manual` | Same as `full` unless user narrows paths | As requested |

## Before you start

1. Read [threat-model.md](threat-model.md) (Issuebridge assets & attack paths).
2. Read [report-format.md](report-format.md) (required output shape).
3. Prefer evidence over speculation. No finding without `file:line` (or clear “missing control” with where it should live).
4. **Never** write weaponized exploits, exploit PoCs, or public step-by-step attack recipes. Impact = narrative + conditions only.
5. **Never** post finding detail on public issues/PR bodies. Private channel = **draft repository Security Advisory**.

## Process

### 1. Orient

- Confirm mode (`full` / `pr`).
- For `pr`: `git diff <base>...HEAD` and list changed paths; still open adjacent auth/IPC/store files when the diff touches them.
- Skim `CONTEXT.md` only for domain terms if findings mention product concepts (Draft, Publish, Capture, …).

### 2. Deterministic pass (when tools available)

Run what exists; fold real hits into the report (do not invent CVEs):

- `cargo audit` (if installed / in CI image) on `src-tauri`
- `npm audit --omit=dev` (or project-equivalent) — High+ only unless clearly reachable
- Search for obvious secret patterns (tokens, private keys) in tracked files — exclude fixtures/docs that are clearly fake

Tool noise without a reachable Issuebridge impact → discard.

### 3. Threat-led code pass

Walk the threat pack in [threat-model.md](threat-model.md). Prioritize:

1. Credential theft / token exfil (keyring, OAuth, env, logs)
2. Authn/authz bypass (GitHub API calls, repo scope, Install App)
3. Tauri IPC / command surface (untrusted frontend → privileged Rust)
4. Path traversal / arbitrary file read-write (Draft store, models, Whisper/llama paths)
5. Command/argument injection into sidecars (Whisper, llama.cpp)
6. Webview XSS → native bridge escalation
7. Supply chain / installer update trust (only if code/config in-repo supports a concrete claim)
8. Privacy: Draft content or tokens leaving the machine unexpectedly

For each candidate, ask: **who attacks, from where, what do they gain, is it reachable in the shipped Windows app or CI?** If not Medium+, drop it.

### 4. Severity

| Severity | Use when |
|----------|----------|
| Critical | Remote or trivial local → token theft, RCE, or full account takeover |
| High | Realistic path to token theft, cross-repo abuse, or trusted-code execution |
| Medium | Meaningful confidentiality/integrity impact under plausible local or content-attacker assumptions |
| Low | Discard for this skill |

Cap the report at **12** findings (highest severity first). If more exist, keep the top 12 and note “additional candidates omitted”.

### 5. Report + private publish

1. Emit markdown matching [report-format.md](report-format.md).
2. Create **one draft** repository Security Advisory per run (not a public issue):
   - `summary`: `[Security audit] <YYYY-MM-DD> — N finding(s), max=<severity>`
   - `description`: full report body
   - `severity`: max finding severity (`critical` \| `high` \| `medium`)
   - `vulnerabilities`: at least one package entry (`ecosystem: other`, `name: issuebridge` or `ecosystem: rust` / `npm` when a dependency is the root cause)
3. If advisory creation fails (missing `repository_advisories:write` / admin), **stop** — do not fall back to a public issue. Tell the user what permission is missing.
4. For PR mode only: leave a **public** PR comment with counts only, e.g. `Security audit: 2 Medium+ finding(s) filed as a draft advisory for maintainers.` — no paths, no attack detail.

### 6. Out of scope for auto-fix

Do **not** open fix PRs or `@copilot` fix rounds unless the user explicitly asks after triage.

## Cursor invocation examples

- “Run a full security audit”
- “Security-audit this PR”
- “Hunt for IPC / token vulnerabilities”

## CI / automation

GitHub Actions workflow `.github/workflows/security-audit.yml`:

- Weekly cron (`full`)
- `workflow_dispatch` (`full`)
- PR label `agent:security-audit` (`pr`)

Prompt pack: `.github/security-audit/prompt.md` (must stay aligned with this skill).

Model: repo variable `SECURITY_AUDIT_MODEL` (Copilot CLI `--model`); unset = CLI default. Prefer a deep-reasoning model — see `docs/security-audit.md`.

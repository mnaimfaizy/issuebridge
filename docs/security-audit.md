# Security audit (pilot)

Threat-led Medium+ security audit for Issuebridge. Skill: [`.agents/skills/security-audit/`](../.agents/skills/security-audit/). Workflow: [`.github/workflows/security-audit.yml`](../.github/workflows/security-audit.yml).

## Why draft advisories (not issues)

Issuebridge is **public**. Normal GitHub issues and Actions artifacts are world-readable. Findings are filed as a **draft repository Security Advisory** (visible to admins / security managers only) until you publish or close it.

## Triggers

| Trigger | Mode |
|---------|------|
| Cron Monday 06:00 UTC | `full` |
| Actions → **Security audit** → Run workflow | `full` |
| Label a PR `agent:security-audit` | `pr` (diff-focused) |
| Cursor: invoke the **security-audit** skill | as requested |

## Stand-up

1. Repo variable `SECURITY_AUDIT_ENABLED=true`
2. Repo variable `SECURITY_AUDIT_ALLOWLIST=mnaimfaizy` (comma-separated; label + `workflow_dispatch`)
3. Label `agent:security-audit`
4. Fine-grained PAT in `COPILOT_GITHUB_TOKEN` with **Repository security advisories: Write** (token owner = admin or security manager). Same secret as the agent pipeline is fine if the permission is added.
5. Optional model/effort vars — see [Model and reasoning](#model-and-reasoning)
6. Optional: enable private vulnerability reporting under repo Settings → Code security (helps humans; automation uses the advisories API directly).

## Model and reasoning

The audit runs through Copilot CLI. Pin both via repo variables:

| Variable | CLI flag | Example |
|----------|----------|---------|
| `SECURITY_AUDIT_MODEL` | `--model` | `gpt-5.6-sol` |
| `SECURITY_AUDIT_REASONING_EFFORT` | `--reasoning-effort` | `medium` (`low` \| `medium` \| `high` \| `xhigh`) |

Leave either unset to use the CLI/model default. What the UI shows as `gpt-5.6-sol (medium)` is model id `gpt-5.6-sol` plus effort `medium` — not a single combined string.

Run `copilot` locally and use `/model` to see the ids and effort levels your subscription offers. Prefer a deep-reasoning model for security work.

Gotchas:

- An unavailable model id may warn and silently fall back. The run logs `Requested model:` / `Requested reasoning effort:` — compare those against the CLI log if quality looks off.
- Higher effort and heavier models cost more premium requests per weekly run.

## Outputs

- **Findings:** one draft advisory per run with findings (skipped when count is 0)
- **PR label runs:** public comment with **counts only** (no attack detail)
- **No auto-fix PRs** in this pilot

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
5. Optional repo variable `SECURITY_AUDIT_MODEL` — see [Model](#model)
6. Optional: enable private vulnerability reporting under repo Settings → Code security (helps humans; automation uses the advisories API directly).

## Model

The audit runs through Copilot CLI, so the model is selectable with repo variable `SECURITY_AUDIT_MODEL` (passed as `--model`). Leave it unset to use the CLI default.

Pick a deep-reasoning model for security work rather than a cheap/fast one — for example a Claude Opus or GPT-5.x reasoning id. Run `copilot` locally and use `/model` to see the ids your subscription actually offers.

Two gotchas:

- An id your account cannot access is **not** an error; the CLI warns and silently falls back. The run logs `Requested model: <id>`, so compare that against the CLI log if quality looks off.
- Model choice affects premium-request cost per run (multipliers differ per model).

## Outputs

- **Findings:** one draft advisory per run with findings (skipped when count is 0)
- **PR label runs:** public comment with **counts only** (no attack detail)
- **No auto-fix PRs** in this pilot

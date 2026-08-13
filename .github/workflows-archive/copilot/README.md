# Archived — Copilot agent workflows

These workflows are **preserved, not deleted**. They are the Copilot-based agent pipeline
that ran on this repository until it was superseded by the Claude Code pipeline.

They were stress-tested and worked well. They are kept here so the design — the gating
model, the review loop, the private-advisory reporting path — stays available for
reference and can be restored if the Claude pipeline is ever rolled back.

## Why they no longer run

GitHub only executes workflow YAML that lives in `.github/workflows/` **on the default
branch**. Files in this directory are inert: no `schedule`, no `issues`, no
`pull_request`, no `workflow_run` triggers fire. Nothing here consumes Actions minutes,
Copilot requests, or repository permissions.

The `.yml` extension is kept deliberately, so the files retain syntax highlighting and
diff cleanly, and so restoring is a single `git mv` with no edits.

## What is archived

| File | Was |
| --- | --- |
| `agent-pipeline.yml` | `agent:plan` / `agent:implement` label pipeline — Copilot CLI planner + Copilot cloud-agent implementer |
| `agent-pipeline-review.yml` | Post-PR review loop — Copilot code review, ≤2 `@copilot` fix rounds, maintainer handoff |
| `security-audit.yml` | Weekly / dispatch / PR-label security audit via Copilot CLI, reporting to a draft Security Advisory |
| `copilot-setup-steps.yml` | Environment provisioning for the Copilot cloud agent and code-review sandboxes |

## What was deliberately NOT archived

The agent-neutral assets stay in their original locations, because the Claude pipeline
reuses them unchanged:

- `.github/security-audit/publish-draft-advisory.sh` — private draft-advisory publisher
- `.github/security-audit/notify-email.sh` — optional email delivery
- `.github/security-audit/prompt.md` — audit prompt
- `.agents/skills/security-audit/` — threat model, findings ledger, report format
- `.github/agent-pipeline/planner-prompt.md`, `implementer-instructions.md`

`.github/copilot-cli/` (pinned Copilot CLI `package.json` + `package-lock.json`) also
stays in place. Nothing invokes it anymore, and leaving it means the workflows above
restore byte-for-byte with no path edits. Its `node_modules` was never tracked.

## Archiving files does not disable Copilot itself

Copilot code review and Copilot cloud-agent assignment are **repository/account
settings**, not workflow files. `agent-pipeline-review.yml` listened for a dynamically
generated workflow named `Running Copilot Code Review`, which GitHub creates from those
settings. To make Copilot fully silent on this repository, also turn it off in repository
settings.

## Restoring

The Copilot and Claude pipelines are **mutually exclusive**. They share label names
(`agent:plan`, `agent:implement`, `agent:security-audit`) and concurrency group names, so
running both would double-fire on a single label.

To roll back:

1. Archive the Claude workflows first — move `.github/workflows/claude-*.yml` out of
   `.github/workflows/`.
2. `git mv .github/workflows-archive/copilot/*.yml .github/workflows/`
3. Merge to the default branch. Scheduled workflows only resume once the file is on
   `main`.
4. Re-check the repository variables the restored workflows read:
   `AGENT_PIPELINE_ENABLED`, `AGENT_PIPELINE_ALLOWLIST`, `SECURITY_AUDIT_ENABLED`,
   `SECURITY_AUDIT_ALLOWLIST`, `SECURITY_AUDIT_MODEL`,
   `SECURITY_AUDIT_REASONING_EFFORT`.
5. Confirm `COPILOT_GITHUB_TOKEN` still carries the scopes these workflows need. Its
   scopes were reduced after archiving, since only advisory publishing still used it —
   Copilot cloud-agent assignment needs `Copilot Requests` and issue/PR write back.

The Claude pipeline uses separate kill switches (`CLAUDE_PIPELINE_ENABLED`,
`CLAUDE_SECURITY_AUDIT_ENABLED`) precisely so that restoring one generation never
silently enables the other.

## Related docs

- `docs/agent-pipeline-pilot.md`
- `docs/security-audit.md`
- `docs/security-response.md`

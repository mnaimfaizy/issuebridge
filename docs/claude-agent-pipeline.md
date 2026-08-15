# Claude Code agent pipeline

Live agent automation for Issuebridge, running Claude Code in GitHub Actions on a Claude
subscription. Replaces the Copilot pipeline archived at
[`.github/workflows-archive/copilot/`](../.github/workflows-archive/copilot/README.md).

| Workflow | Trigger | Does |
| --- | --- | --- |
| [`claude-agent-pipeline.yml`](../.github/workflows/claude-agent-pipeline.yml) | issue labeled `agent:plan` | Posts an implementation plan comment |
| | issue labeled `agent:implement` | Implements the plan, pushes a branch, opens a draft PR |
| [`claude-code-review.yml`](../.github/workflows/claude-code-review.yml) | PR labeled `agent:review` | Three-axis review (Standards / Spec / Correctness) posted to the PR |
| [`claude-security-audit.yml`](../.github/workflows/claude-security-audit.yml) | weekly cron (Sunday 14:00 UTC / Monday 00:00 AEST) / dispatch / PR labeled `agent:security-audit` | Threat-led audit → private draft Security Advisory |

## Stand-up

### 1. Install the Claude GitHub App

Install [github.com/apps/claude](https://github.com/apps/claude) on this repository. The
action authenticates as this App for git operations, which is what makes CI fire on
Claude's pull requests.

### 2. Mint a subscription token

Locally, signed in to Claude Code on a Pro/Max/Team/Enterprise plan:

```bash
claude setup-token
```

This prints a one-year OAuth token and saves it nowhere — copy it immediately. It
authenticates against the subscription (no API billing) and can only make model requests,
so it cannot open Remote Control sessions or reach claude.ai connectors.

### 3. Secrets

| Secret | Required | Purpose |
| --- | --- | --- |
| `CLAUDE_CODE_OAUTH_TOKEN` | yes | Subscription auth for both workflows |
| `COPILOT_GITHUB_TOKEN` | yes | Draft-advisory publisher PAT. Despite the name it is no longer used for Copilot — it needs only `Repository security advisories: write` with an admin/security-manager owner. **Revoke its `Copilot Requests` scope.** |
| `RESEND_API_KEY` | no | Email delivery of report + transcript |

### 4. Repository variables

| Variable | Value | Notes |
| --- | --- | --- |
| `CLAUDE_PIPELINE_ENABLED` | `true` | Kill switch for plan/implement |
| `CLAUDE_SECURITY_AUDIT_ENABLED` | `true` | Kill switch for the audit |
| `CLAUDE_REVIEW_ENABLED` | `true` | Kill switch for code review |
| `AGENT_PIPELINE_ALLOWLIST` | `mnaimfaizy` | Comma-separated logins |
| `SECURITY_AUDIT_ALLOWLIST` | `mnaimfaizy` | Comma-separated logins |
| `CLAUDE_PIPELINE_MODEL` | optional | Defaults to `claude-opus-5` |
| `CLAUDE_SECURITY_AUDIT_MODEL` | optional | Defaults to `claude-opus-5` |
| `CLAUDE_REVIEW_MODEL` | optional | Defaults to `claude-opus-5` |
| `SECURITY_AUDIT_NOTIFY_EMAIL` / `SECURITY_AUDIT_EMAIL_FROM` | optional | Email delivery |

The kill switches are deliberately **not** the archived `AGENT_PIPELINE_ENABLED` /
`SECURITY_AUDIT_ENABLED` names, so restoring the Copilot generation can never silently
enable both pipelines at once.

### 5. Labels

`agent:plan`, `agent:implement`, `agent:review`, `agent:security-audit`. Each is consumed
(removed) after its run, so a re-run needs a deliberate re-label — re-apply `agent:review`
to get a fresh review after pushing fixes.

## Security model

**Nothing runs unattended on issue creation.** Every plan/implement run needs a maintainer
on the allowlist to apply a label. That is what keeps subscription usage under maintainer
control rather than at the mercy of whoever opens an issue. Three independent gates apply:
the kill-switch variable, the repository allowlist, and the action's own write-access and
human-actor checks.

**This repository is public**, which drives the rest:

- **No findings in the Actions log.** Run logs are world-readable. The audit writes its
  report to a file and is instructed to emit only a one-line status. `upload-artifact` is
  never used — artifacts are world-readable too. Findings travel only to the private draft
  advisory and email on the scheduled `full` only.
- **Fork PRs cannot reach the token.** Both workflows use `pull_request`, not
  `pull_request_target`, so GitHub withholds secrets from fork-originated runs. Do not
  "fix" a fork PR failing by switching triggers.
- **PR-authored code cannot rewrite its own audit.** Before scanning a PR, the audit
  restores `AGENTS.md`, `CLAUDE.md`, `.claude/`, the audit prompt, and the skill assets
  from the PR base. The advisory publisher is likewise re-checked-out from base before it
  runs with the privileged PAT.
- **The advisory PAT is never exposed to the agent.** It first appears in the workflow
  after the Claude step has exited. A contract test enforces the ordering.
- **PR-mode audits get no code execution.** No `git`, `npm`, `cargo`, or `find` — read-only
  inspection only. Full mode (scheduled/dispatch, trusted default-branch code) adds
  read-only git subcommands. Lockfile scanners run as workflow steps on `full` only. This is tighter than the archived Copilot
  config, which granted `shell(git:*)`, `shell(cargo:*)`, and `shell(npm:*)`.
- **The reviewer cannot modify or run what it reviews.** `claude-code-review.yml` checks
  out untrusted PR code, so it is granted no `Edit`/`Write` and no `npm`/`cargo` — read,
  reason, comment. It also restores `AGENTS.md`, `CLAUDE.md`, `.claude/` and the
  code-review skill from the PR base, so a PR cannot rewrite the instructions reviewing
  it.
- **Untrusted input is fenced.** Issue bodies, PR diffs, and the plan handed to the Spec
  axis are wrapped in explicit `<untrusted_issue_context>` / `<untrusted_pr_diff>` /
  `<untrusted_spec>` markers instructing the model to treat the contents as data, never
  instructions. The action also scrubs hidden markdown
  and invisible characters, but that is defense in depth, not the primary control.
- **The action is pinned to a commit SHA**, matching the policy already enforced for
  `release-windows.yml`. `@v1` is mutable. Bumping it is deliberate; a contract test fails
  on an unpinned ref.

Contract tests live in [`scripts/ci-workflow-contract.test.mjs`](../scripts/ci-workflow-contract.test.mjs)
and run in CI via `npm run test:ci-contract`.

## Cost and limits

Runs bill against the **personal Claude subscription** that minted the token, not API
credits, and consume the same quota as local interactive use. There is no per-repo budget
isolation and no spend cap — heavy months show up as reduced local availability rather than
a bill. `--max-turns` and job timeouts cap each run.

The token is bound to the individual who minted it, so this does not scale to a team. A
team setup would use an API key or workload identity federation instead.

## Known limitations

- **The implementer cannot touch `.github/workflows`.** The Claude GitHub App has no
  workflow-write permission in this job, so issues asking for workflow changes (such as
  #126 and #127) will come back with those files skipped and a note in the PR body. Drive
  those yourself using the plan.
- **Monthly cron is best-effort.** GitHub disables scheduled workflows on public repos
  after 60 days without repository activity. `workflow_dispatch` is the manual fallback.
- **Review is on demand, and never automatic.** Apply `agent:review` when you want one.
  The archived pipeline additionally ran up to two `@copilot` fix rounds before handing
  off; that auto-fix loop is not reimplemented, so findings come back to you rather than
  to the implementer.
- **The reviewer shares a model family with the implementer.** Claude reviewing Claude is
  less independent than a cross-vendor pass would be. The Correctness axis and its
  "tests passing is not evidence" rule exist partly to counter that, but a review clean
  on all three axes is not proof.
- **The implementer contract is duplicated** between
  [`implementer-instructions.md`](../.github/agent-pipeline/implementer-instructions.md)
  and the `--append-system-prompt` value in the workflow, which is the enforced copy. Tag
  mode builds its own prompt from the issue, so the file cannot be passed directly.

# Claude Code agent pipeline

Live agent automation for Issuebridge, running Claude Code in GitHub Actions on a Claude
subscription. Replaces the Copilot pipeline archived at
[`.github/workflows-archive/copilot/`](../.github/workflows-archive/copilot/README.md).

| Workflow | Trigger | Does |
| --- | --- | --- |
| [`claude-agent-pipeline.yml`](../.github/workflows/claude-agent-pipeline.yml) | issue labeled `agent:plan` | Posts an implementation plan comment |
| | issue labeled `agent:implement` | Implements the plan, pushes a branch, opens a draft PR |
| [`claude-code-review.yml`](../.github/workflows/claude-code-review.yml) | PR labeled `agent:review` | Three-axis review (Standards / Spec / Correctness) posted to the PR |
| [`claude-review-response.yml`](../.github/workflows/claude-review-response.yml) | PR labeled `agent:address-review` (or, in auto mode, handoff from a review) | The Review responder fixes or declines each review finding, pushes, replies on every thread and resolves the fixed ones |
| [`claude-security-audit.yml`](../.github/workflows/claude-security-audit.yml) | weekly cron (Sunday 14:00 UTC / Monday 00:00 AEST) / dispatch / PR labeled `agent:security-audit` | Threat-led audit → private draft Security Advisory |

## Stand-up

### 1. Install the Claude GitHub App

Install [github.com/apps/claude](https://github.com/apps/claude) on this repository. The
implementer authenticates as this App for git operations, which is what makes CI fire on
Claude's pull requests. The planner, reviewer, audit and Review responder use the job's own
`GITHUB_TOKEN` instead, so their comments appear as `github-actions[bot]`.

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
| `CLAUDE_CODE_OAUTH_TOKEN` | yes | Subscription auth for every agent workflow |
| `COPILOT_GITHUB_TOKEN` | yes | Draft-advisory publisher PAT. Despite the name it is no longer used for Copilot — it needs only `Repository security advisories: write` with an admin/security-manager owner. **Revoke its `Copilot Requests` scope.** |
| `RESEND_API_KEY` | no | Email delivery of report + transcript |

### 4. Repository variables

| Variable | Value | Notes |
| --- | --- | --- |
| `CLAUDE_PIPELINE_ENABLED` | `true` | Kill switch for plan/implement |
| `CLAUDE_SECURITY_AUDIT_ENABLED` | `true` | Kill switch for the audit |
| `CLAUDE_REVIEW_ENABLED` | `true` | Kill switch for code review |
| `CLAUDE_REVIEW_RESPONSE_ENABLED` | `true` | Kill switch for the Review responder, label and auto alike |
| `CLAUDE_REVIEW_RESPONSE_MODE` | optional | `auto` lets a finished review hand off to the responder. Anything else, including unset, is manual |
| `AGENT_PIPELINE_ALLOWLIST` | `mnaimfaizy` | Comma-separated logins |
| `SECURITY_AUDIT_ALLOWLIST` | `mnaimfaizy` | Comma-separated logins |
| `CLAUDE_PIPELINE_MODEL` | optional | Defaults to `claude-opus-5` |
| `CLAUDE_SECURITY_AUDIT_MODEL` | optional | Defaults to `claude-opus-5` |
| `CLAUDE_REVIEW_MODEL` | optional | Defaults to `claude-opus-5` |
| `CLAUDE_REVIEW_RESPONSE_MODEL` | optional | Defaults to `claude-opus-5` |
| `SECURITY_AUDIT_NOTIFY_EMAIL` / `SECURITY_AUDIT_EMAIL_FROM` | optional | Email delivery |

The kill switches are deliberately **not** the archived `AGENT_PIPELINE_ENABLED` /
`SECURITY_AUDIT_ENABLED` names, so restoring the Copilot generation can never silently
enable both pipelines at once.

### 5. Labels

`agent:plan`, `agent:implement`, `agent:review`, `agent:address-review`,
`agent:security-audit`. Each is consumed (removed) after its run, so a re-run needs a
deliberate re-label — re-apply `agent:review` to get a fresh review after pushing fixes.

## Addressing a review

After `agent:review`, apply `agent:address-review` to the same pull request. One **response
round** then runs:

1. A trusted step builds the **work list**: every unresolved review thread the reviewer
   started, oldest first, at most 20. Outdated threads are included. The reviewer's
   summary comment is background only — a note with no thread is not acted on.
2. The Review responder reaches a **verdict** on each **finding**: **fixed** (one commit per
   finding, after running the checks that cover it) or **declined**, with a reason.
3. The agent cannot push. Its commits are handed to a separate job on a fresh runner, which
   checks them, pushes them, and starts CI for the pushed commit.
4. That job then replies on every finding that has a verdict. A thread is resolved only when
   its fix changed the file the finding is on; a fix made elsewhere, and every declined
   finding, gets a reply and stays open for you. One summary comment lists every outcome.

To steer a finding before a round, reply on its thread: replies from logins on
`AGENT_PIPELINE_ALLOWLIST` reach the responder as **maintainer guidance** for that finding.
Everyone else's replies are dropped.

A round is refused on fork pull requests, on pull requests that do not target the default
branch, on Dependabot pull requests, and on pull requests that change agent instruction
files (`CLAUDE.md`, `AGENTS.md`, `.claude/`, `.agents/skills/`, `.github/agent-runtime/`,
`.mcp.json`) — address those reviews by hand. Findings that need a change under
`.github/workflows` are declined: the job token cannot push workflow files.

If a round fails partway, only what it can prove is published: a finding is resolved only
when its commit was pushed by that round. A missing response file changes no thread. If
anyone pushes to the branch while a round runs, or its commits fail the checks before the
push, nothing is pushed and the summary says so.

### Auto mode

With `CLAUDE_REVIEW_RESPONSE_MODE=auto`, a review that leaves unresolved findings starts a
response round itself (the **handoff**). A round never starts a review: the chain is
review → respond → stop, and the next review needs `agent:review` from a maintainer. Automatic
handoff stops after two rounds on a pull request and says so in a comment; the label ignores
that cap. Auto mode roughly doubles the subscription cost of each review that has findings.

## Security model

**Nothing runs unattended on issue creation.** Every plan/implement run needs a maintainer
on the allowlist to apply a label. That is what keeps subscription usage under maintainer
control rather than at the mercy of whoever opens an issue. Three independent gates apply:
the kill-switch variable, the repository allowlist, and the action's own write-access and
human-actor checks. The one exception is opt-in: in auto mode a response round starts
without a label, but only after a review that a maintainer did label.

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
  from the PR base.
- **Credentialed scripts never run from the agent's workspace.** On every run, before the
  scan, the advisory publisher and email notifier are copied from a trusted commit (the PR
  base, or the checked-out commit on a full run) to a directory outside the workspace, and
  their digests recorded. The steps holding the PAT and email key verify those digests and
  run only that copy. The agent can still write its report; nothing it writes is executed.
- **The advisory PAT is never exposed to the agent.** It first appears in the workflow
  after the Claude step has exited. A contract test enforces the ordering.
- **PR-mode audits get no code execution.** No `git`, `npm`, `cargo`, or `find` — read-only
  inspection only. Full mode (scheduled/dispatch, trusted default-branch code) adds
  read-only git subcommands. Lockfile scanners run as workflow steps on `full` only. This is tighter than the archived Copilot
  config, which granted `shell(git:*)`, `shell(cargo:*)`, and `shell(npm:*)`.
- **Only the implementer holds the Claude App token.** The planner, reviewer, audit and
  Review responder authenticate GitHub with the job's `GITHUB_TOKEN`, scoped by each job's
  `permissions:` block, and deny built-in reads of `.git/`. Only the implementer job
  grants `id-token: write`. A contract test holds this.
  Without the App token exchange, the action no longer skips a run whose workflow file
  differs from the default branch. That check was not a boundary here: anyone who can
  push a same-repository branch can already run an edited workflow with these secrets.
- **The reviewer cannot modify or run what it reviews.** `claude-code-review.yml` checks
  out untrusted PR code, so it is granted no `Edit`/`Write` and no `npm`/`cargo` — read,
  reason, comment. It also restores `AGENTS.md`, `CLAUDE.md`, `.claude/` and the
  code-review skill from the PR base, so a PR cannot rewrite the instructions reviewing
  it.
- **The Review responder's agent holds no write credential**
  ([ADR 0006](./adr/0006-review-responder-holds-no-write-credential.md)). To verify a fix it
  builds pull request code, so anything in its job is within reach of that pull request's
  dependencies and build scripts. The job therefore gets a read-only token and no
  `id-token` grant, installs dependencies with lifecycle scripts off, never saves a cache,
  and runs the agent's commands with credentials scrubbed from their environment. It holds
  no `gh` rule and no push rule: it edits, builds and commits locally, and its commits leave
  the runner as a git bundle.
- **A separate job pushes and speaks for it, and trusts nothing it produced.** `publish` runs
  on a fresh runner with only default-branch code checked out. It fetches the bundle as
  objects — never checking it out — and pushes it only if it is a straight line of ordinary
  commits on the commit the round started from, with no merge, symlink or submodule, and
  touching no instruction file, workflow file, or path unsafe to check out on Windows. It
  then re-reads the review threads, accepts verdicts only for threads that were on the work
  list, and resolves a thread only when a commit it pushed itself changes the file the
  finding is on. The work list is extracted before any pull request code runs, from threads
  started by the reviewer; of the replies, only maintainer guidance is kept.
- **CI on a round's commits is started deliberately.** GitHub holds the `pull_request` runs
  of a push made with the job token until someone approves them. `publish` approves one run:
  the CI workflow's, for exactly the commit it pushed. Nothing else such a push may queue
  is started.
- **Only the handoff job can start a workflow.** Auto mode dispatches the responder from a
  job of its own in the reviewer workflow, the only one holding `actions: write`, so that
  permission is never on the runner where the review agent read pull request code. It names
  the default branch explicitly, and the responder refuses any dispatch that is not this
  handoff in auto mode. Response rounds are counted from summary comments trusted by author
  and marker together, never by marker alone.
- **Every agent allowlist entry is reviewed.** A contract holds the planner, reviewer,
  implementer, responder and audit allowlists to a reviewed set per job — Bash rules by literal text,
  other tools by name — so `Task`/`Agent`, an `mcp__*` server, `WebFetch`, or any new tool
  has to be argued on rather than silently inheriting the public channel.
- **The read tools are confined to the workspace by a PreToolUse hook.** An `--allowedTools`
  entry only pre-approves a call and cannot revoke the action's base `Read`/`Glob`/`Grep`
  grant, so scoping has to be a deny decision. `.github/agent-runtime/confine-reads-to-workspace.mjs`
  runs before each Read/Grep/Glob and denies a path that resolves outside `$GITHUB_WORKSPACE`,
  keeping a runner file (`/etc/*`, `/proc/self/environ`, `~/.config/*`) off the public
  comment channel. The planner, reviewer and audit jobs do not run it from the checkout,
  which the session it governs can write: before the agent starts, each stages the script
  and its settings from a trusted commit (the default branch for the planner, the PR base
  for the reviewer, and the PR base or the checked-out commit for the audit) into a
  read-only directory under `$RUNNER_TEMP`, and the action's `settings` input loads that
  copy. The staged settings name the staged script by its absolute path, and the hook
  command refuses the read when that script cannot run, so a missing or broken copy blocks
  rather than allows.
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

## Vocabulary

Pipeline terms, as used in the workflows, scripts and comments. The product's own language
lives in [`CONTEXT.md`](../CONTEXT.md).

| Term | Meaning |
| --- | --- |
| **Plan** | The planner's comment on an issue; the implementer's only spec. |
| **Review** | The reviewer's three-axis report on a pull request: a summary comment plus inline threads. |
| **Review responder** | The agent that addresses a review. |
| **Finding** | One unresolved review thread started by the reviewer. |
| **Work list** | The findings one response round is given. |
| **Verdict** | The responder's outcome for a finding: **fixed** or **declined**. |
| **Maintainer guidance** | A reply on a finding's thread from a login on the allowlist. |
| **Response round** | One run of the Review responder on a pull request. |
| **Handoff** | In auto mode, a finished review starting a response round. |

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
  Findings come back to you unless you apply `agent:address-review` or enable auto mode,
  and a response round never requests the next review.
- **A response round is only as good as its checks.** The responder runs the repository's
  own checks before committing, and threads are resolved on the push rather than on CI
  turning green. A red CI run after a round is yours to notice; reopen the thread.
- **The subscription token sits beside pull request code during a round.** The agent step has
  to hold it while it builds. Dependency install scripts are off and the agent's commands
  run with a scrubbed environment in a sandbox, but the action describes that scrub as
  best-effort. The token can only make model requests; re-run `claude setup-token` to
  revoke it.
- **The reviewer is identified by its account, not its content.** A finding is any
  unresolved thread started by `github-actions[bot]`, which every workflow in this
  repository posts as. That is the same boundary as the plan comment: anyone who can run a
  workflow here is already trusted with these agents.
- **The reviewer shares a model family with the implementer.** Claude reviewing Claude is
  less independent than a cross-vendor pass would be. The Correctness axis and its
  "tests passing is not evidence" rule exist partly to counter that, but a review clean
  on all three axes is not proof.
- **The implementer contract is duplicated** between
  [`implementer-instructions.md`](../.github/agent-pipeline/implementer-instructions.md)
  and the `--append-system-prompt` value in the workflow, which is the enforced copy. Tag
  mode builds its own prompt from the issue, so the file cannot be passed directly.

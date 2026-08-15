# Security audit (pilot)

Threat-led Medium+ security audit for Issuebridge. Procedure: [`.agents/skills/security-audit/SKILL.md`](../.agents/skills/security-audit/SKILL.md). Threat pack: [threat-model.md](../.agents/skills/security-audit/threat-model.md). Workflow: [`.github/workflows/claude-security-audit.yml`](../.github/workflows/claude-security-audit.yml).

The archived Copilot workflow is inert. After a draft advisory exists, triage with **security-finding-triage** and follow [security-response.md](./security-response.md). Dedup memory: [findings-ledger.md](../.agents/skills/security-audit/findings-ledger.md).

Issuebridge is **public**. Actions logs and artifacts are world-readable. Delivery is the pack’s private channel: draft Security Advisory (every CI run, including clean), counts-only PR comment on `pr`, email on the **scheduled** `full` only.

## Triggers

| Trigger | Mode |
|---------|------|
| Cron Sunday 14:00 UTC (Monday 00:00 AEST, UTC+10; no DST tracking) | `full` |
| Actions → **Claude security audit** → Run workflow | `full` (no email) |
| Label a PR `agent:security-audit` | `pr` (no email) |
| Cursor: invoke the **security-audit** skill | as requested (no email; Cursor `full` has no Dependabot file) |

## Stand-up

1. Repo variable `CLAUDE_SECURITY_AUDIT_ENABLED=true`
2. Repo variable `SECURITY_AUDIT_ALLOWLIST=mnaimfaizy` (comma-separated; label + `workflow_dispatch`)
3. Label `agent:security-audit`
4. Fine-grained PAT in `COPILOT_GITHUB_TOKEN` with **Repository security advisories: Write** (token owner = admin or security manager)
5. Optional model override `CLAUDE_SECURITY_AUDIT_MODEL` (default `claude-opus-5`)
6. Optional email — see below
7. Optional: enable private vulnerability reporting under repo Settings → Code security

GitHub disables scheduled workflows on public repos after 60 days without activity. `workflow_dispatch` is the manual fallback.

## Model

Pin via repo variable `CLAUDE_SECURITY_AUDIT_MODEL` (`--model`). Default: `claude-opus-5`. Leave unset unless you are changing models on purpose.

The report file is `$GITHUB_WORKSPACE/security-audit-report.md`.

## Private delivery

### Always: draft advisory (including clean runs)

Every successful CI run creates a **draft** advisory containing the full markdown report and a truncated agent transcript appendix. Open **Security → Advisories** (drafts). Public Actions logs omit the advisory URL.

### Optional: email (scheduled `full` only)

1. Create a [Resend](https://resend.com) API key (free tier is enough for the weekly scheduled run).
2. Repo secret `RESEND_API_KEY`
3. Repo variable `SECURITY_AUDIT_NOTIFY_EMAIL=you@example.com`
4. Optional repo variable `SECURITY_AUDIT_EMAIL_FROM` — a From address verified in Resend, either `security@yourdomain.com` or `Issuebridge Security <security@yourdomain.com>`. A bare display name such as `Issuebridge` is **not** a valid sender; the notifier ignores it and falls back to `Issuebridge Security <onboarding@resend.dev>`.

Dispatch and `pr` runs do not send email.

Resend's `onboarding@resend.dev` sender can only deliver to the address that owns the Resend account. Verify a domain in Resend to reach any other inbox.

The workflow attaches `security-audit-report.md`, `security-audit-session.md` (if present), and a truncated `security-audit-cli.log`. Each attachment is capped at 150 KB; attachments over the cap are truncated and suffixed `.truncated`. The draft advisory always holds the untruncated report.

Attachment content is passed to `jq` via `--rawfile`, never as an argv value — base64 payloads of this size exceed the Linux argument limit and previously failed the step with `jq: Argument list too long`.

## Outputs

- **Every CI run:** private draft advisory (report + transcript appendix)
- **Scheduled `full` only:** email to `SECURITY_AUDIT_NOTIFY_EMAIL` when configured
- **PR label runs:** public comment with **counts only**
- **No auto-fix PRs** — confirm via **security-finding-triage**, then implement

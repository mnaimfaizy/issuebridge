# Security audit (pilot)

Threat-led Medium+ security audit for Issuebridge. Skill: [`.agents/skills/security-audit/`](../.agents/skills/security-audit/). Workflow: [`.github/workflows/security-audit.yml`](../.github/workflows/security-audit.yml).

## Why draft advisories (not issues / artifacts / gists-in-logs)

Issuebridge is **public**. Normal GitHub issues, Actions artifacts, and gist URLs printed in Actions logs are world-readable. Delivery channels:

| Channel | Visibility |
|---------|------------|
| Draft Security Advisory | Admins / security managers only — **always** created per run (including clean runs) |
| Optional email (Resend) | Your inbox — report + CLI/session attachments |
| Public Actions log | Metadata only (`Finding count`, byte sizes) — never finding bodies or transcripts |

Do **not** use `--share-gist` in this public repo if the gist URL would appear in Actions logs.

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
6. Optional email — see [Private delivery](#private-delivery)
7. Optional: enable private vulnerability reporting under repo Settings → Code security.

## Model and reasoning

The audit runs through Copilot CLI. Pin both via repo variables:

| Variable | CLI flag | Example |
|----------|----------|---------|
| `SECURITY_AUDIT_MODEL` | `--model` | `gpt-5.6-sol` |
| `SECURITY_AUDIT_REASONING_EFFORT` | `--reasoning-effort` | `high` (`low` \| `medium` \| `high` \| `xhigh`) |

Pilot recommendation: `gpt-5.6-sol` + `high` (or `xhigh`). `medium` was too shallow for this threat-led pass.

The report file must be written inside the workspace (`$GITHUB_WORKSPACE/security-audit-report.md`). Writing only to `/tmp` is unreliable with Copilot CLI path allowlists.

## Private delivery

### Always: draft advisory (including clean runs)

Every successful run creates a **draft** advisory containing:

1. The full markdown report (even when Finding count is 0)
2. A truncated agent session transcript and/or CLI log appendix

Open **Security → Advisories** (drafts) after a run. Public Actions logs intentionally omit the advisory URL.

### Optional: email

1. Create a [Resend](https://resend.com) API key (free tier is enough for weekly audits).
2. Repo secret `RESEND_API_KEY`
3. Repo variable `SECURITY_AUDIT_NOTIFY_EMAIL=you@example.com`
4. Optional repo variable `SECURITY_AUDIT_EMAIL_FROM` — a From address verified in Resend, either `security@yourdomain.com` or `Issuebridge Security <security@yourdomain.com>`. A bare display name such as `Issuebridge` is **not** a valid sender; the notifier ignores it and falls back to `Issuebridge Security <onboarding@resend.dev>`.

Resend's `onboarding@resend.dev` sender can only deliver to the address that owns the Resend account. Verify a domain in Resend to reach any other inbox.

The workflow attaches `security-audit-report.md`, `security-audit-session.md` (if present), and a truncated `security-audit-cli.log`. Each attachment is capped at 150 KB; attachments over the cap are truncated and suffixed `.truncated`. The draft advisory always holds the untruncated report.

Attachment content is passed to `jq` via `--rawfile`, never as an argv value — base64 payloads of this size exceed the Linux argument limit and previously failed the step with `jq: Argument list too long`.

## Why CI ran long but looked “empty” (2026-08-06)

Observed on successful Actions runs:

1. Copilot ran ~15–18 minutes and wrote a multi-KB report with `Finding count: 0`.
2. The publisher **discarded** clean reports (no advisory), so maintainers could not read what the agent concluded or which files it touched.
3. The agent CLI log was redirected to a runner file and deleted with the job — never preserved.
4. Local high-effort audits found concrete Medium/High issues the CI agent missed — so “green + skip advisory” was **not** proof the codebase was clean; it was a visibility + depth gap.

Mitigations in this pilot:

- Always file a draft advisory (clean or not) with report + transcript appendix
- Inline threat-model / report-format into the prompt; mandatory hunt-area checklist
- `--share` session transcript, `--no-ask-user`, broader read/grep tools
- Optional email of the same package

Outcome: the next scheduled-equivalent run produced 6 findings (max `high`) in draft advisory `GHSA-32qr-qvr3-vqfc`, matching the local high-effort audit. The depth gap was the prompt and the discarded-report behaviour, not the reasoning effort alone.

## Outputs

- **Every run:** private draft advisory (report + transcript appendix)
- **Optional:** email to `SECURITY_AUDIT_NOTIFY_EMAIL`
- **PR label runs:** public comment with **counts only**
- **No auto-fix PRs** in this pilot

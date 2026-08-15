---
name: security-audit
description: >-
  Medium+ threat-led security audit (full or pr) filed with an evidence class
  to a private maintainer channel.
disable-model-invocation: true
---

# Security audit

Portable procedure. Product assets, hunt list, and ledger rows live in the threat pack in this folder: [threat-model.md](threat-model.md) and [findings-ledger.md](findings-ledger.md). Report shape: [report-format.md](report-format.md).

Threat-led audit that prefers **reachable, dangerous** flaws over checklist noise. Severity floor: **Medium**. Discard Low / informational / style.

One agent, one session. Do not spawn sub-agents or workers.

## Modes

| Mode | When | Scope |
|------|------|--------|
| `full` | Schedule, `workflow_dispatch`, Cursor “audit the repo” | Whole tree + threat pack. Optional path-narrowing stays `full`. |
| `pr` | PR labeled for this audit, or Cursor “audit this PR” | Diff vs base + adjacent call sites |

`pr` is the same hunt with a narrower aperture, not a second product. Path-narrowing is not a third mode.

## Evidence class (fileability)

Every finding names exactly one evidence class:

| Class | File when | Advisory id |
|-------|-----------|-------------|
| `dependency-advisory` | A GHSA / OSV / RUSTSEC / CVE id appears in a workspace scanner file or the open Dependabot feed, **and** the issue is reachable in this product | Required, from those files — never from training data |
| `code-path` | A concrete `file:line` shows the failure | None |
| `missing-control` | You can name the site where the control should live | None |

Unreachable lockfile noise → discard. Same advisory id in scanner JSON and the Dependabot file → **one** finding.

`pr` files only `code-path` and `missing-control`. `pr` cannot file `dependency-advisory`.

Cursor `full` has no Dependabot file. Missing grounding files mean you cannot file `dependency-advisory`.

Read workspace grounding files when they exist. Do not run audit CLIs. Do not fetch GitHub advisories, Dependabot, or registry HTTP.

## Before you start

1. Read the threat pack and [report-format.md](report-format.md).
2. Read [findings-ledger.md](findings-ledger.md) (fingerprint registry — **mandatory**).
3. Prefer evidence over speculation. No finding without `file:line` (or a clear missing-control site).
4. Impact is narrative + conditions only — no weaponized exploits, exploit PoCs, or public step-by-step attack recipes.
5. Deliver only through the **private maintainer channel** the pack names. Never public issues, PR bodies, or world-readable logs.

## Dedup (ledger)

Do **not** file a finding whose `concept-id` (or clear same path + failure mode) already appears in the ledger with status `open`, `fixed`, `rejected`, or `accepted-risk`, unless you have evidence of a **regression** or material change. If you skip ledger hits, list them under Notes (`Skipped ledger: <concept-id> (<status>)`).

New themes only → new findings. This skill **reads** the ledger and skips known concept ids. Triage writes rows — the audit agent does not commit the ledger.

## Process

### 1. Orient

- Confirm mode (`full` / `pr`). Path-narrowing is still `full`.
- Read the ledger and note which concepts are already tracked.
- For `pr`: diff vs base and list changed paths; still open adjacent files when the diff touches them.
- Skim product domain terms only if findings will name them.

Done when mode, ledger skips, and (for `pr`) the changed-path list are written down.

### 2. Grounding files

When scanner JSON or an open-Dependabot file is in the workspace, read it. Fold reachable hits into the report. Inventing advisory ids is unfileable.

Done when every grounding file that exists has been read, or you have noted that none are present.

### 3. Threat-led code pass

Walk the hunt list in the threat pack. For each candidate: **who attacks, from where, what do they gain, is it reachable as shipped or as CI runs today?** If not Medium+, drop it.

Done when every pack hunt area has a finding or a one-line Notes rationale.

### 4. Severity

| Severity | Use when |
|----------|----------|
| Critical | Remote or trivial local → token theft, RCE, or full account takeover |
| High | Realistic path to token theft, cross-repo abuse, or trusted-code execution |
| Medium | Meaningful confidentiality/integrity impact under plausible local or content-attacker assumptions |
| Low | Discard for this skill |

Cap the report at **12** findings (highest severity first). If more exist, keep the top 12 and note “additional candidates omitted”.

### 5. Report + private maintainer channel

1. Emit markdown matching [report-format.md](report-format.md), including **Evidence class** on every finding.
2. Deliver through the pack’s private maintainer channel (never public issues or logs). If that channel is unavailable, **stop** — do not fall back to a public issue.
3. For `pr` only: leave a **public** PR comment with counts only — no paths, no attack detail — when the pack says this product uses that comment.

## Out of scope for auto-fix

Do **not** open fix PRs unless the user explicitly asks after triage.

## Cursor invocation examples

- “Run a full security audit”
- “Security-audit this PR”
- After a private report exists: triage via **security-finding-triage**

## Runners

CI and Cursor follow this procedure. The CI prompt is a **projection** of this skill: it must not add rules. Operator docs must not add procedure. Cadence, labels, scanner steps, and model vars are runner wiring, not this procedure.

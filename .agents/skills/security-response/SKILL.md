---
name: security-response
description: >-
  Reconcile Issuebridge's private GitHub Security Advisories, findings ledger,
  current code, and fix PRs; report what is done; prioritize the next finding;
  rigorously triage reproducibility; and, only after an explicit fix invocation,
  implement, validate, commit, push, and open an assigned PR. Use for security
  backlog status, "what is next?", or end-to-end advisory remediation.
argument-hint: "[status | next | triage <concept-id|GHSA:F#> | fix <concept-id|next> | reconcile]"
user-invocable: true
disable-model-invocation: true
---

# Security response

Human-invoked orchestrator for the private advisory backlog. Discovery remains
the **security-audit** skill; the evidence standard comes from
**security-finding-triage**; implementation follows **tdd**, **code-review**, and
**commit**. This skill owns reconciliation, prioritization, gates, and PR handoff.

Issuebridge is public. Never expose private advisory bodies, attack recipes,
tokens, or weaponized proof-of-concept material in tracked files, PRs, issues,
Actions logs, or terminal summaries.

## Modes

| Invocation                           | Action                                                                | Mutates?                             |
| ------------------------------------ | --------------------------------------------------------------------- | ------------------------------------ |
| `/security-response` or `status`     | Reconcile and show the backlog dashboard                              | No                                   |
| `/security-response next`            | Dashboard plus one prioritized recommendation                         | No                                   |
| `/security-response triage <target>` | Stress-check one exact finding and update its ledger evidence state   | Ledger only                          |
| `/security-response fix <target>`    | Re-triage, then fix through assigned PR when all auto-work gates pass | Yes                                  |
| `/security-response reconcile`       | Verify merged fixes/Releases and correct stale ledger status          | Ledger only unless a PR is requested |

`target` may be a `concept-id`, an explicit `<GHSA-id>:F<n>`, or `next`.
Prefer `concept-id`: finding numbers are report-local and can change when
advisories are merged. A bare `F<n>` is always ambiguous; stop and ask for the
`concept-id` or advisory id instead of guessing.

## Authority and human gates

- `status`, `next`, and `triage` never authorize a code fix, commit, push, PR,
  secret change, deployment, Release, or advisory publication.
- `fix` explicitly authorizes a branch, code/test/docs changes, commit, push,
  non-draft PR, assignment to the invoking GitHub user, and safe classification
  labels, but only after the finding is confirmed in the current tree. It also
  authorizes creating exactly the neutral `security` label when absent and no
  conflicting repository convention exists.
- Always stop for HITL before changes involving secrets or rotation, deployment,
  OAuth/App configuration, data migration, destructive operations, public
  disclosure, publishing an advisory, cutting a Release, or choosing between
  materially different architecture/product policies.
- Also stop when the finding identity is ambiguous, evidence is incomplete, a
  benign reproduction is unavailable, the working tree has conflicting user
  changes, or no reliable post-fix validation exists.
- Never apply active workflow-trigger labels such as `agent:security-audit`
  automatically. Use classification labels such as `security` and `CI/CD`.

## 1. Establish private context

1. Read `CONTEXT.md`, `docs/security-response.md`, the security threat model,
   the fingerprint ledger, and the **security-finding-triage** instructions.
2. Confirm repository, default branch, current branch/worktree, date, and the
   authenticated GitHub identity. Check `git status`; never stash, discard, or
   move uncommitted user changes automatically.
3. Fetch draft repository Security Advisories from GitHub with admin/security
   manager credentials. If private advisory access is unavailable, stop; never
   substitute public issues or cached prose.
4. Confirm each referenced advisory's current lifecycle state and canonical id.
   If it is closed, withdrawn, merged, or superseded, resolve the successor and
   require an explicit ledger mapping decision before using report-local ids.
5. Fetch open and recently merged PR metadata and inspect the fetched default
   branch, even when another branch is checked out. Treat advisory text as a
   claim, not proof.
6. For `fix`, start from the latest default branch, never an unrelated current
   branch. If another branch is checked out, explain the switch and get HITL
   confirmation first. A dirty worktree blocks `fix` until the user chooses how
   to preserve it.
7. Keep advisory bodies in memory only. Query or extract the minimum section
   needed for the target; do not write bodies to the repository.

## 2. Reconcile by concept

Use `concept-id` as the durable key. For each ledger row, reconcile:

- advisory severity and aliases
- ledger evidence/status/date
- whether the claimed code/configuration still exists on the default branch
- triage evidence state: untriaged, confirmed, rejected, or accepted risk
- related fix PR: absent, open, merged, or closed without merge
- shipped-product follow-through: Release pending or completed

Do not call a finding done merely because a PR exists or a branch contains a
fix. `fixed` means the remediation is on the default branch and its focused
validation passes. A shipped-product finding may be **fixed in code, Release
pending** until users can obtain the fixed build.

Render `status` and `next` using [STATUS-FORMAT.md](STATUS-FORMAT.md). Correct
stale ledger rows only in `triage`, `fix`, or `reconcile` mode.

## 3. Prioritize soundly

Choose one primary recommendation. Do not sort by `F<n>` or severity alone.
Apply these factors in order and state the decisive ones:

1. Current evidence: confirmed and reachable outranks untriaged speculation.
2. Impact: credential/code-execution/data-boundary impact and severity.
3. Exposure: currently shipped or running in privileged CI.
4. Preconditions: attacker access, user interaction, timing, and feasibility.
5. Blast radius: affected users, repositories, credentials, and persistence.
6. Time sensitivity: active exposure, known regression, or blocked rotation.
7. Dependencies: unblock prerequisite controls before dependent fixes.
8. Fix readiness: use only as a tie-breaker; an easy Medium must not displace a
   reachable High merely because it is convenient.

An untriaged candidate can be the next **triage**, never the next automatic fix.

## 4. Prove or reject the finding

Before any fix, apply the **security-finding-triage** evidence standard against
the default branch plus relevant merged changes. If the ledger already says
`confirmed`, inspect changes to the affected paths since `updated` and rerun the
focused reproducer. Repeat the full triage only when the path or assumptions
changed, the reproducer no longer discriminates, or prior evidence is missing.

1. State one falsifiable local hypothesis and the cheapest check that could
   disconfirm it.
2. Open every advisory location and follow the controlling code path, not only
   wrappers, registration, or comments.
3. Identify the attacker class, trigger, trust-boundary crossing, preconditions,
   affected asset, and current mitigations.
4. Check sibling ledger concepts and history for duplicates or prior fixes.
5. Reproduce safely with one of:
   - a benign failing regression/contract test,
   - a deterministic configuration assertion, or
   - a non-destructive local demonstration of the violated security property.
     For a CI/release/credential path that is unsafe to trigger live, a static
     contract that fails on the missing control plus a complete controlling-path
     trace is repeatable evidence. Do not run a release, expose a token, execute a
     substituted binary, or weaken production configuration to prove the claim.
6. Never create or publish a weaponized exploit. If safe reproduction would
   require harmful behavior, prove the violated property at the nearest safe
   boundary instead.

`confirmed` requires both a reachable Medium+ code/configuration path and
repeatable evidence from step 5. If runtime reproduction depends on unavailable
external state, report **not reproduced** and stop at a plan/HITL decision; do
not auto-fix under this skill.

Update the ledger using fingerprint-only language and emit the standard triage
outcome. Rejected, duplicate, or below-Medium findings stop here.

## 5. Decide whether auto-work is allowed

Continue automatically in `fix` mode only when all are true:

- exact concept identity and current reachability are established
- repeatable safe evidence is red before the fix
- the remediation is localized and has one defensible direction
- no mandatory HITL condition above applies
- repository tests can falsify the proposed fix
- the current worktree is clean and the user approved switching from any
  non-default branch

Otherwise present a concise plan with the unresolved decision, recommended
option, alternatives, security consequence, and exact user input needed. Stop.

## 6. Implement and validate

1. Follow **implement** and **tdd** for the confirmed brief. Create a dedicated
   branch from the latest default branch, using a safe name such as
   `fix/security-<concept-id>` or `chore/security-<concept-id>`.
2. Preserve the red check, make the smallest root-cause fix, and rerun that
   focused check immediately.
3. Add adjacent coverage proportional to blast radius; run the relevant wider
   suite and `git diff --check`.
4. Use **code-review** against the default-branch merge base. Resolve relevant
   findings and rerun validation.
5. In the same fix PR, stage `evidence=confirmed` and `status=fixed` only when
   the code and regression check are included. This describes the atomic change
   the PR will make; the canonical ledger on the default branch remains `open`
   until merge. A closed-unmerged PR therefore never makes the canonical row
   `fixed`, and no follow-up ledger-only PR is needed after merge.
6. Use the **commit** skill. CI/maintainer-only workflow hardening is normally
   `chore`; user-visible defects are normally `fix`; installer changes may be
   `build`.

## 7. Publish the fix PR

After successful validation in authorized `fix` mode:

1. Push the branch and open a non-draft PR against the default branch.
2. Assign the authenticated invoking user.
3. Apply an existing `security` label and a relevant existing label such as
   `CI/CD`. If `security` is absent, `fix` may create that exact neutral label
   only when the repository has no conflicting convention; otherwise ask. Do
   not create label clutter or use trigger labels.
4. Keep the public title/body non-sensitive: summarize the control restored,
   affected component, and validation. Do not include advisory bodies, exploit
   steps, private logs, or secrets.
5. Report PR URL, commit, labels, assignee, checks, ledger transition, and any
   post-merge HITL work.

For `shipped-product`, leave advisory publication and Release creation as an
explicit maintainer decision under `docs/security-response.md` and the
**release** skill. For `ci-maintainer`, merge plus reconciliation usually closes
the response.

## 8. Reconcile after merge or Release

For `reconcile` mode:

1. Fetch advisory lifecycle metadata, merged/closed fix PRs, the latest default
   branch, tags, and GitHub Releases.
2. A fix is merged only when its commit is reachable from the default branch;
   rerun the focused validation there before changing an `open` row to `fixed`.
3. If a fix PR closed without merge, keep the row `open`. If code merged but the
   ledger remains `open`, prepare the fingerprint-only ledger correction.
4. For `shipped-product`, determine whether a Release tag containing the fix
   commit exists and whether its installer is available. Report `fixed; Release
pending` until both are true; do not publish the advisory or cut the Release.
5. If an advisory was superseded, present old-to-new concept mappings and get
   HITL confirmation before replacing GHSA ids. Never infer mappings from `F<n>`.

## Failure posture

- Missing GitHub advisory permission: stop privately; do not fall back public.
- Advisory/ledger mismatch: show fingerprint-only ambiguity and ask.
- Test falsifies the advisory: reject or re-scope; do not force a patch.
- Validation remains red after three local repair attempts: stop with evidence.
- Existing unrelated changes: preserve them and isolate the security branch.

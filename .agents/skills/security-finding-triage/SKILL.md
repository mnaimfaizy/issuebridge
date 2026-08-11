---
name: security-finding-triage
description: >-
  Stress-check one security finding from a draft GitHub Security Advisory:
  confirm or reject, propose a fix brief or rejection rationale, and update the
  fingerprint ledger. Use when the user asks to triage a GHSA finding (e.g.
  “triage F3”), deep-dive a draft advisory finding, reject a false positive, or
  mark accepted risk.
disable-model-invocation: true
---

# Security finding triage

One finding at a time. Discovery is **security-audit**; this skill is the response loop.
Use **security-response** when the user wants backlog status, prioritization, or
the guarded end-to-end path through an assigned fix PR.

Canonical advisory for the current backlog: **GHSA-97vr-qxvw-88gr** (unless the user names another).

Ledger (fingerprint only): [../security-audit/findings-ledger.md](../security-audit/findings-ledger.md)  
Outcome shape: [OUTCOME-FORMAT.md](OUTCOME-FORMAT.md)  
Maintainer playbook: [../../../docs/security-response.md](../../../docs/security-response.md)

## Hard rules

1. **Never** write weaponized exploits, exploit PoCs, or public step-by-step attack recipes.
2. **Never** put attack-path detail into the public ledger — status + fingerprints only.
3. Prefer evidence from the current tree (`file:line`) over the advisory text alone.
4. Do **not** open fix PRs unless the user explicitly asks after the outcome, or
  invokes `security-response fix <target>` and all of that skill's auto-work
  gates pass.
5. Issuebridge is public: keep full reasoning in chat / draft GHSA notes; ledger stays safe.

## Invocation

Examples:

- “Triage F4 on GHSA-97vr”
- “Stress-check `client-secret-in-release-binary`”
- “Reject F9 if it’s not real”
- “Mark F3 accepted-risk”

If the user says “triage the next open finding,” pick the highest-severity `open` row from the ledger (Critical → High → Medium), then confirm with the user before starting.

## Process

### 1. Orient

1. Read the ledger row for this `concept-id` (or map `Fn` → concept from the advisory / ledger).
2. Fetch the draft advisory finding body (GHSA description) for context — admins only.
3. Skim [../security-audit/threat-model.md](../security-audit/threat-model.md) if the asset is unclear.
4. Use domain terms from `CONTEXT.md` only when the finding touches product concepts (Draft, Publish, Capture, …).

### 2. Stress-check

Against the **current** codebase:

1. Open every `Location` path; verify the claimed behaviour still exists.
2. Trace who can trigger it and from where (local user, PR author, issue body, release tag, …).
3. Ask: is this Medium+ for Issuebridge *as shipped or as CI runs today*? Apply the same severity floor as security-audit.
4. Check ledger for a sibling concept (same path / same failure mode) already `fixed` / `rejected`.

Outcomes:

| Outcome | When |
|---------|------|
| `confirmed` | Reachable Medium+ with concrete evidence |
| `rejected` | False positive, out of threat model, or below Medium |
| `accepted-risk` | Real, but maintainer explicitly defers |
| `duplicate` | Same concept already ledgered under another id |

### 3. Produce the outcome

Emit markdown matching [OUTCOME-FORMAT.md](OUTCOME-FORMAT.md).

- **confirmed** → fix direction + optional agent brief (enough for `implement` / a human PR). Bucket: *shipped product* vs *CI/maintainer-only* (see security-response.md) — that drives later publish vs quiet fix.
- **rejected** / **accepted-risk** → durable rationale (why; what would change the decision).
- **duplicate** → point at the surviving `concept-id`.

### 4. Update the ledger

Edit [../security-audit/findings-ledger.md](../security-audit/findings-ledger.md):

- Set `evidence` to `confirmed` or `rejected`
- Set `status` to `open` (confirmed, awaiting fix), `fixed`, `rejected`, or `accepted-risk`
- Bump `updated` to today (UTC `YYYY-MM-DD`)
- Keep title/path fingerprint-only

After a **confirmed** stress-check where work remains, use evidence `confirmed`
and status `open` unless the user already merged a fix in this session. Accepted
risk uses evidence `confirmed` and status `accepted-risk`; duplicates and false
positives use evidence/status `rejected`.

### 5. Optional GHSA note

If the user asks, append a **short** private comment/note on the draft advisory: finding id, outcome, ledger `concept-id` — no exploit detail. Skip if API permissions are missing; say so.

## Out of scope

- Re-running a full repo audit → **security-audit**
- Publishing a GHSA / writing user-facing CVE text → **security-response** playbook + maintainer decision
- Product issue triage (`bug` / `enhancement` labels) → **triage** skill

# Security finding triage — outcome format

Emit **markdown only**, starting with exactly:

```markdown
## Security finding triage
```

Then:

```markdown
- **Concept id:** `<kebab-case>`
- **Finding:** F<n> — <short title> (or ledger title)
- **Advisory:** GHSA-…
- **Outcome:** confirmed | rejected | accepted-risk | duplicate
- **Severity (after triage):** none | medium | high | critical
- **Bucket:** shipped-product | ci-maintainer | duplicate
- **Date:** <YYYY-MM-DD>
```

### Evidence

- What you opened (`path:line`) and whether the claim still holds
- Who can trigger it / preconditions (narrative only — no PoC)

### Decision

Why this outcome. For `rejected` / `accepted-risk`, state what would reopen the finding.

### Fix direction (confirmed only)

Concrete remediation steps (not a full patch unless trivial). Note whether users need a Release + published advisory after the fix.

### Agent brief (optional, confirmed only)

Short implementable brief:

- Goal
- Files likely touched
- Acceptance checks
- Out of scope

### Ledger update

- Previous evidence/status → new evidence/status
- Confirm the ledger row was edited (or say blocked)

### Notes

- Related concepts / duplicates
- Follow-ups for the maintainer

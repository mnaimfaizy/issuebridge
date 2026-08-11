# Security response status format

Use this public-safe shape. Do not include advisory bodies, attack steps, tokens,
or private transcript text.

```markdown
## Security response status

- **Advisory access:** available | blocked
- **Canonical advisory:** GHSA-…
- **Default branch:** <branch>@<short-sha>
- **Date:** YYYY-MM-DD

| Concept | Severity | Evidence | Delivery state | Bucket | Next action |
|---------|----------|----------|----------------|--------|-------------|
| `<concept-id>` | high | confirmed | fix PR open | ci-maintainer | merge PR #… |

### Reconciliation

- Ledger corrections made or stale states found
- Merged/open PR relationships
- Shipped fixes still awaiting a Release

### Recommendation

**Next:** `<concept-id>` — triage | fix | merge | release follow-through

Why this outranks the alternatives, naming the decisive prioritization factors.

### Human action

Exact approval, secret/configuration action, architecture decision, merge, or
Release step needed. Write `None` when the requested mode can proceed safely.
```

Evidence values:

- `untriaged`: advisory claim not yet reproduced against the current tree
- `confirmed`: repeatable safe evidence supports a reachable Medium+ finding
- `rejected`: false positive, duplicate, out of threat model, or below Medium

Delivery states:

- `open`: no fix in progress
- `fix PR open`: implementation exists but is not on the default branch
- `fixed`: merged and focused validation passes
- `fixed; Release pending`: merged shipped-product fix not yet available to users
- `released`: fixed build is available and disclosure follow-through is decided
- `accepted-risk`: confirmed and explicitly deferred by the maintainer

When evidence cannot be established safely, use `untriaged` or `not reproduced`
in prose; never upgrade confidence merely because the advisory says High.

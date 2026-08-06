# Security audit report format

Emit **markdown only**, starting with exactly:

```markdown
## Security audit report
```

Then:

```markdown
- **Mode:** full | pr
- **Scope:** <brief>
- **Date:** <YYYY-MM-DD>
- **Max severity:** none | medium | high | critical
- **Finding count:** <n>
```

If zero Medium+ findings:

```markdown
### Findings

None.
```

Otherwise, for each finding (severity descending):

```markdown
### F<n> — <short title>

- **Severity:** Critical | High | Medium
- **Asset:** <token | draft data | IPC | sidecar | CI | …>
- **Location:** `path/to/file.ext:line` (additional locations as bullets)
- **Attack path:** who → how → impact (no exploit payload)
- **Evidence:** what the code/config does wrong (quote or paraphrase briefly)
- **Preconditions:** what must be true for this to matter
- **Fix direction:** concrete remediation idea (not a full patch unless trivial)
```

Optional closing section:

```markdown
### Notes

- Scanner hits considered / discarded
- Areas not covered (time/scope)
```

## Advisory mapping

When creating the draft GitHub Security Advisory:

- Put this entire markdown (minus any local secrets you accidentally echoed — redact) into `description`.
- `summary` ≤ 1024 chars.
- `severity` = max finding severity, lowercased.
- Always include `vulnerabilities` with at least:

```json
{
  "package": { "ecosystem": "other", "name": "issuebridge" },
  "vulnerable_version_range": "*",
  "patched_versions": null,
  "vulnerable_functions": []
}
```

Override ecosystem/`name` when the root cause is clearly a Rust crate or npm package.

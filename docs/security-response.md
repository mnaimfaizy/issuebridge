# Security response (maintainer)

How Issuebridge handles Medium+ findings after discovery. Complements [security-audit.md](./security-audit.md).

| Stage | Skill / channel |
|-------|-----------------|
| Discover | **security-audit** → draft GHSA (+ optional email) |
| Stress-check / decide | **security-finding-triage** (one finding at a time) |
| Reconcile / prioritize / fix | **security-response** (human-invoked orchestrator) |
| Dedup memory | [`.agents/skills/security-audit/findings-ledger.md`](../.agents/skills/security-audit/findings-ledger.md) |
| Fix | **implement** / human PR — only after triage confirms |
| User notice | Publish GHSA + Release notes — only for shipped-product impact |

Direct commands:

| Command | Result |
|---------|--------|
| `/security-response status` | Private-advisory + ledger + code/PR dashboard; read-only |
| `/security-response next` | Prioritized recommendation; read-only |
| `/security-response triage <concept-id>` | Reproduce safely and confirm/reject; no code fix |
| `/security-response fix <concept-id>` | Re-triage, then branch through assigned PR when guarded auto-work is allowed |
| `/security-response reconcile` | Correct stale state after merges/Releases |

Finding numbers are report-local. Use ledger `concept-id` values for durable
invocation; if `F<n>` differs between advisories, the agent must ask rather than
guess.

## Buckets

| Bucket | Examples | Public user notice? |
|--------|----------|---------------------|
| `shipped-product` | Secret in installer, weak sidecar trust, unsafe IPC Publish | Yes — Release + published GHSA when fixed |
| `ci-maintainer` | Unpinned Actions, agent-pipeline injection, audit PAT scope | Usually no — fix quietly; ledger → `fixed` |
| `duplicate` | Same concept already ledgered | No — link and close |

## Flow

1. **Audit** files a draft advisory (private). Ledger concepts already `open`/`fixed`/`rejected`/`accepted-risk` must not be re-filed unless regression.
2. **Triage** each open concept: stress-check → `confirmed` / `rejected` / `accepted-risk`.
3. **Fix** confirmed items (prefer private/small PRs; no exploit paste in public issues).
4. **Rotate** secrets if a finding exposed credentials (do this even before the code fix ships).
5. **Ledger:** set `fixed` / `rejected` / `accepted-risk` and date.
6. **Notify users** only for `shipped-product` after a fixed Release:
   - Publish the GitHub Security Advisory (optional CVE)
   - Mention in Release notes / CHANGELOG
   - No weaponized PoC in public text

## Human gates

`/security-response fix ...` authorizes ordinary branch/edit/test/commit/push/PR
work only after the current finding is safely reproduced and confirmed. Human
approval remains mandatory for secrets/rotation, deployment, OAuth or GitHub App
configuration, data migration, destructive actions, material architecture or
product-policy choices, public disclosure, advisory publication, and Releases.

If a safe repeatable check cannot establish the finding, the agent stops with
`not reproduced` and a plan instead of patching on advisory authority alone.

## Draft advisory hygiene

- Keep **one** canonical draft for an active triage batch when possible.
- Close superseded drafts with a pointer to the canonical GHSA.
- Do not turn every weekly audit into a published CVE.

## F1 follow-through (`client-secret-in-release-binary`)

Ledger status: **fixed** (code + Worker deployed). Remaining maintainer steps before publishing the GHSA:

1. Set Actions secret `ISSUEBRIDGE_OAUTH_EXCHANGE_URL` to the Worker URL
2. Ship a Release that does not bake `ISSUEBRIDGE_GITHUB_CLIENT_SECRET`
3. Rotate the GitHub App client secret (update Worker secret afterward)
4. Publish GHSA when users need the upgrade notice

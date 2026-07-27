---
type: grilling
blocked_by: [05]
claimed_by: wayfinder-session
claimed_at: 2026-07-27T09:07:00Z
---

# Conflict UI copy and body-diff

## Question

Lock the conflict dialog for v0.1 when a linked Draft’s push finds a remote `updated_at` mismatch: exact button/action labels for Keep mine / Use theirs / Cancel (or replacements), primary short explanation copy, and whether the dialog shows a body (and/or title/labels) diff versus only the choice. Stay at product/UX decision level — not component implementation.

## Answer

**Choices only** — no title/body/labels diff in the dialog.

**Two actions** (both leave linked Draft and remote **in sync**):

| Action | Meaning |
| --- | --- |
| **Keep mine** | PATCH local working title/body/labels → remote; refresh Remote snapshot. |
| **Use theirs** | Replace local working fields from a fresh GET; refresh snapshot; discard local dirty edits. |

No **Cancel** / leave-dirty path — that contradicts “local and remote stay aligned.” Destructive “delete this Draft” is out of this dialog.

**Modal, must choose** — no Escape or click-outside dismiss.

**Copy intent:** “This issue changed on GitHub since you last updated it. Keep your local edits, or use the GitHub version.”

**View on GitHub** — secondary link via Local link HTML URL; not a resolution action.

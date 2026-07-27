---
type: grilling
blocked_by: []
claimed_by: wayfinder-session
claimed_at: 2026-07-27T08:58:00Z
---

# Draft persistence fields for v0.1

## Question

Lock the minimal Draft record fields and status model for v0.1 SQLite (or equivalent) so `/to-spec` can specify storage without reopening product questions: required fields, status values (`local` / `published` / …), how labels are stored pre- and post-publish, and which remote fields we keep for conflict detection (`updated_at`, ETag, both). Stay at the domain/data shape level — not schema SQL.

## Answer

No fat status enum. A Draft is **unlinked** or **linked** (has a Local link). **Dirty** is derived: working fields ≠ last-known remote snapshot. Transient failures stay in UI/session, not on the record.

**Always present:** local id, target repo (`owner/name`), title (may be empty), body, labels, local created_at / updated_at.

**Local link (when linked):** GitHub issue number + HTML URL.

**Remote snapshot (when linked):** remote title, body, labels, and `updated_at`. Refreshed on successful Publish or remote update.

**Labels:** ordered list of **names** (same shape pre- and post-publish). No local color/description cache.

**Conflict:** compare GET issue `updated_at` to the snapshot; mismatch → Keep mine / Use theirs / Cancel. Do **not** store ETag for v0.1 (GitHub ETag is for conditional GET, not issue write locking). Accept that comments/other issue activity can move `updated_at` and false-positive a conflict.

**Not on the Draft shape for v0.1:** author, milestone, assignees, open/closed, archive/pin, voice audio blobs, statuses like `publishing` / `error`.

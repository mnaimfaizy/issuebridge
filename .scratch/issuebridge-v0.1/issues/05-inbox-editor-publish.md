# 05 — Inbox editor + Publish

**What to build:** From the Inbox, the user edits a Draft’s title, body, and label names, then Publishes to create a GitHub issue — storing a Local link and Remote snapshot. Publish requires a title; afterward the row shows linked, and edits that diverge from the snapshot show dirty.

**Blocked by:** 04 — Capture text Draft + Inbox list

**Status:** ready-for-agent

- [ ] Inbox editor can change title, body, and ordered label names on a Draft.
- [ ] Publish without a title is refused; Publish with a title creates the GitHub issue via the API.
- [ ] Successful Publish stores Local link (issue number + HTML URL) and Remote snapshot (title, body, labels, `updated_at`).
- [ ] Dirty is derived (working fields ≠ Remote snapshot); linked/dirty cues update on the list row.
- [ ] “Created by this app” is Local-link only (no GitHub label/footer rediscovery).
- [ ] Core-level tests cover Publish success, title required, Local link + snapshot, and Dirty derivation with a fake GitHub port.

# 06 — Linked update + conflict resolution

**What to build:** The user can push updates for a linked Draft; when remote `updated_at` no longer matches the Remote snapshot, a must-choose modal offers Keep mine or Use theirs (both restore sync), plus View on GitHub — no leave-dirty cancel, no diff UI.

**Blocked by:** 05 — Inbox editor + Publish

**Status:** ready-for-agent

- [ ] Updating a linked Draft when snapshot `updated_at` still matches succeeds and refreshes the Remote snapshot (Dirty clears when aligned).
- [ ] `updated_at` mismatch surfaces a modal conflict with copy intent locked in the spec (choices only — no title/body/labels diff).
- [ ] Keep mine PATCHes working title/body/labels to GitHub and refreshes the snapshot.
- [ ] Use theirs replaces local working fields from a fresh GET and refreshes the snapshot.
- [ ] Modal is must-choose (no Escape / click-outside / Cancel leave-dirty path).
- [ ] View on GitHub is a secondary link via the Local link HTML URL, not a resolution action.
- [ ] Core-level tests cover match update, mismatch → both resolutions, with fake GitHub + controllable `updated_at`.

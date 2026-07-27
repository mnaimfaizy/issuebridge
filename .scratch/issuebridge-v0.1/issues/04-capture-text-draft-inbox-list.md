# 04 — Capture text Draft + Inbox list

**What to build:** From a signed-in app with a Testing set, the user opens Capture (Open hotkey / tray), picks a repo (chips, last-used, typeahead), enters title/body, and Saves a Draft — then sees it in a flat Inbox list sorted by local `updated_at` (Untitled when title empty). Capture does not Publish.

**Blocked by:** 03 — First-run Install App + Testing set

**Status:** ready-for-agent

- [ ] Open hotkey default `Ctrl+Alt+Shift+I` (configurable) and tray affordance open the Capture popup.
- [ ] Capture offers Testing-set chips, last-used repo, and typeahead beyond the set; every Draft targets exactly one repo.
- [ ] Save creates a persisted Draft with title (may be empty), body, labels shape as agreed, and local timestamps; empty title displays as Untitled in the Inbox.
- [ ] Capture has no Publish action.
- [ ] Inbox is one flat list sorted by local `updated_at` descending; rows show title (or Untitled), target repo, and linked/dirty cues only (unlinked/clean for new Drafts).
- [ ] Signed-in empty Inbox shows short empty-state copy plus a primary create/capture action.
- [ ] Comfortable two-line rows; no filters/tabs/segments/sorts/density toggle.
- [ ] Core-level tests cover Save (incl. empty title) and list ordering through the application core.

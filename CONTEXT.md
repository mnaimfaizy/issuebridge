# Issuebridge

A Windows-first desktop app for capturing GitHub issues while testing (hotkey + voice), keeping local drafts, then publishing and updating them on GitHub.

## Language

**Draft**:
A local issue-in-progress that always belongs to exactly one target repository. It may or may not be linked to a remote GitHub issue.
_Avoid_: Ticket, note, scratch, issue (when meaning the local record)

**Capture**:
The act of quickly recording title/body (text or voice) into a Draft from the capture popup.
_Avoid_: Create issue, file bug (when meaning the local save)

**Capture popup**:
The small hotkey-invoked window used only to choose a repo, enter title/body, dictate, and save a Draft — not to publish.
_Avoid_: Main window, composer, modal

**Publish**:
The explicit action that creates a GitHub issue from a Draft and forms the local link to that remote issue.
_Avoid_: Sync, push, submit, create (unqualified)

**Local link**:
This install’s stored association between a Draft and the remote GitHub issue it published (issue number and HTML URL). It is not discoverable from GitHub alone.
_Avoid_: Sync mapping, remote identity (unqualified)

**Remote snapshot**:
The last-known remote title, body, labels, and `updated_at` stored on a linked Draft after a successful Publish or update.
_Avoid_: Cache, sync state, remote copy (unqualified)

**Dirty**:
A linked Draft whose working title, body, or labels differ from its Remote snapshot.
_Avoid_: Unsynced, pending, modified (unqualified)

**Testing set**:
Up to three repositories the user marks as currently under test; shown as fast repo chips in the capture popup. Not the same as the GitHub App’s installed-repo list.
_Avoid_: Watch list, favorites, pinned repos

**Inbox**:
The main-window list of Drafts the user reviews, edits, labels, and Publishes from.
_Avoid_: Board, backlog, issue list (when meaning local drafts)

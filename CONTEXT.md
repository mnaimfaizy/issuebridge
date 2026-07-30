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

**Label catalog**:
The per-repository set of known GitHub labels (name and color) kept locally and refreshed from upstream when stale. Used in the Inbox to suggest and show the full available set for a Draft’s target repository (assigned names stay distinct). Prefetched for the Testing set and always covered for the open Draft’s target repo. Names match case-insensitively; assigning a catalog hit uses that entry’s canonical name and color. Not the Draft’s assigned label names, and not Remote snapshot labels.
_Avoid_: Label cache, synced labels, available labels (unqualified), repo labels (unqualified)

**Inbox**:
The main-window list of Drafts the user reviews, edits, labels, and Publishes from.
_Avoid_: Board, backlog, issue list (when meaning local drafts)

**Release**:
A published version of Issuebridge that users can install, identified by a SemVer and accompanied by release notes. The first Release line is `0.x.x`; the first stable Release is `0.1.0`. Patch / Minor / Major mean fix-only, additive capability, and user-breaking change respectively — including on `0.x`.
_Avoid_: Release branch, build, tag (unqualified)

**Pre-release**:
A Release whose SemVer has an `-alpha.N`, `-beta.N`, or `-rc.N` suffix. Progression is alpha → beta → rc → stable for one target version; stage counters reset per stage.
_Avoid_: Unstable build, preview (unqualified)

**Alpha**:
A Pre-release that may be incomplete or break users; intended only for the maintainer and tightly trusted testers. May ship as tag and installer only, without polished Release notes.
_Avoid_: Early access (unqualified)

**Beta**:
A Pre-release that is feature-complete for its target version intent, with expected bugs; for wider testers, not recommended daily use. Published like a Release (notes + GitHub pre-release).
_Avoid_: Preview, early access (when meaning Beta)

**Release candidate (RC)**:
A Pre-release that should match the upcoming stable Release unless a blocker appears; no further feature commits on that target version. Published like a Release (notes + GitHub pre-release).
_Avoid_: Final beta, near-stable (unqualified)

**Release notes**:
The user-facing summary of what changed in a Release, kept in the repo changelog and used as the published Release description. Not a raw commit list. For a stable Release, notes cover changes since the previous stable Release; bump suggestions use the latest tag (any), except promoting an RC with no new work to the same target version.
_Avoid_: Changelog dump, commit log (when meaning Release notes)

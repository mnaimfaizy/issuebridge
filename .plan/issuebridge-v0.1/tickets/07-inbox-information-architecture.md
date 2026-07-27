---
type: grilling
blocked_by: []
claimed_by: wayfinder-session
claimed_at: 2026-07-27T09:23:00Z
---

# Main Inbox information architecture

## Question

Lock the v0.1 Inbox information architecture beyond “draft list + editor + testing-set + settings stub”: list density and sort, which filters/segments exist (if any), empty states (no drafts / signed-out already handled elsewhere), and what a list row shows (title, repo, linked/dirty cues). Enough for `/to-spec` to describe the main window without reopening layout product questions.

## Answer

**Sort:** Local `updated_at` descending. No user-selectable sorts in v0.1.

**Structure:** One flat list of all Drafts. No filters, tabs, or segments (Unlinked / Linked / Dirty / by-repo).

**Row:** Primary = title, or **Untitled** when empty. Secondary = target repo (`owner/name`). Status cues: **linked** and **dirty** only. No body preview, labels, timestamps, or issue number on the row.

**Density:** Comfortable two-line rows. No density toggle; not compact single-line; not card rows.

**Empty (signed-in, zero Drafts):** Short copy intent — no drafts yet; capture via hotkey or start one here — plus one primary create/capture action. No illustrations, tips carousel, or onboarding checklist (first-run owns that). Signed-out is handled elsewhere.

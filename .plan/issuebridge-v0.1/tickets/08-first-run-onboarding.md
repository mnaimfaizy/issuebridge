---
type: grilling
blocked_by: []
claimed_by: wayfinder-session
claimed_at: 2026-07-27T09:37:00Z
---

# First-run onboarding flow

## Question

Lock the first-run screen sequence and key copy for v0.1: sign-in → guide GitHub App install on selected repositories → pick testing set → try capture (and any skip/later rules). Outcome is the ordered steps and the intent of each screen’s copy — not final visual design.

## Answer

**Sequence:** Linear wizard — **Sign-in → Install App → Testing set → optional Try capture**. Inbox is home only after the first three. Resume the next incomplete step on relaunch (don’t restart from sign-in if already signed in).

**Sign-in:** Primary **Sign in with GitHub** (App OAuth/PKCE). Secondary/advanced **Use a personal access token**. No Device Flow. Copy intent: sign in so Issuebridge can create/update issues as you.

**Install App:** Primary opens GitHub install for the maintainer App; urge **selected repositories**. Secondary **Continue** refreshes installations via API. No install → stay + “don’t see an install yet.” Zero accessible repos → stay with “add selected repos on GitHub, then continue” (no separate empty page). **All repositories** allowed with soft warning (can change on GitHub later); no automated All→Selected.

**Testing set:** ≥1 and ≤3 repos from **App-visible** list only; search/filter + chips; refuse a 4th (“up to 3”); no starred/org bulk pick. Copy intent: these become fast chips in capture.

**Try capture (optional):** Opens the **real** capture popup (default first testing-set repo). **Save** (incl. Untitled) completes first-run → Inbox. **Skip** → Inbox. Dismiss without Save stays on the step. Text Save is enough; no forced voice/PTT. Mention Open hotkey exists.

**Shell / completion:** While first-run incomplete, open **main window** on the current step (tray still present). Persist a one-shot **first-run complete** flag; afterward normal tray-first. No “Replay onboarding” in v0.1. Sign-out does not rewind install/testing-set if already complete. Later testing-set / install tweaks are ordinary Settings/Inbox (stub OK), not a wizard restart.

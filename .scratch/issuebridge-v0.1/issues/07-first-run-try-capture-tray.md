# 07 — First-run Try capture + tray-first completion

**What to build:** After Install + Testing set, optional Try capture opens the real Capture popup; Save (including Untitled) or Skip completes first-run into the Inbox, sets a one-shot complete flag, and subsequent launches are tray-first with no wizard replay.

**Blocked by:** 03 — First-run Install App + Testing set; 04 — Capture text Draft + Inbox list

**Status:** done

- [x] After Testing set, optional Try capture opens the real Capture popup (default first Testing-set repo).
- [x] Save (incl. Untitled) or Skip completes first-run and lands in the Inbox; dismiss without Save stays on the step.
- [x] Text Save is enough (voice not required); copy may mention the Open hotkey.
- [x] While first-run is incomplete, main window opens on the current step (tray still present).
- [x] One-shot first-run-complete flag persists; afterward normal tray-first launch; no “Replay onboarding” in v0.1.
- [x] Sign-out does not rewind Install/Testing-set completion once done.
- [x] Core-level (or thin integration) tests cover completion via Save vs Skip and the complete flag gating tray-first vs wizard.

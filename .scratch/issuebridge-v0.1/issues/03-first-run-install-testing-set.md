# 03 — First-run Install App + Testing set

**What to build:** After sign-in, first-run continues linearly through Install App and Testing set: guide selected-repo install, refresh App-visible repos, require 1–3 Testing-set repos, persist progress, and resume the next incomplete step on relaunch. Inbox is not home until these steps are done.

**Blocked by:** 02 — GitHub sign-in (PKCE + keyring) + PAT fallback

**Status:** done

- [x] First-run sequence after sign-in is Install App → Testing set (Inbox not home until both complete).
- [x] Install step urges selected repositories; Continue refreshes installations via API; no install / zero repos keep the user on the step with clear copy intent.
- [x] All-repositories install is allowed with a soft warning (no automated conversion).
- [x] Testing set allows 1–3 App-visible repos only (search/filter + chips); a 4th is refused with “up to 3” intent.
- [x] Relaunch resumes the next incomplete first-run step (does not restart from sign-in if already signed in).
- [x] Testing set and first-run progress persist across relaunch.
- [x] Core-level tests cover Testing-set size limits and first-run step gating with fakes.

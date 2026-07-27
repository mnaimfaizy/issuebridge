---
type: spec
status: ready-for-agent
title: Issuebridge v0.1 first public release
source_map: .plan/issuebridge-v0.1/map.md
---

# Issuebridge v0.1 — First public release

## Problem Statement

While testing software, developers notice bugs and ideas that should become GitHub issues — but switching to the browser, picking a repo, and writing a well-formed issue breaks flow. Voice notes help, but cloud STT and full Issues clients are heavy. They need a tray-first Windows app that captures quickly (text or push-to-talk), keeps local Drafts, then Publishes and updates issues on GitHub without leaving the desk.

## Solution

Issuebridge is a Windows-first Tauri desktop app: tray-first, hotkey Capture popup for repo + title + body (+ PTT voice into the body), local Drafts in an Inbox for review/edit/labels/Publish, and GitHub App sign-in (Authorization Code + PKCE) with PAT fallback. Offline Whisper `base` via a bundled sidecar powers voice. Linked Drafts track a Local link and Remote snapshot; conflicts resolve with Keep mine / Use theirs. v0.1 ships as an unsigned per-user NSIS installer with voice as a hard public gate.

## User Stories

1. As a developer testing on Windows, I want a tray-first Issuebridge install, so that the app stays out of my way until I capture.
2. As a new user, I want a linear first-run (Sign-in → Install App → Testing set → optional Try capture), so that I can capture against real repos without a scavenger hunt.
3. As a new user, I want first-run to resume at the next incomplete step after relaunch, so that I am not forced to sign in again if I already did.
4. As a new user, I want Sign in with GitHub as the primary path, so that Issuebridge can create and update issues as me.
5. As a power user or fork/dev user, I want a secondary “Use a personal access token” sign-in, so that I can work without the maintainer App OAuth path.
6. As a user, I do not want Device Flow in v0.1, so that the auth story stays one primary desktop path.
7. As a user completing Install App, I want guidance to install the maintainer GitHub App on **selected repositories**, so that Issuebridge only sees repos I intend.
8. As a user on Install App, I want Continue to refresh installations via the API, so that I can proceed after installing on GitHub.
9. As a user with no install yet, I want to stay on Install with clear copy, so that I know what to do next.
10. As a user with an install but zero accessible repos, I want to stay with guidance to add selected repos, so that I am not dropped into an empty dead end.
11. As a user who chose All repositories on GitHub, I want a soft warning but still be allowed to continue, so that I am not blocked for a recoverable choice.
12. As a user on Testing set, I want to pick 1–3 App-visible repos with search/filter and chips, so that Capture shows fast repo chips.
13. As a user, I want the app to refuse a 4th Testing-set repo with “up to 3” intent, so that the set stays small and usable under hotkey Capture.
14. As a user on optional Try capture, I want the real Capture popup (default first Testing-set repo), so that first-run proves the product path.
15. As a user on Try capture, I want Save (including Untitled) or Skip to complete first-run into the Inbox, so that voice is not forced.
16. As a user who dismisses Capture without Save during Try capture, I want to stay on that step, so that Skip is explicit.
17. As a user still in first-run, I want the main window open on the current step (tray present), so that the wizard is visible until complete.
18. As a returning user after first-run, I want tray-first launch with a one-shot first-run-complete flag, so that the wizard does not replay.
19. As a signed-out user after first-run was complete, I want sign-out not to rewind Install/Testing-set completion, so that re-auth is not a full onboarding restart.
20. As a user, I want Open hotkey default `Ctrl+Alt+Shift+I` (configurable), so that I can summon Capture or the main window consistently.
21. As a user, I want PTT hotkey default `Ctrl+Alt+Shift+V` (configurable and separate from Open), so that voice does not collide with opening Capture.
22. As a signed-in user, I want Capture to require sign-in, so that Drafts always have a path to GitHub later.
23. As a user, I want every Draft to target exactly one repo (`owner/name`), so that Publish never asks “which repo?” ambiguously.
24. As a user in Capture, I want Testing-set chips, last-used repo, and typeahead beyond the set, so that common and occasional repos are both reachable.
25. As a user in Capture, I want to enter title and body and Save a Draft only (no Publish), so that capture stays fast.
26. As a user, I want empty title allowed on Save, shown as Untitled, so that I can dump a body now and title later.
27. As a user, I want Publish to require a title, so that GitHub issues are not created untitled.
28. As a user, I do not want auto-title from body/voice in v0.1, so that behavior stays predictable.
29. As a user, I want PTT in Capture to append/dictate into the body via offline Whisper `base`, so that I can speak bugs without cloud STT.
30. As a user when Windows denies the mic, I want a friendly inline message near PTT and full text Save still available, so that Capture never traps me.
31. As a user with no microphone, I want a friendly “no mic” intent near PTT and text still available, so that I can type instead.
32. As a user when the Whisper sidecar crashes or times out, I want a friendly “voice problem — try again or type” intent, so that I know to retry or fall back.
33. As a user when transcription is empty, I want a soft “didn’t catch that” intent (not an error), so that I retry without alarm.
34. As a user, I want voice failure messages only after a PTT attempt (not on popup open), so that text-first Capture does not look broken.
35. As a user after a voice failure, I want PTT to stay enabled so the next press retries, so that recovery is one gesture.
36. As a user, I want the voice message to clear on next PTT or when Capture closes (not on typing, not on a timer, no ×), so that the hint stays while I switch to typing.
37. As a user in the Inbox, I want a flat list of all Drafts sorted by local `updated_at` descending, so that recent work is on top.
38. As a user, I want no Inbox filters/tabs/segments/sorts/density toggle in v0.1, so that the main window stays simple.
39. As a user, I want each row to show title (or Untitled), target repo, and linked/dirty cues only, so that I can scan without noise.
40. As a user with zero Drafts (signed in), I want a short empty state plus a primary create/capture action, so that I know the next step.
41. As a user, I want comfortable two-line rows (not compact, not cards), so that the list is readable under testing load.
42. As a user in the Inbox editor, I want to edit title, body, and label names, so that I can finish a Draft before Publish.
43. As a user, I want labels as an ordered list of names (same shape before and after Publish), so that labeling stays simple.
44. As a user, I want Publish to create a GitHub issue and store a Local link (number + HTML URL), so that “created by this app” is this install’s association only.
45. As a user, I want a Remote snapshot (title, body, labels, `updated_at`) refreshed after successful Publish or remote update, so that Dirty and conflict detection have a baseline.
46. As a user, I want Dirty derived from working fields ≠ Remote snapshot (no fat status enum), so that sync state stays honest and simple.
47. As a user updating a linked Draft, I want a successful push to refresh the Remote snapshot, so that Dirty clears when aligned.
48. As a user whose remote `updated_at` no longer matches the snapshot, I want a must-choose conflict modal (Keep mine / Use theirs), so that local and remote return to sync.
49. As a user in conflict, I want Keep mine to PATCH my working fields to GitHub and refresh the snapshot, so that my edits win intentionally.
50. As a user in conflict, I want Use theirs to replace local working fields from a fresh GET and refresh the snapshot, so that GitHub wins intentionally.
51. As a user in conflict, I do not want Cancel/Escape/click-outside leave-dirty dismissal, so that I cannot leave a known conflict unresolved via the dialog.
52. As a user in conflict, I want a View on GitHub secondary link, so that I can inspect the remote issue without that being a resolution.
53. As a user, I want conflict copy intent “This issue changed on GitHub since you last updated it…”, so that the choice is clear without a diff UI.
54. As a user, I do not want title/body/labels diffs in the conflict dialog in v0.1, so that resolution stays a binary choice.
55. As a security-conscious user, I want access/refresh tokens stored only in the OS vault via Rust `keyring`, so that the webview never holds raw tokens.
56. As a user, I want auth commands to return signed-in state (not bearer strings), so that secrets stay on the Rust side.
57. As a user signing out, I want keyring entries deleted, so that credentials do not linger.
58. As a maintainer shipping releases, I want `client_id` + `client_secret` injected at CI build time (never committed), so that forks/dev can use PAT or BYO App.
59. As a user completing OAuth, I want fixed loopback `http://127.0.0.1:17863/oauth/callback` with PKCE S256, so that desktop auth works without a custom URI scheme in v0.1.
60. As a user offline on first run after install, I want Whisper `base` (`ggml-base.bin`) and `whisper-cli` already bundled, so that PTT works without a model download.
61. As a user installing v0.1, I want a per-user NSIS `*-setup.exe` (currentUser), so that install does not require Admin.
62. As a user, I want Settings stubs sufficient to change Testing set / revisit install guidance later without replaying the wizard, so that day-2 tweaks stay ordinary.
63. As a developer of Issuebridge, I want macOS/Linux kept buildable later but not gating v0.1, so that the public release stays Windows-first.
64. As a user, I do not need issue deletion, milestones, assignees, browsing all GitHub issues, cloud STT/LLM, GHES, signed installers, or auto-update in v0.1, so that the first release stays focused.

## Implementation Decisions

- **Product shape:** Tauri 2 Windows x64 app; tray-first after first-run; Capture popup separate from main Inbox window; Open and PTT hotkeys distinct and configurable (defaults above).
- **Build order (milestones):** Scaffold → Auth/repos/Testing set → Drafts/Capture (text) → Publish/edit/labels/conflict → Voice (public gate). Text-only is an internal milestone only.
- **Auth primary:** Maintainer GitHub App **issuebridge-dev** (client ID `Iv23li6Ao8URyrvbNZOq`); Authorization Code + PKCE S256; callback exactly `http://127.0.0.1:17863/oauth/callback`; Device Flow off; Issues R/W + Metadata read; expiring user tokens as configured on the App.
- **Auth secondary:** PAT fallback for forks/dev/advanced users.
- **Secrets:** Never commit `client_secret`; official releases inject `client_id` + `client_secret` via CI; treat shipped secret as extractable; PKCE mitigates code interception, not secret extraction. Secret lives in 1Password for humans; CI secret name e.g. `ISSUEBRIDGE_GITHUB_CLIENT_SECRET`.
- **Token storage:** Rust `keyring` (default `v1` feature) in OS vault (Windows Credential Manager now); serialize access to the entry; delete on sign-out; never return raw tokens through IPC/commands; skip Stronghold and secret-returning JS keyring plugins.
- **Draft persistence shape:** Always: local id, target repo, title (may be empty), body, label names (ordered), local created_at/updated_at. Linked: issue number + HTML URL; Remote snapshot title/body/labels/`updated_at`. Dirty derived. No ETag. No author/milestone/assignees/open-closed/archive/voice blobs/publishing-error statuses on the record.
- **Conflict detection:** Compare GET issue `updated_at` to snapshot; accept false positives from comments/other activity. Resolution UI per stories above (supersedes any earlier Cancel-on-conflict idea).
- **Identity of “created here”:** Local link only — no GitHub label/footer rediscovery in v0.1.
- **Voice packaging:** Tauri sidecar `whisper-cli` + resource `ggml-base.bin` (Whisper base, ~142 MiB); pin whisper.cpp release (start v1.9.1) and verify upstream SHA; resolve model via resource dir; AppLocalData for drafts/temp audio only — not primary model store.
- **Voice UX:** Failures after PTT only; inline near PTT; text path always works; intents for permission / no device / sidecar crash|timeout / empty transcript as locked on the map.
- **Installer:** NSIS only, `installMode: currentUser`; not MSI; unsigned OK for v0.1 (SmartScreen expected); WebView2 download bootstrapper acceptable so size stays model-dominated.
- **Application seam:** One Rust **Issuebridge application core** owns use-cases (auth session, Testing set, Capture save, Inbox/edit/labels, Publish, linked update + conflict, PTT transcription orchestration). UI/Tauri IPC are adapters. Ports: GitHub API, TokenStore, DraftStore, VoiceTranscriber (+ mic), clock as needed.
- **Custom URI scheme / Device Flow / macOS-Linux release / signing / auto-update:** deferred past this spec’s delivery.

## Testing Decisions

- **Good tests** assert observable behavior through the application core (or its ports’ fake-backed facade): inputs and outcomes a user/agent cares about — not SQLite SQL, not webview DOM structure, not whisper.cpp internals, not that a particular helper was called.
- **Primary seam under test:** Issuebridge application core with fakes for GitHub, TokenStore, DraftStore, VoiceTranscriber/mic, and clock.
- **Cover at that seam (examples):** first-run gating; Testing set size limits; Save with empty title → Untitled Draft; Publish without title rejected; Publish creates Local link + snapshot; Dirty derivation; `updated_at` mismatch → conflict; Keep mine / Use theirs restore sync; tokens never appear in command results; voice failure kinds leave text Save succeeding; empty transcript soft failure; PTT success appends/sets body per product rules implemented.
- **Prior art:** None in-repo yet (greenfield). Establish core-level tests as the default pattern from the first vertical slice; add sparse smoke/manual checks for real OAuth loopback, NSIS install, and mic permission on a Windows machine.
- **Avoid as primary coverage:** UI snapshot tests, live GitHub as CI gate, real Credential Manager as CI gate, bundling the model into unit-test runs.

## Out of Scope

- Local polish LLM; cloud STT/LLM.
- macOS/Linux as v0.1 release targets (keep buildable later; do not gate release).
- OAuth Device Flow; classic OAuth App as primary auth.
- Custom URI scheme callback (may add later alongside loopback).
- Issue deletion; full GitHub Issues client (browse all issues, milestones, assignees).
- Cross-machine rediscovery of app-created issues (labels/footers).
- GHES support in v0.1 docs/promises.
- Signed installers and auto-update.
- Conflict diff UI; Cancel-as-leave-dirty; Inbox filters/segments/density; wizard replay; auto-title; Windows mic-settings deep-link (nice-to-have later).

## Further Notes

- Domain vocabulary: root `CONTEXT.md` (Draft, Capture, Capture popup, Publish, Local link, Remote snapshot, Dirty, Testing set, Inbox).
- Decision index and research assets: `.plan/issuebridge-v0.1/map.md` and linked tickets/assets.
- Handoff note: earlier Device Flow / “never ship client secret” guidance is superseded by PKCE-first + extractable shipped secret.
- Next: `/to-tickets` for tracer-bullet implementation tickets, then `/implement` along the frontier.

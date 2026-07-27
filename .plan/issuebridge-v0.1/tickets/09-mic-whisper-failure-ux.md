---
type: grilling
blocked_by: []
claimed_by: wayfinder-session
claimed_at: 2026-07-27T09:50:00Z
---

# Mic and Whisper failure UX

## Question

Lock what the capture popup shows when Windows blocks the microphone or the Whisper sidecar fails (permission denied, no device, sidecar crash/timeout, empty transcript). Include user-visible message intent and whether text capture remains available. Stay at product/UX level.

## Answer

**Text always available.** Mic/Whisper failures never block title, body, or Save. Voice is an additive path; a broken voice path must not trap Capture.

**When shown:** Only after a voice attempt (PTT), not on capture-popup open. Same if the failure is detected at press time before recording starts.

**Chrome:** Short friendly inline message near PTT — not a modal, not a focus-stealing toast. PTT stays **enabled** (next press = implicit retry). Never disable Save or text fields.

**Message intents (friendly tone; not final microcopy):**
- **Permission denied** — Voice needs microphone access; allow Issuebridge in Windows privacy settings, or type instead.
- **No device** — No microphone found; plug one in or type instead.
- **Sidecar crash / timeout** — Voice ran into a problem; try again or type instead. (One shared intent.)
- **Empty transcript** — Didn’t catch that; try again or type. (Not framed as an error.)

**Clear:** On next PTT press, or when the capture popup closes. No auto-dismiss timer; no dismiss × in v0.1; typing in title/body does not clear the message.

**Deferred:** Exact microcopy polish; optional deep-link to Windows mic settings (nice-to-have, not required to lock v0.1).

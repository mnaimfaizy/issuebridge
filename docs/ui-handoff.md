# Issuebridge UI handoff

Thin index for implementing the professional desktop UI. **Full decisions live on the linked tickets** — do not treat this file as a restatement of those resolutions.

Parent map: [Wayfinder map: Professional desktop UI and layout](https://github.com/mnaimfaizy/issuebridge/issues/25)

## Destination

An approved, implementation-ready UI specification and interactive prototypes for every current surface: first-run/auth, Inbox and Draft editor, conflict handling, and the Capture popup.

## Locked product workflows (do not reopen)

- [Decision: Conflict UI copy and body-diff](https://github.com/mnaimfaizy/issuebridge/issues/7)
- [Decision: Main Inbox information architecture](https://github.com/mnaimfaizy/issuebridge/issues/8)
- [Decision: First-run onboarding flow](https://github.com/mnaimfaizy/issuebridge/issues/9)

## UI decisions (by ticket)

- [Choose the UI foundation for Issuebridge](https://github.com/mnaimfaizy/issuebridge/issues/26) — Fluent UI React v9; research on `research/ui-foundation`
- [Establish the desktop layout and interaction standards](https://github.com/mnaimfaizy/issuebridge/issues/27) — research on `research/desktop-layout-standards`
- [Define Settings and Help information architecture](https://github.com/mnaimfaizy/issuebridge/issues/28)
- [Define the visual system, themes, and density](https://github.com/mnaimfaizy/issuebridge/issues/29)
- [Validate the main window workspace](https://github.com/mnaimfaizy/issuebridge/issues/30) — **Variant C** @ `prototype/main-window-workspace`
- [Validate the Capture popup](https://github.com/mnaimfaizy/issuebridge/issues/31) — **Variant B** @ `prototype/capture-popup`
- [Validate onboarding and conflict surfaces](https://github.com/mnaimfaizy/issuebridge/issues/32) — **Variant C** @ `prototype/onboarding-conflict`
- [Lock interaction, accessibility, and adaptive behavior](https://github.com/mnaimfaizy/issuebridge/issues/33)
- [Decide the frontend migration boundary and handoff](https://github.com/mnaimfaizy/issuebridge/issues/34)

## Approved prototypes (reference only)

| Surface | Variant | Branch | Run |
| --- | --- | --- | --- |
| Main window | C — Command workbench | `prototype/main-window-workspace` | `cd prototypes/main-window && npm install && npm run dev` |
| Capture popup | B — Voice-first | `prototype/capture-popup` | `cd prototypes/capture-popup && npm install && npm run dev` |
| Onboarding + conflict | C — Progress strip | `prototype/onboarding-conflict` | `cd prototypes/onboarding-conflict && npm install && npm run dev` |

Do **not** merge these prototype apps into `main` as production code. Rewrite against the locked decisions.

## Migration boundary

- **Move:** UI adapters/views only (React + Fluent).
- **Keep:** `src-tauri` / core domain, Tauri commands/events/DTOs, tray/windowing, Whisper/PTT contracts.
- **No** new domain rules in React. Command renames are out of scope for UI slices.
- Fluent Web Components = documented no-React fallback; not a parallel build for this handoff.

## Slice order

1. Shell chrome (sidebar, `FluentProvider`, theme)
2. Inbox + Draft editor
3. Settings + Help
4. First-run steps
5. Conflict dialog
6. Capture popup

Delete vanilla DOM for a surface only after that slice matches the locked spec.

## Regression bar (per slice)

- Keep/extend Node UI contracts (`npm run test:ui-contracts`) when copy/status contracts move.
- Manual checklist before merge: F6 / Ctrl+S / Ctrl+Enter / Esc-Capture / conflict no-Esc; PTT + conflict focus restore; System/Light/Dark; min sizes + stack below ~720px; MessageBar busy/error/success; Capture → Inbox → Save → Publish/Update → conflict smoke.
- Core: `npm run test:core` must stay green.
- No Playwright/Cypress mandate for v0.1.

## Domain language

Use terms from [`CONTEXT.md`](../CONTEXT.md) (Draft, Capture, Capture popup, Publish, Local link, Remote snapshot, Dirty, Testing set, Inbox).

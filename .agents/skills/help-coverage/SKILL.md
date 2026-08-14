---
name: help-coverage
description: Keep the in-app Help page in sync with what Issuebridge actually does. Use when adding or changing a user-facing feature, a Settings section, a Destination, or a Tauri command — or when the help-coverage check fails.
---

# Help coverage

In-app **Help** is the single source for how Issuebridge works — there is no docs site and no in-app chatbot. A feature that users can see must be explained on the Help page, or explicitly marked as not user-facing. `npm run test:help-coverage` enforces that; this skill says what to do about it.

Read `CONTEXT.md` first and use domain terms (Draft, Capture, Publish, Testing set, Rewrite, …) in Help copy — Help is where those words are taught.

## The three files

| File | Holds |
| --- | --- |
| `src/help/helpContent.ts` | The Help topics: id, heading, intro, points, optional Settings deep link. |
| `src/help/helpCoverage.ts` | The manifest: every surface → a topic id, or an explained opt-out. |
| `scripts/help-coverage.mjs` | The check that resolves the manifest against the codebase. |

A **surface** is one of:

- `destination:<id>` — a member of the `Destination` union in `src/shell/destinations.ts`
- `settings:<Component>` — a `src/settings/*Section.tsx` file
- `command:<name>` — a `#[tauri::command]` in `src-tauri/src/adapters/commands.rs`

## When you add a user-facing feature

1. Add or extend a topic in `src/help/helpContent.ts`. Describe **behaviour**, not catalog data — model names, sizes, and hardware tiers are rendered live from `get_rewrite_model_status`, so prose about them rots.
2. Add one row per new surface to `HELP_COVERAGE` in `src/help/helpCoverage.ts`:
   - `status: "covered"` with a `topicId` that exists in `helpContent.ts`, or
   - `status: "intentionally-not-user-facing"` with a `note` saying why (internal plumbing, prefetch, state reads).
3. If the feature is something the user *changes*, add a `link` to the topic pointing at the Settings section anchor (`aria-labelledby` id on that section) so Help stays read-only and Settings stays where changes happen.
4. Run `npm run test:help-coverage`.

## When the check fails

The failure names the surface and the reason. Map it:

| Message | Fix |
| --- | --- |
| `… has no entry in src/help/helpCoverage.ts` | New surface shipped. Add a row — cover it or opt out with a note. |
| `… no longer exists in the codebase` | Surface removed. Delete the stale row (and the topic, if nothing else maps to it). |
| `… points at topic "x", which is not in helpContent.ts` | Topic id renamed or dropped. Repoint the row or restore the topic. |
| `… is covered but names no topicId` | Finish the row. |
| `… opts out of Help without a note` | Write the reason. Silence is not an allowed default. |

Never "fix" a failure by deleting the assertion or widening the opt-out list without a reason — the check exists because Help drifted once already (#146).

## Guard rails

- Help is **read-only**: no downloading, switching, or removing Rewrite models, and no hotkey rebinding from Help.
- Don't introduce a docs site, an in-app chatbot, or an onboarding replay — `scripts/settings-help-contract.test.mjs` fails on those strings on purpose.
- Keep Settings and Help consistent: if you change wording for a capability in one, check the other.

---
name: release
description: Cut an Issuebridge Release — classify commits since the last tag, suggest SemVer (including alpha/beta/rc), draft user-facing release notes, and after confirmation prepare CHANGELOG.md and version fields. Use when the user wants to release, cut a version, bump SemVer, or write release notes.
---

# Release

Prepare a **Release** (ship event: SemVer + installer + notes). Domain terms live in `CONTEXT.md`. Commit-type vocabulary lives in the `commit` skill — **do not redefine types here**.

## Do not

- Create a release branch (cut from `main` via tags only).
- Commit, create tags, or push unless the user explicitly asks after prep.
- Publish secrets or skip the user's version confirmation.

## Process

### 1. Gather baselines

On `main` (or the branch the user names), collect:

```text
git tag -l "v*" --sort=-v:refname
git describe --tags --abbrev=0   # if any tags exist
```

Define:

| Baseline | Meaning |
|----------|---------|
| **Latest tag** | Newest `v*` tag of any kind (stable or Pre-release), or *none* |
| **Last stable** | Newest `vX.Y.Z` with no `-` suffix, or *none* |

Commit range for **bump suggestion**:

- If latest tag exists: `git log <latest-tag>..HEAD`
- If none: entire history (`git log` from root → `HEAD`)

Also list commits since **last stable** (or root) when drafting stable Release notes.

### 2. Classify commits

Using the `commit` skill types on the bump-suggestion range:

| Strongest signal present | Suggest at least |
|--------------------------|------------------|
| `feat!` / `fix!` / `BREAKING CHANGE` / clear user-breaking intent | **Major** |
| `feat` | **Minor** |
| `fix` / `perf` / user-felt `build` | **Patch** |
| only `chore` / `docs` / `test` / `refactor` | **no Release** — say so; optional Patch only if the user insists |

Pre-release stage logic (after choosing the target `X.Y.Z` bump from the signals above, or keeping the current target if already on a Pre-release line):

- Progression: **alpha → beta → rc → stable** (never go backward on the same target).
- Counters reset per stage: `-alpha.1`, `-alpha.2`, … then `-beta.1`, …
- If latest tag is `vX.Y.Z-rc.N` and the range has **no material commits** (or only blocker fixes you still want as rc): prefer **promote to `X.Y.Z` stable** or `-rc.(N+1)` for fixes — ask which.
- If promoting rc → stable with no new user-facing work: keep the same `X.Y.Z`; do not invent a new bump.

**First Release (no tags):** default primary suggestion is **`0.1.0` stable** (versions in the repo already say `0.1.0`). Offer Pre-release only if the user asks.

### 3. Propose (wait for confirmation)

Present:

1. **Primary SemVer** (with `v` prefix for the eventual tag, e.g. `v0.2.0-beta.1`)
2. **Why** (strongest commit signal + stage rule)
3. **Alternatives** (e.g. Patch if polish-only; next Pre-release stage)
4. **Draft Release notes** — user-facing bullets, not a raw `git log`. Group roughly: Added / Fixed / Changed. Omit pure chore/docs/test noise unless it affects installers or upgrade steps.

Stable notes summarize since **last stable** (or root). Beta/rc notes may focus on the bump range but should stay readable.

**Stop and wait** until the user confirms the version (and edits notes if they want).

### 4. Prepare the cut (after confirmation only)

Update in one working tree (do not commit unless asked):

1. **`CHANGELOG.md`** (create if missing) — Keep a Changelog–style section at the top:

   ```md
   ## [0.2.0-beta.1] - YYYY-MM-DD

   ### Added
   - …

   ### Fixed
   - …
   ```

   - **beta / rc / stable:** always add a section.
   - **alpha:** section optional (default skip unless the user wants notes).

2. **Version fields** — set the confirmed SemVer (no leading `v`) in:

   - `package.json` → `version`
   - `package-lock.json` → root `version` / `packages[""].version` (keep lockfile consistent)
   - `src-tauri/tauri.conf.json` → `version`
   - `src-tauri/Cargo.toml` → `version`

3. Show a short summary of files changed and remind the user:

   - Commit (use `commit` skill; often `chore: prepare release X.Y.Z` or `build: …`)
   - Annotated tag: `vX.Y.Z` or `vX.Y.Z-alpha.N` etc.
   - Push the tag to trigger `.github/workflows/release-windows.yml` (CI attaches `*-setup.exe` to the GitHub Release automatically on tag pushes)
   - For beta/rc/stable: create/update the GitHub Release (mark pre-release for alpha/beta/rc) with the same notes before or after the tag; CI uploads the installer asset either way

Alpha may be tag + artifact only (notes optional), per `CONTEXT.md`.

## SemVer reminder (Issuebridge)

Same meaning on `0.x` as after `1.0`:

- **Patch** — fix/polish only  
- **Minor** — new capability, no user-breaking change  
- **Major** — user-breaking (data/model/UX contract)

First Release line is `0.x.x`; first stable is `0.1.0`.

## Related

- `commit` — type list and message format  
- `AGENTS.md` — thin router  
- `CONTEXT.md` — Release / Pre-release / Release notes language  
- `README.md` — NSIS release build / CI secrets  

---
name: commit
description: Author and validate conventional commits for Issuebridge. Use when creating a git commit, reviewing a commit message, or when another skill needs the commit-type vocabulary (especially release).
---

# Commit

Source of truth for Issuebridge commit messages. Humans and agents follow this skill whenever committing. The `release` skill classifies history using these types — do not invent parallel vocabularies.

Read `CONTEXT.md` and use domain terms (Draft, Capture, Publish, …) in subjects when the change is about those concepts.

## Format

```
type(optional-scope): description

optional body

optional footer
```

Rules:

- **type** — one of the closed list below (lowercase).
- **scope** — optional, short area (`capture`, `inbox`, `auth`, `packaging`, …). Omit rather than force a vague scope.
- **description** — imperative, lowercase start preferred, no trailing period; say *why/what for the user or system*, not a file list.
- Reference issues with `#n` in the subject or body when relevant (GitLab/GitHub style used by this repo).
- One logical change per commit when practical.

Breaking change — either:

- `feat!:` / `fix!:` (bang after type), or
- Footer line: `BREAKING CHANGE: <explanation>`

## Closed type list

| Type | Use when | Release signal |
|------|----------|----------------|
| `feat` | User-facing capability | → at least **Minor** |
| `fix` | User-facing bug fix | → at least **Patch** |
| `perf` | User-facing performance improvement | → at least **Patch** |
| `docs` | Documentation only | no Release by itself |
| `test` | Tests only | no Release by itself |
| `refactor` | Internal change with no user-facing behavior change | no Release by itself |
| `chore` | Tooling, deps, CI, repo glue with no user-facing change | no Release by itself |
| `build` | Build/packaging that affects the shipped installer | may be **Patch** if users feel it |

Do **not** use separate `ci`, `style`, or `revert` types. Fold CI into `chore`; formatting-only into `chore` or the type of the real change; reverts as `revert: <original subject>` in the description or `fix`/`feat` that undoes the bad behavior — keep the original type visible in the body if helpful.

## Examples

```
feat: add Capture PTT voice with Whisper failure UX
fix: harden first-run auth after QA
feat!: replace Draft storage format (requires migration)
docs: clarify Windows NSIS release steps
chore: add local agent skills for the Issuebridge workflow
build: bundle whisper base model in NSIS resources
```

## Agent workflow when committing

1. Follow the user's git/commit rules (only commit when asked; never update git config; etc.).
2. Draft the message from this skill’s types — if unsure between `refactor` and `fix`, ask: did user-visible behavior change?
3. Prefer `feat` / `fix` / `perf` only for user-facing changes; packaging that only changes how CI builds (not the artifact users get) is `chore`, not `build`.
4. Do not put secrets, credentials, or `.env` contents in commits or messages.

## Out of scope

- SemVer choice, changelog editing, tagging — that is the `release` skill.
- Project routing for agents — that is root `AGENTS.md`.

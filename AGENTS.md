# Issuebridge — agent guide

Windows-first Tauri app: capture GitHub issues while testing (hotkey + voice), keep local **Drafts**, then **Publish** them. Domain language lives in [`CONTEXT.md`](./CONTEXT.md) — use those terms; do not invent synonyms.

## Always

1. Read [`CONTEXT.md`](./CONTEXT.md) before naming domain concepts in code, commits, or docs.
2. Commits follow the **commit** skill (conventional types). Do not invent extra types.
3. Releases follow the **release** skill (suggest SemVer → confirm → prepare changelog/versions). Do not invent a release-branch workflow.
4. Never commit secrets, client secrets, or `.env` files. Release builds inject GitHub App credentials via env/CI only.
5. Keep domain logic in `src-tauri/src/core`; UI/IPC stay in adapters / `src`.

## Skills

| Skill | Path | Use when |
|-------|------|----------|
| commit | [`.agents/skills/commit/SKILL.md`](./.agents/skills/commit/SKILL.md) | Writing or checking commit messages |
| release | [`.agents/skills/release/SKILL.md`](./.agents/skills/release/SKILL.md) | Cutting a Release / SemVer / changelog |
| domain-modeling | [`.agents/skills/domain-modeling/SKILL.md`](./.agents/skills/domain-modeling/SKILL.md) | Glossary / ADRs |
| implement | [`.agents/skills/implement/SKILL.md`](./.agents/skills/implement/SKILL.md) | Building from a spec or tickets |
| tdd | [`.agents/skills/tdd/SKILL.md`](./.agents/skills/tdd/SKILL.md) | Test-first work |
| code-review | [`.agents/skills/code-review/SKILL.md`](./.agents/skills/code-review/SKILL.md) | Review since a fixed point |
| diagnosing-bugs | [`.agents/skills/diagnosing-bugs/SKILL.md`](./.agents/skills/diagnosing-bugs/SKILL.md) | Hard bugs / regressions |
| grill-with-docs | [`.agents/skills/grill-with-docs/SKILL.md`](./.agents/skills/grill-with-docs/SKILL.md) | Stress-test a plan with domain modeling |
| security-audit | [`.agents/skills/security-audit/SKILL.md`](./.agents/skills/security-audit/SKILL.md) | Medium+ threat-led security audit; draft advisory (private) |

Other skills under [`.agents/skills/`](./.agents/skills/) apply when their descriptions match the task.

## Hard constraints (short)

- **Platform:** Windows-first (NSIS per-user installer for official Release).
- **Auth:** Prefer GitHub App OAuth + PKCE; PAT is identity-only for first-run Install App.
- **Voice:** Whisper assets are fetched/bundled for offline PTT — do not commit large binaries that are gitignored.
- **Quit before rebuild:** Fully quit Issuebridge before re-fetching Whisper assets or restarting `tauri dev` if files are locked.

## Out of scope for this file

Full commit-type tables, SemVer/pre-release rules, and release prep steps — see the **commit** and **release** skills. Architecture depth — see `README.md` and `CONTEXT.md`.

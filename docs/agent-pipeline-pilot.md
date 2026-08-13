# Agent pipeline pilot — buildable spec

**Status:** buildable pilot spec for Issuebridge (public personal repo)  
**Map:** [Map: label-triggered agent pipeline (plan → implement → review) on Issuebridge](https://github.com/mnaimfaizy/issuebridge/issues/80)  
**Audience:** implement the vertical-slice prototype; do not treat this as multi-repo product docs.

This document is the single source of truth for *what to build* in the pilot. Product domain language for Issuebridge itself stays in `CONTEXT.md`; this pipeline is **repo meta-automation**, not product vocabulary.

> **Revision (2026-08-04):** GitHub Models was [retired 2026-07-30](https://github.blog/changelog/2026-07-30-github-models-is-now-retired/). Pilot planner is **Copilot CLI in Actions** (not Models / OpenAI / Cursor). Cursor and other BYOK providers remain later adapters only.

> **Revision (2026-08-13) — superseded:** the Copilot implementation described below is **archived and no longer runs**. Its workflows live in [`.github/workflows-archive/copilot/`](../.github/workflows-archive/copilot/README.md), preserved for reference and rollback. The live pipeline is Claude Code in Actions, authenticated with a Claude subscription OAuth token. The gating model in this document (kill switch → allowlist → label consumption) carried over unchanged; the agent invocation and the implement step did not — Claude pushes its own branch and opens the PR instead of assigning a cloud agent.

---

## 1. Goal (prototype acceptance)

One **real** end-to-end run on Issuebridge:

1. Allowlisted maintainer adds `agent:plan` → planner posts a **plan as an issue comment**.
2. Same (or another allowlisted) maintainer adds `agent:implement` → implementer opens a **PR** from that plan.
3. Reviewer runs (at least one round); **≤ 2** reviewer ↔ implementer rounds.
4. CI green; findings cleared or capped; **PR assigned to the maintainer** for final human approval.

Mocked-only orchestration does **not** count. Prototype invoke is **label-only** (no Slack/Teams in acceptance).

---

## 2. Architecture

```text
┌─────────────────────────────────────────────────────────┐
│  GitHub-hosted Actions  = portable orchestrator        │
│  (gates, state, concurrency, comments, adapter calls)  │
└───────────────┬─────────────────────┬───────────────────┘
                │                     │
        ┌───────▼───────┐     ┌───────▼────────────────┐
        │ Planner       │     │ Copilot adapters       │
        │ Copilot CLI   │     │ implementer (assign)   │
        │ in Actions    │     │ reviewer (review bot)  │
        └───────────────┘     └────────────────────────┘
```

| Layer | Choice |
|-------|--------|
| Orchestrator / hosting | GitHub-hosted Actions only (no public self-hosted / VPS runners) |
| Planner | **Copilot CLI** on the runner (`copilot -p … --no-ask-user`), plan markdown → issue comment |
| Implementer | **Copilot cloud agent** — assign `copilot-swe-agent[bot]` + `custom_instructions` (plan handoff) |
| Reviewer | **Copilot** — request review from `copilot-pull-request-reviewer[bot]`; fix rounds via PR `@copilot` under orchestrator policy |
| Cursor / OpenAI / other BYOK | Pluggable adapters **later** — not pilot default |

**Non-goals for the spine:** unattended “assign Copilot once and let it own plan+implement without orchestrator gates.” Labels + allowlist + plan-gate still apply.

---

## 3. Maintainer UX (triggers and gates)

| Step | Action | Orchestrator behavior |
|------|--------|------------------------|
| Start planner | Add label `agent:plan` | Authorize actor → consume label → Copilot CLI plan → plan **comment** |
| Unlock implementer | Add label `agent:implement` | Authorize actor → consume label → assign Copilot cloud agent with plan handoff |
| Final approval | Human reviews PR | Orchestrator assigns PR to maintainer when ready / stuck |

### Authorization

- **Hard allowlist** of GitHub logins in repo variable `AGENT_PIPELINE_ALLOWLIST` (comma-separated). Start with the owner only.
- A label alone is **not** authz: check `github.actor` against the allowlist.
- Non-allowlisted labelers: bot comment; do not spend Copilot credits.

### Secrets and environment

- Prefer Actions environment `agent-pipeline` for elevated tokens.
- **Copilot CLI auth (pilot):**
  - Fine-grained PAT with **Copilot Requests** stored as secret `COPILOT_GITHUB_TOKEN` (classic `ghp_` PATs are **not** supported by Copilot CLI), **or**
  - Where supported: `GITHUB_TOKEN` with `permissions: copilot-requests: write` ([docs](https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli-in-actions)).
- Assigning the cloud agent may need a user token with issues/contents/PRs write if `GITHUB_TOKEN` cannot assign `copilot-swe-agent[bot]` — use the same fine-grained PAT in the environment when required.
- Pilot happy path: **no second environment Approve click** beyond the labels.

### Plan artifact (pilot default)

- Plan is **issue comment only**.
- Marker: HTML comment `<!-- agent-pipeline-plan -->` plus heading `## Agent plan` so implement handoff can find the latest plan.

---

## 4. Pipeline stages

### 4.1 Kill-switch and concurrency

- Repo variable `AGENT_PIPELINE_ENABLED` — if `false`, workflows no-op with a short bot comment.
- `concurrency:` group `agent-pipeline`, `cancel-in-progress: false` (queue; do not cancel).

### 4.2 Planner (`agent:plan`)

1. Guard: enabled + allowlist + label name.
2. Remove `agent:plan`.
3. Install `@github/copilot`; run one-shot programmatic CLI with a **plan-only** prompt and **minimal** `--allow-tool` (read/checkout context; avoid `--allow-all`).
4. Post plan comment (marker + `## Agent plan`). Do **not** open a PR.
5. On failure: bot comment + stop (no auto-retry).

### 4.3 Implementer (`agent:implement`)

1. Guard: enabled + allowlist + label name.
2. Remove `agent:implement`.
3. Locate latest plan comment; if missing → fail + bot comment.
4. Assign `copilot-swe-agent[bot]` with `agent_assignment.custom_instructions` = implement from this plan only; draft PR preferred; do not merge.
5. Track review rounds (max 2) in issue comments / workflow outputs as needed.

### 4.4 Reviewer loop (orchestrator policy)

Implemented by `.github/workflows-archive/copilot/agent-pipeline-review.yml` (archived; triggers were PR open/sync, Copilot review submitted, CI `workflow_run` completed, plus manual `workflow_dispatch`).

1. Detect pipeline PRs: Copilot author / `copilot/*` head **and** a linked issue (or prior loop comment) with `<!-- agent-pipeline-plan -->`.
2. Request review from `copilot-pull-request-reviewer[bot]` (GraphQL `requestReviews` + `botIds`, REST fallback). Marker: `<!-- agent-pipeline-review-requested -->`.
3. After review (and/or CI), post `@copilot` **as the `COPILOT_GITHUB_TOKEN` user** (`<!-- agent-pipeline-fix-round:N sha:… invoked:user -->`) and optionally re-assign `copilot-swe-agent[bot]`. Comments from `github-actions[bot]` do **not** start the coding agent.
4. Triggers include CI / Copilot Code Review `workflow_run` (may need manual approval when Copilot is the actor) **and** PR `synchronize`, which **waits for CI in-job** so round-2 is not lost.
5. Review findings = unresolved **and** non-outdated Copilot threads; fix comments include a short thread summary.
6. **Hard cap: 2** user-invoked fix rounds → `<!-- agent-pipeline-handoff -->`, assign PR to first login on `AGENT_PIPELINE_ALLOWLIST`, stop auto-loops. The handoff comment reports CI state, whether the last agent session errored, its session log, and any open threads.
7. **Crashed agent sessions are free.** A `Copilot cloud agent` run that ends in `failure` did not complete its round, so the orchestrator re-invokes with `kind:crash-retry crash-run:<id>` (max 2 retries) instead of burning the budget. Known crash: the agent's Node process aborts with `failed printing to stdout: Resource temporarily unavailable (os error 11)` / exit 134 when rust-analyzer floods stdout with `macro expansion failed` warnings — mitigated by warming the Rust build cache in `copilot-setup-steps.yml`.
8. When CI green and no open Copilot threads (after at least one review): same handoff marker + maintainer assign for final human approval.

State is PR-comment markers (no extra DB). Kill-switch `AGENT_PIPELINE_ENABLED` still applies. First review request does **not** fire a fix in the same run (Reviewer → Implementer order).

### 4.5 Failure UX

- Bot comment on issue (and PR if open): stage + short error gist.
- Stop; **no auto-retry**; labels stay consumed.
- Kill in-flight runs from the Actions UI if needed.

---

## 5. Cost posture

| Spend | Control |
|-------|---------|
| Planner (CLI) | Copilot AI credits; one-shot; allowlist + serial |
| Implement / review | Copilot cloud agent + review credits; prefer included Max allowance |
| Actions | Public repo standard hosted minutes |
| Learning band | Serial one pipeline; kill-switch; avoid parallel agent runs |

---

## 6. Prompt packs (pilot stubs)

### Planner (CLI `-p`)

- Produce an implementation plan for this repo/issue only.
- Output markdown only (goals, non-goals, file touch list, test/CI notes, risks).
- No code patches; no PR; cite issue number.

### Implementer `custom_instructions`

- Implement only what the attached plan requires.
- Open a draft PR from a dedicated branch; do not merge or approve.
- Do not expand scope.

### Reviewer

- Correctness, regressions, secrets, plan fidelity.
- Orchestrator counts rounds (no first-party max-reviews knob).

---

## 7. Stand-up checklist (prototype wiring)

1. Labels `agent:plan`, `agent:implement`.
2. Vars: `AGENT_PIPELINE_ENABLED=true`, `AGENT_PIPELINE_ALLOWLIST=mnaimfaizy` (adjust).
3. Secret: fine-grained PAT → `COPILOT_GITHUB_TOKEN` (Copilot Requests + repo issues/contents/PRs as needed).
4. Workflow: `.github/workflows-archive/copilot/agent-pipeline.yml` (archived; ran from the default branch on `issues: [labeled]`, concurrency `agent-pipeline`).
5. Review loop: `.github/workflows-archive/copilot/agent-pipeline-review.yml` (archived).
6. Copilot env: `.github/workflows-archive/copilot/copilot-setup-steps.yml` (archived; Node 22 + `npm ci`, Rust toolchain, Tauri Linux deps, `cargo check --all-targets`) so cloud agent / code review could build before the firewall session, and rust-analyzer had macro/build-script artifacts. Restoring this file requires moving it back to `.github/workflows/copilot-setup-steps.yml` — GitHub reads it by exact path.
7. Prompts under `.github/agent-pipeline/`.
8. Dry-run kill-switch / allowlist miss; then one tiny real E2E issue.

---

## 8. Copy later (out of prototype build)

- Other repos: copy workflow + vars/labels; keep allowlist per repo.
- Messaging: custom chat → same label gate only.
- Additional adapters (Cursor Cloud, OpenAI, …) behind the same orchestrator.

---

## 9. Decision index

| Topic | Ticket |
|-------|--------|
| Stack / hosting | [#85](https://github.com/mnaimfaizy/issuebridge/issues/85) — revised: all-Copilot for v1 planner too |
| Labels / plan-gate UX | [#86](https://github.com/mnaimfaizy/issuebridge/issues/86) |
| Planner model | [#91](https://github.com/mnaimfaizy/issuebridge/issues/91) — **superseded**: Models retired; use Copilot CLI |
| Serial / failure / kill | [#92](https://github.com/mnaimfaizy/issuebridge/issues/92) |
| Copilot adapter invoke | [#90](https://github.com/mnaimfaizy/issuebridge/issues/90) |
| Spec task | [#87](https://github.com/mnaimfaizy/issuebridge/issues/87) |
| Prototype | [#88](https://github.com/mnaimfaizy/issuebridge/issues/88) |

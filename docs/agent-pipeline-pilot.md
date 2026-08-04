# Agent pipeline pilot — buildable spec

**Status:** buildable pilot spec for Issuebridge (public personal repo)  
**Map:** [Map: label-triggered agent pipeline (plan → implement → review) on Issuebridge](https://github.com/mnaimfaizy/issuebridge/issues/80)  
**Audience:** implement the vertical-slice prototype; do not treat this as multi-repo product docs.

This document is the single source of truth for *what to build* in the pilot. Product domain language for Issuebridge itself stays in `CONTEXT.md`; this pipeline is **repo meta-automation**, not product vocabulary.

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
        │ Planner       │     │ Copilot adapter        │
        │ GitHub Models │     │ implementer + reviewer │
        │ GPT-5.6 Luna  │     │ (not the product spine)│
        └───────────────┘     └────────────────────────┘
```

| Layer | Choice |
|-------|--------|
| Orchestrator / hosting | GitHub-hosted Actions only (no public self-hosted / VPS runners) |
| Planner | Actions job → **GitHub Models** + **GPT-5.6 Luna** (model id in a repo variable) |
| Implementer | **Copilot adapter** — orchestrator invokes after plan-gate (issue assign to `copilot-swe-agent[bot]` + `custom_instructions` / plan handoff) |
| Reviewer | **Copilot adapter** — review requests to `copilot-pull-request-reviewer[bot]`; fix rounds via PR `@copilot` under orchestrator policy |
| Other providers (Cursor Cloud, etc.) | Pluggable adapters **later** — not pilot default |

**Non-goals for the spine:** “Assign Copilot and let it own plan+implement.” Copilot is one adapter behind the orchestrator.

---

## 3. Maintainer UX (triggers and gates)

| Step | Action | Orchestrator behavior |
|------|--------|------------------------|
| Start planner | Add label `agent:plan` | Authorize actor → consume label → run planner → plan **comment** |
| Unlock implementer | Add label `agent:implement` | Authorize actor → consume label → invoke Copilot implementer with plan handoff |
| Final approval | Human reviews PR | Orchestrator assigns PR to maintainer when ready / stuck |

### Authorization

- **Hard allowlist** of GitHub logins in a repo variable (e.g. `AGENT_PIPELINE_ALLOWLIST`, comma-separated). Start with the owner only.
- A label alone is **not** authz: check `github.actor` against the allowlist (and optionally write+ via collaborator permission API).
- Non-allowlisted labelers: no-op or bot comment; do not spend Models/Copilot.

### Secrets and environment

- Put Models / any elevated tokens in an Actions **environment** (e.g. `agent-pipeline`).
- Pilot happy path: **no second “Approve deployment” click** required beyond the labels; environment still scopes secrets.

### Plan artifact (pilot default)

- Plan is **issue comment only** (no linked file artifact in v1).
- Comment should be clearly marked (e.g. heading `## Agent plan` + machine-readable fence or HTML comment marker) so implement handoff can find the latest plan.

---

## 4. Pipeline stages

### 4.1 Kill-switch and concurrency

- Repo variable `AGENT_PIPELINE_ENABLED` — if `false`, workflows no-op with a short bot comment.
- `concurrency:` group `agent-pipeline`, `cancel-in-progress: false` (queue; do not cancel).
- If another pipeline is active, bot-comment on the waiting issue naming the active issue number.

### 4.2 Planner (`agent:plan`)

1. Guard: enabled + allowlist + label name.
2. Remove `agent:plan`.
3. One-shot GitHub Models call (**GPT-5.6 Luna**): issue body + constrained repo context.
4. **Hard per-run** max input / max output token caps (repo vars). If caps would be exceeded → **fail** + bot comment (no silent bad truncate).
5. Post plan comment. Stop. Do **not** open a PR.

### 4.3 Implementer (`agent:implement`)

1. Guard: enabled + allowlist + label name.
2. Remove `agent:implement`.
3. Locate latest plan comment; if missing → fail + bot comment.
4. Invoke Copilot adapter with instructions: implement **from this plan only**; open/update PR; do not merge; do not mark draft ready.
5. Preferred public-repo mechanism: assign issue to `copilot-swe-agent[bot]` with `agent_assignment` / `custom_instructions` carrying the plan (see research). Agent-tasks `POST …/tasks` Start is Business/Enterprise + user token — **not** the pilot default path unless prerequisites exist.

### 4.4 Reviewer loop (orchestrator policy)

1. Request review from `copilot-pull-request-reviewer[bot]` (or documented equivalent).
2. On findings: orchestrator may `@copilot` on the PR for a fix round (write-gated by platform).
3. **Hard cap: 2** reviewer ↔ implementer rounds. After that: bot comment “stuck after 2 rounds”, assign PR to maintainer, stop auto-loops.
4. When CI green and no blocking findings (or cap reached with handoff): assign PR to maintainer for final approval.

### 4.5 Failure UX

- Bot comment on issue (and PR if open): stage + short error gist.
- Stop pipeline; **no auto-retry**.
- Trigger labels stay consumed.
- Cancel in-flight runs from the Actions UI if needed.

---

## 5. Cost posture

| Spend | Control |
|-------|---------|
| Planner | Luna one-shot + token caps; GitHub Models billing alerts |
| Implement / review | Prefer included Copilot Max credits; serial one pipeline |
| Actions | Public repo standard hosted minutes |
| Learning band | Aim to stay near ~$20–50 *extra* where possible; Max seat may be sunk cost |

---

## 6. Prompt packs (pilot stubs)

Exact wording can iterate in the prototype; structure is fixed:

### Planner system/user shape

- Role: produce an implementation plan for this repo/issue only.
- Output: markdown plan (goals, non-goals, file touch list, test/CI notes, risks).
- Constraints: no code patches; no PR; respect token caps; cite issue number.

### Implementer `custom_instructions`

- Implement only what the attached plan requires.
- Open a draft PR (preferred) from a dedicated branch; do not merge or approve.
- Summarize deviations if the plan is ambiguous; do not expand scope.

### Reviewer

- Focus on correctness, regressions, secrets, and plan fidelity.
- Findings as review comments; severity if useful.
- Orchestrator counts rounds; product has no first-party max-reviews knob.

---

## 7. Stand-up checklist (prototype wiring)

1. Create labels `agent:plan`, `agent:implement`.
2. Repo variables: `AGENT_PIPELINE_ENABLED=true`, `AGENT_PIPELINE_ALLOWLIST`, model id for Luna, token cap ints.
3. Actions environment `agent-pipeline` + secrets for GitHub Models auth as required by current docs.
4. Workflow(s) on default branch:
   - `on: issues: types: [labeled]` filtered to the two labels.
   - Shared concurrency `agent-pipeline`.
   - Jobs: authorize → consume label → plan **or** implement/review orchestration.
5. Document in workflow comments how Copilot assign / review-request is performed (tokens: prefer fine-grained PAT / App with least privilege if `GITHUB_TOKEN` is insufficient — call out in PR for the prototype).
6. Dry-run: allowlist check failure path; kill-switch path; then one tiny real E2E issue.

Suggested paths (implementer may adjust):

- `.github/workflows/agent-pipeline.yml`
- Optional: `.github/agent-pipeline/` for prompt text files referenced by the workflow.

---

## 8. Copy later (out of prototype build)

- Other repos: copy workflow + vars/labels; keep allowlist per repo.
- Messaging: only via **custom chat → GitHub label/dispatch** into the same gates — not first-party Copilot-in-Slack/Teams (bypasses orchestrator).
- Additional adapters (Cursor Cloud, OpenHands, …) behind the same orchestrator interfaces.

---

## 9. Decision index

| Topic | Ticket |
|-------|--------|
| Stack / hosting | [Grill: choose agent stack and hosting…](https://github.com/mnaimfaizy/issuebridge/issues/85) |
| Labels / plan-gate UX | [Grill: lock trigger labels…](https://github.com/mnaimfaizy/issuebridge/issues/86) |
| Planner model | [Grill: choose BYOK model/API…](https://github.com/mnaimfaizy/issuebridge/issues/91) |
| Serial / failure / kill | [Grill: lock serial pipeline…](https://github.com/mnaimfaizy/issuebridge/issues/92) |
| Maintainer-only research | [#81](https://github.com/mnaimfaizy/issuebridge/issues/81) |
| Copilot cost/capabilities | [#82](https://github.com/mnaimfaizy/issuebridge/issues/82) |
| Industry patterns | [#83](https://github.com/mnaimfaizy/issuebridge/issues/83) |
| Hosting comparison | [#84](https://github.com/mnaimfaizy/issuebridge/issues/84) |
| Messaging triggers | [#89](https://github.com/mnaimfaizy/issuebridge/issues/89) |
| Copilot adapter invoke | [#90](https://github.com/mnaimfaizy/issuebridge/issues/90) |

Research markdown lives under `docs/research/` on the respective `research/*` branches until merged.

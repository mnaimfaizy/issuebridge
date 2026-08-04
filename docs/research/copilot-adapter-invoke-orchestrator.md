# Research: Copilot adapter invoke under Actions orchestrator

**Date:** 2026-08-04  
**Question:** Given the locked stack (portable Actions orchestrator; `agent:implement` plan-gate; Copilot as implementer+reviewer adapter only — not assignee-spine), what first-party mechanisms can the orchestrator use to start Copilot cloud agent / code review with a bounded plan handoff (implement-from-plan, then review rounds ≤2), and what cannot be constrained? Cover API assign, `@copilot`, code review triggers, permissions, and failure modes on a public repo. Primary sources only.  
**Issue context:** [#90](https://github.com/mnaimfaizy/issuebridge/issues/90) (wayfinder research; part of #80 — this note does not map #80).  
**Locked context:** GitHub-hosted Actions orchestrator; planner Actions/BYOK with human plan-gate; implementer+reviewer Copilot adapter only (not assignee-spine); portable adapters later.

## Scope of this note

Primary sources only:

- GitHub Docs (Copilot cloud agent, code review, automations, access, troubleshooting)
- GitHub REST / GraphQL references (agent tasks, issue assignees, review requests)
- GitHub Actions token / billing docs (public-repo minutes; `GITHUB_TOKEN` limits)

Secondary blogs, “how we wired Copilot from Actions” posts, and anecdotal bot-login lists are **not** used as evidence except where the same claim appears in first-party docs. Where GitHub does not publish a product knob (e.g. max review rounds), that gap is stated explicitly.

---

## Executive verdict

For a **public** repo, a portable Actions orchestrator can drive Copilot as an **adapter** (not as the pipeline spine) through **first-party GitHub APIs**, not through Copilot automations:

| Mechanism | What it starts | Plan handoff surface | Public repo? | Auth that works from Actions |
|-----------|----------------|----------------------|--------------|------------------------------|
| **Issue assign** → `copilot-swe-agent[bot]` (+ optional `agent_assignment`) | Cloud agent session that **always opens a PR** | Issue title/body/existing comments at assign time; REST/GraphQL `custom_instructions` | Yes | **User-to-server** token (PAT / App user token). Documented for GraphQL assign; same REST assignee login |
| **Agent tasks API** `POST /agents/repos/{owner}/{repo}/tasks` | Cloud agent task; default **no** PR (`create_pull_request: false`) | Required `prompt` (put the approved plan here) | Yes (API itself not gated on visibility) | **User-to-server only**; **installation tokens unsupported**. **Start** is documented for **Business/Enterprise only** |
| **PR `@copilot` comment** | New cloud-agent session on the **same PR branch** (by default) | Comment body (follow-ups / fix rounds) | Yes | Comment author must have **write**; token used to post must act as such a user |
| **Review request** → `copilot-pull-request-reviewer[bot]` | Copilot code review | N/A (reviews the PR diff) | Yes | REST review-requests; CLI `--add-reviewer @copilot` |
| **Copilot automations** (schedule / issue / PR events) | Cloud agent without per-run human start | Automation prompt | **No — private/internal only** | N/A for public OSS |

**Bounded loop (implement-from-plan → ≤2 review rounds) is an orchestrator policy, not a Copilot product limit.** First-party docs expose start/status/review APIs and hard session limits (59 minutes, one branch / one PR per assigned task). They do **not** expose “max N code reviews,” “must follow this plan file,” or “stop after two `@copilot` iterations.”

**Critical Actions constraint:** the default workflow `GITHUB_TOKEN` is **not** sufficient for the agent tasks API (installation / server-to-server tokens are unsupported). The adapter must call Copilot with a **user-scoped** secret (fine-grained PAT or GitHub App **user-to-server** token) held by a maintainer who has paid Copilot and write on the repo.

---

## 1. Invoke mechanisms the orchestrator can use

### 1.1 Issue assignment (REST / GraphQL) — primary public-repo implement path

**UI behavior:** Assigning an issue to Copilot **always creates a pull request**. Copilot works the task and requests the assigner’s review when finished ([Kick off a task](https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/kick-off-a-task); [Use cloud agent on GitHub](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/use-cloud-agent-on-github)). Feature is **public preview** and subject to change (same Use-on-GitHub page).

**Context at start:** Copilot receives the issue **title, description, and comments that already exist at assignment**. It does **not** see comments added to the issue after assignment — follow-ups belong on the PR ([Kick off a task](https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/kick-off-a-task); [Use cloud agent on GitHub](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/use-cloud-agent-on-github)).

**Programmatic assign (documented):**

- REST assignee login: `copilot-swe-agent[bot]` on:

  - `POST /repos/{owner}/{repo}/issues/{issue_number}/assignees`
  - `POST /repos/{owner}/{repo}/issues` (create)
  - `PATCH /repos/{owner}/{repo}/issues/{issue_number}`

- Optional body field `agent_assignment`: `target_repo`, `base_branch`, `custom_instructions`, `custom_agent`, `model` ([Using Copilot cloud agent via the API](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/use-cloud-agent-via-the-api)).

- GraphQL: `createIssue`, `updateIssue`, `addAssigneesToAssignable`, `replaceActorsForAssignable` with `agentAssignment`; requires header `GraphQL-Features: issues_copilot_assignment_api_support,coding_agent_model_selection`. Suggested-actor login when enabled: `copilot-swe-agent` (bot id for mutations) (same page).

**Orchestrator fit for implement-from-plan:** After the plan-gate, write the approved plan into the **issue body** (and/or `custom_instructions`) **before** assign, then assign. That is the first-party handoff surface for the assign path. Do **not** rely on later issue comments.

**Not assignee-spine:** Using assign here is an **adapter invoke** to start implement work, not “the issue is owned by Copilot as the pipeline controller.” The Actions orchestrator still owns labels, plan-gate, and review-round counting.

### 1.2 Agent tasks API — prompt-first start (Business/Enterprise for Start)

Documented as public preview ([Using Copilot cloud agent via the API](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/use-cloud-agent-via-the-api); [REST API endpoints for agent tasks](https://docs.github.com/en/rest/agent-tasks/agent-tasks)):

| Call | Role for orchestrator |
|------|------------------------|
| `POST /agents/repos/{owner}/{repo}/tasks` | Start task; required `prompt`; optional `model`, `custom_agent`, `create_pull_request` (default **false**), `base_ref`, `head_ref` (continue on existing branch/PR) |
| `GET …/tasks`, `GET …/tasks/{task_id}`, `GET /agents/tasks` | List / poll; `state` ∈ `queued`, `in_progress`, `completed`, `failed`, `idle`, `waiting_for_user`, `timed_out`, `cancelled` |

**Plan handoff:** put the gated plan text in `prompt` (e.g. “Implement the following approved plan: …”). With `create_pull_request: false`, behavior aligns with Agents UI “work on a branch first” ([Kick off a task](https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/kick-off-a-task); [Research, plan, and iterate](https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/research-plan-iterate)). With `create_pull_request: true` or a later prompt/PR create, you get a PR when ready. `head_ref` + `base_ref` supports committing to an existing PR branch ([agent tasks REST](https://docs.github.com/en/rest/agent-tasks/agent-tasks)).

**Hard plan/subscription constraint:** the **Start a task** REST endpoint is documented as **only available to users with a Copilot Business or Copilot Enterprise subscription** ([agent tasks REST](https://docs.github.com/en/rest/agent-tasks/agent-tasks)). Individual Pro / Pro+ / Max still have cloud agent in the product UI ([Access management](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/access-management)), but the **Start** API gate means a Pro-only maintainer cannot treat agent-tasks Start as the public first-party path today — prefer **issue assign** for Pro.

**Auth:** user-to-server only (PAT, OAuth, or GitHub App **user-to-server**). **Server-to-server / installation access tokens are not supported** ([Using Copilot cloud agent via the API](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/use-cloud-agent-via-the-api); fine-grained note on agent-tasks endpoints). Fine-grained PAT for GraphQL assign needs read metadata + read/write actions, contents, issues, and pull requests; classic PAT needs `repo` ([Using Copilot cloud agent via the API](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/use-cloud-agent-via-the-api)). Agent-tasks fine-grained permission set: **Agent tasks** read/write for Start ([agent tasks REST](https://docs.github.com/en/rest/agent-tasks/agent-tasks)).

### 1.3 `@copilot` on pull requests — iteration / fix rounds (not initial plan start)

Mention `@copilot` in a **PR comment** to ask for changes. Default: pushes commits to the **same** PR branch; ask in the comment if a separate PR is wanted ([Use cloud agent on GitHub](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/use-cloud-agent-on-github)).

Constraints ([Use cloud agent on GitHub](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/use-cloud-agent-on-github); [Troubleshooting](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/troubleshoot-cloud-agent)):

- Only responds to people with **write** access.
- Eyes reaction (👀) + “Copilot started work” timeline event when a session starts.
- Remembers context from previous sessions on the **same** PR; custom-agent PRs continue that agent on `@copilot`.
- Does **not** respond on **merged/closed** PRs.
- Troubleshoot note: if the PR is still “assigned to Copilot,” mentions are passed through; if Copilot was **unassigned**, or the commenter lacks write, nothing happens.

**Orchestrator use:** after code review (or CI failure), post a bounded `@copilot` comment summarizing required fixes (optionally citing review comments). Count each successful session start toward the ≤2 review/fix budget in **workflow state**, not by expecting Copilot to stop itself.

**Not a substitute for issue assign for cold start** when you need issue linkage + always-PR semantics — `@copilot` is documented for **existing** PRs ([About cloud agent](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent)).

### 1.4 Copilot code review — request and re-request

**Manual / API:**

- UI: Reviewers → Copilot → Request; usually &lt; ~30 seconds ([Copilot code review how-to](https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/copilot-code-review); [Agents overview](https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/overview)).
- REST: request reviewer login `copilot-pull-request-reviewer[bot]` via [Request reviewers for a pull request](https://docs.github.com/en/rest/pulls/review-requests#request-reviewers-for-a-pull-request) ([Copilot code review how-to](https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/copilot-code-review)).
- CLI: `gh pr create --reviewer @copilot` / `gh pr edit PR --add-reviewer @copilot` (documented on the code-review how-to family; see [Use code review](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/request-a-code-review/use-code-review)).

**Review semantics:** Copilot always leaves a **Comment** review — not Approve / Request changes. Reviews **do not** count toward required approvals and **do not** block merging ([Copilot code review how-to](https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/copilot-code-review)).

**Re-review:** after new pushes, Copilot does **not** auto re-review unless automatic “Review new pushes” is configured. Manual re-request via Reviewers UI / equivalent API ([Copilot code review how-to](https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/copilot-code-review); [Configure automatic review](https://docs.github.com/en/copilot/how-tos/copilot-on-github/set-up-copilot/configure-automatic-review)).

**Automatic reviews (rulesets / personal):** can auto-request on open, optionally every push, optionally on drafts ([About code review](https://docs.github.com/en/copilot/concepts/agents/code-review#about-automatic-pull-request-reviews); [Configure automatic review](https://docs.github.com/en/copilot/how-tos/copilot-on-github/set-up-copilot/configure-automatic-review)). For a **≤2 rounds** orchestrator budget, leave **Review new pushes** off (or avoid repo-wide auto-review) so the adapter controls each review request.

**Fix path from review:** “Fix with Copilot” on a review comment starts cloud agent (new PR or same branch) ([Copilot code review how-to](https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/copilot-code-review)). Orchestrator can approximate that with a controlled `@copilot` PR comment instead of relying on UI buttons.

### 1.5 Mechanisms that do **not** compose with this stack on a public repo

| Mechanism | Why it is out |
|-----------|----------------|
| **Copilot automations** | Require **private or internal** repository — **not available in public repositories** ([About automations](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-automations); [Access management](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/access-management)). |
| **Interactive Agents research → plan → iterate UI** | Deep research / plan / iterate **before** PR is **GitHub.com Agents UI only**; integrations open a PR directly ([About cloud agent](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent); [Research, plan, and iterate](https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/research-plan-iterate)). Orchestrator replaces that with **external plan-gate** + assign / tasks prompt. |
| **Slack / Teams / Jira / Linear / Azure Boards Copilot** | Bypass the Actions orchestrator; integrations do not support research/plan-before-PR ([About cloud agent](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent)). Covered in sibling research; not an adapter invoke under the locked stack. |
| **Default `GITHUB_TOKEN` for agent tasks Start** | Installation-style token unsupported ([Using Copilot cloud agent via the API](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/use-cloud-agent-via-the-api)). Actions docs: use a PAT or App token when `GITHUB_TOKEN` lacks needed auth ([Automatic token authentication](https://docs.github.com/en/actions/security-guides/automatic-token-authentication)). |

Other documented entry points (Mobile, IDEs, CLI, MCP, Raycast) exist for **humans** ([Starting GitHub Copilot sessions](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/start-copilot-sessions)) but are not the portable orchestrator’s primary path; the API + issue/PR REST surfaces above are.

---

## 2. Recommended adapter loop (implement-from-plan → ≤2 review rounds)

Conceptual sequence the orchestrator can implement with first-party primitives:

```text
[plan-gate passed: approved plan artifact on issue / label]
        │
        ▼
1. IMPLEMENT  — Prefer:
   A) PATCH/POST issue body with plan → assign copilot-swe-agent[bot]
      (+ agent_assignment.custom_instructions = plan summary)
   B) (Business/Enterprise) POST /agents/.../tasks
      prompt = plan, create_pull_request true|false as desired
        │
        ▼
2. WAIT      — Poll: issue timeline / linked draft PR / agent task state
        │
        ▼
3. REVIEW #1 — POST requested_reviewers: copilot-pull-request-reviewer[bot]
        │
        ▼
4. FIX #1    — Optional: PR comment "@copilot …" with bounded fix list
               (count as round 1 of agent follow-up)
        │
        ▼
5. REVIEW #2 — Manual re-request reviewer (only if still within budget)
        │
        ▼
6. STOP      — Orchestrator refuses further @copilot / review requests;
               human merge / discard. Copilot will not enforce the cap.
```

**Why this matches the locked stack:** Copilot never replaces the plan-gate or the Actions orchestrator; it is invoked twice-class roles only — **implement** (assign/tasks) and **review** (reviewer bot), with optional **fix** (`@copilot`) under orchestrator counters.

---

## 3. Permissions, eligibility, and public-repo cost shape

### 3.1 Who can start / steer

| Action | Published requirement |
|--------|------------------------|
| Appear as assignee / start cloud agent | Paid Copilot plan; cloud agent enabled for user + not opted out on repo ([Troubleshooting](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/troubleshoot-cloud-agent); [Access management](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/access-management)) |
| Assign via UI to a repo | Write on target repo; cloud agent enabled there ([Use cloud agent on GitHub](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/use-cloud-agent-on-github)) |
| GraphQL/REST assign | User token; fine-grained scopes as above ([Using Copilot cloud agent via the API](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/use-cloud-agent-via-the-api)) |
| `@copilot` on PR | Write access ([Use cloud agent on GitHub](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/use-cloud-agent-on-github)) |
| Pro vs Business for agent-tasks **Start** | Start endpoint: Business/Enterprise only ([agent tasks REST](https://docs.github.com/en/rest/agent-tasks/agent-tasks)) |
| Business/Enterprise policy | Cloud agent **disabled by default** until admin enables ([Access management](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/access-management)) |
| Pro / Pro+ / Max | Cloud agent **enabled by default** (same page) |

### 3.2 Public repository specifics

- **Automations:** unavailable ([About automations](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-automations)).
- **Actions minutes for standard hosted runners:** free on public repos ([Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions#free-use-of-github-actions)). Copilot code review minutes on **public** repos remain free (same page, Copilot code review subsection).
- **AI credits** for cloud agent / code review still meter against the Copilot subscriber (see sibling cost research); not free just because the repo is public ([About cloud agent](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent) usage-costs section).
- **Fork PRs / untrusted writers:** `@copilot` ignores non-write commenters ([Troubleshooting](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/troubleshoot-cloud-agent)). Automations’ “ignore non-write event authors” pattern does not apply on public because automations are unavailable; the orchestrator’s own label/plan-gate remains the spend control.

### 3.3 Workflow runs on Copilot PRs

By default, GitHub Actions workflows **do not run automatically** when Copilot pushes; a write user must **Approve and run workflows** (or configure agent settings to allow without intervention) ([Use cloud agent on GitHub](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/use-cloud-agent-on-github); [Troubleshooting](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/troubleshoot-cloud-agent)). An orchestrator that expects CI green before review round 2 must account for this approval step (human or configured auto-approve).

---

## 4. What **cannot** be constrained (first-party gaps)

| Desired bound | First-party reality |
|---------------|---------------------|
| **Review rounds ≤2** | No product API or setting for “max Copilot reviews.” Re-review is manual or “every push” auto ([Configure automatic review](https://docs.github.com/en/copilot/how-tos/copilot-on-github/set-up-copilot/configure-automatic-review)). Cap must live in the orchestrator. |
| **Must implement exactly the gated plan** | Soft guidance only: issue body / `custom_instructions` / task `prompt`. No published “plan artifact contract” or enforcement that rejects divergent diffs. |
| **Interactive research→plan→PR from Actions** | Research/plan-before-PR is GitHub.com Agents UI; assign path always PR ([Kick off a task](https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/kick-off-a-task); [Research, plan, and iterate](https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/research-plan-iterate)). |
| **Session longer than 59 minutes** | Hard limit; cannot extend ([About cloud agent](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent)). |
| **Multi-repo / multi-PR single task** | One specified repo; one branch; exactly one PR per assigned task (same page). |
| **Post-assign issue comments as steering** | Ignored; use PR comments ([Kick off a task](https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/kick-off-a-task)). |
| **Copilot review as merge gate** | Comment-only; does not satisfy required reviews ([Copilot code review how-to](https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/copilot-code-review)). |
| **Installation-token adapter** | Agent tasks API rejects server-to-server tokens ([Using Copilot cloud agent via the API](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/use-cloud-agent-via-the-api)). |
| **Public-repo event automations** | Not available ([About automations](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-automations)). |
| **Model switch for code review** | Model switching not supported for code review ([About code review](https://docs.github.com/en/copilot/concepts/agents/code-review#model-usage)). |
| **Complete issue coverage / perfect reviews** | Explicitly not guaranteed; always validate with humans ([About code review](https://docs.github.com/en/copilot/concepts/agents/code-review#validating-copilot-code-reviews); responsible-use agents card linked from cloud-agent docs). |

**Compatible rulesets:** rules that only allow specific commit authors (or similar) can **block** the agent entirely unless Copilot is added as a bypass actor ([About cloud agent](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent) limitations). That is a repo-policy failure mode, not something the adapter can soft-negotiate at runtime.

---

## 5. Failure modes (public repo + Actions adapter)

Drawn from [Troubleshooting GitHub Copilot cloud agent](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/troubleshoot-cloud-agent) and related pages:

| Symptom | Likely cause (docs) | Orchestrator implication |
|---------|---------------------|---------------------------|
| Copilot missing from Assignees | No paid plan; or cloud agent disabled for repo/org | Fail plan→implement transition; surface config |
| Assign succeeds, nothing happens | Wait/refresh; expect 👀 then draft PR | Poll with timeout; don’t treat silence as success |
| Stuck session | May recover; else times out (~1 hour); unassign/reassign | Treat `timed_out` / hung poll as failed round; re-queue new task only if budget allows |
| `@copilot` ignored | No write; PR closed/merged; Copilot unassigned | Use write-capable user token; only open PRs |
| CI not running on agent PR | Default “Approve and run workflows” gate | Separate approval step or agent setting |
| Firewall warning on PR/comment | Agent outbound blocked | Custom firewall docs; may need allowlist |
| Screenshots dropped | Image &gt; 3.00 MiB removed | Keep plan handoff textual for reliability |
| EMU personal repo | Hosted runners unavailable for EMU personal repos | Use org-owned public repo |
| Agent-tasks Start 403 | Not Business/Enterprise; or wrong token type | Fall back to issue assign on Pro |
| Ruleset blocks agent commits | Incompatible branch rules | Add bypass or relax rule before pipeline |

Task states for API polling include `failed`, `timed_out`, `cancelled`, `waiting_for_user` ([Using Copilot cloud agent via the API](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/use-cloud-agent-via-the-api)) — map those to adapter errors rather than inventing silent retries without a budget.

---

## 6. Implications for the locked stack (adapter-only)

1. **Invoke = API/issue/PR surfaces, not automations**, on a public repo ([About automations](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-automations)).
2. **Plan-gate stays outside Copilot.** Handoff is issue body / `custom_instructions` / tasks `prompt` written by the orchestrator after human approval ([Kick off a task](https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/kick-off-a-task); [Using Copilot cloud agent via the API](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/use-cloud-agent-via-the-api)).
3. **Prefer issue assign + `copilot-swe-agent[bot]`** for Pro-era public OSS; treat agent-tasks **Start** as Business/Enterprise-capable enhancement ([agent tasks REST](https://docs.github.com/en/rest/agent-tasks/agent-tasks)).
4. **Review = `copilot-pull-request-reviewer[bot]`**; **≤2 rounds = orchestrator counter** + avoid auto “Review new pushes” ([Copilot code review how-to](https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/copilot-code-review); [Configure automatic review](https://docs.github.com/en/copilot/how-tos/copilot-on-github/set-up-copilot/configure-automatic-review)).
5. **Store a user-to-server secret** for the adapter; do not expect `GITHUB_TOKEN` to start agent tasks ([Using Copilot cloud agent via the API](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/use-cloud-agent-via-the-api); [Automatic token authentication](https://docs.github.com/en/actions/security-guides/automatic-token-authentication)).
6. **Do not make Copilot the assignee-spine** of the product workflow: assign is a start signal; labels, plan-gate, and round limits remain Actions-owned.

---

## Sources (primary)

- [Kick off a task with Copilot agents on GitHub](https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/kick-off-a-task)
- [Using Copilot cloud agent on GitHub](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/use-cloud-agent-on-github)
- [Using Copilot cloud agent via the API](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/use-cloud-agent-via-the-api)
- [REST API endpoints for agent tasks](https://docs.github.com/en/rest/agent-tasks/agent-tasks)
- [REST API endpoints for issue assignees](https://docs.github.com/en/rest/issues/assignees)
- [REST API endpoints for review requests](https://docs.github.com/en/rest/pulls/review-requests)
- [About GitHub Copilot cloud agent](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent)
- [Research, plan, and iterate](https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/research-plan-iterate)
- [About Copilot automations](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-automations)
- [Managing access to GitHub Copilot cloud agent](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/access-management)
- [Using GitHub Copilot code review on GitHub](https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/copilot-code-review)
- [About GitHub Copilot code review](https://docs.github.com/en/copilot/concepts/agents/code-review)
- [Configuring automatic code review by GitHub Copilot](https://docs.github.com/en/copilot/how-tos/copilot-on-github/set-up-copilot/configure-automatic-review)
- [Get started with Copilot agents on GitHub](https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/overview)
- [Starting GitHub Copilot sessions](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/start-copilot-sessions)
- [Troubleshooting GitHub Copilot cloud agent](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/troubleshoot-cloud-agent)
- [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
- [Use GITHUB_TOKEN for authentication in workflows](https://docs.github.com/en/actions/security-guides/automatic-token-authentication)

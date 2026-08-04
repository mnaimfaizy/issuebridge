# Research: label-triggered / issue-driven AI issue→PR automation

**Date:** 2026-08-04  
**Question:** How are others implementing label-triggered or issue-driven AI automation that plans, opens a PR, and reviews — including safety gates (who can invoke), hosting (GitHub-native vs VPS vs local), and cost posture? Survey concrete products and OSS patterns from primary docs and first-party write-ups. Extract patterns Issuebridge can copy or avoid.  
**Issue context:** [#83](https://github.com/mnaimfaizy/issuebridge/issues/83) (wayfinder research; part of #80 — this note does not map #80).

## Scope of this note

Primary sources only: official product docs, first-party vendor blogs, and first-party OSS READMEs / action manifests. Community forum threads and third-party composite actions are cited only when they document a **gap or workaround** relative to first-party docs, and are labeled as such.

Products surveyed:

| System | Role in survey |
|--------|----------------|
| GitHub Copilot cloud agent (+ automations) | GitHub-native issue→plan→PR agent |
| Cursor Automations / Cloud Agents / Bugbot | Vendor cloud agents + PR review |
| OpenHands GitHub Resolver | OSS label-triggered issue→PR on Actions |
| Anthropic Claude Code Action | OSS/first-party Actions bot (mention / label / assignee) |
| OpenAI Codex Action | First-party Actions runner with strong sandbox defaults |

---

## 1. GitHub Copilot cloud agent

### Trigger model (issue → PR)

- **Primary invoke:** assign the issue to **Copilot** (assignee), not a label. Copilot starts work, opens a pull request, then requests review. ([Using Copilot cloud agent on GitHub](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/use-cloud-agent-on-github); [About Copilot cloud agent](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent))
- **API invoke:** REST/GraphQL can assign `copilot-swe-agent[bot]` with optional `agent_assignment` / `agentAssignment` (target repo, base branch, custom instructions, model). ([Use cloud agent via the API](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/use-cloud-agent-via-the-api))
- **PR iteration:** `@copilot` on a PR only responds to people with **write** access. ([Using Copilot cloud agent on GitHub](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/use-cloud-agent-on-github))
- **Automations (event-driven):** schedule, issue created, PR opened, PR synchronized — with optional search filters. **Not** a documented “issue labeled” trigger. Automations are **private/internal repos only** (not public). ([About Copilot automations](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-automations))
- **Planning posture:** cloud agent can research, create an implementation plan, and make branch changes; deep research/plan/iterate before PR is GitHub.com-centric. Session hard timeout **59 minutes**. ([About Copilot cloud agent](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent))

### Safety gates

- Only users with **write access** can trigger the agent; comments from non-writers are never presented. ([Risks and mitigations](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/risks-and-mitigations))
- Agent pushes only to a dedicated `copilot/` branch (or the existing PR branch when `@copilot` is used); cannot mark draft PRs ready, approve, or merge. ([Risks and mitigations](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/risks-and-mitigations))
- **Actions workflows on agent PRs require human “Approve and run workflows”** by default (secrets/privilege risk). ([Using Copilot cloud agent on GitHub](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/use-cloud-agent-on-github); [Configuring agent settings](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/configuring-agent-settings))
- Default **firewall** limits outbound network; hidden/HTML-comment prompt injection filtered. ([Responsible use — Agents](https://docs.github.com/en/copilot/responsible-use/agents); [Risks and mitigations](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/risks-and-mitigations))
- Automations: least-privilege **tool allowlists**; ignore non-write actors by default; work attributed to automation creator (who cannot approve their own PR). ([About Copilot automations](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-automations))
- Built-in pre-finish validation: CodeQL, Advisory DB for new deps, secret scanning + optional Copilot code review. ([Risks and mitigations](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/risks-and-mitigations))

### Hosting

- Ephemeral env **powered by GitHub Actions** on GitHub-hosted infrastructure — not a user VPS. ([About Copilot cloud agent](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent))
- GitHub-hosted repositories only. ([About Copilot cloud agent](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent))

### Cost posture

- Consumes **GitHub Actions minutes** and **AI credits** (model/token dependent); included allowances avoid extra cost until exhausted. ([About Copilot cloud agent](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent); [Usage-based billing](https://docs.github.com/en/copilot/concepts/billing/usage-based-billing-for-organizations-and-enterprises))
- Legacy premium-request framing: each cloud agent **session** consumes premium-request budget (SKU-specific). ([Premium requests (legacy)](https://docs.github.com/en/copilot/reference/copilot-billing/request-based-billing-legacy/github-copilot-premium-requests))
- Automations bill Actions + AI credits to the **user who created** the automation. ([About Copilot automations](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-automations))
- Requires a **paid** Copilot plan; Business/Enterprise need admin policy enablement. ([About Copilot cloud agent](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent))

### Pattern takeaway

**Assignee-as-invoke** (human intent) + hard write-access gate + draft/human-merge + delayed Actions secrets. Closest GitHub-native “teammate” model. Weak fit if the product wants a **public-repo label** trigger: Copilot automations exclude public repos and do not document label triggers.

---

## 2. Cursor: Automations, Cloud Agents, Bugbot

### Trigger model

**Automations** run cloud agents on schedule or SCM/Slack/Linear/webhook/Sentry/PagerDuty events. GitHub-specific triggers include:

- **Issue label changed** (non-PR issues)
- **Pull request label changed**
- Issue comment, PR review events, CI / workflow completed, etc.

([Cursor Automations](https://cursor.com/docs/cloud-agent/automations))

Repo-backed automations can **open pull requests** (tool enabled by default). ([Cursor Automations](https://cursor.com/docs/cloud-agent/automations))

**Bugbot** is a **PR review** agent (auto on PR updates or `cursor review` / `bugbot run`), not the issue→implement path. **Bugbot Autofix** can spawn a Cloud Agent to fix findings. ([Bugbot](https://cursor.com/docs/bugbot))

**Cloud Agents API** lets you `POST` to launch an agent with `source.repository` / `ref`, optional `target.autoCreatePr`, branch name, webhooks. Useful as the backend when a GitHub Action watches `issues: labeled`. ([Cloud Agents API v0](https://cursor.com/docs/cloud-agent/api/v0); current API noted on that page)

### Safety / permissions

- Automation scopes: **Private** / **Team Visible** / **Team Owned** — who can manage vs who triggers, and **who is billed**. Team Owned runs as a shared service account. ([Cursor Automations](https://cursor.com/docs/cloud-agent/automations))
- Identity: GitHub comments/approvals as `cursor`; Private automations open PRs as the **user**; Team-scoped as `cursor`. ([Cursor Automations](https://cursor.com/docs/cloud-agent/automations))
- Memories / MCP: docs warn untrusted input can poison memories; only connect trusted MCP servers. ([Cursor Automations](https://cursor.com/docs/cloud-agent/automations))
- Fork PRs: Automations do **not** run on PRs from forks (security). ([Cursor Automations](https://cursor.com/docs/cloud-agent/automations))

**Caveat (not primary docs):** Cursor’s own community forum reports that “Issue label changed” is documented but may be missing from the Automations UI at times — treat UI availability as something to verify in-product, not as a guarantee from docs alone. ([Cursor community thread](https://forum.cursor.com/t/cursor-agent-github-issue-label-change-trigger/166049) — secondary)

### Hosting

- Cloud agents / Automations / Bugbot run on **Cursor’s cloud**, not GitHub Actions runners (Actions may still be used as a thin webhook to call Cursor’s API). ([Cursor Automations](https://cursor.com/docs/cloud-agent/automations); [Cloud Agents API](https://cursor.com/docs/cloud-agent/api/v0))
- API docs also describe **private workers** / self-hosted pool endpoints for enterprise-style capacity. ([Cloud Agents API v0](https://cursor.com/docs/cloud-agent/api/v0))

### Cost posture

- Automations create cloud agents and bill **cloud agent usage**; Team Owned → team pool; Private/Team Visible → creating user. Automations use max context windows. ([Cursor Automations](https://cursor.com/docs/cloud-agent/automations))
- Individual plans (Pro+) include Cloud Agents; Automations called out as not on Start. Model usage from plan pools / on-demand API rates. ([Models & Pricing](https://cursor.com/docs/models-and-pricing))
- Bugbot: included usage then on-demand; Autofix uses Cloud Agent credits. ([Bugbot](https://cursor.com/docs/bugbot))

### Pattern takeaway

**First-class label trigger in product docs** + separate **review** product (Bugbot) from **implement** (cloud agent). Strong “compose via API + Actions glue” escape hatch. Cost is vendor metered, not BYOK LLM on your runners.

---

## 3. OpenHands GitHub Resolver (OSS)

### Trigger model

Documented flow:

1. Create an issue.
2. Add label **`fix-me`**, **or** comment starting with **`@openhands-agent`**.
3. Agent attempts resolution; review the PR; re-label / mention for follow-up.

([OpenHands GitHub Action docs](https://docs.openhands.dev/openhands/usage/run-openhands/github-action); first-party blog [Open-source coding agents in your GitHub](https://www.openhands.dev/blog/open-source-coding-agents-in-your-github-fixing-your-issues))

**Label vs macro:**

- `fix-me` → address the **entire** issue/PR thread.
- `@openhands-agent` → only the issue/PR description **plus that comment**.

([OpenHands GitHub Action docs](https://docs.openhands.dev/openhands/usage/run-openhands/github-action))

Workflow behavior (resolver README / blog): attempt resolve → **draft PR** if successful else push a branch → comment results → **remove `fix-me`**. ([OpenHands blog](https://www.openhands.dev/blog/open-source-coding-agents-in-your-github-fixing-your-issues); resolver tree [OpenHands/openhands/resolver](https://github.com/OpenHands/OpenHands/tree/main/openhands/resolver))

**PR review path:** separate workflow patterns use label **`review-this`** or requesting `openhands-agent` as reviewer. ([OpenHands code review docs](https://docs.openhands.dev/openhands/usage/use-cases/code-review))

### Safety gates

- First-party workflow conditions for `@openhands-agent` comments require `author_association` ∈ `{OWNER, COLLABORATOR, MEMBER}` (label path is “who can apply the label,” which already implies permission to label). ([OpenHands resolver workflow example cited in docs ecosystem](https://github.com/OpenHands/OpenHands/blob/ff1d47247331c6bb4ef21c362ad8f122892ea864/.github/workflows/openhands-resolver.yml))
- Repo must grant Actions **read/write** + allow Actions to create/approve PRs. ([OpenHands blog](https://www.openhands.dev/blog/open-source-coding-agents-in-your-github-fixing-your-issues))
- Optional PAT for a dedicated bot identity. ([OpenHands blog](https://www.openhands.dev/blog/open-source-coding-agents-in-your-github-fixing-your-issues))
- Local resolver exists (including bulk “all issues”) — higher blast radius than label-gated Actions. ([OpenHands blog](https://www.openhands.dev/blog/open-source-coding-agents-in-your-github-fixing-your-issues))

### Hosting

- Default: **GitHub Actions** calling OpenHands resolver (pip/image as configured).
- Also runnable **locally**. ([OpenHands blog](https://www.openhands.dev/blog/open-source-coding-agents-in-your-github-fixing-your-issues))

### Cost posture

- **BYO LLM API key** (`LLM_API_KEY` / model secrets) + **Actions minutes**. ([OpenHands blog](https://www.openhands.dev/blog/open-source-coding-agents-in-your-github-fixing-your-issues); [code review docs](https://docs.openhands.dev/openhands/usage/use-cases/code-review))
- Public repos: Actions minutes free for standard runners; LLM cost still applies. ([GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions#free-use-of-github-actions))

### Pattern takeaway

Canonical **label-as-expensive-intent** pattern: consume the label, draft PR, human review. Split **implement** (`fix-me`) from **review** (`review-this`). Association checks on mentions. Closest OSS template for a custom Issuebridge-adjacent bot.

---

## 4. Anthropic Claude Code Action

### Trigger model

- Interactive: **`@claude`** (configurable `trigger_phrase`) in comments / bodies.
- Issue automation: optional **`assignee_trigger`**, **`label_trigger`** (e.g. `"claude"`).
- Automation mode: supply `prompt` so the action runs without a mention (any supporting GitHub event).

([Claude Code GitHub Actions](https://code.claude.com/docs/en/github-actions); [claude-code-action usage](https://github.com/anthropics/claude-code-action/blob/main/docs/usage.md); [action.yml](https://github.com/anthropics/claude-code-action/blob/main/action.yml))

Default `label_trigger` in `action.yml` is `"claude"`. ([action.yml](https://github.com/anthropics/claude-code-action/blob/main/action.yml))

### Safety gates

- Default: only users with **write access** can trigger. ([security.md](https://github.com/anthropics/claude-code-action/blob/main/docs/security.md))
- Bots blocked unless `allowed_bots` (warns strongly against `'*'` on public repos). ([security.md](https://github.com/anthropics/claude-code-action/blob/main/docs/security.md))
- `allowed_non_write_users` is explicitly **risky** — only for minimal-permission workflows (e.g. labeling). Prefer short-lived `GITHUB_TOKEN`, not PATs. ([security.md](https://github.com/anthropics/claude-code-action/blob/main/docs/security.md))
- Default interactive posture: commits to a branch and gives a **PR creation link**; user creates the PR (human oversight). ([security.md](https://github.com/anthropics/claude-code-action/blob/main/docs/security.md))
- Sanitizes HTML comments / invisible chars; still warns about prompt injection on untrusted content. ([security.md](https://github.com/anthropics/claude-code-action/blob/main/docs/security.md))
- Avoid checking out untrusted PR heads into workspace root under `pull_request_target` / `workflow_run`. ([security.md](https://github.com/anthropics/claude-code-action/blob/main/docs/security.md))

### Hosting

- Runs on **GitHub-hosted runners** (“code stays on Github's runners”). ([Claude Code GitHub Actions](https://code.claude.com/docs/en/github-actions))
- Enterprise: Bedrock / Vertex via OIDC (no long-lived cloud keys in secrets). ([Claude Code GitHub Actions](https://code.claude.com/docs/en/github-actions))

### Cost posture

- Dual meter: **Actions minutes** + **Anthropic API** (or Bedrock/Vertex bill). Tips: specific `@claude` commands, `--max-turns`, workflow timeouts, concurrency limits. ([Claude Code GitHub Actions](https://code.claude.com/docs/en/github-actions))

### Pattern takeaway

**Write-gated** Actions bot with **label + assignee + mention** triggers and explicit warnings for public-repo bot allowlists. Prefer “branch + human opens PR” default over silent auto-PR for untrusted flows.

---

## 5. OpenAI Codex Action (+ first-party label workflows)

### Trigger model

- `openai/codex-action` is a **generic** “run Codex in Actions with a prompt” primitive; workflows choose events. ([codex-action README](https://github.com/openai/codex-action/blob/main/README.md))
- OpenAI’s own `openai/codex` repo uses labels like **`codex-label`** / **`codex-deduplicate`** to re-run triage, then **removes the label** in an `always()` step. ([issue-labeler.yml](https://github.com/openai/codex/blob/main/.github/workflows/issue-labeler.yml))

### Safety gates

- `allow-users` / write-access checks; bots gated via `allow-bots` / explicit `allow-bot-users` (no `*`). ([codex-action README](https://github.com/openai/codex-action/blob/main/README.md))
- Default **`safety-strategy: drop-sudo`**; prefer **`permission-profile: ":workspace"`** (no network) vs broader sandboxes; `unsafe` only when prompt is fully trusted. ([codex-action README](https://github.com/openai/codex-action/blob/main/README.md))
- Example review workflow: Codex job with `contents: read`, separate job posts comment with narrower write perms. ([codex-action README](https://github.com/openai/codex-action/blob/main/README.md))

### Hosting / cost

- GitHub Actions + **OpenAI (or Azure) API key** via secrets / proxy. ([codex-action README](https://github.com/openai/codex-action/blob/main/README.md))

### Pattern takeaway

Treat Actions as a **privileged shell with least privilege**: sandboxed agent job + separate mutation job; **ephemeral trigger labels** that self-delete; never leave expensive automations on `opened` alone without filters if the repo is noisy.

---

## 6. Cross-cutting pattern map

| Dimension | Copilot cloud agent | Cursor Automations / Bugbot | OpenHands | Claude Code Action | Codex Action |
|-----------|---------------------|-----------------------------|---------|--------------------|--------------|
| Issue→implement trigger | Assignee (+ API) | Issue label / comment / API | `fix-me` label / `@openhands-agent` | `@claude` / label / assignee | Custom workflow (`labeled`, etc.) |
| Review path | Copilot code review / `@copilot` | Bugbot (+ Autofix) | `review-this` | Prompted review workflows | DIY PR review example |
| Who can invoke | Write access | Automation scope + SCM identity | Labelers; mentions gated by association | Write access (default) | Write access (+ allow lists) |
| Hosting | GitHub Actions (managed) | Cursor cloud (+ optional private workers) | Actions or local | Actions | Actions |
| Cost | Copilot AI credits + Actions mins | Cursor cloud / Bugbot usage | BYO LLM + Actions | Anthropic/Bedrock + Actions | OpenAI/Azure + Actions |
| Public-repo automation | Automations **not** available | Supported (with fork PR caveats) | Supported | Supported (tight write gates) | Supported |

### Patterns worth **copying** for Issuebridge-shaped work

1. **Explicit expensive invoke** — Prefer assignee, trusted label, or mention over “every issue opened.” (Copilot assignee; OpenHands `fix-me`; Claude `label_trigger`; Codex `codex-label`.)
2. **Write-access / association gate** — Default deny for outsiders; never casually enable `allowed_bots: '*'` or `allowed_non_write_users` on public repos. (Copilot, Claude security, Codex allow lists, OpenHands association checks.)
3. **Consume the trigger** — Remove or replace the label (`fix-me`, `codex-label`) so re-runs are intentional; optional second “enqueued/in-progress” label for concurrency. (OpenHands; OpenAI workflows.)
4. **Draft PR + human merge** — Agent must not approve/merge; prefer draft or “user clicks create PR.” (Copilot risks docs; Claude security default.)
5. **Separate implement vs review** — Distinct labels/products (`fix-me` vs `review-this`; cloud agent vs Bugbot). Avoid one mega-bot that both authors and rubber-stamps.
6. **Delay privileged CI** — Don’t auto-run secret-bearing workflows on agent-authored PRs until a human approves. (Copilot default.)
7. **Least-privilege tools / sandbox** — Automation tool allowlists (Copilot/Cursor); Codex `:workspace` + drop-sudo; firewall for managed agents.
8. **Split cost meters in UX thinking** — Users feel “Actions minutes + LLM/API” (OSS bots) vs “plan credits” (Copilot/Cursor). Document both when recommending a stack.
9. **Repo instructions** — `AGENTS.md` / `CLAUDE.md` / Copilot custom instructions / Cursor prompts steer quality without changing invoke gates.

### Patterns worth **avoiding**

1. **Auto-implement on every public issue open** without write gates — prompt-injection and cost DoS surface. (Copilot automations default-ignore non-writers for this reason; Claude warns on public bots.)
2. **Private-only features as the only plan** if the target repo is public — Copilot automations explicitly exclude public repos.
3. **Letting the implementer auto-approve** privileged Actions or its own PR.
4. **Checking out untrusted PR heads into the root workspace** under elevated tokens (`pull_request_target`). (Claude security; GitHub Security Lab guidance linked there.)
5. **Relying on UI parity with docs** for niche triggers without verification (Cursor issue-label UI gap reports).
6. **Bulk local “fix everything”** as a default product path — OpenHands documents it; blast radius is high for a maintainer tool aimed at careful Publish flows.

---

## 7. Implications for Issuebridge (non-prescriptive)

Issuebridge’s domain centers on Capture → Draft → Publish (and Label catalog), not on becoming a coding agent. If later work explores “label means send this Published issue to an agent,” primary sources suggest:

| If Issuebridge… | Lean toward |
|-----------------|-------------|
| Stays on **public** GitHub repos | Actions-based bots (OpenHands / Claude / Codex) or Cursor Automations/API — **not** Copilot automations |
| Wants **zero infra** for maintainers who already pay Copilot | **Assign to Copilot** (or API assign) rather than inventing labels |
| Wants **label UX** matching Label catalog | OpenHands-style `fix-me` / Claude `label_trigger` / Cursor “Issue label changed” |
| Needs **review** without implement | Bugbot, Copilot code review, or OpenHands `review-this` — separate from Publish |
| Cares about **cost predictability** | BYOK + max-turns/concurrency (Actions bots) vs subscription credit pools (Copilot/Cursor) |
| Must stay **safe by default** | Write-gate + draft PR + remove trigger label + no auto workflow secrets |

This research does **not** choose a product direction for #80; it only inventories copyable controls and hosting/cost shapes.

---

## Sources (primary)

- [About GitHub Copilot cloud agent](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent)
- [Using Copilot cloud agent on GitHub](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/use-cloud-agent-on-github)
- [Use cloud agent via the API](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/use-cloud-agent-via-the-api)
- [About Copilot automations](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-automations)
- [Risks and mitigations for Copilot cloud agent](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/risks-and-mitigations)
- [Responsible use: Agents](https://docs.github.com/en/copilot/responsible-use/agents)
- [Usage-based billing for organizations and enterprises](https://docs.github.com/en/copilot/concepts/billing/usage-based-billing-for-organizations-and-enterprises)
- [GitHub Copilot premium requests (legacy)](https://docs.github.com/en/copilot/reference/copilot-billing/request-based-billing-legacy/github-copilot-premium-requests)
- [Assigning and completing issues with coding agent (GitHub Blog)](https://github.blog/ai-and-ml/github-copilot/assigning-and-completing-issues-with-coding-agent-in-github-copilot/)
- [Cursor Automations](https://cursor.com/docs/cloud-agent/automations)
- [Cursor Bugbot](https://cursor.com/docs/bugbot)
- [Cursor Models & Pricing](https://cursor.com/docs/models-and-pricing)
- [Cursor Cloud Agents API v0](https://cursor.com/docs/cloud-agent/api/v0)
- [OpenHands GitHub Action](https://docs.openhands.dev/openhands/usage/run-openhands/github-action)
- [OpenHands code review](https://docs.openhands.dev/openhands/usage/use-cases/code-review)
- [OpenHands blog: open-source coding agents in your GitHub](https://www.openhands.dev/blog/open-source-coding-agents-in-your-github-fixing-your-issues)
- [OpenHands resolver tree](https://github.com/OpenHands/OpenHands/tree/main/openhands/resolver)
- [Claude Code GitHub Actions](https://code.claude.com/docs/en/github-actions)
- [claude-code-action security.md](https://github.com/anthropics/claude-code-action/blob/main/docs/security.md)
- [claude-code-action usage.md](https://github.com/anthropics/claude-code-action/blob/main/docs/usage.md)
- [claude-code-action action.yml](https://github.com/anthropics/claude-code-action/blob/main/action.yml)
- [openai/codex-action README](https://github.com/openai/codex-action/blob/main/README.md)
- [openai/codex issue-labeler.yml](https://github.com/openai/codex/blob/main/.github/workflows/issue-labeler.yml)
- [GitHub Actions billing — free use](https://docs.github.com/en/billing/concepts/product-billing/github-actions#free-use-of-github-actions)

Secondary (UI caveat only): [Cursor forum — issue label trigger](https://forum.cursor.com/t/cursor-agent-github-issue-label-change-trigger/166049)

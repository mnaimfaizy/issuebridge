# Research: Copilot Max and GitHub-native agent cost and capabilities

**Date:** 2026-08-04  
**Question:** For GitHub Copilot Max (and related GitHub-native coding agents / Actions patterns), what can actually power a plan → PR → review loop on a **public** repo today? Document metering, included usage vs overage, per-repo or seat limits, public vs private differences, and rough cost for ~one serial pipeline at a time within a ~$20–50/mo learning budget.  
**Issue context:** [#82](https://github.com/mnaimfaizy/issuebridge/issues/82) (wayfinder research; part of #80 — this note does not map #80).

## Scope of this note

Primary sources only:

- GitHub Docs (Copilot billing, plans, cloud agent, code review, Actions billing)
- GitHub product / plans pages (`github.com/features/copilot/plans`)

Secondary blogs, third-party cost calculators, and anecdotal “average session” posts are **not** used as evidence. Where GitHub does not publish a fixed per-session price, that gap is stated explicitly.

---

## Executive verdict

**Yes — a plan → PR → review loop exists today on GitHub.com** via **Copilot cloud agent** (research / plan / implement on a branch, then PR) plus **Copilot code review** (request Copilot as a PR reviewer), with optional `@copilot` iteration on the same PR. Official walkthrough: [Get started with Copilot agents on GitHub](https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/overview); capabilities: [About GitHub Copilot cloud agent](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent); research/plan/iterate: [Research, plan, and iterate](https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/research-plan-iterate).

**Copilot Max ($100 USD/mo) is outside a ~$20–50 learning budget** as a subscription alone. Within that budget, the primary-source fit is **Copilot Pro ($10)** or **Copilot Pro+ ($39)** — both include cloud agent and code review — plus optional **additional AI-credit budgets**, with **Actions minutes free on public repos** for standard hosted runners (including agent/review infrastructure).

---

## 1. What powers the loop today (capabilities)

### Copilot cloud agent (implement / plan / PR)

Copilot cloud agent can research a repository, create implementation plans, make code changes on a branch, open pull requests, and iterate from PR comments. Documented task types include bug fixes, incremental features, tests, docs, tech debt, and merge-conflict resolution ([About GitHub Copilot cloud agent](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent)).

**Ways to start a coding task:**

| Entry | PR behavior | Source |
|-------|-------------|--------|
| Assign an issue to Copilot | Always creates a PR; Copilot requests your review when done | [Kick off a task](https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/kick-off-a-task); [Use cloud agent on GitHub](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/use-cloud-agent-on-github) |
| Agents tab / panel prompt | Works on a branch by default; create PR when ready (or ask for a PR in the prompt) | [Research, plan, and iterate](https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/research-plan-iterate) |
| `@copilot` on an existing PR | Pushes new commits to the same branch | [Agents overview](https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/overview) |

While coding, the agent runs in an **ephemeral GitHub Actions–powered environment** where it can explore code, change files, and run tests/linters ([About GitHub Copilot cloud agent](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent)).

**Hard workflow limits** (same page):

- Changes only in the **one repository** specified for the task (no multi-repo run).
- **One branch** and **exactly one PR** per assigned task.
- **Maximum session execution time: 59 minutes** (hard limit; break large work into smaller tasks).

**Not the same as IDE “agent mode”:** cloud agent is autonomous on GitHub Actions compute; IDE agent mode edits locally ([About GitHub Copilot cloud agent](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent)).

### Plan phase (research → plan → implement)

On GitHub.com only, cloud agent supports deep research, creating/refining a plan, then iterating on a branch before opening a PR ([Research, plan, and iterate](https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/research-plan-iterate)). Integrations (Jira, Linear, Slack, etc.) only support creating a PR directly — not the research/plan-before-PR flow (same page; also noted in [About GitHub Copilot cloud agent](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent)).

GitHub’s cost-optimization tutorial recommends splitting research / plan / implement across sessions and using stronger models for planning and cheaper ones for execution ([Optimizing your AI usage](https://docs.github.com/en/copilot/tutorials/optimize-ai-usage)).

### Review phase (Copilot code review)

After a PR exists, request **Copilot** under Reviewers; review comments typically appear in under ~30 seconds ([Agents overview](https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/overview); [Copilot code review](https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/copilot-code-review)). You can then apply suggestions, ask cloud agent to **Fix with Copilot**, or mention `@copilot` for further commits.

### Serial vs concurrent

Docs explicitly allow **multiple agent sessions concurrently** ([About agent management](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/agent-management); the agents overview walks through two parallel sessions). There is **no published hard “one session per user/repo” cap** in these pages — concurrency is supported; cost still scales with AI credits + Actions minutes. A learning budget that aims for **~one serial pipeline** is a cost-control choice, not a product requirement.

### Partner / third-party coding agents

Paid individual plans can enable partner agents (e.g. Anthropic Claude, OpenAI Codex) in personal cloud-agent settings; they share the same repository enablement as Copilot cloud agent and consume AI credits when used ([Manage policies](https://docs.github.com/en/copilot/how-tos/manage-your-account/manage-policies); billing lists “third-party coding agents” under AI credits — [Usage-based billing for individuals](https://docs.github.com/en/copilot/concepts/billing/usage-based-billing-for-individuals)).

### Automations (event/schedule) — **not** for public repos

**Copilot automations** (schedule or issue/PR events) start cloud-agent sessions automatically, but require a **private or internal** repository — **not available in public repositories** ([About Copilot automations](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-automations); [Access management](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/access-management)). For a public Issuebridge-style repo, the loop must be **manually** started (issue assign, Agents UI, `@copilot`), not automation-triggered.

---

## 2. Plan eligibility and “Max” positioning

### Individual plan prices and AI-credit allowances (current usage-based billing)

As of the current docs (usage-based billing; request-based “premium requests” are **legacy** for remaining annual Pro/Pro+ subscribers after 2026-06-01 — [What changed with billing](https://docs.github.com/en/copilot/reference/copilot-billing/request-based-billing-legacy/what-changed-with-billing)):

| Plan | Price / month | Base credits | Flex allotment | Total monthly AI credits | Face value of total (1 credit = $0.01) |
|------|---------------|--------------|----------------|--------------------------|----------------------------------------|
| Copilot Pro | $10 USD | 1,000 | 500 | **1,500** | $15 |
| Copilot Pro+ | $39 USD | 3,900 | 3,100 | **7,000** | $70 |
| Copilot Max | $100 USD | 10,000 | 10,000 | **20,000** | $200 |

Sources: [Usage-based billing for individuals](https://docs.github.com/en/copilot/concepts/billing/usage-based-billing-for-individuals); [Individual plans](https://docs.github.com/en/copilot/concepts/billing/individual-plans); [Copilot licenses](https://docs.github.com/en/billing/concepts/product-billing/github-copilot-licenses); product page [Plans & pricing](https://github.com/features/copilot/plans) (markets Max as “sustained, high-volume agent workflows” with “$200 monthly total credits”).

**Base vs flex:** Base credits match subscription price and are fixed; flex is additional included usage that GitHub may adjust as model economics change. Base is consumed first; flex applies automatically at the same rates ([Usage-based billing for individuals](https://docs.github.com/en/copilot/concepts/billing/usage-based-billing-for-individuals)).

**Reset:** Included credits **do not roll over**. Allowance resets at **00:00:00 UTC on the 1st of each calendar month** (not on your subscription anniversary) (same page).

### What Max adds vs Pro+

Max is “everything in Pro+” plus the **highest individual AI-credit allowance** and **priority access** to new models/features ([Individual plans](https://docs.github.com/en/copilot/concepts/billing/individual-plans); [Plans for GitHub Copilot](https://docs.github.com/en/copilot/get-started/plans)). It is **not** a separate agent product — cloud agent and code review are already on Pro / Pro+ / Max / Business / Enterprise ([Plans](https://docs.github.com/en/copilot/get-started/plans); [About GitHub Copilot cloud agent](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent)).

### Cloud agent enablement

- **Pro / Pro+ / Max:** cloud agent **enabled by default** ([Access management](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/access-management)).
- **Business / Enterprise:** disabled by default; admin must enable (same page).
- Available for **all paid** Copilot plans; available in repositories on GitHub except managed-user-owned repos and where explicitly disabled ([Manage policies](https://docs.github.com/en/copilot/how-tos/manage-your-account/manage-policies)).

**Premium models:** Pro+ and Max have full premium-model access in the individual-plan comparison; Pro has a selection of models ([Individual plans](https://docs.github.com/en/copilot/concepts/billing/individual-plans)). Cloud agent model picker (where supported) lists specific models including Auto, Claude Sonnet/Opus/Haiku variants, Gemini Flash/Pro, GPT-5.x family, etc. ([Changing the AI model](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/changing-the-ai-model)).

### Seats / per-repo limits

- Individual Pro / Pro+ / Max are **single-user licenses** — you cannot add seats on a personal plan; multi-user requires Business/Enterprise ([Copilot licenses](https://docs.github.com/en/billing/concepts/product-billing/github-copilot-licenses)).
- Repository access for cloud agent is a **policy** (all / selected / none), not a metered “N agent repos” product limit ([Manage policies](https://docs.github.com/en/copilot/how-tos/manage-your-account/manage-policies)).
- No primary-source **per-repository monthly credit quota** was found; metering is **account/seat AI credits** (and Actions minutes attributed to the repo for infrastructure).

---

## 3. Metering: AI credits + Actions minutes

### AI credits (model usage)

**1 AI credit = $0.01 USD.** Cost of an interaction = model × tokens (input / output / cached), converted to credits ([Usage-based billing for individuals](https://docs.github.com/en/copilot/concepts/billing/usage-based-billing-for-individuals); [Models and pricing](https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing)).

**Billed in AI credits** (among others): Copilot Chat, CLI, **cloud agent**, Spaces, Spark, **third-party coding agents**, and code-review token usage ([Usage-based billing for individuals](https://docs.github.com/en/copilot/concepts/billing/usage-based-billing-for-individuals); [Models and pricing](https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing)).

**Not billed in AI credits:** code completions and next-edit suggestions remain **unlimited** on paid plans (same sources).

**Agentic work burns credits faster:** docs call out that cloud agent / agent mode can involve multiple model calls; a long frontier-model session across many files costs more than a short chat ([Usage-based billing for individuals](https://docs.github.com/en/copilot/concepts/billing/usage-based-billing-for-individuals)). Steering mid-session also consumes credits ([Agent management](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/agent-management)).

**10% discount** on model costs when using **auto model selection** in Chat, CLI, Copilot app, or cloud agent (paid plans) ([Usage-based billing for individuals](https://docs.github.com/en/copilot/concepts/billing/usage-based-billing-for-individuals)).

Per-token list prices (USD per 1M tokens) are published by model in [Models and pricing](https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing) — e.g. Claude Haiku 4.5 input $1 / output $5; Claude Opus 4.x/5 input $5 / output $25; GPT-5 mini input $0.25 / output $2.00 (illustrative of the published table; always re-check that page).

**Code review model is opaque:** for code review, the model is selected automatically and **not disclosed**, so per-review token cost varies ([Models and pricing](https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing)).

### GitHub Actions minutes (agent / review infrastructure)

Cloud agent **uses GitHub Actions minutes and AI credits**; credits depend on model and tokens ([About GitHub Copilot cloud agent — usage costs](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent#copilot-cloud-agent-usage-costs)). Automations bill the same way to the automation creator ([About Copilot automations](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-automations)).

**Copilot code review** also consumes **Actions minutes + AI credits** ([Models and pricing](https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing); [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions#copilot-code-review-and-github-actions-minutes)). Default runner: standard GitHub-hosted Ubuntu Linux. Minutes attribute to the **repository** (then org/enterprise); AI credits charge the **requester** (or PR author for policy-triggered review) (Models and pricing page).

### Included vs overage (AI credits)

When included credits are exhausted ([Usage-based billing for individuals](https://docs.github.com/en/copilot/concepts/billing/usage-based-billing-for-individuals)):

1. **Upgrade** to a higher plan (charged the **price difference**, not a second full price; prior usage counts against the larger allowance), or  
2. Stay and set a **budget for additional usage** (USD budget; still 1 credit = $0.01; e.g. $10 → 1,000 credits). Additional usage **may be capped**; unpaid additional usage can block further work, or  
3. Wait for the next calendar-month reset.

Budgets: [Set up budgets](https://docs.github.com/en/billing/how-tos/set-up-budgets#managing-budgets-for-your-personal-account). Session soft-caps (CLI/SDK) can limit credits **per session** but do not replace monthly budgets ([Optimizing your AI usage](https://docs.github.com/en/copilot/tutorials/optimize-ai-usage)).

### Legacy premium-request model (do not use for new planning)

For remaining **annual** Pro/Pro+ on request-based billing, cloud agent sessions were counted as **premium requests** (plus Actions minutes) with a dedicated SKU ([Legacy premium requests](https://docs.github.com/en/copilot/reference/copilot-billing/request-based-billing-legacy/github-copilot-premium-requests)). That model **does not apply** to current usage-based Pro / Pro+ / Max monthly plans after the June 1, 2026 change ([What changed](https://docs.github.com/en/copilot/reference/copilot-billing/request-based-billing-legacy/what-changed-with-billing)).

---

## 4. Public vs private differences (relevant to Issuebridge)

| Concern | Public repository | Private repository | Source |
|---------|-------------------|--------------------|--------|
| Standard GitHub-hosted Actions minutes | **Free** | Count against plan quota; overage billed | [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions) |
| Cloud agent Actions minutes | Covered by public free Actions use for standard runners | Consume private-repo minute quota / overage | Cloud agent uses Actions ([About cloud agent](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent)); Actions free-for-public rule above |
| Code review Actions minutes | **Remain free** | Consume entitlement / overage | [Actions billing — Copilot code review](https://docs.github.com/en/billing/concepts/product-billing/github-actions#copilot-code-review-and-github-actions-minutes) |
| AI credits for agent + review | **Still charged** to the Copilot user/plan | Same | [Usage-based billing for individuals](https://docs.github.com/en/copilot/concepts/billing/usage-based-billing-for-individuals) |
| Manual cloud agent (assign issue / Agents UI / `@copilot`) | Available (if enabled; not opted out) | Available | [Manage policies](https://docs.github.com/en/copilot/how-tos/manage-your-account/manage-policies) |
| **Automations** (schedule / events) | **Not available** | Available (private or internal) | [About automations](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-automations) |
| Larger runners | Always billed (even on public) | Always billed | [Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions) |

**Implication for a public learning repo:** infrastructure minutes for standard cloud-agent and code-review runners are **not** the budget bottleneck; **AI credits (and the Copilot subscription)** are.

Private-repo minute quotas for context (if the repo were private): Free 2,000 / Pro 3,000 / Team 3,000 / Enterprise Cloud 50,000 included minutes/month; Linux 2-core overage **$0.006**/min ([Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)).

---

## 5. Rough cost for ~one serial pipeline under ~$20–50/mo

### Subscription fit

| Option | Monthly license | Included AI credits | Fits $20–50 alone? | Notes |
|--------|-----------------|---------------------|--------------------|-------|
| Pro | $10 | 1,500 ($15 face) | Yes; leaves $10–40 for overage or buffer | Full cloud agent + code review; fewer premium models than Pro+ |
| Pro+ | $39 | 7,000 ($70 face) | Yes (upper band) | Premium models; better headroom for agent loops |
| Max | $100 | 20,000 ($200 face) | **No** — license alone exceeds budget | Same agent features as Pro+; more credits / priority |

Sources: credit tables and prices cited in §2; Max marketed for high-volume agents on [Plans & pricing](https://github.com/features/copilot/plans).

**Open-source maintainer path:** Copilot Pro can be **free** for verified teachers and maintainers of popular open source projects ([Individual plans](https://docs.github.com/en/copilot/concepts/billing/individual-plans); [Copilot licenses](https://docs.github.com/en/billing/concepts/product-billing/github-copilot-licenses)) — eligibility is separate from this cost model; if eligible, the $10 line becomes $0 and the whole $20–50 can be additional-credit budget.

### What one “pipeline” costs (honest bound)

GitHub **does not publish** a fixed “credits per cloud-agent session” or “credits per code review” under usage-based billing. Cost is **token × model**, and agent sessions can span many calls for up to **59 minutes** of Actions execution ([About cloud agent](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent); [Models and pricing](https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing)).

Therefore any “N pipelines per month” figure must be **measured** on the [AI usage](https://docs.github.com/en/copilot/how-tos/manage-and-track-spending/monitor-ai-usage) dashboard after a few representative runs — not extrapolated from a published average.

**Budget arithmetic that *is* primary-source grounded:**

- On a **public** repo, expect **~$0 Actions overage** for standard runners for agent + review ([Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)).
- All meaningful spend is **subscription + AI credits** (included first, then optional additional at $0.01/credit).
- Example envelopes within ~$20–50:
  - **Pro $10 + $10 additional budget** → $20 total; **2,500** credits usable that month if the $10 overage is fully spent (1,500 included + 1,000 bought).
  - **Pro $10 + $40 additional** → $50 total; up to **5,500** credits.
  - **Pro+ $39** alone → $39; **7,000** included credits, **no** Max required for the agent loop itself.
  - **Pro+ $39 + ~$11 additional** → ~$50; up to **8,100** credits.

**How to stretch serial pipelines** (official guidance, not invented tips): prefer Auto (10% discount) or lighter models for implementation; use stronger models for planning; split research/plan/implement; keep prompts scoped; use custom instructions so the agent explores less; set session limits in CLI ([Optimizing your AI usage](https://docs.github.com/en/copilot/tutorials/optimize-ai-usage); [Changing the AI model](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/changing-the-ai-model)).

### Practical recommendation for the ticket’s learning budget

1. **Do not need Max** to run plan → PR → review on a public repo — **Pro or Pro+** already include the agents.  
2. Prefer **Pro+ ($39)** if you will use premium/frontier models for planning and expect multi-step agent sessions; prefer **Pro ($10)** if you stay on Auto/lighter models and accept smaller included credit pool.  
3. Cap downside with a personal **additional-usage budget** and (where available) **session limits**.  
4. Measure 3–5 serial pipelines, then decide whether Pro headroom is enough or Pro+ is required — Max is a volume upgrade, not a capability unlock for this loop.

---

## 6. End-to-end loop checklist (public repo)

1. Paid Copilot plan with cloud agent allowed on the repo ([Access management](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/access-management)).  
2. **Plan:** Agents UI research + plan (or a well-specified issue) ([Research, plan, and iterate](https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/research-plan-iterate)).  
3. **Implement / PR:** assign Copilot to the issue *or* implement on a branch and create the PR ([Kick off a task](https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/kick-off-a-task)).  
4. **Review:** Request Copilot as reviewer ([Code review](https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/copilot-code-review)).  
5. **Iterate:** `@copilot` / Fix with Copilot; human approve/merge ([Agents overview](https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/overview)).  
6. **Do not rely on Automations** while the repo is public ([About automations](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-automations)).

---

## Sources index

| Topic | URL |
|-------|-----|
| Usage-based billing (individuals) | https://docs.github.com/en/copilot/concepts/billing/usage-based-billing-for-individuals |
| Individual plan benefits | https://docs.github.com/en/copilot/concepts/billing/individual-plans |
| Plans comparison | https://docs.github.com/en/copilot/get-started/plans |
| Product plans & pricing | https://github.com/features/copilot/plans |
| Models & token pricing | https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing |
| Copilot licenses | https://docs.github.com/en/billing/concepts/product-billing/github-copilot-licenses |
| About cloud agent | https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-cloud-agent |
| Access management | https://docs.github.com/en/copilot/concepts/agents/cloud-agent/access-management |
| Manage personal policies | https://docs.github.com/en/copilot/how-tos/manage-your-account/manage-policies |
| Agents overview (plan→PR→review) | https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/overview |
| Research / plan / iterate | https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/research-plan-iterate |
| Kick off a task | https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/kick-off-a-task |
| Code review how-to | https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/copilot-code-review |
| About automations | https://docs.github.com/en/copilot/concepts/agents/cloud-agent/about-automations |
| Agent management / concurrency | https://docs.github.com/en/copilot/concepts/agents/cloud-agent/agent-management |
| Optimize AI usage | https://docs.github.com/en/copilot/tutorials/optimize-ai-usage |
| Cloud agent models | https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/changing-the-ai-model |
| Actions billing | https://docs.github.com/en/billing/concepts/product-billing/github-actions |
| Legacy premium requests (annual only) | https://docs.github.com/en/copilot/reference/copilot-billing/request-based-billing-legacy/github-copilot-premium-requests |
| Billing model change (2026-06-01) | https://docs.github.com/en/copilot/reference/copilot-billing/request-based-billing-legacy/what-changed-with-billing |

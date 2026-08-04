# Research: Maintainer-only pipeline invocation on GitHub

**Date:** 2026-08-04  
**Question:** How can a public GitHub repo ensure only maintainers (or a defined trusted set) can start a label-triggered agent pipeline and the plan-gate step — so a random commenter adding a label cannot burn planner/implementer/reviewer spend or open PRs? Cover Actions actor/permission checks, label-change events, GitHub Apps, Copilot agent assignment rules, and known bypasses. Call out what is and is not enforceable on public OSS.  
**Issue context:** [#81](https://github.com/mnaimfaizy/issuebridge/issues/81) (part of [#80](https://github.com/mnaimfaizy/issuebridge/issues/80)). Constraints from the map: public Issuebridge pilot; maintainer-only invocation is a hard requirement; human plan-gate before implementer.

## Scope of this note

Primary sources only:

- GitHub Docs (Actions events/contexts, environments, secrets, security hardening, repository roles, personal-account permissions, webhooks)
- GitHub REST API (collaborator permission endpoint)
- GitHub Apps first-party docs (App tokens in Actions)
- GitHub Copilot cloud agent first-party docs (access, risks/mitigations, assignment)

Secondary blogs, Security Lab write-ups, and Scorecard commentary are **not** used as evidence (GitHub’s own security-hardening page links some of those as further reading; this note sticks to GitHub’s documented product behavior).

---

## Executive answer

On a **public** repository:

1. **A random issue commenter without repo privileges cannot apply labels.** Applying/dismissing labels requires **triage** access (org roles) or collaborator/owner access (personal-account repos). That alone stops the “drive-by commenter adds `agent:plan`” story for people who only have Read / anonymous interaction. ([Managing labels](https://docs.github.com/en/issues/using-labels-and-milestones-to-track-work/managing-labels); [Repository roles for an organization](https://docs.github.com/en/organizations/managing-user-access-to-your-organizations-repositories/managing-repository-roles/repository-roles-for-an-organization); [Permission levels for a personal account repository](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/repository-access-and-collaboration/permission-levels-for-a-personal-account-repository))
2. **A label is not an authorization boundary.** Anyone who *can* apply the trigger label can start a workflow that listens to `issues: [labeled]`. For spend/PRs you must **additionally** authorize the **actor who labeled** (and gate secrets behind an environment / human approval for the plan-gate → implementer step). ([Events that trigger workflows — issues](https://docs.github.com/en/actions/writing-workflows/choosing-when-your-workflow-runs/events-that-trigger-workflows#issues); [Contexts — `github.actor`](https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/accessing-contextual-information-about-workflow-runs); [Managing environments for deployment](https://docs.github.com/en/actions/managing-workflow-runs-and-deployments/managing-deployments/managing-environments-for-deployment))
3. **What public OSS can enforce well:** (a) platform label permission, (b) workflow actor allowlist or REST permission check requiring **write+**, (c) **environment required reviewers** + environment-scoped secrets for plan-gate / implementer / reviewer spend, (d) Copilot’s built-in “write access required to trigger” rule if Copilot is used.  
4. **What public OSS cannot fully enforce:** separating “trusted write collaborator” from “can burn agent secrets / edit workflows” without org-level policy products; preventing a **Write** user from removing workflow checks or reading repository secrets; fine-grained “only these three humans may assign Copilot” beyond **write**; enterprise-only **workflow execution protections** (actor/event allow lists evaluated before run). ([Security hardening for GitHub Actions](https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions); [Repository roles](https://docs.github.com/en/organizations/managing-user-access-to-your-organizations-repositories/managing-repository-roles/repository-roles-for-an-organization); [Workflow execution protections](https://docs.github.com/en/enterprise-cloud@latest/admin/enforcing-policies/enforcing-policies-for-your-enterprise/actions-policies/workflow-execution-protections); [Copilot risks and mitigations](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/risks-and-mitigations))

---

## 1. Who can apply labels (platform gate)

### Organization repositories

GitHub’s org repository-role matrix:

| Action | Read | Triage | Write | Maintain | Admin |
|--------|------|--------|-------|----------|-------|
| Apply/dismiss labels | ✗ | ✓ | ✓ | ✓ | ✓ |
| Create/edit/delete labels | ✗ | ✗ | ✓ | ✓ | ✓ |

Source: [Repository roles for an organization](https://docs.github.com/en/organizations/managing-user-access-to-your-organizations-repositories/managing-repository-roles/repository-roles-for-an-organization).

Label management docs repeat the same rule: **Anyone with triage access can apply and dismiss labels**; creating labels needs write. ([Managing labels](https://docs.github.com/en/issues/using-labels-and-milestones-to-track-work/managing-labels))

**Implication:** On an org-owned public OSS repo, **Triage** collaborators (or anyone granted a custom role that includes apply-label) can add a pipeline label even though they **cannot** create/edit/run Actions workflows (Create/edit/run/re-run/cancel workflows is Write+ in the same matrix). ([Repository roles for an organization](https://docs.github.com/en/organizations/managing-user-access-to-your-organizations-repositories/managing-repository-roles/repository-roles-for-an-organization))

### Personal-account repositories (Issuebridge today: `mnaimfaizy/issuebridge`)

Personal repos have **owner** and **collaborators** only. Collaborators have pull + push (write) and can **manage labels**. There is no Triage role on personal-account repos; GitHub points owners who need finer roles to transfer to an organization. ([Permission levels for a personal account repository](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/repository-access-and-collaboration/permission-levels-for-a-personal-account-repository); [Access permissions on GitHub](https://docs.github.com/en/get-started/learning-about-github/access-permissions-on-github))

**Implication for the pilot:** Non-collaborators who open issues or comment **cannot** apply labels. Collaborators (write) **can**. The “random commenter” threat is largely handled by the platform for personal public repos; the remaining threat is **any collaborator** (or App) that can label.

### What this does *not* do

Platform label permission does **not** distinguish “maintainer intended to start the agent” from “trusted triage helper who should not burn planner spend.” If Triage (org) or Write (personal collaborator) can label, a label-only workflow will run for them.

---

## 2. Label-change events in Actions

### Correct event

To run when a label is **added to an issue**, use the `issues` event with activity type `labeled` (not the `label` event — that fires when a repository label definition is created/edited/deleted). ([Events that trigger workflows — issues](https://docs.github.com/en/actions/writing-workflows/choosing-when-your-workflow-runs/events-that-trigger-workflows#issues); [Events that trigger workflows — label](https://docs.github.com/en/actions/writing-workflows/choosing-when-your-workflow-runs/events-that-trigger-workflows#label); webhook note in [Webhook events and payloads](https://docs.github.com/en/webhooks/webhook-events-and-payloads#issues))

Example shape:

```yaml
on:
  issues:
    types: [labeled]
```

Filter the specific label in a job `if:` (e.g. `github.event.label.name == 'agent:plan'`) using expressions / `contains` on label collections as documented. ([Evaluate expressions in workflows and actions](https://docs.github.com/en/actions/reference/workflows-and-actions/expressions))

### Run context

`issues` workflows use the **last commit on the default branch** / default-branch ref — the workflow file must exist on the default branch. ([Events that trigger workflows — issues](https://docs.github.com/en/actions/writing-workflows/choosing-when-your-workflow-runs/events-that-trigger-workflows#issues))

That is safer than `pull_request_target` + untrusted checkout for *invocation* (no fork PR merge ref), but it still runs with the workflow’s configured `permissions` and any secrets the job can reach. Privileged checkout / `pull_request_target` / `workflow_run` risks remain a separate concern if later stages touch PR code. ([Security hardening for GitHub Actions](https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions))

### Actor identity on the event

Webhook payloads include a `sender` identifying who triggered the event (with documented caveats that some events may surface the `ghost` user). ([Webhook events and payloads — sender](https://docs.github.com/en/webhooks/webhook-events-and-payloads#webhook-payload-object-common-properties))

In Actions, the workflow contexts expose:

- `github.actor` — user that triggered the **initial** workflow run  
- `github.triggering_actor` — user that initiated this run (differs on re-runs)  
- Re-runs **use the privileges of `github.actor`**, not `github.triggering_actor`

([Contexts reference](https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/accessing-contextual-information-about-workflow-runs); [Re-running workflows and jobs](https://docs.github.com/en/actions/managing-workflow-runs-and-deployments/managing-workflow-runs/re-running-workflows-and-jobs))

For a label-triggered pipeline, authorize against **`github.actor`** (the labeler), and treat re-run privilege inheritance as intentional GitHub behavior.

---

## 3. Actions actor / permission checks (enforceable patterns)

There is **no** first-party workflow syntax key that says “only Maintainers may run this job.” Authorization is composed from platform roles + expressions + API checks + environments.

### Pattern A — Explicit username / team allowlist

Job-level `if:` comparing `github.actor` to known logins (or membership checks via `gh`/`curl` against org teams). Expressions support `==`, `contains`, `fromJSON`, etc. ([Evaluate expressions](https://docs.github.com/en/actions/reference/workflows-and-actions/expressions); [Contexts — `github.actor`](https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/accessing-contextual-information-about-workflow-runs))

**Pros:** Precise “defined trusted set.”  
**Cons:** Allowlist lives in a workflow file editable by **Write+** (org) / collaborators (personal). Not a cryptographic control against write-trusted actors.

### Pattern B — REST permission check for the actor

Official endpoint:

```http
GET /repos/{owner}/{repo}/collaborators/{username}/permission
```

Docs state:

- Returns legacy `permission`: `admin` | `write` | `read` | `none`  
- **`maintain` maps to `write`; `triage` maps to `read`**  
- `role_name` gives the fine role (including custom roles)  
- Permission is the **highest** grant across repo/team/org/enterprise

([REST API — Get repository permissions for a user](https://docs.github.com/en/rest/collaborators/collaborators#get-repository-permissions-for-a-user))

**Practical gate for “maintainer-class” invocation:** require `permission` in `{write, admin}` (and/or `role_name` in `{maintain, admin, write}`). That **rejects Triage labelers** (mapped to `read`) even though they can apply labels — important for org repos.

Call the API with `GITHUB_TOKEN` (or an App installation token) from a first “authorize” job; fail closed before any paid agent step.

### Pattern C — Do not rely on label presence alone

`contains(github.event.issue.labels.*.name, '…')` only answers “is the label present,” not “who may spend.” Use it as a **routing** filter after Pattern A/B. ([Evaluate expressions — contains](https://docs.github.com/en/actions/reference/workflows-and-actions/expressions#contains))

### Pattern D — `workflow_dispatch` as an alternate start

Manual runs require **write** access to the repository. ([Manually running a workflow](https://docs.github.com/en/actions/managing-workflow-runs-and-deployments/managing-workflow-runs/manually-running-a-workflow))

Org role matrix: Create/edit/run/re-run/cancel workflows = Write+. ([Repository roles](https://docs.github.com/en/organizations/managing-user-access-to-your-organizations-repositories/managing-repository-roles/repository-roles-for-an-organization))

Useful as a maintainer escape hatch; still not finer than Write unless combined with environments.

### Pattern E — Environment required reviewers (plan-gate)

For public repositories on current GitHub plans, **environments**, **environment secrets**, and **deployment protection rules** (including **required reviewers** and wait timers) are available. ([Managing environments for deployment](https://docs.github.com/en/actions/managing-workflow-runs-and-deployments/managing-deployments/managing-environments-for-deployment))

Documented behavior relevant to a human plan-gate:

- A job that references an environment must satisfy protection rules **before running or accessing environment secrets**.  
- Required reviewers: up to **6** people or teams; **one** approval proceeds.  
- **Prevent self-review** can block the triggerer from approving their own run.  
- Admins can bypass unless “Allow administrators to bypass…” is disabled.  
- Environment secrets are only available after rules pass.  
- Anyone who can edit workflows can **create** an environment name by referencing it, but **only admins/owners configure** protection rules/secrets.

([Managing environments for deployment](https://docs.github.com/en/actions/managing-workflow-runs-and-deployments/managing-deployments/managing-environments-for-deployment); related hardening note that required reviewers protect environment secrets: [Security hardening](https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions))

**Fit for #80/#81:** Planner may run after actor auth (cheap or allowlisted). **Implementer/reviewer jobs** (and API keys that burn spend) should live on an environment such as `agent-plan-gate` / `agent-implement` with required reviewers + prevent self-review + secrets only on that environment. That maps the map’s “human plan-gate before implementer” onto a first-party Actions control.

### Secrets trust boundary (critical for spend)

GitHub’s security hardening guide states that **any user with write access to the repository has read access to all secrets configured in the repository**. ([Security hardening for GitHub Actions](https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions))

Org matrix: create/update/delete Actions secrets = Write+. ([Repository roles](https://docs.github.com/en/organizations/managing-user-access-to-your-organizations-repositories/managing-repository-roles/repository-roles-for-an-organization))

**Implication:** Repository-level agent API secrets are reachable by every Write collaborator (via crafting a workflow). **Environment secrets + required reviewers** are the documented way to require an extra human before a job can use those credentials. Put spend credentials in the gated environment, not (only) in repository secrets.

---

## 4. GitHub Apps

### Using an App inside Actions

GitHub documents generating an **installation access token** in a workflow (e.g. via `actions/create-github-app-token`) when `GITHUB_TOKEN` is insufficient (cross-repo, org resources, or a dedicated bot identity). Credentials: App client ID as a variable; private key as a secret; App installed on the account/repo with least privilege. ([Making authenticated API requests with a GitHub App in a GitHub Actions workflow](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/making-authenticated-api-requests-with-a-github-app-in-a-github-actions-workflow))

### What an App does and does not solve for invocation

| Concern | App helps? | Notes |
|---------|------------|--------|
| Open PRs / comment as a bot | Yes | Dedicated installation permissions, separate from human `GITHUB_TOKEN` |
| Restrict *who starts* the pipeline | No by itself | Trigger is still the Actions event + whoever caused it |
| Hide spend secrets from Write users | Partially | Prefer environment secrets + reviewers; App private key as a **repository** secret is still in the write-user secret-read trust set per hardening docs |
| Label events from the App | Possible bypass vector | If an App installation can add labels, it becomes a `sender`/`actor` — authorize Apps explicitly or deny non-User actors |

Webhook `sender` may be an App/bot; authorization logic should decide whether App actors are allowed. ([Webhook events — sender](https://docs.github.com/en/webhooks/webhook-events-and-payloads#webhook-payload-object-common-properties))

---

## 5. Copilot cloud agent assignment rules

First-party mitigations (GitHub):

- **Only users with write access** can trigger Copilot cloud agent; **comments from users without write access are never presented to the agent**. ([Risks and mitigations for GitHub Copilot cloud agent](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/risks-and-mitigations))
- Org enablement docs: once enabled for a repository, **any user with access to Copilot cloud agent and write permission** can delegate work to Copilot. ([Adding GitHub Copilot cloud agent to your organization](https://docs.github.com/en/enterprise-cloud@latest/copilot/how-tos/administer-copilot/manage-for-organization/add-copilot-cloud-agent))
- Issue assignment UI: repository dropdown only allows selecting a repo where you have **write** and Copilot is enabled. ([Using Copilot cloud agent on GitHub](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/use-cloud-agent-on-github))
- `@copilot` on PRs: **Copilot only responds to comments from people who have write access**. (same page)
- Default: Actions workflows on Copilot PRs **do not run** until a write user clicks **Approve and run workflows**. ([Risks and mitigations](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/risks-and-mitigations); [Using Copilot cloud agent on GitHub](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/use-cloud-agent-on-github))
- **Automations** (schedule/event auto-runs): **not available in public repositories**; private/internal only. Default ignore events from users without write. ([Managing access to GitHub Copilot cloud agent](https://docs.github.com/en/copilot/concepts/agents/coding-agent/access-management); [Risks and mitigations](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/risks-and-mitigations))

**Implication for Issuebridge:** Copilot’s own trigger bar is **Write**, not Triage — stronger than bare label application on org repos. It is **not** “named maintainer list only.” Any write collaborator with a Copilot seat (and policy enabling the agent) can assign issues / `@copilot`. Finer restriction requires not granting Write, or org/enterprise policy / repository opt-out — not a per-label ACL in Actions.

---

## 6. Known bypasses and gaps (public OSS)

| Bypass / gap | Why it matters | Primary source |
|--------------|----------------|----------------|
| Triage can label (org) | Label-only workflows run for triage users who cannot edit workflows but can still start jobs and (if secrets are repo-scoped and the job runs) consume minutes/API | [Repository roles](https://docs.github.com/en/organizations/managing-user-access-to-your-organizations-repositories/managing-repository-roles/repository-roles-for-an-organization); [Managing labels](https://docs.github.com/en/issues/using-labels-and-milestones-to-track-work/managing-labels) |
| Permission API maps triage → `read` | Good: write-check blocks triage. Bad if you mistakenly treat “can label” as “authorized” | [Get repository permissions for a user](https://docs.github.com/en/rest/collaborators/collaborators#get-repository-permissions-for-a-user) |
| Write users own the secret + workflow surface | They can edit workflows to remove actor checks, add exfil steps, or use repository secrets | [Security hardening](https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions); [Repository roles](https://docs.github.com/en/organizations/managing-user-access-to-your-organizations-repositories/managing-repository-roles/repository-roles-for-an-organization) |
| Implicit environment creation | Referencing a new `environment:` name creates an unprotected environment; only admin/owner configuration adds reviewers/secrets | [Managing environments for deployment](https://docs.github.com/en/actions/managing-workflow-runs-and-deployments/managing-deployments/managing-environments-for-deployment) |
| Admin bypass of environment rules | Unless disabled, admins can bypass required reviewers | [Managing environments for deployment](https://docs.github.com/en/actions/managing-workflow-runs-and-deployments/managing-deployments/managing-environments-for-deployment) |
| Re-run privilege inheritance | Re-run uses original `github.actor` privileges even if `triggering_actor` differs | [Contexts](https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/accessing-contextual-information-about-workflow-runs); [Re-running workflows](https://docs.github.com/en/actions/managing-workflow-runs-and-deployments/managing-workflow-runs/re-running-workflows-and-jobs) |
| App / bot labelers | Installations that can label become actors; must be allow/deny listed | [Webhook sender](https://docs.github.com/en/webhooks/webhook-events-and-payloads#webhook-payload-object-common-properties); Apps-in-Actions docs |
| `ghost` sender | Rare non-user senders; do not assume `sender` is always a person | [Webhook sender](https://docs.github.com/en/webhooks/webhook-events-and-payloads#webhook-payload-object-common-properties) |
| Copilot = any Write + seat | Cannot restrict assignment to a subset of writers via Copilot product docs alone | [Risks and mitigations](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/risks-and-mitigations); [Add Copilot cloud agent](https://docs.github.com/en/enterprise-cloud@latest/copilot/how-tos/administer-copilot/manage-for-organization/add-copilot-cloud-agent) |
| Workflow execution protections | Enterprise docs describe pre-run actor/event allow lists; not a substitute control for a free personal public repo without that product surface | [Workflow execution protections (Enterprise Cloud)](https://docs.github.com/en/enterprise-cloud@latest/admin/enforcing-policies/enforcing-policies-for-your-enterprise/actions-policies/workflow-execution-protections) |
| Self-hosted runners on public repos | GitHub warns self-hosted runners should almost never be used for public repos (PR abuse) | [Security hardening](https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions) |
| Personal-account role coarseness | No Triage/Maintain; collaborators are write; finer ACLs need an org | [Personal account permission levels](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/repository-access-and-collaboration/permission-levels-for-a-personal-account-repository) |

---

## 7. What is / is not enforceable on public OSS (Issuebridge-shaped)

### Enforceable with first-party features (recommended stack)

1. **Rely on platform labeling rights** so anonymous/Read users cannot start label workflows.  
2. **Authorize the labeler** in the workflow: allowlist **and/or** `GET …/collaborators/{actor}/permission` requiring **write/admin** (blocks org Triage).  
3. **Split jobs:** cheap auth + optional planner vs **implementer/reviewer** behind an **environment** with **required reviewers**, **prevent self-review**, and **environment secrets** holding agent spend credentials.  
4. **Disable admin bypass** on that environment if the threat model includes admin mistakes.  
5. If using **Copilot**, treat Write as the product’s trigger floor; keep default **Approve and run workflows**; note Automations unavailable on public repos.  
6. Use a **GitHub App** for bot PR/comment identity and least-privilege API calls *after* human gate — not as the sole invocation ACL.  
7. Keep trigger workflows on the **default branch**; avoid privileged untrusted checkout patterns for agent stages.  

### Not fully enforceable on public OSS without trust or product upgrades

- Preventing a **Write** collaborator from burning spend if they can edit workflows **and** secrets are repository-scoped.  
- “Only these maintainers” as a **platform** ACL finer than Write (personal account) or without org teams + careful grants.  
- Stopping Copilot assignment for a subset of Write users while leaving Write intact.  
- Enterprise **workflow execution protections** unless that enterprise feature applies to the account.  
- Guaranteeing `sender` is always a human (`ghost` / Apps).  

### Mapping to map constraints (#80)

| Constraint | Primary-source fit |
|------------|-------------------|
| Public pilot | Label platform gate works; environments + required reviewers available on public repos for current plans |
| Maintainer-only invocation | Combine label rights + actor write/allowlist check; do not trust label alone; minimize Write collaborators |
| Human plan-gate before implementer | Environment required reviewers (+ prevent self-review) on implementer job; store spend secrets as environment secrets |

---

## 8. Suggested decision for Issuebridge (research conclusion, not an implementation)

For a **public personal-account** pilot:

- Treat **collaborators** as the only humans who can label; keep that set = maintainers.  
- Still implement **actor authorization** (write/admin check or allowlist) so a future org migration / Triage grant / App labeler does not silently widen spend.  
- Implement **plan-gate** as an Actions **environment** with required reviewers and environment-scoped agent secrets; implementer/reviewer jobs `needs` the gated job.  
- Prefer App installation tokens for opening PRs **after** the gate.  
- If Copilot is in the loop, accept Write-as-trigger and keep workflow-approval defaults; do not expect Copilot to enforce a narrower maintainer set than Write.

---

## Sources (primary)

- [Events that trigger workflows](https://docs.github.com/en/actions/writing-workflows/choosing-when-your-workflow-runs/events-that-trigger-workflows)  
- [Contexts reference](https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/accessing-contextual-information-about-workflow-runs)  
- [Evaluate expressions in workflows and actions](https://docs.github.com/en/actions/reference/workflows-and-actions/expressions)  
- [Security hardening for GitHub Actions](https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions)  
- [Using secrets in GitHub Actions](https://docs.github.com/en/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions)  
- [Managing environments for deployment](https://docs.github.com/en/actions/managing-workflow-runs-and-deployments/managing-deployments/managing-environments-for-deployment)  
- [Manually running a workflow](https://docs.github.com/en/actions/managing-workflow-runs-and-deployments/managing-workflow-runs/manually-running-a-workflow)  
- [Re-running workflows and jobs](https://docs.github.com/en/actions/managing-workflow-runs-and-deployments/managing-workflow-runs/re-running-workflows-and-jobs)  
- [Managing labels](https://docs.github.com/en/issues/using-labels-and-milestones-to-track-work/managing-labels)  
- [Repository roles for an organization](https://docs.github.com/en/organizations/managing-user-access-to-your-organizations-repositories/managing-repository-roles/repository-roles-for-an-organization)  
- [Permission levels for a personal account repository](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/repository-access-and-collaboration/permission-levels-for-a-personal-account-repository)  
- [Access permissions on GitHub](https://docs.github.com/en/get-started/learning-about-github/access-permissions-on-github)  
- [REST: Collaborators — get permission](https://docs.github.com/en/rest/collaborators/collaborators#get-repository-permissions-for-a-user)  
- [Webhook events and payloads](https://docs.github.com/en/webhooks/webhook-events-and-payloads)  
- [GitHub App auth in Actions](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/making-authenticated-api-requests-with-a-github-app-in-a-github-actions-workflow)  
- [Copilot cloud agent — risks and mitigations](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/risks-and-mitigations)  
- [Managing access to Copilot cloud agent](https://docs.github.com/en/copilot/concepts/agents/coding-agent/access-management)  
- [Using Copilot cloud agent on GitHub](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/use-cloud-agent-on-github)  
- [Adding Copilot cloud agent to your organization](https://docs.github.com/en/enterprise-cloud@latest/copilot/how-tos/administer-copilot/manage-for-organization/add-copilot-cloud-agent)  
- [Workflow execution protections (Enterprise Cloud)](https://docs.github.com/en/enterprise-cloud@latest/admin/enforcing-policies/enforcing-policies-for-your-enterprise/actions-policies/workflow-execution-protections)  

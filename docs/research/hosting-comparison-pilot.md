# Research: hosting comparison for the Issuebridge pilot

**Date:** 2026-08-04  
**Question:** Compare GitHub-native (Actions / Copilot cloud-agent style) vs an always-on local machine vs a small VPS for running this pilot pipeline under our constraints: maintainer-only gates, serial one-at-a-time, ~$20–50/mo, public OSS, need for real PRs and CI. Cover operational burden, secrets exposure, availability, and where each option fails our constraints.  
**Issue context:** [#84](https://github.com/mnaimfaizy/issuebridge/issues/84) (part of #80). Primary sources only for pricing and platform limits.

## Scope of this note

Primary sources: GitHub Docs (Actions billing, limits, concurrency, environments, self-hosted runners, secure-use / hardening), GitHub Copilot cloud-agent and billing docs, GitHub’s 2026 Actions pricing announcement, and first-party VPS pricing pages (DigitalOcean Droplets; Hetzner Cloud overview for ballpark only). Secondary blogs and aggregators are not used as evidence.

“Pilot pipeline” here means an agentic / automation path that produces **real pull requests** and relies on **real CI**, with **maintainer-only** sensitive steps and **serial** (one-at-a-time) execution, on a **public** repository, within roughly **$20–50/month**.

---

## Constraints mapped to platform facts

| Constraint | What primary sources allow |
|------------|----------------------------|
| Public OSS | Standard GitHub-hosted Actions minutes are **free** in public repositories ([GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions#free-use-of-github-actions)). GitHub states public-repo Actions remain free under the 2026 pricing update ([Pricing changes for GitHub Actions](https://github.com/resources/insights/2026-pricing-changes-for-github-actions)). |
| Real PRs + CI | Native: workflows on `pull_request` / `push`, checks API, branch protection. Copilot cloud agent can research, change code on a branch, and open a PR from an Actions-powered ephemeral environment ([About Copilot cloud agent](https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-coding-agent)). |
| Maintainer-only gates | Environment **required reviewers** (and environment secrets that unlock only after approval). On Free/Pro/Team, required reviewers are available for **public** repositories ([Deployments and environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments#required-reviewers)). |
| Serial one-at-a-time | Workflow/job `concurrency` groups: at most one run in a group at a time; optional `queue: max` (up to 100 pending) vs default single pending ([Control concurrency](https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/control-the-concurrency-of-workflows-and-jobs)). |
| ~$20–50/mo | Public standard Actions: $0 runner minutes. Copilot (if used): paid plan from **$10/mo** (Pro) upward with included AI credits ([Usage-based billing for individuals](https://docs.github.com/en/copilot/concepts/billing/usage-based-billing-for-individuals)). Small VPS ballpark: DigitalOcean Basic Droplets **$4–$48/mo** in the sizes that fit this band ([Droplet pricing](https://www.digitalocean.com/pricing/droplets)). |

---

## Option A — GitHub-native (hosted Actions + optional Copilot cloud agent)

### What it is

1. **CI / gated jobs** on **standard GitHub-hosted runners** in the public repo.  
2. Optionally **Copilot cloud agent** for background implementation: ephemeral env powered by Actions, branch + optional PR, separate **Agents** secrets ([About Copilot cloud agent](https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-coding-agent); [Configure Agents secrets](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/configure-secrets-and-variables)).

### Cost (primary)

| Item | Public OSS pilot implication | Source |
|------|------------------------------|--------|
| Standard hosted runners | Free for public repos | [Actions billing — free use](https://docs.github.com/en/billing/concepts/product-billing/github-actions#free-use-of-github-actions); [2026 pricing changes](https://github.com/resources/insights/2026-pricing-changes-for-github-actions) |
| Larger runners | Always charged, including public repos | [Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions#free-use-of-github-actions) |
| Artifact / cache storage | Included quotas (e.g. Free: 500 MB artifacts, 10 GB cache/repo); overage billed | [Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions) |
| Copilot cloud agent | Consumes **Actions minutes** (free on public) **and AI credits** | [About Copilot cloud agent — usage costs](https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-coding-agent#copilot-cloud-agent-usage-costs) |
| Copilot plan (individual) | Pro **$10/mo** / 1,500 AI credits; Pro+ **$39/mo** / 7,000; Max **$100/mo** / 20,000; extra usage **$0.01 per AI credit** | [Usage-based billing for individuals](https://docs.github.com/en/copilot/concepts/billing/usage-based-billing-for-individuals) |

**Budget fit:** CI-only hosted Actions stays well under $20–50 on a public repo (storage overages are the main Actions-side risk). Adding Copilot for agent work fits the band at Pro ($10) or Pro+ ($39); heavy agent sessions can exhaust credits and require overage budget ([same billing doc](https://docs.github.com/en/copilot/concepts/billing/usage-based-billing-for-individuals)).

### Operational burden

- **Low for CI:** no VM OS patching; GitHub operates runners. Job wall-clock capped at **6 hours** per job on hosted runners ([Actions limits](https://docs.github.com/en/actions/reference/limits)).
- **Moderate for agent customization:** `copilot-setup-steps.yml`, custom instructions, Agents secrets/variables ([About Copilot cloud agent](https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-coding-agent)).
- **Maintainer gates:** environment required reviewers + environment secrets (secrets unavailable until approval) ([Deployments and environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments#environment-secrets)).
- **Serial:** one shared `concurrency` group with `queue: max` if you want FIFO backlog instead of canceling pending runs ([Concurrency docs](https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/control-the-concurrency-of-workflows-and-jobs)).

### Secrets exposure

- Repository/org Actions secrets: anyone with write access can use them in workflows; prefer least privilege and environment-gated secrets ([Secure use reference](https://docs.github.com/en/actions/reference/security/secure-use)).
- Environment secrets stay locked until deployment protection rules pass ([Deployments and environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments#environment-secrets)).
- Copilot cloud agent does **not** receive Actions/Codespaces/Dependabot secrets — only dedicated **Agents** secrets/variables ([Configure Agents secrets](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/configure-secrets-and-variables)). Responsible-use docs also note constrained push scope (e.g. `copilot/` branches, not default branch) and automated scanning during generation ([Responsible use of Copilot agents](https://docs.github.com/en/copilot/responsible-use/agents)).

### Availability

- Hosted runners: GitHub operates capacity; Free plan allows up to **20** concurrent standard jobs account-wide ([Actions limits](https://docs.github.com/en/actions/reference/limits#job-concurrency-limits-for-github-hosted-runners)) — far above “serial one” need.
- Copilot cloud agent session hard limit: **59 minutes** (not extendable) ([About Copilot cloud agent — limitations](https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-coding-agent#limitations-of-copilot-cloud-agent)).
- Ephemeral agent environment: no always-on machine to babysit.

### Where it fails our constraints

| Constraint | Failure mode |
|------------|--------------|
| Serial long-running agent work | Copilot cloud agent **59-minute** hard timeout; must split work ([limitations](https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-coding-agent#limitations-of-copilot-cloud-agent)). |
| ~$20–50 with heavy agents | Included AI credits may be insufficient; overage at $0.01/credit can blow the band ([billing](https://docs.github.com/en/copilot/concepts/billing/usage-based-billing-for-individuals)). Max plan ($100) exceeds the band. |
| Maintainer-only on *all* automation | Public repos still accept forks/PRs; unsafe privileged triggers (`pull_request_target`, careless `workflow_run`) remain a risk if misconfigured ([Secure use](https://docs.github.com/en/actions/reference/security/secure-use)). Gates must be explicit (environments, branch filters, who can dispatch). |
| Always-on background daemon | Hosted Actions is **job-based**, not a persistent process host. |

**Does not fail:** public OSS cost for standard CI; real PRs/CI; maintainer approval gates on public Free/Pro/Team; serial execution via concurrency.

---

## Option B — Always-on local machine (typically as a self-hosted Actions runner)

### What it is

A maintainer PC or mini-PC left on, usually registered as a **self-hosted runner** so workflow jobs (or agent-adjacent jobs) execute locally ([About self-hosted runners](https://docs.github.com/en/actions/concepts/runners/about-self-hosted-runners)).

### Cost (primary + ballpark)

- GitHub’s docs: self-hosted runners are free to *use with Actions*, but you pay to maintain the machine ([About self-hosted runners](https://docs.github.com/en/actions/concepts/runners/about-self-hosted-runners)).
- For **public** repositories, standard self-hosted usage remains free of GitHub Actions minute charges under the stated public-repo policy ([2026 pricing changes](https://github.com/resources/insights/2026-pricing-changes-for-github-actions); [Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)).  
  Note: GitHub announced then **postponed** a private-repo self-hosted cloud-platform charge; public repos were stated to remain free either way ([Pricing changes for GitHub Actions](https://github.com/resources/insights/2026-pricing-changes-for-github-actions)).
- Electricity / hardware amortization is outside GitHub’s published pricing; treat as “sunk hardware + power,” often inside or near $20–50 if the machine already exists, but not first-party documented.

### Operational burden

- **High:** OS updates, runner app updates, disk, sleep/hibernate policy, home ISP, VPN, “is the box awake?” ([About self-hosted runners](https://docs.github.com/en/actions/concepts/runners/about-self-hosted-runners) — you maintain OS and software).
- Job limits on self-hosted: up to **5 days** job execution, **24 hours** queue time ([Actions limits](https://docs.github.com/en/actions/reference/limits)).
- Serial: natural if only one runner; still should use workflow `concurrency` so jobs do not pile conflicting state on a dirty workspace (self-hosted are **not** guaranteed clean VMs per job — [Secure use — self-hosted](https://docs.github.com/en/actions/reference/security/secure-use#hardening-for-self-hosted-runners)).

### Secrets exposure

GitHub’s secure-use guidance is decisive for a **public** OSS pilot:

> Self-hosted runners should almost never be used for public repositories on GitHub, because any user can open pull requests against the repository and compromise the environment.  
> ([Secure use — Hardening for self-hosted runners](https://docs.github.com/en/actions/reference/security/secure-use#hardening-for-self-hosted-runners))

Further: workflows on self-hosted are not isolated containers even with environments; environment secrets must be treated like repo secrets; persistent compromise and secret leakage across jobs are called out ([same section](https://docs.github.com/en/actions/reference/security/secure-use#hardening-for-self-hosted-runners); [Deployments and environments — environment secrets note](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments#environment-secrets)).

A local always-on box also holds whatever SSH keys, tokens, and personal data live on that machine ([Secure use — environment of the machine](https://docs.github.com/en/actions/reference/security/secure-use#hardening-for-self-hosted-runners)).

### Availability

- Tied to power, sleep, OS crashes, and residential network.
- No GitHub SLA for your hardware; Free hosted concurrency is irrelevant if the only runner is offline.
- Poor fit for “pilot must pick up the next serial job overnight” unless the maintainer engineers no-sleep + monitoring.

### Where it fails our constraints

| Constraint | Failure mode |
|------------|--------------|
| Public OSS | **Direct conflict** with GitHub guidance: self-hosted ≈ never for public repos ([Secure use](https://docs.github.com/en/actions/reference/security/secure-use#hardening-for-self-hosted-runners)). |
| Secrets | Persistent machine + non-ephemeral runner ⇒ high blast radius if a PR workflow runs there. |
| Availability | Sleep, travel, ISP outages break the queue. |
| Operational burden | Dominates vs hosted Actions for a solo maintainer. |

**Does not fail budget** if hardware is already owned and GitHub minutes stay free on public — but security/availability dominate.

---

## Option C — Small VPS (always-on cloud VM)

### What it is

A rented Linux VM used either as (1) a **self-hosted Actions runner**, or (2) a private orchestration host (cron / webhook / agent runtime) that only the maintainer triggers, while **CI and PRs stay on GitHub-hosted Actions**.

### Cost (primary ballpark)

DigitalOcean **Basic Droplets** (official list prices, monthly caps):

| Memory | vCPU | $/mo |
|--------|------|------|
| 2 GiB | 1 | $12 |
| 2 GiB | 2 | $18 |
| 4 GiB | 2 | $24 |
| 8 GiB | 4 | $48 |

Source: [DigitalOcean Droplet pricing](https://www.digitalocean.com/pricing/droplets). Billing is per-second with a monthly cap (never more than the listed monthly price) ([same page](https://www.digitalocean.com/pricing/droplets)).

Hetzner Cloud markets cost-optimized / shared instances for test and small workloads with hourly billing and a monthly price cap ([Hetzner Cloud](https://www.hetzner.com/cloud)); exact SKU dollars change by region and date — use their console/calculator at purchase time. Ballpark: small shared instances are commonly **well under** $20–50/mo relative to DigitalOcean’s table above.

**Budget fit:** Easy for a small always-on VM ($12–$24 mid-band; $48 at the top of band for 8 GiB / 4 vCPU on DO).

### Operational burden

- **Medium–high:** You own OS hardening, SSH, firewall, unattended upgrades, disk, backups (DO backups are extra — e.g. percentage of Droplet cost or usage-based — [Droplet pricing](https://www.digitalocean.com/pricing/droplets)), and runner/agent process supervision.
- DigitalOcean documents Droplets as **IaaS / unmanaged** — you manage the OS and apps ([Droplet pricing FAQ](https://www.digitalocean.com/pricing/droplets)).
- Still must integrate with GitHub for **real PRs and CI** (clone, `gh`, or self-hosted runner registration).

### Secrets exposure

- **If registered as a public-repo self-hosted runner:** same critical warning as Option B ([Secure use](https://docs.github.com/en/actions/reference/security/secure-use#hardening-for-self-hosted-runners)).
- **If used only for maintainer-triggered automation** (no public `pull_request` jobs on that runner): threat model shrinks to VPS compromise, stolen SSH keys, and whatever tokens you place on the VM — still your responsibility, but not “any fork PR owns the runner.”
- Environment secrets on self-hosted still lack VM isolation ([Deployments and environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments#environment-secrets)).

### Availability

- Better than a laptop: datacenter power/network; providers advertise uptime targets (e.g. Hetzner states a **99.9%** uptime SLA for their cloud offering on their cloud marketing page ([Hetzner Cloud](https://www.hetzner.com/cloud))). Still a single VM = single point of failure unless you add monitoring and rebuild automation.
- Always-on cost is continuous even when idle (DO: billed until destroyed; monthly cap ([Droplet pricing](https://www.digitalocean.com/pricing/droplets))).

### Where it fails our constraints

| Constraint | Failure mode |
|------------|--------------|
| Public OSS + self-hosted runner | Same **almost never** guidance as local ([Secure use](https://docs.github.com/en/actions/reference/security/secure-use#hardening-for-self-hosted-runners)). |
| Operational burden | Ongoing sysadmin for little gain vs free public hosted Actions for CI. |
| ~$20–50 | Fits compute; **fails** if you also buy a high Copilot tier *and* a large Droplet *and* paid larger runners. |
| Real PRs/CI | VPS alone does not replace GitHub PR/CI; you still need hosted Actions (or accept self-hosted risk). |

**Partial fit:** VPS as a **private** serial worker (maintainer-only dispatch), with public CI on hosted runners — budget OK, ops higher, secrets still concentrated on one box.

---

## Side-by-side summary

| Dimension | GitHub-native (hosted + optional Copilot) | Always-on local | Small VPS |
|-----------|-------------------------------------------|-----------------|-----------|
| Public OSS cost (CI) | Free standard minutes | Free Actions control plane; pay power/hardware | ~$12–$48/mo VM (+ same Actions note) |
| Real PRs + CI | Native | Via runner or manual push | Via runner or API from VM |
| Maintainer-only gates | Environments + required reviewers (public OK) | Process discipline only; weak if public workflows hit the machine | Same as local if self-hosted; better if private dispatch only |
| Serial one-at-a-time | `concurrency` (+ queue) | One machine ≈ serial | One VM ≈ serial |
| Secrets | Ephemeral hosted VMs; Agents secrets isolated from Actions; env gates | Persistent disk; **high risk on public** | Persistent disk; **high risk if public self-hosted** |
| Availability | GitHub-operated; agent 59‑min cap | Poor (sleep/home net) | Good (datacenter), single VM |
| Ops burden | Low–moderate | High | Medium–high |
| Hard constraint breaks | Heavy Copilot spend; long agent tasks; not a daemon | **Public self-hosted security** | **Public self-hosted security** (if used that way) |

---

## Recommendation for this pilot

1. **Default to GitHub-native hosted Actions** for CI and for any gated “pilot” jobs that must produce checks on real PRs. Public standard runners are free; use **environment required reviewers** + environment secrets for maintainer-only steps; use a single **concurrency** group with `queue: max` for serial FIFO ([sources above](https://docs.github.com/en/billing/concepts/product-billing/github-actions#free-use-of-github-actions)).

2. **Treat Copilot cloud agent as an optional accelerator**, not the hosting plane: it already opens real branches/PRs in an ephemeral Actions environment, keeps Agents secrets separate from Actions secrets, and stays inside ~$20–50 at Pro/Pro+ **if** AI-credit use is budgeted. Split work to respect the **59-minute** session limit ([About Copilot cloud agent](https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-coding-agent)).

3. **Do not** put a self-hosted runner (local or VPS) on this **public** repository for untrusted PR jobs — GitHub’s own hardening doc says self-hosted should almost never be used for public repos ([Secure use](https://docs.github.com/en/actions/reference/security/secure-use#hardening-for-self-hosted-runners)). That alone fails Option B and the common “cheap VPS runner” pattern against our public-OSS constraint.

4. **Consider a small VPS only** if the pilot needs a **persistent, maintainer-triggered** worker that hosted Actions cannot express (long-lived process, special hardware, or >6h hosted job — hosted job cap is 6 hours ([Actions limits](https://docs.github.com/en/actions/reference/limits))). Keep public CI on hosted runners; keep privileged tokens off any path fork PRs can invoke. A $18–$24 Droplet fits the budget band ([Droplet pricing](https://www.digitalocean.com/pricing/droplets)).

**Bottom line:** Under maintainer-only + serial + ~$20–50 + public OSS + real PRs/CI, **GitHub-hosted Actions (with environment gates and concurrency) wins**; add **Copilot cloud agent** only with an explicit AI-credit budget; reserve **VPS** for private orchestration exceptions; **reject always-on local/VPS self-hosted runners for public PR execution**.

---

## Sources (index)

- [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
- [Actions runner pricing](https://docs.github.com/en/billing/reference/actions-runner-pricing)
- [Actions limits](https://docs.github.com/en/actions/reference/limits)
- [Control concurrency of workflows and jobs](https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/control-the-concurrency-of-workflows-and-jobs)
- [Deployments and environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)
- [About self-hosted runners](https://docs.github.com/en/actions/concepts/runners/about-self-hosted-runners)
- [Secure use reference — self-hosted hardening](https://docs.github.com/en/actions/reference/security/secure-use#hardening-for-self-hosted-runners)
- [Pricing changes for GitHub Actions (2026)](https://github.com/resources/insights/2026-pricing-changes-for-github-actions)
- [About GitHub Copilot cloud agent](https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-coding-agent)
- [Configure secrets and variables for Copilot cloud agent](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/configure-secrets-and-variables)
- [Usage-based billing for individuals (Copilot)](https://docs.github.com/en/copilot/concepts/billing/usage-based-billing-for-individuals)
- [Responsible use of Copilot agents](https://docs.github.com/en/copilot/responsible-use/agents)
- [DigitalOcean Droplet pricing](https://www.digitalocean.com/pricing/droplets)
- [Hetzner Cloud](https://www.hetzner.com/cloud)

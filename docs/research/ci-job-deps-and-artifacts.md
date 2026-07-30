# Research: CI job deps — prepare once, fan-out, then build

**Date:** 2026-07-30  
**Question:** For a multi-job GitHub Actions PR pipeline that wants one “prepare” job to install dependencies once, parallel lint/format/test jobs that reuse those installs without reinstalling, and a final build job that `needs` the earlier stages — what do primary docs actually support, and what topology should Issuebridge #24 use?  
**Issue context:** [#24](https://github.com/mnaimfaizy/issuebridge/issues/24). Companion note: [CI runner OS for PR checks](./ci-runner-os-for-pr-checks.md) (ubuntu-latest only; no full Tauri/NSIS in this workflow).

## Scope of this note

Primary sources only:

- GitHub Docs (jobs/`needs`, hosted runners, dependency caching vs artifacts, Node CI, Actions limits, workflow syntax including parallel steps)
- First-party actions docs (`actions/cache`, `actions/setup-node`, `actions/upload-artifact`)
- Cargo Book (Cargo home CI caching, CI examples)
- Tauri v2 first-party GitHub pipeline guide (as an example of what Tauri documents — not as a substitute for Actions semantics)

Secondary blogs are not used as evidence.

---

## 1. Can job B literally reuse job A’s `node_modules` / Cargo registry+`target` without reinstall?

### Fresh VM per job

On GitHub-hosted runners, **each job runs on its own runner**. GitHub’s conceptual model is explicit:

- A **job** is a set of steps executed on the **same** runner; steps share that workspace/filesystem. ([Understanding GitHub Actions](https://docs.github.com/en/actions/learn-github-actions/understanding-github-actions))
- Each workflow run executes in a **fresh, newly-provisioned virtual machine**; each runner runs a **single job** at a time. (same page; also [About GitHub-hosted runners](https://docs.github.com/en/actions/using-github-hosted-runners/using-github-hosted-runners/about-github-hosted-runners))
- Jobs on hosted runners **start in a clean runner image and must download dependencies each time** unless you use caching. ([Dependency caching](https://docs.github.com/en/actions/concepts/workflows-and-actions/dependency-caching))

So job B **cannot** see job A’s local disk. There is no shared install directory across jobs on separate hosted VMs.

### Three mechanisms (only)

| Mechanism | Same job (steps) | Across jobs (same run) | Across runs |
|-----------|------------------|------------------------|-------------|
| Shared workspace | Yes — install once, later steps reuse | No | No |
| `actions/upload-artifact` + `download-artifact` | N/A (same disk) | Yes — copy files to next job | Artifacts persist for retention; not the intended “deps” tool |
| `actions/cache` (or setup-\* cache) | Restore then use | Restore after a prior job/run saved the cache | Primary intent |

**Artifacts between jobs:** GitHub documents uploading/downloading artifacts to **pass data between jobs** in a workflow, with `needs` so dependents wait for producers. Example uses small computed files, not dependency trees. ([Store and share data with workflow artifacts](https://docs.github.com/en/actions/tutorials/store-and-share-data); concepts: [Workflow artifacts](https://docs.github.com/en/actions/concepts/workflows-and-actions/workflow-artifacts))

**Cache between jobs/runs:** Cache is for files that **don’t change often** (package-manager downloads, expensive intermediates). A job must still be able to **re-download or regenerate** if the cache is missing. ([Dependency caching](https://docs.github.com/en/actions/concepts/workflows-and-actions/dependency-caching); [Dependency caching reference](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching))

### Verdict on “without reinstalling”

- **Same job:** Yes — one `npm ci` / Cargo build, then sequential (or `parallel`) steps share the tree.
- **Different jobs:** No literal reuse. You either **reinstall** (ideally accelerated by a **package-manager cache**) or **restore a blob** (cache or artifact) onto a new VM. Restoring `node_modules` or `target/` is still a full download/extract cycle — it is not free, and it is not the same as sharing a live install.

---

## 2. What GitHub docs recommend: cache / setup-node vs upload-artifact for deps

### Artifacts vs dependency caching (official split)

GitHub states artifacts and caching are **similar but not interchangeable**:

- **Use caching** when you want to reuse files that don’t change often between workflow runs — e.g. dependencies from a package manager, intermediate build outputs — and the job can regenerate them if the cache is absent.
- **Use artifacts** when you want to save files produced by a job for after the run (binaries, logs, coverage) **or** pass **job outputs** between jobs in a workflow.

Sources: [Dependency caching](https://docs.github.com/en/actions/concepts/workflows-and-actions/dependency-caching), [Workflow artifacts](https://docs.github.com/en/actions/concepts/workflows-and-actions/workflow-artifacts).

**Implication:** Shipping `node_modules` or `target/` between jobs via `upload-artifact` fights the documented purpose of artifacts. Dependencies belong in the **cache** model.

### Node: what to cache

GitHub’s Node CI guide shows:

```yaml
- uses: actions/setup-node@v7
  with:
    node-version: '20'
    cache: 'npm'
- run: npm install   # or npm ci
```

([Building and testing Node.js](https://docs.github.com/en/actions/automating-builds-and-tests/building-and-testing-nodejs))

`actions/setup-node` documents that it follows `actions/cache` guidelines and **caches the global package-manager cache on the machine instead of `node_modules`**, so the cache can be reused across Node versions. ([setup-node advanced usage](https://github.com/actions/setup-node/blob/main/docs/advanced-usage.md))

`actions/cache` examples for npm are explicit:

> **It is not recommended to cache `node_modules`, as it can break across Node versions and won't work with `npm ci`.**

Cache path guidance: `~/.npm` (or `npm config get cache`), keyed on `package-lock.json`. ([actions/cache examples — Node npm](https://github.com/actions/cache/blob/main/examples.md#node---npm))

GitHub’s own npm caching example in the dependency-caching reference also caches **`~/.npm`**, then still runs **`npm install`**. ([Dependency caching reference](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching))

### Rust / Cargo: first-party caching guidance

The Cargo Book’s **Caching the Cargo home in CI** section:

- You **can** cache `$CARGO_HOME` to avoid redownloading crates.
- Caching the **entire** home is often **inefficient** (downloaded `.crate` archives in `registry/cache` plus extracted sources in `registry/src` — duplicate data → slow download/extract/recompress/reupload).
- Prefer caching: `.crates.toml`, `.crates2.json`, `bin/`, `registry/index/`, `registry/cache/`, `git/db/`.

([Cargo Home](https://doc.rust-lang.org/cargo/guide/cargo-home.html))

`actions/cache`’s Rust example caches those Cargo home paths **plus `target/`**, keyed on `Cargo.lock`. ([actions/cache examples — Rust](https://github.com/actions/cache/blob/main/examples.md#rust---cargo))

Cargo’s GitHub Actions sample workflow is a **single job** that builds/tests (optionally under a toolchain matrix) — it does **not** demonstrate a prepare/fan-out artifact pattern. ([Continuous Integration](https://doc.rust-lang.org/cargo/guide/continuous-integration.html))

### Tauri (first-party) — what they show

Tauri’s v2 GitHub pipeline guide uses **one job** (matrix over platforms for **release** builds), with:

- `actions/setup-node` + `cache: 'npm'`
- `swatinem/rust-cache@v2` for Rust build artifacts
- `npm install` in that same job
- Artifacts via `tauri-action` / upload for **bundles**, not for sharing `node_modules` across quality jobs

([Tauri — GitHub](https://v2.tauri.app/distribute/pipelines/github/))

Note: `swatinem/rust-cache` and `dtolnay/rust-toolchain` are third-party actions Tauri’s docs call for; for **cache path policy**, prefer the Cargo Book + `actions/cache` example above. This research does not treat third-party action READMEs as Actions platform law.

---

## 3. Size / time pitfalls of uploading `node_modules` or `target/` as artifacts

### Storage quotas

| Store | Typical limit (relevant) | Notes |
|-------|--------------------------|--------|
| **Artifacts** | Shared Actions artifact + Packages allowance (e.g. Free **500 MB**) | [Actions limits — storage](https://docs.github.com/en/actions/reference/limits) |
| **Caches** | Default **10 GB** per repository; unused entries evicted after **7 days** | [Dependency caching reference — usage limits](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching#usage-limits-and-eviction-policy) |

Public repos get free standard runner **minutes**, but artifact/cache **storage** rules and eviction still apply. ([Billing and usage](https://docs.github.com/en/actions/concepts/billing-and-usage); limits table above)

Uploading a multi‑hundred‑MB `node_modules` or multi‑GB `target/` as an artifact:

- Burns the shared artifact quota quickly (especially Free/Pro).
- Retains by default for **90 days** unless `retention-days` is shortened. ([upload-artifact retention](https://github.com/actions/upload-artifact); org retention docs)

### Wall-clock cost (often worse than “just npm ci”)

Dependent jobs must **`needs` the producer**, so they cannot start until install **and upload** finish. Parallel quality jobs then each **download + extract** the blob.

Cargo Book warns that inefficient Cargo-home caching already slows CI via download/extract/recompress/reupload. The same physics apply to artifacting `target/` or fat `node_modules`: transfer + compression can dominate for small projects. ([Cargo Home](https://doc.rust-lang.org/cargo/guide/cargo-home.html); `upload-artifact` documents compression-level tradeoffs for large binaries — [upload-artifact README](https://github.com/actions/upload-artifact))

### Correctness / permissions

- Zipped artifacts **do not preserve file permissions** (dirs `755`, files `644`). ([upload-artifact — Permission Loss](https://github.com/actions/upload-artifact#permission-loss))
- Caching / restoring `node_modules` is discouraged with `npm ci` (see §2).
- Jobs must always tolerate **cache miss** / missing artifact and reinstall. ([Dependency caching](https://docs.github.com/en/actions/concepts/workflows-and-actions/dependency-caching))

### Cache-specific pitfalls (if using cache instead of artifacts)

- PR caches are scoped to the merge ref and have **limited reuse** outside re-runs of that PR. ([Dependency caching reference — restrictions](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching#restrictions-for-accessing-a-cache))
- Cache save typically occurs when the job completes successfully (combined `actions/cache` behavior); a “prepare” job that only exists to seed a same-run cache **serializes** the pipeline before any parallel work starts.
- Concurrent jobs racing to **save** the same key: caches are immutable; only one write wins — others may no-op / warn. Design for restore-from-previous-run, not exclusive prepare-writer within one run.

---

## 4. Recommended pattern on GitHub-hosted runners: prepare → fan-out → build

### What “prepare once” actually means here

Because each job is a new VM:

1. **Do not** design a prepare job whose purpose is “install deps into a shared filesystem for siblings.”
2. **Do** let each job: `checkout` → toolchain setup → **restore cache** → **`npm ci` / cargo commands** → checks.
3. **Do** use **`needs`** only for true ordering (e.g. a final gate, or a job that consumes a **build product** artifact — not for dep trees).

### Jobs and `needs`

```yaml
jobs:
  job1: { ... }
  job2:
    needs: job1
  job3:
    needs: [job1, job2]
```

Jobs with no `needs` run **in parallel** by default. ([Using jobs in a workflow](https://docs.github.com/en/actions/using-jobs/using-jobs-in-a-workflow); [Workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax))

### Fan-out without a prepare job

```text
          ┌── frontend (setup-node cache + npm ci + checks + vite build)
trigger ──┤
          └── rust     (cargo cache + fmt/clippy/test)
                │
                └── ci (needs: [frontend, rust])   # optional single status check
```

Caches are filled by whichever job runs successfully (and by pushes to the default branch), then **restored on later runs** — that is the documented speedup path. ([Dependency caching](https://docs.github.com/en/actions/concepts/workflows-and-actions/dependency-caching))

### If you insist on a prepare job

The only coherent prepare patterns are:

- **Warm the Actions cache** (save `~/.npm` / Cargo home paths), then consumers `needs: prepare` and **restore + still run `npm ci`**, or  
- **Upload a true product** (e.g. `dist/`) for a later deploy job — not for quality fan-out.

A prepare that uploads `node_modules`/`target/` as artifacts is **against** the artifacts-vs-cache guidance and usually **slower** than parallel jobs each doing cached installs.

---

## 5. Single job (parallel steps / matrix) vs multi-job — at Issuebridge scale

### Repo shape (relevant to #24)

From the tree at research time:

- Frontend scripts: `typecheck`, `test:ui-contracts`, `test:packaging`, `build` (`tsc && vite build`)
- Rust: `cargo test` via `src-tauri`; fmt/clippy as planned gates
- Modest npm dependency set (React, Fluent UI, Vite, Tauri API/CLI)
- **No** full Tauri/NSIS in this PR workflow (release already separate: `release-windows.yml`)
- Runner decision: **`ubuntu-latest` only** ([ci-runner-os-for-pr-checks.md](./ci-runner-os-for-pr-checks.md))

### Options

| Shape | Pros | Cons |
|-------|------|------|
| **One job**, sequential steps | Simplest YAML; one install; one cache write | No cross-VM parallelism; slower wall-clock if Rust and Node both heavy |
| **One job**, `steps.parallel` for independent commands | Same install; concurrent steps on **one** VM ([workflow syntax — parallel](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idstepsparallel)) | Shares CPU/disk of one runner; not two machines |
| **Two jobs** (`frontend` ∥ `rust`) | True parallel VMs; clear checks in UI; matches language split | Each job pays checkout + install (mitigated by cache) |
| **prepare → many jobs → build** | Looks like classic CI stages | Prepare adds **mandatory serialization**; artifacted deps are an anti-pattern; little gain at this scale |
| **Matrix** (OS / Node / toolchain) | Good when you need combinatorial coverage | Overkill for #24 (single OS, single Node, stable Rust) |

Cargo’s own GH Actions sample uses one job (plus optional toolchain matrix). Tauri’s publish example uses one job per platform matrix entry with install+build together — not prepare/fan-out for lint. Both reinforce: **same-job install + work** is the first-party default.

### Scale judgment

For Issuebridge #24, **two parallel jobs** (frontend ∥ rust) is enough parallelism. A third “build” job only pays off if it consumes a **small product artifact** or is a **no-op gate** for branch protection. Folding Vite build into `frontend` avoids a fourth install.

A single job is acceptable if wall-clock stays under ~few minutes with caches warm; prefer two jobs once Rust compile time dominates Node checks.

---

## 6. Concrete recommended topology for Issuebridge #24

Opinionated pick: **no prepare job; no dep artifacts; two parallel quality jobs; optional thin gate.**

### Job: `frontend` (`ubuntu-latest`)

| Step | What |
|------|------|
| `actions/checkout` | Source |
| `actions/setup-node` with `cache: 'npm'` | Node + **global npm cache** (not `node_modules`) |
| `npm ci` | Deterministic install (always run) |
| Checks | `npm run typecheck`; `npm run test:ui-contracts`; `npm run test:packaging` |
| Build | `npm run build` (tsc + Vite) — **this is the frontend “build” stage** |
| Artifacts | **None required** for deps. Optionally upload `dist/` with short `retention-days` only if something else must consume it (not needed for the gate below) |

### Job: `rust` (`ubuntu-latest`, no `needs` — parallel with `frontend`)

| Step | What |
|------|------|
| `actions/checkout` | Source |
| Toolchain | `rustup` stable + `rustfmt` + `clippy` (or equivalent first-party setup) |
| `actions/cache` | Paths per Cargo Book / cache example: `~/.cargo/bin`, `registry/index`, `registry/cache`, `git/db`, and **`src-tauri/target`** (or workspace `target/`) keyed on `hashFiles('**/Cargo.lock')` + `runner.os` |
| Checks | `cargo fmt --all -- --check`; `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`; `cargo test --manifest-path src-tauri/Cargo.toml` |
| Artifacts | **Do not** upload `target/` |

### Job: `ci` (optional gate)

```yaml
ci:
  needs: [frontend, rust]
  runs-on: ubuntu-latest
  steps:
    - run: echo "All required checks passed"
```

Use this when branch protection wants **one** required check named `ci`. It does **not** reinstall deps and does **not** run Tauri/NSIS.

### Explicitly out of this workflow

- Full `tauri build` / NSIS (belongs in release workflow on Windows)
- `prepare` that `upload-artifact`s `node_modules` or `target/`
- Caching `node_modules` instead of `~/.npm`
- OS matrix for PR quality gates

### Rejected alternative (user’s sketched prepare → parallel → build)

```text
prepare (npm ci + cargo fetch, upload node_modules + target)
   ├── lint-frontend (download…)
   ├── lint-rust (download…)
   └── …
        └── build (needs all)
```

Rejected because: separate VMs, docs say **cache ≠ artifacts** for deps, upload/download cost and quota risk, and serialization through prepare. Same checks are faster as **two cached parallel jobs**.

---

## Answers checklist (must-answer)

1. **Literal reuse without reinstall?** Only **within one job’s steps**. Across jobs: only via **cache restore** or **artifact download** onto a new VM — both re-materialize files; prefer cache of package-manager data + re-run `npm ci` / cargo.
2. **Docs recommendation?** **`actions/cache` / `setup-node` `cache:`** for dependencies; **`upload-artifact`** for build/test **outputs** and intentional job-to-job **products** — not `node_modules`. Do not cache `node_modules` with npm/`npm ci`.
3. **Pitfalls?** Artifact storage quotas, long retention, compress/upload/download latency, permission loss, Cargo duplicate-source cache bloat, `target/` size; prepare+artifact **delays** parallel start.
4. **Hosted-runner pattern?** Parallel jobs each checkout + restore cache + install + check; `needs` for gates/products only; caches warm **across runs**.
5. **Simpler for this repo?** Yes alternatives exist: **one job** or **two parallel jobs**. Prefer **two jobs** over prepare/fan-out. Matrix only if OS/toolchain matrix is required (it isn’t for #24).
6. **Topology?** `frontend` ∥ `rust` → optional `ci` gate; caches as in §6; **no** dep artifacts; Vite build lives in `frontend`.

---

## Recommendation for Issuebridge #24

**Pick:** Two parallel jobs on `ubuntu-latest` — **`frontend`** (setup-node npm cache → `npm ci` → typecheck, contract tests, Vite build) and **`rust`** (`actions/cache` on Cargo home subsets + `target/` → fmt, clippy `-Dwarnings`, `cargo test`) — then an optional **`ci`** job with `needs: [frontend, rust]` for a single required status check.

**Do not:**

- Add a **prepare** job that installs once and shares `node_modules` / `target/` via **artifacts**
- Cache or artifact **`node_modules`** for npm/`npm ci` workflows
- Re-install in a final “build” job just for stage theater — put Vite build in `frontend`
- Pull full Tauri/NSIS into this PR workflow

**Myth to retire:** “If I upload `node_modules` as an artifact, parallel jobs reuse the install for free.” On hosted runners every job is a **new VM**; artifact/cache restore is a **re-copy**, GitHub tells you to use **dependency caching** (global npm/Cargo caches) rather than artifacts for deps, and you should still run **`npm ci`** after restoring the npm cache.

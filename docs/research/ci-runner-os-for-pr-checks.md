# Research: CI runner OS for Issuebridge PR / push checks

**Date:** 2026-07-30  
**Question:** For a non-release GitHub Actions pipeline (typecheck, Vite frontend build, Node contract tests, `cargo test` / `clippy` / `fmt --check` on `src-tauri` — **not** full Tauri/NSIS packaging), which runner is best overall: `ubuntu-latest` only, `windows-latest` only, or a matrix of both?  
**Issue context:** [#24](https://github.com/mnaimfaizy/issuebridge/issues/24) (CI for linting/testing/type-checking/building). Official release already ships on `windows-latest` + NSIS ([`.github/workflows/release-windows.yml`](../../.github/workflows/release-windows.yml)).

## Scope of this note

Primary sources only (GitHub Docs, Tauri docs / first-party workflow examples, Rust/Cargo/Clippy/rustfmt docs, `keyring` crate docs). Secondary blogs are not used as evidence.

---

## 1. Actions billing: Linux vs Windows

### Public repositories (Issuebridge today)

Issuebridge is a **public** repository (`mnaimfaizy/issuebridge`). GitHub’s billing docs state that use of **standard GitHub-hosted runners is free in public repositories** (and for GitHub Pages / Dependabot). See [GitHub Actions billing — Free use of GitHub Actions](https://docs.github.com/en/billing/concepts/product-billing/github-actions#free-use-of-github-actions) and [Billing and usage](https://docs.github.com/en/actions/concepts/billing-and-usage).

**Implication for #24:** On the current public repo, choosing `ubuntu-latest` vs `windows-latest` vs both does **not** consume plan minute quotas for standard runners. Cost is not the differentiator; wall-clock time, setup complexity, and OS fidelity are.

### Private repositories / overage (if the repo becomes private)

For **private** repos, accounts get a monthly included minute quota (e.g. Free 2,000 / Pro & Team 3,000 / Enterprise Cloud 50,000). Usage beyond quota is billed at per-minute rates that differ by OS and machine size. Current published baseline rates for standard 2-core runners:

| OS | SKU | Per-minute rate (USD) |
|----|-----|------------------------|
| Linux 2-core (x64) | `actions_linux` | $0.006 |
| Windows 2-core (x64) | `actions_windows` | $0.010 |

Source: [GitHub Actions billing — Baseline minute costs](https://docs.github.com/en/billing/concepts/product-billing/github-actions#baseline-minute-costs) and [Actions runner pricing](https://docs.github.com/en/billing/reference/actions-runner-pricing).

So at current list prices, a Windows minute costs about **1.67×** a Linux minute when paying overages ($0.010 / $0.006). GitHub also rounds each job up to the nearest whole minute ([Actions runner pricing](https://docs.github.com/en/billing/reference/actions-runner-pricing)).

### “Minute multipliers” (historical vs current docs)

Older GitHub docs described **included-quota multipliers**: Linux 1×, Windows 2×, macOS 10× (e.g. 1,000 Windows wall-clock minutes consuming 2,000 of the included pool). That table still appears in archived `github/docs` content (e.g. [about-billing-for-github-actions.md @ 086d7f83](https://github.com/github/docs/blob/086d7f835f2e801c70db93959786f323fc30a201/content/billing/managing-billing-for-github-actions/about-billing-for-github-actions.md)).

Current [Billing and usage](https://docs.github.com/en/actions/concepts/billing-and-usage) still mentions that usage metrics “do not apply minute multipliers” and links to “Baseline minute costs,” but that section now documents **per-minute USD rates**, not the classic 1/2/10 multiplier table. Treat the **published per-minute rates** as the authoritative current private-repo overage model; treat the classic multipliers as historical / transitional documentation that metrics still allude to.

**Matrix cost shape (private):** running the same job on both OSes roughly **doubles** wall-clock minutes (and roughly doubles overage spend at Windows’s higher rate for the Windows half).

---

## 2. Do these checks need a Windows runner when not bundling NSIS?

### Frontend / Node (typecheck, Vite build, `node --test`)

- TypeScript / Vite / Node test runners are available on both Linux and Windows hosted images ([GitHub-hosted runners](https://docs.github.com/en/actions/using-github-hosted-runners/using-github-hosted-runners/about-github-hosted-runners); Node via [`actions/setup-node`](https://github.com/actions/setup-node)).
- Issuebridge scripts (`npm run typecheck`, `npm run build`, `test:ui-contracts`, `test:packaging`) do not hard-require `win32` APIs in the contract-test scripts surveyed for this note.
- **Verdict:** These steps do **not** require `windows-latest` for correctness of a PR gate that deliberately excludes installer packaging.

### `cargo fmt --check`

- rustfmt’s CI guidance is to fail when formatting would change: `cargo fmt --all -- --check` ([rustfmt README — Checking style on a CI server](https://github.com/rust-lang/rustfmt#checking-style-on-a-ci-server); also [Cargo Book: `cargo fmt`](https://doc.rust-lang.org/cargo/commands/cargo-fmt.html)).
- Formatting is source-based, not OS-installer-based.
- **Verdict:** OS-agnostic; Linux is fine.

### `cargo clippy`

- Clippy is a toolchain component; CI commonly uses `cargo clippy -- -Dwarnings` ([Clippy usage](https://doc.rust-lang.org/clippy/usage.html); [Cargo Book: `cargo clippy`](https://doc.rust-lang.org/cargo/commands/cargo-clippy.html)).
- Clippy compiles the crate for the **host target**, so it still needs Tauri’s **compile-time** native deps on that OS (below). It does **not** require NSIS or a Windows runner specifically.
- **Verdict:** Runnable on Ubuntu once Linux system packages are installed; does not mandate Windows for a non-bundle gate.

### `cargo test` (Tauri crate, no `tauri build` / NSIS)

- Compiling a Tauri 2 app links against platform webview / GTK stacks. That is a **compile** requirement even when you never run `tauri build` or produce an installer.
- Official Tauri WebDriver CI example runs `cargo test` on a matrix including `ubuntu-latest` and `windows-latest`, and installs Linux packages only on Ubuntu ([Tauri — WebDriver CI](https://v2.tauri.app/develop/tests/webdriver/ci/)).
- Official release / PR build examples install Ubuntu packages before building; Windows steps have no equivalent apt step ([Tauri — GitHub pipelines](https://v2.tauri.app/distribute/pipelines/github/); [tauri-action `test-build-only.yml`](https://raw.githubusercontent.com/tauri-apps/tauri-action/dev/examples/test-build-only.yml)).
- **Verdict:** `cargo test` / `clippy` do **not** require Windows when the goal is “compile + unit tests + lint,” provided Linux deps are installed. They **do** require a Windows runner if you want to exercise **Windows-only** `#[cfg(windows)]` code paths and the Windows credential store in CI.

---

## 3. Linux system deps for Tauri (even without bundling)

Tauri’s prerequisites for Debian/Ubuntu-class systems include (among others) `libwebkit2gtk-4.1-dev`, build tools, SSL, and AppIndicator / RSVG packages ([Tauri Prerequisites — Linux](https://v2.tauri.app/start/prerequisites/)).

First-party GitHub workflow examples install a similar set before compiling on Ubuntu, for example:

```bash
sudo apt-get update
sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf xdg-utils
```

Sources: [Tauri GitHub pipelines example](https://v2.tauri.app/distribute/pipelines/github/), [tauri-action test-build-only.yml](https://raw.githubusercontent.com/tauri-apps/tauri-action/dev/examples/test-build-only.yml). WebDriver CI additionally installs `webkit2gtk-driver` and `xvfb` when driving a GUI ([WebDriver CI](https://v2.tauri.app/develop/tests/webdriver/ci/)) — **not** required for plain `cargo test` / clippy / fmt if tests do not open a display.

Windows prerequisites (MSVC Build Tools, WebView2, VBSCRIPT for MSI) apply to **Windows development / packaging** ([Tauri Prerequisites — Windows](https://v2.tauri.app/start/prerequisites/)). GitHub’s `windows-latest` image already includes a Windows + toolchain-friendly environment for Actions ([GitHub-hosted runners reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)); Issuebridge’s release workflow already relies on that without an apt-equivalent step.

**Practical note for Ubuntu PR jobs:** always install the WebKitGTK 4.1 + related `-dev` packages **before** `cargo test` / `cargo clippy`. Skipping them is a common false-red on Linux Tauri CI.

---

## 4. Fidelity risk: green on Ubuntu, broken on Windows

### What Ubuntu CI will **not** fully prove

| Area | Risk | Evidence in this repo / primary docs |
|------|------|--------------------------------------|
| NSIS / official installer | **Out of scope for #24 by design**; already gated by release workflow on `windows-latest` | [release-windows.yml](../../.github/workflows/release-windows.yml); Tauri Windows packaging deps ([Prerequisites](https://v2.tauri.app/start/prerequisites/)) |
| `#[cfg(windows)]` code | Compiles differently on Linux (`not(windows)` branch). Example: Whisper sidecar kill uses `taskkill` on Windows vs `kill -9` elsewhere | [`whisper_voice.rs`](../../src-tauri/src/adapters/whisper_voice.rs) |
| Credential vault | `keyring` with `windows-native` / `apple-native` / `linux-native` selects the store for the **build target**. On Linux, `linux-native` is **keyutils**, not Windows Credential Manager ([keyring 3.6 docs — credential store features](https://docs.rs/keyring/3.6.2/keyring/)) | [`Cargo.toml`](../../src-tauri/Cargo.toml); [`keyring_token_store` round-trip test](../../src-tauri/src/adapters/keyring_token_store.rs) expects a real platform store |
| Path / shell / PowerScript packaging | Release uses `scripts/release-build.ps1` on Windows; excluded from non-release gate | [release-windows.yml](../../.github/workflows/release-windows.yml) |

### What Ubuntu CI **does** prove well for this pipeline shape

- TypeScript correctness and Vite production build.
- Node contract tests (UI/packaging contracts that are filesystem/content checks).
- Rust formatting and most Clippy / unit-test logic that is not OS-cfg’d.
- That the Tauri crate **compiles** against a real native webview stack (GTK/WebKit on Linux), catching many dependency and API breakages early.

### Matrix vs single OS

Tauri’s own PR “build on all platforms” example uses a **matrix** of macOS / Ubuntu / Windows when the job’s purpose is **building the app** ([tauri-action test-build-only.yml](https://raw.githubusercontent.com/tauri-apps/tauri-action/dev/examples/test-build-only.yml)). That is a different goal than Issuebridge #24 (quality gate **without** installer / App secrets).

A dual OS matrix maximizes fidelity and roughly doubles job minutes (and private-repo cost). It is justified when Windows-specific compile or vault tests are part of the PR bar.

---

## 5. Hosted runner shapes (context)

For **public** repos, `ubuntu-latest` and `windows-latest` are 4-core / 16 GB images; for **private** repos, standard `ubuntu-latest` / `windows-latest` are 2-core / 8 GB ([GitHub-hosted runners reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)). Same labels, different hardware tiers by visibility — another reason Linux-only can feel faster on private forks.

---

## 6. Comparison summary

| Criterion | `ubuntu-latest` only | `windows-latest` only | Matrix both |
|-----------|----------------------|------------------------|-------------|
| Matches #24 scope (no NSIS) | Yes | Yes | Yes (redundant for packaging) |
| Setup friction | Must `apt-get` Tauri Linux deps | Closer to release env; no apt | Both setups |
| Frontend / fmt / Node tests | Strong | Strong | Strong (duplicate) |
| Rust compile + most tests | Strong (with apt) | Strong; exercises Windows cfgs + Win keyring | Strongest |
| Windows vault / `cfg(windows)` | Weak | Strong | Strong |
| Public-repo Actions cost | Free | Free | Free (2× minutes of wall time) |
| Private-repo overage | Lowest ($0.006/min) | Higher ($0.010/min) | Highest |
| Overlap with release workflow | Complementary | Overlaps release OS | Overlaps + extra Linux |

---

## Recommendation for Issuebridge #24

**Pick: `ubuntu-latest` only** for the non-release PR/push check pipeline.

**Why:**

1. **Scope fit** — #24 is a quality gate (tsc, Vite build, Node contracts, `cargo test` / clippy / fmt), explicitly **not** full Tauri/NSIS packaging or GitHub App secrets. Official shipping fidelity already lives on `windows-latest` in `release-windows.yml`.
2. **Primary-source support** — Tauri documents compiling and even `cargo test` on Ubuntu with WebKitGTK 4.1 system packages; Windows is not required for that class of job.
3. **Cost / speed posture** — Repo is public (standard runners free either way), but Ubuntu remains the cheaper/faster default if the repo ever goes private, and avoids duplicating work in a matrix for checks that are largely OS-agnostic.
4. **Acceptable residual risk** — Ubuntu will exercise `linux-native` keyutils (not Windows Credential Manager) and skip `#[cfg(windows)]` branches. Mitigate by keeping the Windows release workflow as the packaging gate, and optionally adding a **thin** `windows-latest` `cargo test` job later if keyring/Windows-only regressions show up — not as the default matrix for every PR.

**Implementation must-haves on Ubuntu:** install Tauri’s Linux `-dev` packages (WebKitGTK 4.1 et al.) before Rust jobs; use `cargo fmt -- --check` and Clippy with CI-friendly flags (`-Dwarnings` as desired); keep secrets out of this workflow.

**Do not pick** `windows-latest` only solely because the product is Windows-first — for this pipeline shape that trades away Linux’s simpler multi-OS ecosystem docs examples and private-repo economics without buying NSIS coverage (still excluded). **Do not default to a full matrix** unless #24’s acceptance criteria expand to “PR must pass Rust tests on Windows too.”

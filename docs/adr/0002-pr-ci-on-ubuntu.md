# PR CI on ubuntu-latest (Windows fidelity via Release)

Issuebridge is Windows-first, but the non-release PR/push quality gate (#24) runs on `ubuntu-latest` only. That gate covers typecheck, Vite build, Node contract tests, `cargo fmt --check`, Clippy (`-D warnings`), and `cargo test` — not Tauri/NSIS packaging or GitHub App secrets. Official Windows + NSIS fidelity stays on the existing `windows-latest` release workflow. Ubuntu is enough for this check set once Tauri’s Linux WebKitGTK `-dev` packages are installed; it avoids a dual-OS matrix for mostly OS-agnostic work and keeps private-repo overage cheaper if the repo ever goes private. Residual risk (`#[cfg(windows)]`, Windows Credential Manager via `keyring`) is accepted and mitigated by the release workflow, with an optional thin Windows `cargo test` job later only if regressions show up.

## Considered Options

- **`windows-latest` only for PR CI** — rejected for #24; overlaps the release OS without buying NSIS coverage (still out of scope) and is slower without a correctness win for these checks.
- **Ubuntu + Windows matrix on every PR** — rejected as default; doubles wall-clock for largely duplicate frontend/Node/fmt work unless Windows Rust tests become an explicit PR bar.
- **Artifact a prepare job’s `node_modules` / `target/` into parallel jobs** — rejected; hosted jobs are separate VMs; GitHub guidance is dependency **caching** plus per-job `npm ci`/cargo, not dep artifacts (see `docs/research/ci-job-deps-and-artifacts.md`).

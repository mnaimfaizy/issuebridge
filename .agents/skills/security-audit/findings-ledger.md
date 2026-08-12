# Security findings ledger

Fingerprint-only registry for Issuebridge security findings. **Public repo safe:** no attack paths, no exploit detail, no secrets. Full write-ups live in draft GitHub Security Advisories (admins only).

The **security-audit** agent must read this file before filing findings and must not re-file a concept that already has status `open`, `fixed`, `rejected`, or `accepted-risk` unless evidence shows a **regression** or material change (document why in Notes).

The **security-finding-triage** skill updates rows after stress-check.

## Evidence and status values

| Evidence    | Meaning                                                         |
| ----------- | --------------------------------------------------------------- |
| `untriaged` | Advisory claim has not been stress-checked against current code |
| `confirmed` | Repeatable safe evidence supports a reachable Medium+ finding   |
| `rejected`  | Claim is false, duplicate, out of threat model, or below Medium |

| Status          | Meaning                                                                          |
| --------------- | -------------------------------------------------------------------------------- |
| `open`          | Still in scope for triage or remediation                                         |
| `fixed`         | Remediation merged; auditor should only refile on regression                     |
| `rejected`      | Not a real Medium+ issue for Issuebridge (with rationale in triage notes / GHSA) |
| `accepted-risk` | Confirmed but explicitly deferred / accepted by maintainer                       |

## Ledger

| concept-id                             | title                                                       | path                                          | severity | evidence  | status | ghsa                | updated    |
| -------------------------------------- | ----------------------------------------------------------- | --------------------------------------------- | -------- | --------- | ------ | ------------------- | ---------- |
| `client-secret-in-release-binary`      | GitHub client secret embedded in release binary             | `src-tauri/src/adapters/github_http.rs`       | high     | confirmed | fixed  | GHSA-97vr-qxvw-88gr | 2026-08-11 |
| `mutable-copilot-cli`                  | Mutable Copilot CLI package with privileged CI tokens       | `.github/workflows/security-audit.yml`        | high     | confirmed | fixed  | GHSA-97vr-qxvw-88gr | 2026-08-10 |
| `mutable-third-party-release-actions`  | Mutable third-party actions in privileged release pipeline  | `.github/workflows/release-windows.yml`       | high     | confirmed | fixed  | GHSA-97vr-qxvw-88gr | 2026-08-10 |
| `pr-controlled-audit-privileged-token` | PR-controlled audit agent + privileged advisory token       | `.github/workflows/security-audit.yml`        | high     | confirmed | fixed  | GHSA-97vr-qxvw-88gr | 2026-08-11 |
| `relative-sidecar-cwd-exec`            | Relative sidecar discovery → cwd code execution             | `src-tauri/src/adapters/whisper_voice.rs`     | high     | confirmed | fixed  | GHSA-97vr-qxvw-88gr | 2026-08-11 |
| `sidecar-download-no-integrity`        | Release sidecars downloaded without integrity verification  | `scripts/fetch-whisper-assets.ps1`            | high     | confirmed | fixed  | GHSA-97vr-qxvw-88gr | 2026-08-12 |
| `unprotected-tag-release-secrets`      | Unprotected tag builds expose release secrets               | `.github/workflows/release-windows.yml`       | high     | confirmed | fixed  | GHSA-97vr-qxvw-88gr | 2026-08-12 |
| `agent-pipeline-plan-injection`        | Untrusted issue text can prompt-inject / replace agent plan | `.github/workflows/agent-pipeline.yml`        | high     | confirmed | fixed  | GHSA-97vr-qxvw-88gr | 2026-08-12 |
| `review-pipeline-missing-actor-gate`   | Review pipeline lacks actor authorization gate              | `.github/workflows/agent-pipeline-review.yml` | medium   | confirmed | fixed  | GHSA-g2j5-62w4-2gfm | 2026-08-12 |
| `publish-app-visible-boundary`         | Publish path does not enforce App-visible repo boundary     | `src/capture/CapturePopup.tsx`                | medium   | untriaged | open   | GHSA-97vr-qxvw-88gr | 2026-08-06 |

## Remediation notes

- `client-secret-in-release-binary` (F1): **response complete** — fixed in code, Worker deployed, safe build shipped in Release `v0.2.1`, GitHub App client secret rotated, and user notice provided in the Release notes. Maintainer decided separate GHSA publication is not required.
- `mutable-copilot-cli` (F2): **fixed** — privileged Copilot workflows install exact version `1.0.78` from a dedicated npm lockfile with registry integrity hashes and invoke only the locked local binary.
- `mutable-third-party-release-actions` (F3): **fixed** — third-party actions in the privileged Release job are pinned to reviewed full commit SHAs, with a contract preventing mutable refs from returning.
- `pr-controlled-audit-privileged-token` (F4): **fixed** — PR scans use the short-lived job token, restore the trusted audit runtime before execution, and exclude repository-code execution tools. Merged in PR #116.
- `relative-sidecar-cwd-exec` (F5): **fixed** — implicit voice and Rewrite sidecar, model, and DLL discovery is anchored to trusted application and build roots; regression tests reject relative candidates.
- `sidecar-download-no-integrity` (F6): **fixed** — official Release fetches verify reviewed SHA-256 digests for both executable sidecar archives before extraction.
- `unprotected-tag-release-secrets`: **fixed** — Release tags are protected by an active repository ruleset, and the privileged build requires approval through the protected `release` environment.
- `review-pipeline-missing-actor-gate`: **fixed** — privileged review automation requires exact allowlist or trusted automation identity checks for both the trigger actor and PR author.

## How to update

1. Prefer editing the matching row in place (same `concept-id`).
2. New themes from a fresh audit → add a row with evidence `untriaged`, status `open`, and the new GHSA id.
3. After triage: set both `evidence` and `status`, bump `updated` (UTC `YYYY-MM-DD`), and keep `title`/`path` fingerprint-only.
4. Never paste attack-path text, PoCs, or tokens into this file.

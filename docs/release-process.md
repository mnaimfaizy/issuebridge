# Release process (Windows NSIS)

How an Issuebridge **Release** goes from a merged `main` commit to a published GitHub Release with its `*-setup.exe` attached. Version choice, changelog wording and SemVer rules live in the **release** skill ([`.agents/skills/release/SKILL.md`](../.agents/skills/release/SKILL.md)); this document covers the mechanics of the cut.

Workflow: [`.github/workflows/release-windows.yml`](../.github/workflows/release-windows.yml). Written after the v0.2.3 cut lost its first run to an environment policy mismatch and briefly published an assetless Release (#126).

## One-time repository setup

The `release` environment is protected: required reviewers plus the two release secrets (`ISSUEBRIDGE_GITHUB_CLIENT_ID`, `ISSUEBRIDGE_OAUTH_EXCHANGE_URL`). Keep both protections.

Because Releases are cut by **pushing a tag**, the environment must admit a **tag** ref:

> Settings → Environments → `release` → **Deployment branches and tags** → *Selected branches and tags* → **Add deployment branch or tag rule** → ref type **Tag**, pattern `v*`.

A rule with pattern `v*` and ref type **Branch** does *not* admit `v*` tags. That was the v0.2.3 failure:

```text
Tag "v0.2.3" is not allowed to deploy to release due to environment protection rules.
```

The job never starts when this happens, so nothing in the build log explains it. The `preflight` job exists to catch it: it deliberately runs **without** the `release` environment, so it is always admitted and can report the policy problem itself.

Verify the current policy at any time:

```bash
gh api repos/mnaimfaizy/issuebridge/environments/release/deployment-branch-policies --jq '.branch_policies'
```

Expect an entry with `"name": "v*"` and `"type": "tag"`.

## Cutting a Release

### 1. Prepare on a branch

Run the **release** skill: it suggests the SemVer, drafts the notes, then updates `CHANGELOG.md` and the four version fields (`package.json`, `package-lock.json` root **and** `packages[""]`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`). Open a PR (`chore: prepare release X.Y.Z`) and merge it.

### 2. Preflight before tagging

From a clean checkout of the merged `main` commit:

```bash
git switch main && git pull && npm run preflight:release -- v0.3.1
```

This fails, with the offending field named, when:

- the worktree is dirty, `HEAD` is not `origin/main`, or the tag already exists locally or remotely;
- any of the four version fields disagrees with the tag;
- `CHANGELOG.md` has no `## [X.Y.Z]` section (alpha tags are exempt — notes are optional there);
- the `release` environment would reject the tag ref.

A wrong policy is a hard failure. Being *unable to read* the policy is not the same thing, so that degrades to a `::warning::` annotation on the run — if you see one, check by hand with the `gh api` command above before approving the deployment.

In CI the same preflight also proves the tagged commit is contained in `origin/main`, which is why its checkout uses `fetch-depth: 0`.

### 3. Tag and push

```bash
git tag -a v0.3.1 -m "Issuebridge v0.3.1" && git push origin v0.3.1
```

Do **not** publish a GitHub Release by hand first. If you want the notes staged ahead of time, create it as a **draft** — the workflow attaches the installer and then publishes it. A published-but-assetless Release is exactly what this process avoids.

### 4. Approve the deployment

The tag push starts `Release Windows NSIS`. The `preflight` job runs first, unprotected. The `windows-nsis` job then waits on the `release` environment's required reviewer — approve it in the run page.

## What the workflow guarantees

The order is fixed and each step is a gate:

| Step | Guarantee |
|------|-----------|
| `preflight` (ubuntu, no environment) | Tag shape, version fields, CHANGELOG section, that the tagged commit is merged into `main`, and the `release` tag policy — before any build time is spent |
| Packaging contract | NSIS-only, per-user install mode, sidecars and DLLs mapped |
| Official NSIS release build | Public client id + exchange URL baked in; client secret refused |
| **Verify installer** | Exactly one non-trivial `*-setup.exe`, carrying this tag's version |
| Upload artifact | Actions artifact for the run |
| Release notes from CHANGELOG | The `## [X.Y.Z]` section, staged as the body for a Release this run has to create |
| Resolve existing Release state | An already-published Release stays published; a missing or draft one stays a draft for now |
| Attach setup.exe | Asset uploaded; the pre-release flag set from the tag |
| **Publish** | Draft flipped to published **only** after the asset is confirmed attached |

Consequences worth knowing:

- **A Release this workflow creates gets its body from `CHANGELOG.md`.** A Release that already exists keeps the notes it has — so staging a draft with hand-written notes is safe, and a rerun never overwrites them.
- **Alpha tags** (`v0.4.0-alpha.1`) may have no changelog section; a Release created for one then starts with an empty body.
- **Pre-release tags** (any tag with a `-` suffix) are marked as pre-releases and published with `--latest=false`. Stable tags are published as *latest*.
- **Manual `workflow_dispatch` runs from a branch** build and upload the Actions artifact but never touch a GitHub Release. Dispatching against a tag ref follows the same path as a tag push.

## Re-running a run

Re-running is safe and idempotent:

- The Release is looked up first, so a published Release is never pushed back into draft. That lookup lists releases (an API call that succeeds whether or not the tag has one), so a transient API failure stops the run instead of being misread as "no Release yet".
- An existing Release keeps its own body; only a Release this run creates is seeded from `CHANGELOG.md`.
- `softprops/action-gh-release` replaces the same-named asset instead of duplicating it.
- `gh release edit --draft=false` on an already-published Release is a no-op.

So an interrupted run is fixed by re-running the workflow from the run page — never by deleting and re-pushing the tag.

## Verifying the finished Release

```bash
gh release view v0.3.1 --json isDraft,isPrerelease,assets --jq '{draft: .isDraft, prerelease: .isPrerelease, assets: [.assets[].name]}'
```

Expect `draft: false` and one `*-setup.exe` asset whose name carries the released version. The final workflow step prints exactly this.

## When something goes wrong

| Symptom | Cause | Fix |
|---------|-------|-----|
| `Tag "vX.Y.Z" is not allowed to deploy to release` | The `release` environment has no **Tag** rule matching `v*` | Add the tag rule (see one-time setup), then re-run the workflow. Do not remove the environment or its reviewer. |
| Preflight fails on a version field | The preparation PR missed a file | Fix on `main` via a PR, delete the tag, re-tag the new commit |
| Preflight fails on the changelog | No `## [X.Y.Z]` section | Add the section on `main`, re-tag |
| `Verify installer` fails | No, several, or a stale/truncated `*-setup.exe` | Inspect the build log; the Release is untouched, so just re-run once fixed |
| Release published without an asset | Should no longer be reachable — the publish step is asset-gated | Re-run the workflow; report it if the publish step passed with no asset |

## Related

- [`.agents/skills/release/SKILL.md`](../.agents/skills/release/SKILL.md) — version choice, changelog and notes
- [`docs/adr/0001-semver-tag-releases.md`](./adr/0001-semver-tag-releases.md) — why tags from `main`, not release branches
- [`README.md`](../README.md) — local official release build
- `scripts/release-preflight.mjs` — the checks; `scripts/release-preflight.test.mjs` and `scripts/release-workflow-contract.test.mjs` hold them to this document

# Action Node runtimes are floor-checked in CI, not discovered at Release

GitHub's Node.js 20 deprecation annotation is non-blocking, so it never fails a job — the v0.2.3 Windows Release was the first place it showed up (#127). Every JavaScript action in `.github/workflows/` now sits on its current Node.js 24 major, and `scripts/ci-workflow-contract.test.mjs` enforces a per-action minimum major so the next drift fails a PR instead of decorating a Release. Composite actions (`dtolnay/rust-toolchain`, `taiki-e/install-action`, `anthropics/claude-code-action`) run as shell steps, declare no Node runtime, and are deliberately exempt rather than bumped; an action in neither table fails the check, so adding one forces a recorded decision.

## Considered Options

- **Bump only to the minimum Node.js 24 major (`checkout@v5`, `upload-artifact@v6`)** — rejected; it clears the annotation today but re-opens the same upgrade within a release or two. The floors stay at the minimum so the check tolerates both.
- **A scheduled job or Dependabot querying the API for newer majors** — rejected as the primary guard; it needs network and a token and reports drift asynchronously, where the offline table check fails the PR that would ship it. Dependabot remains a fine complement.
- **Fix it during release preflight (#126)** — rejected as the only guard; preflight runs when a release is already in motion, which is the timing this ADR exists to avoid.
- **Also upgrade the inert `.github/workflows-archive/copilot/` prototypes** — rejected; GitHub never dispatches them, so they raise no annotation. The check scans `.github/workflows` only, so restoring one would be caught on the move.

## Consequences

A SHA pin carries no readable version, so for the SHA-pinned actions that *are* in the Node-runtime table the trailing `# vN` comment is the version marker and is required. The check trusts that comment without verifying it against the SHA: a stale comment on a downgraded pin is the one regression it cannot see.

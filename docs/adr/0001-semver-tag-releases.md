# SemVer Releases from main via tags

Issuebridge Releases are ship events (SemVer + NSIS installer + release notes), not long-lived release branches. We cut from `main` with `v*` tags so the existing tag-triggered Windows release workflow stays the source of truth, and we avoid maintaining a parallel branch that duplicates `main` for a single-product app.

We use Major.Minor.Patch with the same bump meaning on `0.x` as after `1.0` (Patch = fix/polish, Minor = additive capability, Major = user-breaking), plus ordered Pre-releases (`-alpha.N` → `-beta.N` → `-rc.N` → stable). Beta/rc get changelog + GitHub pre-release treatment; alpha may be tag and artifact only. User-facing notes live in `CHANGELOG.md` and feed the GitHub Release body. Commit types that drive bump suggestions are defined in the commit skill; the release skill proposes a version and, after confirmation, prepares changelog and version fields without committing or tagging unless asked.

## Considered Options

- **Short-lived `release/X.Y.Z` branches** for rc stabilization — rejected for now as optional complexity; revisit if we maintain multiple supported lines.
- **Long-lived `release` branch** — rejected; no need for a standing maintenance line yet.
- **GitHub Release body only (no in-repo changelog)** — rejected so history stays in git for agents and humans without relying on the hosting UI.

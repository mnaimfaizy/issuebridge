/**
 * Release preflight contract (issue #126).
 *
 * Pure checks over the inputs a Release cut depends on: the `v*` tag, the four
 * version fields, the CHANGELOG section, the protected `release` environment's
 * deployment ref policy, local git state, and the produced NSIS installer.
 *
 * I/O (git, gh api, file reads) lives in scripts/check-release-preflight.mjs
 * and scripts/check-release-asset.mjs; both share the argv helpers below so a
 * flag never means one thing in one CLI and something else in the other.
 */

/**
 * Value of `--name`, or `fallback` when the flag is absent or carries no value.
 * @param {string[]} argv
 * @param {string} name
 * @param {string} [fallback]
 * @returns {string | undefined}
 */
export function flagValue(argv, name, fallback = undefined) {
  const at = argv.indexOf(`--${name}`);
  if (at < 0) {
    return fallback;
  }
  const value = argv[at + 1];
  return value && !value.startsWith("--") ? value : fallback;
}

/**
 * True when `--name` is present, with or without a value.
 * @param {string[]} argv
 * @param {string} name
 * @returns {boolean}
 */
export function hasFlag(argv, name) {
  return argv.includes(`--${name}`);
}

/** Stable or pre-release SemVer, no build metadata (tags never carry `+`). */
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?$/;

/**
 * Parse a release tag ref into its SemVer and pre-release nature.
 * @param {string} ref `refs/tags/v0.3.1` or `v0.3.1`
 * @returns {{ ok: boolean, errors: string[], tag: string, version: string, prerelease: boolean }}
 */
export function parseReleaseTag(ref) {
  const raw = String(ref ?? "");
  const bad = (reason) => ({
    ok: false,
    errors: [
      `${reason}: expected a release tag ref of the form refs/tags/vX.Y.Z (SemVer, optional -alpha.N / -beta.N / -rc.N), got "${raw}"`,
    ],
    tag: "",
    version: "",
    prerelease: false,
  });

  if (raw.startsWith("refs/") && !raw.startsWith("refs/tags/")) {
    return bad("not a tag ref");
  }
  const tag = raw.startsWith("refs/tags/")
    ? raw.slice("refs/tags/".length)
    : raw;
  if (!tag.startsWith("v")) {
    return bad("tag is missing the v prefix");
  }
  const version = tag.slice(1);
  const match = SEMVER.exec(version);
  if (!match) {
    return bad("tag is not SemVer");
  }
  return {
    ok: true,
    errors: [],
    tag,
    version,
    prerelease: Boolean(match[4]),
  };
}

/** The `X.Y.Z` part of a SemVer, dropping any pre-release suffix. */
function coreVersion(version) {
  return String(version).split("-")[0];
}

/** Pre-release stage (`alpha` / `beta` / `rc`), or "" for a stable version. */
function prereleaseStage(version) {
  const suffix = String(version).split("-").slice(1).join("-");
  return suffix ? suffix.split(".")[0].toLowerCase() : "";
}

/** Read `version` from the Cargo `[package]` table (not from a dependency). */
function cargoPackageVersion(cargoToml) {
  const text = String(cargoToml ?? "");
  const start = text.search(/^\[package\]\s*$/m);
  if (start < 0) {
    return undefined;
  }
  const rest = text.slice(start + "[package]".length);
  const end = rest.search(/^\[/m);
  const table = end < 0 ? rest : rest.slice(0, end);
  return /^\s*version\s*=\s*"([^"]+)"/m.exec(table)?.[1];
}

/**
 * Every version field the Release depends on must carry the same SemVer.
 * @param {{ version: string, packageJson: any, packageLock: any, tauriConf: any, cargoToml: string }} input
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function checkVersionConsistency({
  version,
  packageJson,
  packageLock,
  tauriConf,
  cargoToml,
}) {
  const errors = [];
  const expect = (label, actual) => {
    if (actual === undefined || actual === null || actual === "") {
      errors.push(`${label} has no version field; expected ${version}`);
      return;
    }
    if (actual !== version) {
      errors.push(`${label} is ${actual}; expected ${version}`);
    }
  };

  expect("package.json version", packageJson?.version);
  expect("package-lock.json version", packageLock?.version);
  expect(
    'package-lock.json packages[""].version',
    packageLock?.packages?.[""]?.version,
  );
  expect("src-tauri/tauri.conf.json version", tauriConf?.version);
  expect(
    "src-tauri/Cargo.toml [package] version",
    cargoPackageVersion(cargoToml),
  );

  return { ok: errors.length === 0, errors };
}

/**
 * Body of the `## [version] - date` CHANGELOG section, or null when absent.
 * @param {string} changelog
 * @param {string} version
 * @returns {string | null}
 */
export function extractChangelogSection(changelog, version) {
  const text = String(changelog ?? "");
  const heading = new RegExp(
    `^## \\[${version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\][^\\n]*$`,
    "m",
  );
  const start = text.search(heading);
  if (start < 0) {
    return null;
  }
  const bodyStart = text.indexOf("\n", start);
  if (bodyStart < 0) {
    return "";
  }
  const rest = text.slice(bodyStart + 1);
  const next = rest.search(/^## /m);
  return (next < 0 ? rest : rest.slice(0, next)).trim();
}

/**
 * Stable, beta and rc Releases need user-facing notes in CHANGELOG.md.
 * Alpha may ship as tag + artifact only (see docs/adr/0001-semver-tag-releases.md).
 * @param {string} changelog
 * @param {string} version
 * @returns {{ ok: boolean, errors: string[], warnings: string[], section: string | null }}
 */
export function checkChangelog(changelog, version) {
  const section = extractChangelogSection(changelog, version);
  if (section) {
    return { ok: true, errors: [], warnings: [], section };
  }
  if (prereleaseStage(version) === "alpha") {
    return {
      ok: true,
      errors: [],
      warnings: [
        `CHANGELOG.md has no "## [${version}]" section; allowed because ${version} is an alpha pre-release (notes optional).`,
      ],
      section: null,
    };
  }
  return {
    ok: false,
    errors: [
      `CHANGELOG.md has no "## [${version}]" section with release notes; add one before tagging (release skill, step 4).`,
    ],
    warnings: [],
    section: null,
  };
}

/**
 * GitHub deployment ref patterns: `*` spans one path segment, `**` spans any.
 * @param {string} pattern
 * @param {string} name ref short name (`v0.3.1`, `main`)
 * @returns {boolean}
 */
export function matchesRefPattern(pattern, name) {
  const chars = String(pattern);
  let source = "";
  let i = 0;
  while (i < chars.length) {
    const char = chars[i];
    if (char === "*" && chars[i + 1] === "*") {
      source += ".*";
      i += 2;
      continue;
    }
    if (char === "*") {
      source += "[^/]*";
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += char.replace(/[.+^${}()|[\]\\]/, "\\$&");
    }
    i += 1;
  }
  return new RegExp(`^${source}$`).test(String(name));
}

/**
 * A protected environment admits a tag only via a custom policy of type `tag`.
 * A `v*` policy of type `branch` silently rejects `v*` tags — the v0.2.3 failure.
 * @param {{ environment: string, deploymentBranchPolicy: any, policies: {name: string, type: string}[], tag: string }} input
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function checkEnvironmentTagPolicy({
  environment,
  deploymentBranchPolicy,
  policies,
  tag,
}) {
  const fix = `Repository Settings -> Environments -> ${environment} -> Deployment branches and tags: add a rule with ref type "Tag" and pattern "v*".`;

  if (!deploymentBranchPolicy) {
    return { ok: true, errors: [] };
  }
  if (deploymentBranchPolicy.protected_branches) {
    return {
      ok: false,
      errors: [
        `the "${environment}" environment only admits protected branches, so tag ${tag} can never deploy to it. ${fix}`,
      ],
    };
  }
  if (!deploymentBranchPolicy.custom_branch_policies) {
    return { ok: true, errors: [] };
  }

  const list = Array.isArray(policies) ? policies : [];
  if (list.some((p) => p.type === "tag" && matchesRefPattern(p.name, tag))) {
    return { ok: true, errors: [] };
  }

  const asBranch = list.filter(
    (p) => p.type !== "tag" && matchesRefPattern(p.name, tag),
  );
  const summary = list.length
    ? list.map((p) => `${p.name} (${p.type})`).join(", ")
    : "(none)";
  const cause = asBranch.length
    ? `pattern "${asBranch[0].name}" exists but is a branch rule, and a branch rule never admits a tag`
    : `no rule matches ${tag}`;
  return {
    ok: false,
    errors: [
      `the "${environment}" environment will reject tag ${tag}: ${cause}. Configured rules: ${summary}. ${fix}`,
    ],
  };
}

/**
 * The tagged commit must already be merged into the release base branch.
 * Checked in CI too, where `checkGitState` cannot apply: by then the tag exists
 * and `main` may have moved on, so containment is the invariant, not equality.
 * @param {{ tag: string, baseRef: string, contained: boolean }} input
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function checkTagOnBase({ tag, baseRef, contained }) {
  if (contained) {
    return { ok: true, errors: [] };
  }
  return {
    ok: false,
    errors: [
      `tag ${tag} points at a commit that is not contained in ${baseRef}; Releases are cut from commits merged into ${baseRef} (docs/adr/0001-semver-tag-releases.md)`,
    ],
  };
}

/**
 * Local git state a maintainer must reach before tagging.
 * @param {{ tag: string, status: string, head: string, baseHead: string, baseRef?: string, localTags: string[], remoteTags: string[] }} input
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function checkGitState({
  tag,
  status,
  head,
  baseHead,
  baseRef = "origin/main",
  localTags,
  remoteTags,
}) {
  const errors = [];

  if (String(status ?? "").trim()) {
    errors.push(
      "the worktree has uncommitted changes; tag the exact merged commit from a clean tree",
    );
  }
  if (head !== baseHead) {
    errors.push(
      `HEAD (${head}) is not ${baseRef} (${baseHead}); tag the merged main commit, not a local or stale one`,
    );
  }
  if ((localTags ?? []).includes(tag)) {
    errors.push(
      `tag ${tag} already exists locally; delete it or pick the next version`,
    );
  }
  if ((remoteTags ?? []).includes(tag)) {
    errors.push(
      `tag ${tag} already exists on the remote; a Release for it was already cut`,
    );
  }

  return { ok: errors.length === 0, errors };
}

/** Minimum plausible NSIS installer size; a truncated build is far smaller. */
const MIN_INSTALLER_BYTES = 1_000_000;

/**
 * Exactly one `*-setup.exe`, non-trivial, carrying the release version.
 * Guards against publishing a Release with a stale, missing or ambiguous asset.
 * @param {{ files: {name: string, size: number}[], version: string }} input
 * @returns {{ ok: boolean, errors: string[], installer?: {name: string, size: number} }}
 */
export function checkInstallerAssets({ files, version }) {
  const installers = (files ?? []).filter((f) =>
    f.name.toLowerCase().endsWith("-setup.exe"),
  );

  if (installers.length === 0) {
    return {
      ok: false,
      errors: [
        `no *-setup.exe was produced for ${version}; refusing to publish an assetless Release`,
      ],
    };
  }
  if (installers.length > 1) {
    return {
      ok: false,
      errors: [
        `expected exactly one *-setup.exe, found ${installers.length}: ${installers
          .map((f) => f.name)
          .join(", ")}`,
      ],
    };
  }

  const errors = [];
  const [installer] = installers;
  if (installer.size < MIN_INSTALLER_BYTES) {
    errors.push(
      `${installer.name} is ${installer.size} bytes; an empty or truncated installer must not be attached to a Release`,
    );
  }
  const accepted = [version, coreVersion(version)];
  if (!accepted.some((v) => installer.name.includes(v))) {
    errors.push(
      `${installer.name} does not carry version ${version}; the bundle is stale for this tag`,
    );
  }
  return { ok: errors.length === 0, errors, installer };
}

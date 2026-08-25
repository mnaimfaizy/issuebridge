import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  checkChangelog,
  checkEnvironmentTagPolicy,
  checkGitState,
  checkInstallerAssets,
  checkTagOnBase,
  checkVersionConsistency,
  extractChangelogSection,
  matchesRefPattern,
  parseReleaseTag,
} from "./release-preflight.mjs";

const CHANGELOG = `# Changelog

All notable changes to Issuebridge are documented here.

## [Unreleased]

## [0.3.1] - 2026-08-25

### Fixed

- Release preflight refuses inconsistent version fields. (#126)

## [0.3.0] - 2026-08-16

### Added

- Help is now a full in-app reference. (#146)
`;

function versionFields(version) {
  return {
    version,
    packageJson: { version },
    packageLock: { version, packages: { "": { version } } },
    tauriConf: { version },
    cargoToml: `[package]\nname = "issuebridge"\nversion = "${version}"\n`,
  };
}

describe("release tag parsing (#126)", () => {
  it("accepts a stable v-prefixed SemVer tag ref", () => {
    const parsed = parseReleaseTag("refs/tags/v0.3.1");
    assert.equal(parsed.ok, true);
    assert.equal(parsed.tag, "v0.3.1");
    assert.equal(parsed.version, "0.3.1");
    assert.equal(parsed.prerelease, false);
  });

  it("accepts a bare tag name as well as a full ref", () => {
    assert.equal(parseReleaseTag("v1.2.3").version, "1.2.3");
  });

  it("marks alpha/beta/rc tags as pre-releases", () => {
    for (const tag of ["v0.4.0-alpha.1", "v0.4.0-beta.2", "v0.4.0-rc.1"]) {
      const parsed = parseReleaseTag(tag);
      assert.equal(parsed.ok, true, `${tag} should parse`);
      assert.equal(parsed.prerelease, true, `${tag} is a pre-release`);
    }
  });

  it("rejects branch refs and non-SemVer tags with a clear diagnostic", () => {
    for (const ref of ["refs/heads/main", "v1.2", "release-1.2.3", "1.2.3"]) {
      const parsed = parseReleaseTag(ref);
      assert.equal(parsed.ok, false, `${ref} should not parse`);
      assert.match(parsed.errors.join("\n"), /vX\.Y\.Z/);
    }
  });
});

describe("release version consistency (#126)", () => {
  it("passes when every version field matches the tag", () => {
    const result = checkVersionConsistency(versionFields("0.3.1"));
    assert.deepEqual(result, { ok: true, errors: [] });
  });

  it("names each field that disagrees with the tag", () => {
    const fields = versionFields("0.3.1");
    fields.tauriConf = { version: "0.3.0" };
    fields.cargoToml = '[package]\nname = "issuebridge"\nversion = "0.2.9"\n';
    const result = checkVersionConsistency(fields);
    assert.equal(result.ok, false);
    const joined = result.errors.join("\n");
    assert.match(joined, /src-tauri\/tauri\.conf\.json/);
    assert.match(joined, /src-tauri\/Cargo\.toml/);
    assert.doesNotMatch(joined, /package\.json version/);
  });

  it("checks both lockfile version roots", () => {
    const fields = versionFields("0.3.1");
    fields.packageLock = {
      version: "0.3.1",
      packages: { "": { version: "0.3.0" } },
    };
    const result = checkVersionConsistency(fields);
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /packages\[""\]/);
  });

  it("reads the version from the Cargo [package] table, not a dependency", () => {
    const fields = versionFields("0.3.1");
    fields.cargoToml = [
      "[package]",
      'name = "issuebridge"',
      'version = "0.3.1"',
      "",
      "[dependencies]",
      'tauri = { version = "2" }',
      "",
      "[package.metadata.other]",
      'version = "9.9.9"',
    ].join("\n");
    assert.equal(checkVersionConsistency(fields).ok, true);
  });

  it("reports a missing Cargo version rather than silently passing", () => {
    const fields = versionFields("0.3.1");
    fields.cargoToml = '[package]\nname = "issuebridge"\n';
    const result = checkVersionConsistency(fields);
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /Cargo\.toml/);
  });
});

describe("changelog section (#126)", () => {
  it("extracts the section body for a version", () => {
    const section = extractChangelogSection(CHANGELOG, "0.3.1");
    assert.match(section, /### Fixed/);
    assert.match(section, /Release preflight refuses/);
    assert.doesNotMatch(section, /Help is now a full in-app reference/);
    assert.doesNotMatch(section, /Unreleased/);
  });

  it("returns null when the version has no section", () => {
    assert.equal(extractChangelogSection(CHANGELOG, "0.9.9"), null);
  });

  it("fails a stable release without a matching section", () => {
    const result = checkChangelog(CHANGELOG, "0.9.9");
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /## \[0\.9\.9\]/);
  });

  it("fails a beta/rc release without a matching section", () => {
    const result = checkChangelog(CHANGELOG, "0.9.9-rc.1");
    assert.equal(result.ok, false);
  });

  it("allows an alpha release with no section (notes optional)", () => {
    const result = checkChangelog(CHANGELOG, "0.9.9-alpha.1");
    assert.equal(result.ok, true);
    assert.match(result.warnings.join("\n"), /alpha/i);
  });

  it("passes when the section exists", () => {
    const result = checkChangelog(CHANGELOG, "0.3.1");
    assert.equal(result.ok, true);
    assert.deepEqual(result.errors, []);
  });
});

describe("deployment ref pattern matching (#126)", () => {
  it("matches a v* pattern against release tags", () => {
    assert.equal(matchesRefPattern("v*", "v0.3.1"), true);
    assert.equal(matchesRefPattern("v*", "v0.4.0-rc.1"), true);
    assert.equal(matchesRefPattern("v*", "main"), false);
  });

  it("treats * as a single path segment and ** as any segments", () => {
    assert.equal(matchesRefPattern("releases/*", "releases/10"), true);
    assert.equal(matchesRefPattern("releases/*", "releases/10/hotfix"), false);
    assert.equal(matchesRefPattern("releases/**", "releases/10/hotfix"), true);
  });

  it("escapes regex metacharacters in the pattern", () => {
    assert.equal(matchesRefPattern("v1.0", "v1.0"), true);
    assert.equal(matchesRefPattern("v1.0", "v100"), false);
  });
});

describe("release environment tag policy (#126)", () => {
  const tag = "v0.3.1";

  it("passes when the environment has no deployment ref restriction", () => {
    const result = checkEnvironmentTagPolicy({
      environment: "release",
      deploymentBranchPolicy: null,
      policies: [],
      tag,
    });
    assert.deepEqual(result, { ok: true, errors: [] });
  });

  it("passes when a custom tag policy matches the tag", () => {
    const result = checkEnvironmentTagPolicy({
      environment: "release",
      deploymentBranchPolicy: {
        protected_branches: false,
        custom_branch_policies: true,
      },
      policies: [
        { name: "main", type: "branch" },
        { name: "v*", type: "tag" },
      ],
      tag,
    });
    assert.equal(result.ok, true);
  });

  it("fails when v* is configured as a branch policy only (the v0.2.3 failure)", () => {
    const result = checkEnvironmentTagPolicy({
      environment: "release",
      deploymentBranchPolicy: {
        protected_branches: false,
        custom_branch_policies: true,
      },
      policies: [{ name: "v*", type: "branch" }],
      tag,
    });
    assert.equal(result.ok, false);
    const joined = result.errors.join("\n");
    assert.match(joined, /tag/i);
    assert.match(joined, /v\*/);
    assert.match(joined, /branch/i);
  });

  it("fails when the tag matches no configured policy", () => {
    const result = checkEnvironmentTagPolicy({
      environment: "release",
      deploymentBranchPolicy: {
        protected_branches: false,
        custom_branch_policies: true,
      },
      policies: [{ name: "release/*", type: "tag" }],
      tag,
    });
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /v0\.3\.1/);
  });

  it("fails when the environment only admits protected branches", () => {
    const result = checkEnvironmentTagPolicy({
      environment: "release",
      deploymentBranchPolicy: {
        protected_branches: true,
        custom_branch_policies: false,
      },
      policies: [],
      tag,
    });
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /protected branches/i);
  });
});

describe("local git state before tagging (#126)", () => {
  const clean = {
    tag: "v0.3.1",
    status: "",
    head: "abc123",
    baseHead: "abc123",
    baseRef: "origin/main",
    localTags: ["v0.3.0"],
    remoteTags: ["v0.3.0"],
  };

  it("passes on a clean worktree at the merged main commit with a free tag", () => {
    assert.deepEqual(checkGitState(clean), { ok: true, errors: [] });
  });

  it("fails on a dirty worktree", () => {
    const result = checkGitState({ ...clean, status: " M package.json" });
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /uncommitted/i);
  });

  it("fails when HEAD is not the merged base commit", () => {
    const result = checkGitState({ ...clean, baseHead: "def456" });
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /origin\/main/);
  });

  it("fails when the tag already exists locally or remotely", () => {
    const local = checkGitState({ ...clean, localTags: ["v0.3.0", "v0.3.1"] });
    assert.equal(local.ok, false);
    assert.match(local.errors.join("\n"), /local/i);

    const remote = checkGitState({ ...clean, remoteTags: ["v0.3.1"] });
    assert.equal(remote.ok, false);
    assert.match(remote.errors.join("\n"), /remote/i);
  });
});

describe("tagged commit on the release base (#126)", () => {
  it("passes when the tagged commit is contained in the base branch", () => {
    const result = checkTagOnBase({
      tag: "v0.3.1",
      baseRef: "origin/main",
      contained: true,
    });
    assert.deepEqual(result, { ok: true, errors: [] });
  });

  it("fails when the tag points outside the base branch", () => {
    const result = checkTagOnBase({
      tag: "v0.3.1",
      baseRef: "origin/main",
      contained: false,
    });
    assert.equal(result.ok, false);
    const joined = result.errors.join("\n");
    assert.match(joined, /origin\/main/);
    assert.match(joined, /v0\.3\.1/);
  });
});

describe("installer asset check (#126)", () => {
  it("passes for exactly one non-empty setup.exe carrying the release version", () => {
    const result = checkInstallerAssets({
      files: [{ name: "Issuebridge_0.3.1_x64-setup.exe", size: 90_000_000 }],
      version: "0.3.1",
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.errors, []);
    // Returned so callers report the asset without re-deriving which file it was.
    assert.equal(result.installer.name, "Issuebridge_0.3.1_x64-setup.exe");
  });

  it("fails when no installer was produced", () => {
    const result = checkInstallerAssets({ files: [], version: "0.3.1" });
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /-setup\.exe/);
  });

  it("fails when the installer version does not match the tag", () => {
    const result = checkInstallerAssets({
      files: [{ name: "Issuebridge_0.3.0_x64-setup.exe", size: 90_000_000 }],
      version: "0.3.1",
    });
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /0\.3\.1/);
  });

  it("fails on a truncated installer", () => {
    const result = checkInstallerAssets({
      files: [{ name: "Issuebridge_0.3.1_x64-setup.exe", size: 12 }],
      version: "0.3.1",
    });
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /empty|truncat/i);
  });

  it("fails when several installers would be attached (ambiguous asset)", () => {
    const result = checkInstallerAssets({
      files: [
        { name: "Issuebridge_0.3.1_x64-setup.exe", size: 90_000_000 },
        { name: "Issuebridge_0.3.1_x86-setup.exe", size: 90_000_000 },
      ],
      version: "0.3.1",
    });
    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /exactly one/i);
  });

  it("accepts a pre-release installer named with or without the suffix", () => {
    for (const name of [
      "Issuebridge_0.4.0-rc.1_x64-setup.exe",
      "Issuebridge_0.4.0_x64-setup.exe",
    ]) {
      const result = checkInstallerAssets({
        files: [{ name, size: 90_000_000 }],
        version: "0.4.0-rc.1",
      });
      assert.equal(result.ok, true, `${name} should match 0.4.0-rc.1`);
    }
  });
});

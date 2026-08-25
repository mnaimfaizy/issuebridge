/**
 * Release preflight gate (issue #126).
 *
 * Verifies everything a Release cut depends on *before* a tag build burns 40
 * minutes or a Release is published: the tag shape, the four version fields,
 * the CHANGELOG section, and — for tag refs — that the protected `release`
 * environment actually admits the tag ref type.
 *
 * Usage:
 *   node scripts/check-release-preflight.mjs --ref refs/tags/v0.3.1
 *   node scripts/check-release-preflight.mjs --ref v0.3.1 --git --environment release
 *   node scripts/check-release-preflight.mjs --ref "$GITHUB_REF" --on-base origin/main
 *
 * Flags:
 *   --ref <ref>          tag ref or tag name (default: $GITHUB_REF). A branch ref
 *                        means workflow_dispatch: version fields only.
 *   --environment <name> also check that environment's deployment ref policy (needs gh + token)
 *   --on-base <ref>      also check the tagged commit is contained in <ref> (CI; needs full history)
 *   --git                also check local git state before tagging (clean tree, base commit, free tag)
 *   --base <ref>         base commit the tag must sit on (default: origin/main)
 *   --notes-out <file>   write the CHANGELOG section for the release body (only when one exists)
 */
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkChangelog,
  checkEnvironmentTagPolicy,
  checkGitState,
  checkTagOnBase,
  checkVersionConsistency,
  flagValue,
  hasFlag,
  parseReleaseTag,
} from "./release-preflight.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);

function readJson(...parts) {
  return JSON.parse(readFileSync(join(root, ...parts), "utf8"));
}

function readText(...parts) {
  return readFileSync(join(root, ...parts), "utf8");
}

function git(...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function gh(...args) {
  return execFileSync("gh", args, { cwd: root, encoding: "utf8" });
}

const errors = [];
const warnings = [];

/** Accumulate a check's errors and warnings, and hand the result back. */
function collect(result) {
  errors.push(...(result.errors ?? []));
  warnings.push(...(result.warnings ?? []));
  return result;
}

function fail(message) {
  console.error(`Release preflight failed: ${message}`);
  process.exit(1);
}

if (hasFlag(argv, "ref") && !flagValue(argv, "ref")) {
  fail(
    "missing value for --ref; pass the tag you intend to cut, e.g. npm run preflight:release -- v0.3.1",
  );
}
const ref = String(flagValue(argv, "ref", process.env.GITHUB_REF ?? ""));
const isTagRef = !ref.startsWith("refs/heads/") && ref !== "";

const packageJson = readJson("package.json");
let version = packageJson.version;
let tag = "";

if (isTagRef) {
  const parsed = collect(parseReleaseTag(ref));
  if (!parsed.ok) {
    console.error(`Release preflight failed:\n  - ${errors.join("\n  - ")}`);
    process.exit(1);
  }
  ({ tag, version } = parsed);
} else {
  console.log(
    `No release tag ref (${ref || "unset"}); checking version fields only. A Release is cut by pushing a v* tag.`,
  );
}

collect(
  checkVersionConsistency({
    version,
    packageJson,
    packageLock: readJson("package-lock.json"),
    tauriConf: readJson("src-tauri", "tauri.conf.json"),
    cargoToml: readText("src-tauri", "Cargo.toml"),
  }),
);

const notesOut = flagValue(argv, "notes-out");
if (isTagRef) {
  const changelog = collect(checkChangelog(readText("CHANGELOG.md"), version));
  if (typeof notesOut === "string") {
    const target = join(root, notesOut);
    if (changelog.section) {
      writeFileSync(target, `${changelog.section}\n`, "utf8");
    } else {
      rmSync(target, { force: true });
    }
  }
}

const environment = flagValue(argv, "environment");
if (isTagRef && typeof environment === "string") {
  const repo = process.env.GITHUB_REPOSITORY ?? "";
  try {
    const slug =
      repo ||
      JSON.parse(gh("repo", "view", "--json", "nameWithOwner")).nameWithOwner;
    const env = JSON.parse(
      gh("api", `repos/${slug}/environments/${environment}`),
    );
    const policies = JSON.parse(
      gh(
        "api",
        `repos/${slug}/environments/${environment}/deployment-branch-policies`,
      ),
    );
    collect(
      checkEnvironmentTagPolicy({
        environment,
        deploymentBranchPolicy: env.deployment_branch_policy,
        policies: policies.branch_policies ?? [],
        tag,
      }),
    );
  } catch (error) {
    warnings.push(
      `could not read the "${environment}" environment deployment policy (${error.message.split("\n")[0]}); verify by hand that it admits tag "${tag}" with ref type Tag.`,
    );
  }
}

// CI runs this: by tag time `main` may have moved on, so the invariant is that
// the tagged commit is contained in the base branch, not equal to its tip.
const onBase = flagValue(argv, "on-base");
if (isTagRef && typeof onBase === "string") {
  let contained = false;
  try {
    git("merge-base", "--is-ancestor", "HEAD", onBase);
    contained = true;
  } catch (error) {
    if (error.status !== 1) {
      errors.push(
        `could not compare HEAD with ${onBase} (${error.message.split("\n")[0]}); the preflight checkout needs full history (fetch-depth: 0)`,
      );
      contained = true; // already reported; do not also claim the tag is unmerged
    }
  }
  collect(checkTagOnBase({ tag, baseRef: onBase, contained }));
}

if (hasFlag(argv, "git") && isTagRef) {
  const base = String(flagValue(argv, "base", "origin/main"));
  try {
    collect(
      checkGitState({
        tag,
        status: git("status", "--porcelain"),
        head: git("rev-parse", "HEAD"),
        baseHead: git("rev-parse", base),
        baseRef: base,
        localTags: git("tag", "--list").split("\n").filter(Boolean),
        remoteTags: git("ls-remote", "--tags", "origin")
          .split("\n")
          .map((line) => line.split("refs/tags/")[1])
          .filter((name) => name && !name.endsWith("^{}")),
      }),
    );
  } catch (error) {
    errors.push(`git state check failed: ${error.message.split("\n")[0]}`);
  }
}

const annotate = process.env.GITHUB_ACTIONS === "true";
for (const warning of warnings) {
  console.warn(annotate ? `::warning::${warning}` : `warning: ${warning}`);
}

if (errors.length > 0) {
  console.error(
    `Release preflight failed for ${tag || version}:\n  - ${errors.join("\n  - ")}`,
  );
  process.exit(1);
}

console.log(`Release preflight OK for ${tag || version}.`);

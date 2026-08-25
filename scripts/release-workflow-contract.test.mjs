import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function readRepo(...parts) {
  return readFileSync(join(root, ...parts), "utf8");
}

const yml = readRepo(".github", "workflows", "release-windows.yml");

/** Extract a top-level job block by name from workflow YAML. */
function jobBlock(name) {
  const start = yml.search(new RegExp(`^  ${name}:\\s*$`, "m"));
  assert.ok(start >= 0, `expected job ${name}`);
  const rest = yml.slice(start + 1);
  const next = rest.search(/^ {2}[a-zA-Z0-9_-]+:\s*$/m);
  return next < 0 ? yml.slice(start) : yml.slice(start, start + 1 + next);
}

function stepBlock(block, heading) {
  const start = block.indexOf(`- name: ${heading}`);
  assert.ok(start >= 0, `expected step "${heading}"`);
  const rest = block.slice(start + 1);
  const next = rest.search(/^\s+- name:/m);
  return next < 0 ? block.slice(start) : block.slice(start, start + 1 + next);
}

/** Index of a step heading, for asserting relative order within a job. */
function stepIndex(block, heading) {
  const at = block.indexOf(`- name: ${heading}`);
  assert.ok(at >= 0, `expected step "${heading}"`);
  return at;
}

describe("release workflow trigger and environment contract (#126)", () => {
  it("still builds on v* tag pushes and manual dispatch", () => {
    assert.match(yml, /on:\s*\n\s*workflow_dispatch:/);
    assert.match(yml, /push:\s*\n\s*tags:\s*\n\s*-\s*["']v\*["']/);
  });

  it("runs a preflight job that the protected environment cannot silently block", () => {
    const preflight = jobBlock("preflight");
    assert.doesNotMatch(
      preflight,
      /environment:/,
      "preflight must not use the release environment, or a rejected ref hides the diagnostic",
    );
    assert.match(preflight, /runs-on:\s*ubuntu-latest/);
    assert.match(preflight, /check-release-preflight\.mjs/);
    assert.match(preflight, /--environment release/);
    assert.match(preflight, /GH_TOKEN:\s*\$\{\{\s*github\.token\s*\}\}/);
  });

  it("proves the tagged commit is merged into main, with the history to do it", () => {
    const preflight = jobBlock("preflight");
    assert.match(preflight, /--on-base origin\/main/);
    assert.match(
      preflight,
      /fetch-depth:\s*0/,
      "containment against origin/main needs full history",
    );
  });

  it("gates the Windows build on the preflight job", () => {
    const build = jobBlock("windows-nsis");
    assert.match(build, /needs:\s*preflight/);
    assert.match(build, /runs-on:\s*windows-latest/);
  });

  it("keeps the release environment (and its reviewers) on the job that holds the secrets", () => {
    const build = jobBlock("windows-nsis");
    assert.match(build, /environment:\s*\n\s*name:\s*release/);
    assert.match(build, /secrets\.ISSUEBRIDGE_GITHUB_CLIENT_ID/);
    assert.match(build, /secrets\.ISSUEBRIDGE_OAUTH_EXCHANGE_URL/);
    assert.doesNotMatch(
      build,
      /ISSUEBRIDGE_GITHUB_CLIENT_SECRET/,
      "the App client secret is never baked into a release build",
    );
  });

  it("grants contents:write only to the job that publishes the Release", () => {
    assert.match(yml, /^permissions:\s*\n\s*contents:\s*read\s*$/m);
    assert.doesNotMatch(jobBlock("preflight"), /contents:\s*write/);
    assert.match(jobBlock("windows-nsis"), /contents:\s*write/);
  });
});

describe("installer-before-publication ordering (#126)", () => {
  const build = jobBlock("windows-nsis");

  it("verifies the installer before any Release is touched", () => {
    assert.match(build, /check-release-asset\.mjs/);
    assert.ok(
      stepIndex(build, "Verify installer") <
        stepIndex(build, "Attach setup.exe to the GitHub Release"),
      "the installer must be verified before the asset upload",
    );
  });

  it("attaches the installer before flipping the Release out of draft", () => {
    assert.ok(
      stepIndex(build, "Attach setup.exe to the GitHub Release") <
        stepIndex(build, "Publish Release once the installer is attached"),
      "publication must come last so no Release is ever left assetless",
    );
  });

  it("uploads the setup.exe from the NSIS bundle path and fails when it is missing", () => {
    const artifact = stepBlock(build, "Upload setup.exe (Actions artifact)");
    assert.match(
      artifact,
      /path:\s*src-tauri\/target\/release\/bundle\/nsis\/\*-setup\.exe/,
    );
    assert.match(artifact, /if-no-files-found:\s*error/);

    const attach = stepBlock(build, "Attach setup.exe to the GitHub Release");
    assert.match(
      attach,
      /files:\s*src-tauri\/target\/release\/bundle\/nsis\/\*-setup\.exe/,
    );
    assert.match(attach, /fail_on_unmatched_files:\s*true/);
  });

  it("refuses to publish a Release that carries no installer asset", () => {
    const publish = stepBlock(
      build,
      "Publish Release once the installer is attached",
    );
    assert.match(publish, /-setup\.exe/);
    assert.match(publish, /::error::/);
    assert.match(publish, /exit 1/);
    assert.match(publish, /gh release edit "\$TAG" --draft=false/);
  });

  it("only touches a Release for tag refs, never for a manual dispatch", () => {
    for (const heading of [
      "Release notes from CHANGELOG",
      "Resolve existing Release state",
      "Attach setup.exe to the GitHub Release",
      "Publish Release once the installer is attached",
    ]) {
      assert.match(
        stepBlock(build, heading),
        /if:\s*startsWith\(github\.ref,\s*'refs\/tags\/'\)/,
        `${heading} must be tag-only`,
      );
    }
  });
});

describe("rerun safety and pre-release behavior (#126)", () => {
  const build = jobBlock("windows-nsis");

  it("keeps an already-published Release published instead of re-drafting it", () => {
    const state = stepBlock(build, "Resolve existing Release state");
    assert.match(state, /set -euo pipefail/);
    assert.match(state, /gh api "\$releases"/);
    assert.match(state, /echo "exists=\$exists"/);
    assert.match(state, /echo "draft=\$draft"/);
    // jq's `//` also fires on a literal false, which is the published Release
    // we must not re-draft; the branch must be on length, not on the value.
    assert.doesNotMatch(state, /\.draft\]\s*\|\s*first \/\/ true/);
    assert.match(state, /if length == 0 then true else \.\[0\] end/);

    const attach = stepBlock(build, "Attach setup.exe to the GitHub Release");
    assert.match(
      attach,
      /draft:\s*\$\{\{\s*steps\.release_state\.outputs\.draft\s*\}\}/,
    );
  });

  it("marks alpha/beta/rc tags as pre-releases", () => {
    const attach = stepBlock(build, "Attach setup.exe to the GitHub Release");
    assert.match(
      attach,
      /prerelease:\s*\$\{\{\s*contains\(github\.ref_name,\s*'-'\)\s*\}\}/,
    );
  });

  it("marks only stable tags latest, at publish time where the flag applies", () => {
    const publish = stepBlock(
      build,
      "Publish Release once the installer is attached",
    );
    assert.match(publish, /latest=false/);
    assert.match(publish, /latest=true/);
    assert.match(publish, /--latest="\$latest"/);
    // make_latest on a still-draft Release is inert; the flag belongs on publish.
    assert.doesNotMatch(build, /make_latest:/);
  });

  it("seeds the Release body from CHANGELOG.md only when it creates the Release", () => {
    const notes = stepBlock(build, "Release notes from CHANGELOG");
    assert.match(notes, /--notes-out release-notes\.md/);
    assert.match(notes, /body_path=release-notes\.md/);

    const attach = stepBlock(build, "Attach setup.exe to the GitHub Release");
    assert.match(
      attach,
      /body_path:\s*\$\{\{\s*steps\.release_state\.outputs\.exists\s*==\s*'false'\s*&&\s*steps\.notes\.outputs\.body_path\s*\|\|\s*''\s*\}\}/,
      "an existing Release must keep the notes a maintainer wrote",
    );
  });
});

describe("release preflight is reachable outside CI (#126)", () => {
  const pkg = JSON.parse(readRepo("package.json"));

  it("exposes preflight and contract scripts", () => {
    assert.equal(typeof pkg.scripts["preflight:release"], "string");
    assert.match(
      pkg.scripts["preflight:release"],
      /check-release-preflight\.mjs/,
    );
    assert.match(pkg.scripts["preflight:release"], /--git/);
    assert.equal(typeof pkg.scripts["test:release-contract"], "string");
    assert.match(
      pkg.scripts["test:release-contract"],
      /release-preflight\.test\.mjs/,
    );
    assert.match(
      pkg.scripts["test:release-contract"],
      /release-workflow-contract\.test\.mjs/,
    );
  });

  it("runs the release contract in the CI gate", () => {
    assert.match(pkg.scripts.ci, /test:release-contract/);
    assert.match(
      readRepo(".github", "workflows", "ci.yml"),
      /npm run test:release-contract/,
    );
  });
});

describe("release procedure documentation (#126)", () => {
  const doc = readRepo("docs", "release-process.md");

  it("documents the tag ref type the release environment must allow", () => {
    assert.match(doc, /Deployment branches and tags/i);
    assert.match(doc, /\bTag\b/);
    assert.match(doc, /v\*/);
    assert.match(doc, /is not allowed to deploy to release/);
  });

  it("documents the preflight command and the tag-to-publish order", () => {
    assert.match(doc, /npm run preflight:release/);
    assert.match(doc, /check-release-asset\.mjs|Verify installer/);
    assert.match(doc, /draft/i);
  });

  it("documents rerun safety and how to verify the final asset", () => {
    assert.match(doc, /re-?run/i);
    assert.match(doc, /-setup\.exe/);
    assert.match(doc, /gh release view/);
  });

  it("is linked from the release skill and the README", () => {
    assert.match(
      readRepo(".agents", "skills", "release", "SKILL.md"),
      /docs\/release-process\.md/,
    );
    assert.match(readRepo("README.md"), /docs\/release-process\.md/);
  });
});

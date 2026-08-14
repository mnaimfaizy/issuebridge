/**
 * Help coverage contract (#146): a user-facing surface may not ship without
 * either a Help topic or a written opt-out.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  checkHelpCoverage,
  commandSurfaces,
  coverageEntries,
  destinationSurfaces,
  expectedSurfaces,
  helpTopicIds,
  settingsSurfaces,
} from "./help-coverage.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function readSrc(...parts) {
  const path = join(root, "src", ...parts);
  assert.ok(existsSync(path), `expected ${path} to exist`);
  return readFileSync(path, "utf8");
}

describe("Help coverage drift check (#146)", () => {
  it("every Settings section, Destination, and command is accounted for", () => {
    const problems = checkHelpCoverage();
    assert.deepEqual(
      problems,
      [],
      `Help coverage is out of date:\n  - ${problems.join("\n  - ")}`,
    );
  });

  it("surface collection actually finds the shipped surfaces", () => {
    assert.ok(
      settingsSurfaces().includes("settings:RewriteModelsSection"),
      "expected Rewrite models section",
    );
    assert.deepEqual(destinationSurfaces(), [
      "destination:help",
      "destination:inbox",
      "destination:settings",
    ]);
    const commands = commandSurfaces();
    assert.ok(commands.includes("command:get_rewrite_model_status"));
    assert.ok(commands.includes("command:publish_draft"));
    assert.ok(commands.length > 20, "expected the full command surface");
  });

  it("manifest covers each surface exactly once with a status", () => {
    const entries = coverageEntries();
    const surfaces = entries.map((entry) => entry.surface);
    assert.equal(
      new Set(surfaces).size,
      surfaces.length,
      "duplicate manifest entries",
    );
    assert.equal(surfaces.length, expectedSurfaces().length);
    for (const entry of entries) {
      assert.ok(
        entry.status === "covered" ||
          entry.status === "intentionally-not-user-facing",
        `${entry.surface} needs a known status`,
      );
    }
  });

  it("opt-outs are explicit and explained, never silent", () => {
    const optOuts = coverageEntries().filter(
      (entry) => entry.status === "intentionally-not-user-facing",
    );
    assert.ok(optOuts.length > 0, "expected internal plumbing to be opted out");
    for (const entry of optOuts) {
      assert.ok(
        entry.note && entry.note.length > 10,
        `${entry.surface} opt-out needs a note`,
      );
    }
  });

  it("covered entries point at real Help topics that the page renders", () => {
    const topics = new Set(helpTopicIds());
    assert.ok(topics.size > 5, "expected a multi-topic Help page");
    for (const entry of coverageEntries()) {
      if (entry.status !== "covered") continue;
      assert.ok(
        topics.has(entry.topicId),
        `${entry.surface} points at unknown topic ${entry.topicId}`,
      );
    }
    const help = readSrc("help", "HelpPage.tsx");
    assert.match(help, /HELP_TOPICS/);
    assert.match(help, /helpContent/);
  });

  it("the manifest lives in TypeScript beside the content it maps", () => {
    assert.ok(existsSync(join(root, "src", "help", "helpCoverage.ts")));
    assert.ok(existsSync(join(root, "src", "help", "helpContent.ts")));
    const manifest = readSrc("help", "helpCoverage.ts");
    assert.match(manifest, /HelpCoverageEntry/);
    assert.match(manifest, /intentionally-not-user-facing/);
  });

  it("a repo-local skill documents how to respond to a failure", () => {
    const skill = join(root, ".agents", "skills", "help-coverage", "SKILL.md");
    assert.ok(existsSync(skill), "expected the help-coverage skill");
    const source = readFileSync(skill, "utf8");
    assert.match(source, /helpCoverage\.ts/);
    assert.match(source, /helpContent\.ts/);
    assert.match(source, /help-coverage/);
  });

  it("npm exposes the check as its own script", () => {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    assert.match(pkg.scripts["test:help-coverage"], /help-coverage\.test\.mjs/);
    assert.match(pkg.scripts.ci, /test:help-coverage/);
  });
});

/**
 * The 1Password wrapper for local development: what it asks `op` to run, and
 * what it refuses, checked without 1Password installed.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  planRun,
  REFERENCES_FILE,
  TEMPLATE_FILE,
} from "./run-with-1password.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const command = ["npm", "run", "tauri", "dev"];
const present = () => true;
const absent = () => false;

describe("1Password development wrapper", () => {
  it("runs the command with the developer's own references file", () => {
    const plan = planRun({
      root: "/repo",
      platform: "linux",
      command,
      exists: present,
    });
    assert.equal(plan.file, "op");
    assert.deepEqual(plan.args, [
      "run",
      `--env-file=${join("/repo", REFERENCES_FILE)}`,
      "--",
      ...command,
    ]);
  });

  it("starts the command through a shell on Windows, where npm is a .cmd shim", () => {
    const { args } = planRun({
      root: "C:\\repo",
      platform: "win32",
      command,
      exists: present,
    });
    assert.deepEqual(args.slice(2), [
      "--",
      "cmd.exe",
      "/d",
      "/s",
      "/c",
      ...command,
    ]);
  });

  it("explains how to create the references file when it is missing", () => {
    assert.throws(
      () => planRun({ root, platform: "win32", command, exists: absent }),
      (error) =>
        error.message.includes(`${REFERENCES_FILE} not found`) &&
        error.message.includes(TEMPLATE_FILE) &&
        error.message.includes("Copy Secret Reference"),
    );
  });

  it("refuses to run with no command", () => {
    assert.throws(
      () => planRun({ root, platform: "linux", command: [], exists: present }),
      /No command given/,
    );
  });

  it("commits the template and nothing that names a real vault", () => {
    const tracked = execFileSync("git", ["ls-files", "-z"], {
      cwd: root,
      encoding: "utf8",
    })
      .split("\0")
      .filter(Boolean);
    // The template is the only env file in the tree: each developer's own
    // references, and any plaintext env file, stay out of it.
    assert.deepEqual(
      tracked.filter((path) => /(^|\/)\.env(\.|$)/.test(path)),
      [TEMPLATE_FILE],
    );
    const ignored = readFileSync(join(root, ".gitignore"), "utf8");
    assert.match(ignored, /^\.env$/m);
    assert.match(ignored, /^\.env\.\*$/m);
    assert.match(ignored, /^!\.env\.op\.example$/m);

    // Every assignment in the template is a placeholder secret reference or a
    // comment: it can be committed because it holds no value and names no
    // real vault.
    const template = readFileSync(join(root, TEMPLATE_FILE), "utf8");
    const assignments = template
      .split(/\r?\n/)
      .map((line) => line.replace(/^#\s?/, ""))
      .filter((line) => /^[A-Z_]+=/.test(line));
    assert.ok(
      assignments.length > 0,
      "expected the template to list variables",
    );
    for (const line of assignments) {
      assert.match(
        line,
        /^ISSUEBRIDGE_[A-Z_]+="op:\/\/<vault>\/<item>\/<field>"$/,
        `${line} must be a placeholder secret reference`,
      );
    }

    const scripts = JSON.parse(
      readFileSync(join(root, "package.json"), "utf8"),
    ).scripts;
    assert.equal(
      scripts["dev:op"],
      "node scripts/run-with-1password.mjs npm run tauri dev",
    );
  });
});

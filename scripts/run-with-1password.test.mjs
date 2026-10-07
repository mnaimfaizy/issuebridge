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
import { ENVIRONMENT_VARIABLE, planRun } from "./run-with-1password.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ID = "abcdefghij0123456789klmnop";
const command = ["npm", "run", "tauri", "dev"];

describe("1Password development wrapper", () => {
  it("runs the command under the Environment named on this machine", () => {
    assert.deepEqual(
      planRun({
        env: { [ENVIRONMENT_VARIABLE]: ID },
        platform: "linux",
        command,
      }),
      { file: "op", args: ["run", "--environment", ID, "--", ...command] },
    );
  });

  it("starts the command through a shell on Windows, where npm is a .cmd shim", () => {
    const { args } = planRun({
      env: { [ENVIRONMENT_VARIABLE]: ` ${ID}\r\n` },
      platform: "win32",
      command,
    });
    assert.deepEqual(args, [
      "run",
      "--environment",
      ID,
      "--",
      "cmd.exe",
      "/d",
      "/s",
      "/c",
      ...command,
    ]);
  });

  it("explains how to set the variable when it is missing", () => {
    for (const env of [{}, { [ENVIRONMENT_VARIABLE]: "   " }]) {
      assert.throws(
        () => planRun({ env, platform: "win32", command }),
        (error) =>
          error.message.includes(`${ENVIRONMENT_VARIABLE} is not set`) &&
          error.message.includes("Copy environment ID"),
      );
    }
  });

  it("refuses a value that is not an ID, so it can never be read as a flag", () => {
    for (const value of [
      "--no-masking",
      "-x",
      "id with space",
      "a/b",
      "op://x/y",
    ]) {
      assert.throws(
        () =>
          planRun({
            env: { [ENVIRONMENT_VARIABLE]: value },
            platform: "linux",
            command,
          }),
        /does not look like a 1Password Environment ID/,
        value,
      );
    }
  });

  it("refuses to run with no command", () => {
    assert.throws(
      () =>
        planRun({
          env: { [ENVIRONMENT_VARIABLE]: ID },
          platform: "linux",
          command: [],
        }),
      /No command given/,
    );
  });

  it("commits no Environment ID, and ignores plaintext env files", () => {
    const tracked = execFileSync("git", ["ls-files", "-z"], {
      cwd: root,
      encoding: "utf8",
    })
      .split("\0")
      .filter(Boolean);
    // No env file is tracked: the values live in 1Password, not in the tree.
    assert.deepEqual(
      tracked.filter((path) => /(^|\/)\.env(\.|$)/.test(path)),
      [],
    );
    const ignored = readFileSync(join(root, ".gitignore"), "utf8");
    assert.match(ignored, /^\.env$/m);
    assert.match(ignored, /^\.env\.\*$/m);

    // The npm script names the wrapper and carries no ID of its own.
    const scripts = JSON.parse(
      readFileSync(join(root, "package.json"), "utf8"),
    ).scripts;
    assert.equal(
      scripts["dev:op"],
      "node scripts/run-with-1password.mjs npm run tauri dev",
    );
    for (const file of [
      "README.md",
      "package.json",
      "docs/dev-first-run-reset.md",
    ]) {
      assert.doesNotMatch(
        readFileSync(join(root, file), "utf8"),
        /--environment [a-z0-9]{20,}/,
        `${file} must not carry an Environment ID`,
      );
    }
  });
});

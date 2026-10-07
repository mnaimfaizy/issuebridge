#!/usr/bin/env node
/**
 * Run a command with the variables of a 1Password Environment in its process
 * environment, and nowhere else:
 *
 *   node scripts/run-with-1password.mjs npm run tauri dev
 *
 * The Environment's ID is read from ISSUEBRIDGE_OP_ENVIRONMENT, a variable on
 * the developer's own machine, so no identifier for anyone's 1Password account
 * is committed here. `op run` resolves the variables after 1Password approves
 * the request, hands them to the child process only, and masks their values in
 * its output. Nothing is written to disk, so there is no `.env` file to leak.
 *
 * Local development only. CI and Release builds take their values from GitHub
 * Actions secrets and never run this.
 */

import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const ENVIRONMENT_VARIABLE = "ISSUEBRIDGE_OP_ENVIRONMENT";

const SETUP = `Set it once to your 1Password Environment's ID (1Password app →
Developer → View Environments → your environment → Manage environment →
Copy environment ID):

  PowerShell:  [Environment]::SetEnvironmentVariable("${ENVIRONMENT_VARIABLE}", "<id>", "User")
  bash/zsh:    export ${ENVIRONMENT_VARIABLE}=<id>   # in your shell profile

then open a new terminal. See README.md, "Secrets from 1Password".`;

/**
 * The `op` invocation for a command, or an Error explaining what is missing.
 * Pure, so the argument handling is tested without 1Password installed.
 */
export function planRun({ env, platform, command }) {
  if (command.length === 0) {
    throw new Error(
      "No command given. Usage: node scripts/run-with-1password.mjs <command> [args...]",
    );
  }
  const id = (env[ENVIRONMENT_VARIABLE] ?? "").trim();
  if (id === "") {
    throw new Error(`${ENVIRONMENT_VARIABLE} is not set.\n\n${SETUP}`);
  }
  // An ID is letters and digits. Anything else is a mistake — and a value
  // starting with `-` would be read by `op` as a flag rather than an ID.
  if (!/^[A-Za-z0-9]+$/.test(id)) {
    throw new Error(
      `${ENVIRONMENT_VARIABLE} does not look like a 1Password Environment ID.\n\n${SETUP}`,
    );
  }
  // `op run` starts the program directly. On Windows `npm` and its kin are
  // `.cmd` shims, which only a shell can start.
  const child =
    platform === "win32" ? ["cmd.exe", "/d", "/s", "/c", ...command] : command;
  return { file: "op", args: ["run", "--environment", id, "--", ...child] };
}

function main(command) {
  let plan;
  try {
    plan = planRun({ env: process.env, platform: process.platform, command });
  } catch (error) {
    console.error(error.message);
    return 2;
  }
  const result = spawnSync(plan.file, plan.args, { stdio: "inherit" });
  if (result.error?.code === "ENOENT") {
    console.error(
      "The 1Password CLI (`op`) was not found. Install it (`winget install 1password-cli`), " +
        "turn on Settings → Developer → Integrate with 1Password CLI in the 1Password app, " +
        "and open a new terminal.",
    );
    return 127;
  }
  if (result.error) {
    console.error(`Could not start the 1Password CLI: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = main(process.argv.slice(2));
}

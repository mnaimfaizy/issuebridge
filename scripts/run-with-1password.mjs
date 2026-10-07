#!/usr/bin/env node
/**
 * Run a command with secrets from 1Password in its process environment, and
 * nowhere else:
 *
 *   node scripts/run-with-1password.mjs npm run tauri dev
 *
 * `.env.op` in the repository root names each variable and where its value
 * lives in 1Password, as a secret reference (`op://vault/item/field`). It
 * holds no secret itself. `op run` resolves the references after 1Password
 * approves the request, hands the values to the child process only, and masks
 * them in its output — nothing is written to disk.
 *
 * `.env.op` is each developer's own and is git-ignored, so no vault or item
 * name from anyone's 1Password account is committed here. `.env.op.example`
 * is the template.
 *
 * Local development only. CI and Release builds take their values from GitHub
 * Actions secrets and never run this.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const REFERENCES_FILE = ".env.op";
export const TEMPLATE_FILE = ".env.op.example";

/**
 * The `op` invocation for a command, or an Error explaining what is missing.
 * Pure apart from `exists`, so it is tested without 1Password installed.
 */
export function planRun({ root, platform, command, exists = existsSync }) {
  if (command.length === 0) {
    throw new Error(
      "No command given. Usage: node scripts/run-with-1password.mjs <command> [args...]",
    );
  }
  const references = join(root, REFERENCES_FILE);
  if (!exists(references)) {
    throw new Error(
      `${REFERENCES_FILE} not found.\n\n` +
        `Copy ${TEMPLATE_FILE} to ${REFERENCES_FILE} and point each variable at your own\n` +
        "1Password item (in the 1Password app: the field's menu → Copy Secret Reference).\n" +
        `${REFERENCES_FILE} is git-ignored. See README.md, "Secrets from 1Password".`,
    );
  }
  // `op run` starts the program directly. On Windows `npm` and its kin are
  // `.cmd` shims, which only a shell can start.
  const child =
    platform === "win32" ? ["cmd.exe", "/d", "/s", "/c", ...command] : command;
  return {
    file: "op",
    args: ["run", `--env-file=${references}`, "--", ...child],
  };
}

function main(command) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  let plan;
  try {
    plan = planRun({ root, platform: process.platform, command });
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

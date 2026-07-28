/**
 * Gate for official release builds: packaging contract + injected credentials.
 * Exit 0 only when both pass.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkPackagingContract,
  checkReleaseCredentials,
} from "./packaging-contract.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const creds = checkReleaseCredentials(process.env);
if (!creds.ok) {
  console.error(creds.errors.join("\n"));
  process.exit(1);
}

const config = JSON.parse(
  readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf8"),
);
const packaging = checkPackagingContract(config);
if (!packaging.ok) {
  console.error(packaging.errors.join("\n"));
  process.exit(1);
}

console.log("Packaging contract and release credentials OK.");

/**
 * Installer gate before a Release is published (issue #126).
 *
 * A successful Release must never be left assetless or carrying a stale
 * installer, so the bundle is verified before the asset upload and publish.
 *
 * Usage:
 *   node scripts/check-release-asset.mjs --ref refs/tags/v0.3.1
 *   node scripts/check-release-asset.mjs --dir src-tauri/target/release/bundle/nsis
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkInstallerAssets,
  flagValue,
  parseReleaseTag,
} from "./release-preflight.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);

const ref = flagValue(argv, "ref", process.env.GITHUB_REF ?? "");
const bundleDir = flagValue(
  argv,
  "dir",
  "src-tauri/target/release/bundle/nsis",
);

const parsed = parseReleaseTag(ref);
const version = parsed.ok
  ? parsed.version
  : JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;

const dir = join(root, bundleDir);
let files = [];
try {
  files = readdirSync(dir).map((name) => ({
    name,
    size: statSync(join(dir, name)).size,
  }));
} catch (error) {
  console.error(
    `Release asset check failed: cannot read ${bundleDir} (${error.message.split("\n")[0]})`,
  );
  process.exit(1);
}

const result = checkInstallerAssets({ files, version });
if (!result.ok) {
  console.error(
    `Release asset check failed:\n  - ${result.errors.join("\n  - ")}`,
  );
  process.exit(1);
}

console.log(`Release asset OK: ${result.installer.name} for ${version}.`);

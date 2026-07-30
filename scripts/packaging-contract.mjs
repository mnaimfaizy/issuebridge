/**
 * v0.1 Windows packaging contract (issue 09).
 * Pure checks over tauri.conf.json shape and release-build env.
 */

const WHISPER_SIDECAR = "binaries/whisper-cli";
const WHISPER_MODEL = "resources/models/ggml-base.bin";

/**
 * @param {unknown} config
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function checkPackagingContract(config) {
  const errors = [];
  const bundle =
    config && typeof config === "object" && "bundle" in config
      ? /** @type {{ bundle?: Record<string, unknown> }} */ (config).bundle
      : undefined;

  if (!bundle || typeof bundle !== "object") {
    return { ok: false, errors: ["bundle missing from tauri config"] };
  }

  const targets = bundle.targets;
  const nsisOnly =
    Array.isArray(targets) && targets.length === 1 && targets[0] === "nsis";
  if (!nsisOnly) {
    errors.push(
      'bundle.targets must be NSIS-only (["nsis"]); "all" also emits MSI which is not a v0.1 deliverable',
    );
  }

  const windows =
    bundle.windows && typeof bundle.windows === "object"
      ? /** @type {Record<string, unknown>} */ (bundle.windows)
      : undefined;
  const nsis =
    windows?.nsis && typeof windows.nsis === "object"
      ? /** @type {Record<string, unknown>} */ (windows.nsis)
      : undefined;
  if (nsis?.installMode !== "currentUser") {
    errors.push(
      'bundle.windows.nsis.installMode must be "currentUser" (per-user, no Admin)',
    );
  }

  const externalBin = Array.isArray(bundle.externalBin)
    ? bundle.externalBin
    : [];
  if (!externalBin.includes(WHISPER_SIDECAR)) {
    errors.push(
      `bundle.externalBin must include "${WHISPER_SIDECAR}" for offline PTT`,
    );
  }

  const resources = Array.isArray(bundle.resources) ? bundle.resources : [];
  if (!resources.includes(WHISPER_MODEL)) {
    errors.push(
      `bundle.resources must include "${WHISPER_MODEL}" for offline PTT`,
    );
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Official release builds inject GitHub App credentials at compile time.
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} env
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function checkReleaseCredentials(env) {
  const errors = [];
  if (!env.ISSUEBRIDGE_GITHUB_CLIENT_ID?.trim()) {
    errors.push(
      "ISSUEBRIDGE_GITHUB_CLIENT_ID must be set for official release builds",
    );
  }
  if (!env.ISSUEBRIDGE_GITHUB_CLIENT_SECRET?.trim()) {
    errors.push(
      "ISSUEBRIDGE_GITHUB_CLIENT_SECRET must be set for official release builds (never commit)",
    );
  }
  return { ok: errors.length === 0, errors };
}

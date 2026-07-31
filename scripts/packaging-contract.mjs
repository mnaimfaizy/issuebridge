/**
 * v0.1 Windows packaging contract (issue 09).
 * Pure checks over tauri.conf.json shape and release-build env.
 */

const WHISPER_SIDECAR = "binaries/whisper-cli";
const WHISPER_MODEL = "resources/models/ggml-base.bin";
const WHISPER_DLL_NAMES = ["whisper.dll", "ggml.dll"];

/**
 * Normalize bundle.resources (array or map) to { source, target } entries.
 * @param {unknown} resources
 * @returns {{ source: string, target: string }[]}
 */
export function resourceEntries(resources) {
  if (Array.isArray(resources)) {
    return resources.map((path) => {
      const s = String(path);
      return { source: s, target: s };
    });
  }
  if (resources && typeof resources === "object") {
    return Object.entries(resources).map(([source, target]) => ({
      source: String(source),
      target: String(target),
    }));
  }
  return [];
}

/**
 * True when Whisper companion DLLs are bundled at the install/resource root
 * (next to externalBin whisper-cli), not nested under binaries/.
 * @param {{ source: string, target: string }[]} entries
 */
export function whisperDllsColocatedWithSidecar(entries) {
  const norm = (p) => p.replace(/\\/g, "/");

  // Map form: binaries/*.dll (or explicit dll sources) → install root.
  const mappedToRoot = entries.some(({ source, target }) => {
    const s = norm(source);
    const t = norm(target);
    if (!s.includes("binaries/") || !s.includes(".dll")) {
      return false;
    }
    return t === "./" || t === "." || t === "" || t === "/";
  });
  if (mappedToRoot) {
    return true;
  }

  // Explicit bare filenames at install root (not binaries/whisper.dll).
  return WHISPER_DLL_NAMES.every((name) =>
    entries.some(({ target }) => {
      const t = norm(target);
      return t === name || t === `./${name}`;
    }),
  );
}

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

  const entries = resourceEntries(bundle.resources);
  const hasModel = entries.some(({ source, target }) => {
    const s = source.replace(/\\/g, "/");
    const t = target.replace(/\\/g, "/");
    return (
      s === WHISPER_MODEL ||
      t === WHISPER_MODEL ||
      s.endsWith("/ggml-base.bin") ||
      t.endsWith("/ggml-base.bin") ||
      t === "ggml-base.bin"
    );
  });
  if (!hasModel) {
    errors.push(
      `bundle.resources must include "${WHISPER_MODEL}" for offline PTT`,
    );
  }

  if (!whisperDllsColocatedWithSidecar(entries)) {
    errors.push(
      'bundle.resources must place Whisper DLLs at the install root next to whisper-cli (e.g. "binaries/*.dll": "./"), not under binaries/',
    );
  }

  // Guard against the 0.1.0 layout that put DLLs under binaries/ and broke PTT (#55).
  const nestedDllTarget = entries.some(({ source, target }) => {
    const s = source.replace(/\\/g, "/");
    const t = target.replace(/\\/g, "/");
    return (
      (s === "binaries/whisper.dll" && t === "binaries/whisper.dll") ||
      t === "binaries/whisper.dll" ||
      t.endsWith("/binaries/whisper.dll")
    );
  });
  if (nestedDllTarget) {
    errors.push(
      'bundle.resources must not nest whisper.dll under binaries/ (Windows loads it next to whisper-cli; see #55)',
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

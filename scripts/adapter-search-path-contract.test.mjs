// Contract: system executables and modules in the OS-facing adapters are
// resolved from a trusted location, never a bare name. Concept:
// unqualified-system-binary-search-order (GHSA-2q8x-c52g-8xv6).
//
// Windows resolves a bare `Command` name through the application directory,
// then the parent process's working directory, and only then `System32`; a bare
// `LoadLibraryW` reaches the working directory and PATH once the module is
// absent from `System32`. A directory the app was started from, or a PATH entry,
// is writable by a party who cannot write the install directory, so a bare name
// there is preferred over the real binary/module and runs in-process as the
// signed-in user. Anchoring each system binary to its OS location, and loading
// the probe module with a System32-only search, removes that search.
//
// These are static assertions over the adapter source: the runtime win requires
// planting and executing a substituted binary, which the triage rules forbid, so
// the control is asserted at the source instead.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const readRepo = (...p) => readFileSync(join(root, ...p), "utf8");

const SPAWN_SITES = [
  "src-tauri/src/adapters/whisper_voice.rs",
  "src-tauri/src/adapters/llama_rewrite.rs",
];
const PROBE = "src-tauri/src/adapters/system_hardware_probe.rs";
const MOD = "src-tauri/src/adapters/mod.rs";
const HELPER = "src-tauri/src/adapters/system_exec.rs";

describe("adapter system search-path contract", () => {
  it("spawns stock system binaries through a resolver, never a bare name", () => {
    for (const path of SPAWN_SITES) {
      const src = readRepo(path);
      // taskkill / kill appear only in production process-termination code;
      // no test in these files spawns them, so a whole-file check is exact.
      assert.doesNotMatch(
        src,
        /Command::new\("taskkill"\)/,
        `${path} spawns taskkill by bare name`,
      );
      assert.doesNotMatch(
        src,
        /Command::new\("kill"\)/,
        `${path} spawns kill by bare name`,
      );
      assert.match(
        src,
        /system_command\(/,
        `${path} must resolve system binaries through system_command()`,
      );
    }
  });

  it("loads the probe module with a System32-only search", () => {
    const src = readRepo(PROBE);
    assert.match(
      src,
      /LOAD_LIBRARY_SEARCH_SYSTEM32/,
      "probe must constrain the module load to System32",
    );
    assert.doesNotMatch(
      src,
      /\bLoadLibraryW\b/,
      "probe must not use the unqualified LoadLibraryW loader",
    );
    assert.match(
      src,
      /\bLoadLibraryExW\b/,
      "probe must use LoadLibraryExW with a search flag",
    );
  });

  it("provides the resolver as a registered adapter module", () => {
    assert.match(
      readRepo(MOD),
      /mod system_exec;/,
      "system_exec must be registered in adapters/mod.rs",
    );
    const helper = readRepo(HELPER);
    assert.match(
      helper,
      /fn system_command\(/,
      "system_exec must expose system_command()",
    );
    // The Windows resolver must anchor to the system directory, not a bare name.
    assert.match(
      helper,
      /System32/,
      "the Windows resolver must anchor to the system directory",
    );
  });
});

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
// the control is asserted at the source instead. The bare-spawn scan is a literal
// tripwire against the obvious revert (`Command::new("taskkill")`), not a proof —
// a binding through a variable (`let p = "taskkill"; Command::new(p)`) would slip
// past it. It is exact today because no adapter spawns `taskkill`/`kill` other
// than the two production `kill_process` sites; the `ping`/`sleep`/`echo` test
// helpers are `#[cfg(test)]` and out of the threat model. Assertions match code
// expressions, never a doc comment, so reverting the fix cannot leave prose that
// keeps the check green.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const readRepo = (...p) => readFileSync(join(root, ...p), "utf8");

const ADAPTERS_DIR = "src-tauri/src/adapters";
const PROBE = join(ADAPTERS_DIR, "system_hardware_probe.rs");
const MOD = join(ADAPTERS_DIR, "mod.rs");
const HELPER = join(ADAPTERS_DIR, "system_exec.rs");

// The adapters whose `kill_process` terminates a sidecar; each must route the
// spawn through the resolver. Not an exhaustive list of adapters — the bare-name
// prohibition below covers every adapter file, present and future.
const PROCESS_TERMINATION_SITES = ["whisper_voice.rs", "llama_rewrite.rs"];

function adapterRustFiles() {
  return readdirSync(join(root, ADAPTERS_DIR)).filter((f) => f.endsWith(".rs"));
}

describe("adapter system search-path contract", () => {
  it("no adapter spawns a process-termination binary by bare name", () => {
    const files = adapterRustFiles();
    // Guard the glob itself: an empty or trivially small set would pass vacuously.
    assert.ok(
      files.length >= 3,
      `expected several adapters, found ${files.length}`,
    );
    for (const f of files) {
      const src = readRepo(ADAPTERS_DIR, f);
      assert.doesNotMatch(
        src,
        /Command::new\("taskkill"\)/,
        `${f} spawns taskkill by bare name`,
      );
      assert.doesNotMatch(
        src,
        /Command::new\("kill"\)/,
        `${f} spawns kill by bare name`,
      );
    }
  });

  it("process-termination adapters resolve the binary through system_command()", () => {
    for (const f of PROCESS_TERMINATION_SITES) {
      const src = readRepo(ADAPTERS_DIR, f);
      // Bind to a call site (`= system_command(`), not a mention in a comment.
      assert.match(
        src,
        /=\s*system_command\(/,
        `${f} must call system_command() to resolve the binary`,
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

  it("provides the resolver as a registered adapter module anchored to System32", () => {
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
    // Anchor to the resolver expressions, not the doc comment: the Windows path
    // must be composed under System32 and read from the protected system root.
    assert.match(
      helper,
      /\.join\("System32"\)/,
      "the Windows resolver must compose the path under System32",
    );
    assert.match(
      helper,
      /var_os\("SystemRoot"\)/,
      "the Windows resolver must read the system root from the protected variable",
    );
    assert.match(
      helper,
      /is_absolute\(\)/,
      "the Windows resolver must reject a relative SystemRoot",
    );
  });
});

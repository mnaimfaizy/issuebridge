// Contract: the shipped HTTPS client never resolves a TLS trust store or path
// verifier that a published distrust advisory covers. Concept:
// webpki-emsign-distrusted-intermediates (GHSA-qjfg-cj55-r52v).
//
// The app's only HTTPS stack is `reqwest` with `rustls-tls`, which verifies
// against the trust store bundled in `webpki-roots` rather than the Windows
// certificate store, so a CA distrust reaches users only through a dependency
// bump. RUSTSEC-2026-0381 (webpki-roots, patched in 1.0.10) and
// RUSTSEC-2026-0382 (rustls-webpki, patched in 0.103.16 and 0.104.0-alpha.8)
// cover the emSign distrust; the affected ranges below keep the lockfile from
// resolving an affected version again.
//
// These are static assertions over `src-tauri/Cargo.lock`: proving the trust
// decision at runtime needs a certificate chain the triage rules do not allow us
// to build, so the control is asserted on the resolved versions instead. While
// reqwest enables `rustls-tls` both crates must be present, so a lockfile the
// parser cannot read fails rather than passing with nothing checked.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const readRepo = (...p) => readFileSync(join(root, ...p), "utf8");

const lock = readRepo("src-tauri", "Cargo.lock");
const manifest = readRepo("src-tauri", "Cargo.toml");

function lockedVersions(name) {
  const re = /\[\[package\]\]\r?\nname = "([^"]+)"\r?\nversion = "([^"]+)"/g;
  return [...lock.matchAll(re)].filter((m) => m[1] === name).map((m) => m[2]);
}

// [major, minor, patch, pre] where pre is the alpha number, or Infinity for a release.
function parseCrateVersion(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-alpha\.(\d+))?$/.exec(version);
  assert.ok(m, `unrecognised version shape: ${version}`);
  return [+m[1], +m[2], +m[3], m[4] === undefined ? Infinity : +m[4]];
}

function compareCrateVersions(a, b) {
  const pa = parseCrateVersion(a);
  const pb = parseCrateVersion(b);
  for (let i = 0; i < 4; i++)
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  return 0;
}

// Affected ranges as [from inclusive, to exclusive): everything the RustSec
// advisories neither patch nor list as unaffected (webpki-roots 0.26.11 is a
// re-export shim over its 1.x parent, which the second range covers).
const AFFECTED = {
  "webpki-roots": [
    ["0.0.0", "0.26.11"],
    ["0.26.12", "1.0.10"],
  ],
  "rustls-webpki": [
    ["0.0.0", "0.103.16"],
    ["0.104.0-alpha.0", "0.104.0-alpha.8"],
  ],
};

const usesRustlsTls = /^reqwest = \{[^\n]*"rustls-tls"/m.test(manifest);

describe("shipped TLS trust store", () => {
  it("reqwest still verifies through rustls, which these ranges govern", () => {
    assert.ok(
      usesRustlsTls,
      "reqwest no longer enables rustls-tls; revisit this contract",
    );
  });

  for (const [name, ranges] of Object.entries(AFFECTED)) {
    it(`${name} resolves outside every distrust advisory range`, () => {
      const versions = lockedVersions(name);
      // While rustls-tls is on, both crates must be found, so a parse miss cannot pass.
      if (usesRustlsTls)
        assert.ok(versions.length > 0, `${name} not found in Cargo.lock`);
      for (const version of versions) {
        for (const [from, to] of ranges) {
          const affected =
            compareCrateVersions(version, from) >= 0 &&
            compareCrateVersions(version, to) < 0;
          assert.ok(
            !affected,
            `${name} ${version} is inside affected range [${from}, ${to})`,
          );
        }
      }
    });
  }
});

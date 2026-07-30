import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function readWorkflow() {
  return readFileSync(join(root, ".github", "workflows", "ci.yml"), "utf8");
}

function readPackageJson() {
  return JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
}

/** Extract a top-level job block by name from workflow YAML. */
function jobBlock(yml, name) {
  const start = yml.search(new RegExp(`^  ${name}:\\s*$`, "m"));
  assert.ok(start >= 0, `expected job ${name}`);
  const rest = yml.slice(start + 1);
  const next = rest.search(/^  [a-zA-Z0-9_-]+:\s*$/m);
  return next < 0 ? yml.slice(start) : yml.slice(start, start + 1 + next);
}

describe("PR CI workflow contract (#24)", () => {
  it("triggers on pull_request and push to main", () => {
    const yml = readWorkflow();
    assert.match(yml, /\bpull_request\b/);
    assert.match(yml, /\bpush\b/);
    assert.match(yml, /\bbranches:\s*\n\s*-\s*main\b/);
  });

  it("runs frontend, rust, and ci gate on ubuntu-latest without a prepare job", () => {
    const yml = readWorkflow();
    assert.match(yml, /^\s*frontend:\s*$/m);
    assert.match(yml, /^\s*rust:\s*$/m);
    assert.match(yml, /^\s*ci:\s*$/m);
    assert.doesNotMatch(yml, /^\s*prepare:\s*$/m);
    assert.match(yml, /runs-on:\s*ubuntu-latest/);
    assert.doesNotMatch(yml, /runs-on:\s*windows-latest/);
  });

  it("frontend job runs typecheck, contracts, packaging, and Vite build with Node 22 npm cache", () => {
    const yml = readWorkflow();
    const frontend = jobBlock(yml, "frontend");
    assert.match(frontend, /node-version:\s*["']?22["']?/);
    assert.match(frontend, /cache:\s*npm/);
    assert.match(frontend, /npm ci/);
    assert.match(frontend, /npm run typecheck/);
    assert.match(frontend, /npm run test:ui-contracts/);
    assert.match(frontend, /npm run test:packaging/);
    assert.match(frontend, /npm run test:ci-contract/);
    assert.match(frontend, /npm run build/);
    assert.doesNotMatch(frontend, /upload-artifact/);
  });

  it("rust job runs fmt, clippy -D warnings, and cargo test with Tauri Linux deps", () => {
    const yml = readWorkflow();
    const rust = jobBlock(yml, "rust");
    assert.match(rust, /libwebkit2gtk-4\.1-dev/);
    assert.match(rust, /clippy/);
    assert.match(rust, /rustfmt/);
    assert.match(rust, /cargo fmt --all -- --check|cargo fmt --manifest-path src-tauri\/Cargo\.toml --all -- --check/);
    assert.match(rust, /cargo clippy[^\n]*-- -D warnings/);
    assert.match(rust, /cargo test --manifest-path src-tauri\/Cargo\.toml/);
    assert.doesNotMatch(rust, /upload-artifact/);
    assert.doesNotMatch(rust, /tauri build|release-build\.ps1|nsis/i);
  });

  it("ci gate needs frontend and rust", () => {
    const yml = readWorkflow();
    const ci = jobBlock(yml, "ci");
    assert.match(
      ci,
      /needs:\s*\[[^\]]*frontend[^\]]*rust[^\]]*\]/,
    );
  });

  it("package.json exposes npm run ci mirroring the gate", () => {
    const pkg = readPackageJson();
    assert.equal(typeof pkg.scripts.ci, "string");
    assert.equal(typeof pkg.scripts["test:ci-contract"], "string");
    assert.match(pkg.scripts.ci, /fmt/);
    assert.match(pkg.scripts.ci, /clippy/);
    assert.match(pkg.scripts.ci, /-D warnings/);
    assert.match(pkg.scripts.ci, /typecheck/);
    assert.match(pkg.scripts.ci, /test:ui-contracts/);
    assert.match(pkg.scripts.ci, /test:packaging/);
    assert.match(pkg.scripts.ci, /test:ci-contract/);
    assert.match(pkg.scripts.ci, /test:core/);
    assert.match(pkg.scripts.ci, /build/);
  });
});

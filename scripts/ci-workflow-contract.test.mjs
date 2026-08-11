import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function readWorkflow(name = "ci.yml") {
  return readFileSync(join(root, ".github", "workflows", name), "utf8");
}

function readPackageJson() {
  return JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
}

/** Extract a top-level job block by name from workflow YAML. */
function jobBlock(yml, name) {
  const start = yml.search(new RegExp(`^  ${name}:\\s*$`, "m"));
  assert.ok(start >= 0, `expected job ${name}`);
  const rest = yml.slice(start + 1);
  const next = rest.search(/^ {2}[a-zA-Z0-9_-]+:\s*$/m);
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

  it("frontend job runs lint, typecheck, contracts, packaging, and Vite build with Node 22 npm cache", () => {
    const yml = readWorkflow();
    const frontend = jobBlock(yml, "frontend");
    assert.match(frontend, /node-version:\s*["']?22["']?/);
    assert.match(frontend, /cache:\s*npm/);
    assert.match(frontend, /npm ci/);
    assert.match(frontend, /npm run lint/);
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
    assert.match(
      rust,
      /cargo fmt --all -- --check|cargo fmt --manifest-path src-tauri\/Cargo\.toml --all -- --check/,
    );
    assert.match(rust, /cargo clippy[^\n]*-- -D warnings/);
    assert.match(rust, /cargo test --manifest-path src-tauri\/Cargo\.toml/);
    assert.match(rust, /TAURI_CONFIG:/);
    assert.match(rust, /"externalBin":\s*\[\]/);
    assert.match(rust, /"resources":\s*\[\]/);
    assert.doesNotMatch(rust, /upload-artifact/);
    assert.doesNotMatch(rust, /tauri build|release-build\.ps1|nsis/i);
  });

  it("ci gate needs frontend and rust", () => {
    const yml = readWorkflow();
    const ci = jobBlock(yml, "ci");
    assert.match(ci, /needs:\s*\[[^\]]*frontend[^\]]*rust[^\]]*\]/);
  });

  it("package.json exposes npm run ci mirroring the gate", () => {
    const pkg = readPackageJson();
    assert.equal(typeof pkg.scripts.ci, "string");
    assert.equal(typeof pkg.scripts["test:ci-contract"], "string");
    assert.match(pkg.scripts.ci, /fmt/);
    assert.match(pkg.scripts.ci, /clippy/);
    assert.match(pkg.scripts.ci, /-D warnings/);
    assert.match(pkg.scripts.ci, /\blint\b/);
    assert.match(pkg.scripts.ci, /typecheck/);
    assert.match(pkg.scripts.ci, /test:ui-contracts/);
    assert.match(pkg.scripts.ci, /test:packaging/);
    assert.match(pkg.scripts.ci, /test:ci-contract/);
    assert.match(pkg.scripts.ci, /test:core/);
    assert.match(pkg.scripts.ci, /build/);
  });

  it("package.json exposes check-only lint and local format autofix (#48)", () => {
    const pkg = readPackageJson();
    assert.equal(typeof pkg.scripts.lint, "string");
    assert.equal(typeof pkg.scripts.format, "string");
    assert.match(pkg.scripts.lint, /biome/);
    assert.match(pkg.scripts.format, /biome/);
    assert.match(pkg.scripts.format, /--write/);
    assert.doesNotMatch(pkg.scripts.lint, /--write/);
  });
});

describe("Copilot CLI workflow supply-chain contract", () => {
  it("locks one exact Copilot CLI dependency with registry integrity", () => {
    const manifest = JSON.parse(
      readFileSync(
        join(root, ".github", "copilot-cli", "package.json"),
        "utf8",
      ),
    );
    const lock = JSON.parse(
      readFileSync(
        join(root, ".github", "copilot-cli", "package-lock.json"),
        "utf8",
      ),
    );

    assert.deepEqual(manifest.dependencies, { "@github/copilot": "1.0.78" });
    assert.deepEqual(lock.packages[""].dependencies, manifest.dependencies);
    assert.match(
      lock.packages["node_modules/@github/copilot"].integrity,
      /^sha512-/,
    );
  });

  for (const workflowName of ["security-audit.yml", "agent-pipeline.yml"]) {
    it(`${workflowName} installs and runs the lockfile-backed CLI`, () => {
      const yml = readWorkflow(workflowName);

      assert.match(
        yml,
        /npm ci --prefix \.github\/copilot-cli --ignore-scripts --install-strategy=nested/,
      );
      assert.match(
        yml,
        /\.\/\.github\/copilot-cli\/node_modules\/\.bin\/copilot\b/,
      );
      assert.doesNotMatch(yml, /npm install -g @github\/copilot(?:\s|$)/m);
    });
  }
});

describe("PR security-audit privilege contract", () => {
  it("keeps the advisory PAT and PR-controlled runtime out of the audit scan", () => {
    const yml = readWorkflow("security-audit.yml");
    const trustedRuntime = yml.indexOf(
      "Restore trusted audit runtime from PR base",
    );
    const installCli = yml.indexOf("Install locked Copilot CLI");
    const runAudit = yml.indexOf("Run security audit (Copilot CLI)");

    assert.ok(trustedRuntime >= 0, "expected trusted PR runtime restore step");
    assert.ok(trustedRuntime < installCli, "restore must precede CLI install");
    assert.ok(installCli < runAudit, "CLI install must precede audit scan");
    assert.match(
      yml,
      /COPILOT_GITHUB_TOKEN:\s*\$\{\{\s*github\.event_name == 'pull_request'\s*&&\s*github\.token\s*\|\|\s*secrets\.COPILOT_GITHUB_TOKEN\s*\}\}/,
    );

    const restore = yml.slice(trustedRuntime, installCli);
    for (const trustedPath of [
      "AGENTS.md",
      ".github/copilot-instructions.md",
      ".github/copilot-cli",
      ".github/security-audit/prompt.md",
      ".agents/skills/security-audit",
    ]) {
      assert.match(restore, new RegExp(trustedPath.replaceAll(".", "\\.")));
    }

    const scan = yml.slice(runAudit, yml.indexOf("Use trusted publisher"));
    assert.match(scan, /if \[ "\$MODE" = "pr" \]/);
    assert.match(scan, /PR_TOOL_ARGS=/);
    assert.doesNotMatch(
      scan.match(/PR_TOOL_ARGS=[^\n]*/)?.[0] ?? "",
      /shell\((?:cargo|npm|git|find):/,
    );
  });
});

describe("Release workflow supply-chain contract", () => {
  it("pins every third-party action to a full commit SHA", () => {
    const yml = readWorkflow("release-windows.yml");
    const thirdPartyActions = [
      ...yml.matchAll(/^\s*uses:\s*([^/\s]+\/[^@\s]+)@([^\s#]+)/gm),
    ]
      .map(([, action, ref]) => ({ action, ref }))
      .filter(({ action }) => !action.startsWith("actions/"));

    assert.deepEqual(thirdPartyActions.map(({ action }) => action).sort(), [
      "dtolnay/rust-toolchain",
      "softprops/action-gh-release",
    ]);
    for (const { action, ref } of thirdPartyActions) {
      assert.match(
        ref,
        /^[0-9a-f]{40}$/,
        `${action} must use an immutable commit SHA`,
      );
    }
  });
});

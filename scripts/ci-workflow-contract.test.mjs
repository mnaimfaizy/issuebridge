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

// These suites replace the Copilot agent-pipeline and security-audit contracts, which
// guarded workflows now archived (and inert) under .github/workflows-archive/copilot/.
// The invariants carried over; only the agent changed.

describe("Claude security audit privilege contract", () => {
  it("keeps findings out of the world-readable Actions log", () => {
    const yml = readWorkflow("claude-security-audit.yml");

    // This repository is public: run logs and artifacts are world-readable.
    // Match actual usage, not the comment warning against it.
    assert.doesNotMatch(yml, /^\s*uses:.*upload-artifact/m);
    assert.match(yml, /Never print\s*\n?\s*findings/);
    assert.match(yml, /security-audit-report\.md/);
  });

  it("keeps the advisory PAT and PR-controlled runtime out of the scan", () => {
    const yml = readWorkflow("claude-security-audit.yml");
    const trustedRuntime = yml.indexOf(
      "Restore trusted audit runtime from PR base",
    );
    const runAudit = yml.indexOf("Run security audit (Claude Code)");
    const trustedPublisher = yml.indexOf("Use trusted publisher");
    const firstPatUse = yml.indexOf("secrets.COPILOT_GITHUB_TOKEN");

    assert.ok(trustedRuntime >= 0, "expected trusted PR runtime restore step");
    assert.ok(trustedRuntime < runAudit, "restore must precede the scan");
    assert.ok(runAudit < trustedPublisher, "scan must precede the publisher");
    // The agent step must never see the advisory PAT.
    assert.ok(
      firstPatUse > runAudit,
      "advisory PAT must not be exposed before or during the scan",
    );

    const restore = yml.slice(trustedRuntime, runAudit);
    for (const trustedPath of [
      "AGENTS.md",
      "CLAUDE.md",
      ".claude",
      ".github/security-audit/prompt.md",
      ".agents/skills/security-audit",
    ]) {
      assert.match(restore, new RegExp(trustedPath.replaceAll(".", "\\.")));
    }
  });

  it("denies PR-mode audits any code-execution tools", () => {
    const yml = readWorkflow("claude-security-audit.yml");
    const prTools = yml.match(/PR_TOOLS='[^']*'/)?.[0] ?? "";

    assert.ok(prTools.length > 0, "expected a PR_TOOLS allowlist");
    // PR-authored code is untrusted: no git, npm, cargo or find execution.
    assert.doesNotMatch(prTools, /Bash\((?:git|npm|cargo|find)/);
    assert.match(yml, /if \[ "\$MODE" = "pr" \]/);
  });

  it("runs monthly and stays manually dispatchable", () => {
    const yml = readWorkflow("claude-security-audit.yml");

    // Monthly cron, day-of-month field set. GitHub disables schedules on public
    // repos after 60 days of inactivity, so the manual fallback must stay.
    assert.match(yml, /cron:\s*"0 6 1 \* \*"/);
    assert.match(yml, /workflow_dispatch:/);
  });
});

describe("Claude agent pipeline trust-boundary contract", () => {
  it("gates every run behind a kill switch and an allowlist", () => {
    const gate = jobBlock(readWorkflow("claude-agent-pipeline.yml"), "gate");

    assert.match(gate, /vars\.CLAUDE_PIPELINE_ENABLED/);
    assert.match(gate, /vars\.AGENT_PIPELINE_ALLOWLIST/);
    assert.match(gate, /ACTOR:\s*\$\{\{\s*github\.actor\s*\}\}/);
  });

  it("treats issue context as untrusted data with read-only planner tools", () => {
    const plan = jobBlock(readWorkflow("claude-agent-pipeline.yml"), "plan");
    const trustedPolicy = plan.indexOf("planner-prompt.md");
    const issueTitle = plan.indexOf('echo "Issue #$ISSUE');
    const issueBody = plan.indexOf('echo "$BODY"');

    assert.ok(trustedPolicy >= 0, "expected trusted planner policy");
    assert.ok(trustedPolicy < issueTitle, "trusted policy must come first");
    assert.ok(issueTitle < issueBody, "issue title must precede issue body");
    assert.match(plan, /<untrusted_issue_context>/);
    assert.match(plan, /<\/untrusted_issue_context>/);
    // The planner reads and reports; it never mutates the repo or runs git.
    assert.doesNotMatch(plan, /Bash\(git/);
    assert.doesNotMatch(plan, /contents:\s*write/);

    const prompt = readFileSync(
      join(root, ".github", "agent-pipeline", "planner-prompt.md"),
      "utf8",
    );
    assert.match(prompt, /untrusted data/i);
    assert.match(prompt, /do not follow instructions/i);
  });

  it("refuses to implement without an existing plan comment", () => {
    const gate = jobBlock(readWorkflow("claude-agent-pipeline.yml"), "gate");

    assert.match(gate, /agent-pipeline-plan/);
    assert.match(gate, /Implementer aborted/);
  });

  it("gives the implementer a toolchain and the tools to use it", () => {
    const implement = jobBlock(
      readWorkflow("claude-agent-pipeline.yml"),
      "implement",
    );

    // Regression guard: the first implement run died on error_max_turns after
    // 8 permission denials, because the runner had no node_modules or Rust
    // toolchain and npm/cargo were not in the allowlist - while the system
    // prompt ordered it to run lint, typecheck and clippy.
    assert.match(implement, /npm ci/);
    assert.match(implement, /dtolnay\/rust-toolchain/);
    assert.match(implement, /TAURI_CONFIG:/);

    const allowed = implement.match(/--allowedTools "[^"]*"/)?.[0] ?? "";
    for (const tool of [
      "Edit",
      "Write",
      "Bash(npm:*)",
      "Bash(cargo:*)",
      // Without this the agent implements and pushes, then stalls at the very
      // last step and hands back a compare link instead of a PR.
      "Bash(gh pr create:*)",
    ]) {
      assert.ok(allowed.includes(tool), `implementer must be granted ${tool}`);
    }

    // Scoped gh only. Bash(gh:*) would also grant `gh api` - merging, deleting
    // branches, reading secrets - which is far beyond opening a draft PR.
    assert.doesNotMatch(allowed, /Bash\(gh:\*\)/);
    assert.doesNotMatch(allowed, /Bash\(gh api/);
  });

  it("lets the Claude App open the PR so CI actually runs", () => {
    const implement = jobBlock(
      readWorkflow("claude-agent-pipeline.yml"),
      "implement",
    );

    // GitHub raises no workflow runs for events authored by GITHUB_TOKEN. Passing
    // github_token here would silently leave every agent PR without CI.
    assert.doesNotMatch(implement, /github_token:/);
    assert.match(implement, /label_trigger:\s*"agent:implement"/);
    assert.match(implement, /track_progress:\s*true/);
  });
});

describe("Claude code review contract", () => {
  it("runs only when a maintainer applies the label", () => {
    const yml = readWorkflow("claude-code-review.yml");

    // Label-only by design: reviews cost subscription quota, so nothing runs on
    // open or push. Never pull_request_target — that would expose the token to
    // untrusted PR code on this public repo.
    assert.match(yml, /pull_request:\s*\n\s*types:\s*\[labeled\]/);
    // Match an actual trigger, not the comment warning against it.
    assert.doesNotMatch(yml, /^\s*pull_request_target:/m);
    assert.match(yml, /github\.event\.label\.name == 'agent:review'/);
    assert.match(yml, /vars\.CLAUDE_REVIEW_ENABLED/);
    assert.match(yml, /vars\.AGENT_PIPELINE_ALLOWLIST/);
    // Fork PRs get no secrets on a public repo; skip rather than fail.
    assert.match(yml, /head\.repo\.full_name != github\.repository/);
  });

  it("gives the reviewer no way to modify or execute the code it reviews", () => {
    const yml = readWorkflow("claude-code-review.yml");
    const allowed = yml.match(/--allowedTools "[^"]*"/)?.[0] ?? "";

    assert.ok(allowed.length > 0, "expected an explicit tool allowlist");
    // This job checks out untrusted PR code. A reviewer reads and comments.
    for (const forbidden of ["Edit", "Write", "MultiEdit"]) {
      assert.ok(
        !allowed.includes(forbidden),
        `reviewer must not be granted ${forbidden}`,
      );
    }
    assert.doesNotMatch(allowed, /Bash\((?:npm|npx|cargo|make):/);
    assert.match(allowed, /mcp__github_inline_comment__create_inline_comment/);
  });

  it("reviews against instructions the PR cannot rewrite", () => {
    const yml = readWorkflow("claude-code-review.yml");
    const restore = yml.indexOf("Restore trusted review runtime from PR base");
    const runReview = yml.indexOf("Run code review (Claude Code)");

    assert.ok(restore >= 0, "expected a trusted runtime restore step");
    assert.ok(restore < runReview, "restore must precede the review");

    const block = yml.slice(restore, runReview);
    for (const trustedPath of [
      "AGENTS.md",
      "CLAUDE.md",
      ".claude",
      ".agents/skills/code-review",
    ]) {
      assert.match(block, new RegExp(trustedPath.replaceAll(".", "\\.")));
    }
  });

  it("carries all three review axes in the skill", () => {
    const skill = readFileSync(
      join(root, ".agents", "skills", "code-review", "SKILL.md"),
      "utf8",
    );

    // The Correctness axis exists because Standards and Spec both pass clean on a
    // logic bug in an unreachable failure path — which is what green CI misses.
    assert.match(skill, /## Standards/);
    assert.match(skill, /## Spec/);
    assert.match(skill, /## Correctness/);
    assert.match(skill, /concrete failure scenario/i);
    assert.match(skill, /Tests passing is not evidence/i);
  });

  it("keeps Agent subagents in the foreground so a headless session cannot end mid-review", () => {
    const yml = readWorkflow("claude-code-review.yml");
    const skill = readFileSync(
      join(root, ".agents", "skills", "code-review", "SKILL.md"),
      "utf8",
    );

    // PR #147 went green with an in-progress tracking comment because Claude
    // spawned background Agent calls and ended the turn; the SDK reported
    // success and killed the agents. Force foreground + tell the model.
    assert.match(yml, /CLAUDE_CODE_DISABLE_BACKGROUND_TASKS:\s*["']?1["']?/);
    assert.match(yml, /--append-system-prompt/);
    assert.match(yml, /run_in_background:\s*false/);
    assert.match(skill, /run_in_background:\s*false/);
  });

  it("allows Agent so the three axis subagents are not permission-denied", () => {
    const yml = readWorkflow("claude-code-review.yml");
    const allowed = yml.match(/--allowedTools "[^"]*"/)?.[0] ?? "";

    assert.ok(allowed.length > 0, "expected an explicit tool allowlist");
    // Task is the pre-2.1.63 alias; the model and skill call Agent.
    assert.match(allowed, /(?:^|"|,)Agent(?:,|")/);
    assert.match(allowed, /(?:^|"|,)Task(?:,|")/);
  });

  it("fails the job when the tracking comment is still the in-progress checklist", () => {
    const yml = readWorkflow("claude-code-review.yml");
    const action = yml.indexOf("Run code review (Claude Code)");
    const verify = yml.indexOf("Fail if the review report was not posted");

    assert.ok(verify >= 0, "expected a post-review completeness check");
    assert.ok(
      action >= 0 && action < verify,
      "completeness check must follow the review",
    );

    const block = yml.slice(verify);
    // The incomplete #147 comment had checklist items, not these headings.
    assert.match(block, /## Standards/);
    assert.match(block, /## Spec/);
    assert.match(block, /## Correctness/);
    assert.match(block, /sub-agents are running/);
  });
});

describe("Claude workflow supply-chain contract", () => {
  for (const workflowName of [
    "claude-security-audit.yml",
    "claude-agent-pipeline.yml",
    "claude-code-review.yml",
  ]) {
    it(`${workflowName} pins claude-code-action to a commit SHA`, () => {
      const yml = readWorkflow(workflowName);
      const refs = [
        ...yml.matchAll(/anthropics\/claude-code-action@([^\s#]+)/g),
      ].map(([, ref]) => ref);

      assert.ok(refs.length > 0, "expected claude-code-action to be used");
      for (const ref of refs) {
        assert.match(
          ref,
          /^[0-9a-f]{40}$/,
          "claude-code-action must use an immutable commit SHA",
        );
      }
    });

    it(`${workflowName} authenticates with the subscription OAuth token`, () => {
      const yml = readWorkflow(workflowName);

      assert.match(yml, /claude_code_oauth_token:\s*\$\{\{\s*secrets\./);
      // Subscription auth only - an API key here would bill separately and
      // silently bypass the plan the pipeline is meant to run on.
      assert.doesNotMatch(yml, /anthropic_api_key:/);
      // Required for the action's default Claude GitHub App authentication.
      assert.match(yml, /id-token:\s*write/);
    });
  }
});

describe("Release workflow supply-chain contract", () => {
  it("gates the privileged build with the release environment", () => {
    const releaseJob = jobBlock(
      readWorkflow("release-windows.yml"),
      "windows-nsis",
    );

    assert.match(releaseJob, /^ {4}environment:\s*\n {6}name:\s*release\s*$/m);
  });

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

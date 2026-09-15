// Contract for the read-confinement PreToolUse hook that binds the agents'
// Read / Grep / Glob to $GITHUB_WORKSPACE. Concept: agent-allowlist-unscoped-
// read-tools (GHSA-xqww-rh2g-g5v9). The `(./**)` allowlist scoping was inert —
// an allow entry pre-approves and cannot revoke the action's base read grant, so
// confinement has to be a deny decision, which a hook makes on the resolved path.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { decide } from "../.github/agent-runtime/confine-reads-to-workspace.mjs";
import { namedStep } from "./workflow-contract-helpers.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const readRepo = (...p) => readFileSync(join(root, ...p), "utf8");

const SETTINGS_PATH = ".github/agent-runtime/read-confinement.settings.json";
const HOOK_PATH = ".github/agent-runtime/confine-reads-to-workspace.mjs";

// The three agent steps that read third-party text and publish. Each must load
// the hook. The implementer is deliberately out of scope here — it edits and
// builds, a different trust decision — so it is not listed.
const CONFINED_AGENT_STEPS = [
  { workflow: "claude-agent-pipeline.yml", step: "Run planner (Claude Code)" },
  { workflow: "claude-code-review.yml", step: "Run code review (Claude Code)" },
  {
    workflow: "claude-security-audit.yml",
    step: "Run security audit (Claude Code)",
  },
];

// The jobs that check out untrusted PR code must restore the hook from the base
// before the agent runs, so a PR cannot disable the control confining it.
const RESTORE_STEPS = [
  {
    workflow: "claude-code-review.yml",
    step: "Restore trusted review runtime from PR base",
  },
  {
    workflow: "claude-security-audit.yml",
    step: "Restore trusted audit runtime from PR base",
  },
];

const workflow = (name) => readRepo(".github", "workflows", name);

describe("agent read-confinement hook contract", () => {
  it("decides allow inside the workspace and deny outside it", () => {
    const ws = "/home/runner/work/repo/repo";
    const allow = [
      { tool_name: "Read", tool_input: { file_path: "src/main.rs" } },
      { tool_name: "Read", tool_input: { file_path: "./agent-plan.md" } },
      { tool_name: "Grep", tool_input: { pattern: "x", path: "src" } },
      { tool_name: "Grep", tool_input: { pattern: "x" } }, // no path → cwd
      { tool_name: "Glob", tool_input: { pattern: "*", path: "." } },
      { tool_name: "Bash", tool_input: { command: "cat /etc/hostname" } }, // other tool
    ];
    for (const payload of allow) {
      assert.equal(decide(payload, ws), null, JSON.stringify(payload));
    }

    const deny = [
      { tool_name: "Read", tool_input: { file_path: "/etc/hostname" } },
      { tool_name: "Read", tool_input: { file_path: "/proc/self/environ" } },
      { tool_name: "Read", tool_input: { file_path: "../../../etc/passwd" } },
      { tool_name: "Grep", tool_input: { pattern: "x", path: "/root/.ssh" } },
      { tool_name: "Glob", tool_input: { pattern: "*", path: "/home/runner" } },
      // A sibling whose name shares the workspace prefix must not slip through.
      {
        tool_name: "Read",
        tool_input: { file_path: "/home/runner/work/repo/repo-evil/x" },
      },
    ];
    for (const payload of deny) {
      const reason = decide(payload, ws);
      assert.ok(reason, `expected a deny for ${JSON.stringify(payload)}`);
      assert.match(reason, /outside GITHUB_WORKSPACE/);
    }
  });

  it("fails closed when the workspace is unset, and stays silent on nothing to judge", () => {
    const call = {
      tool_name: "Read",
      tool_input: { file_path: "/etc/hostname" },
    };
    assert.match(decide(call, ""), /GITHUB_WORKSPACE is unset/);
    assert.match(decide(call, undefined), /GITHUB_WORKSPACE is unset/);
    // Nothing to judge → allow (null), never a throw.
    assert.equal(decide({}, "/ws"), null);
    assert.equal(decide({ tool_name: "Read", tool_input: {} }, "/ws"), null);
    assert.equal(decide(null, "/ws"), null);
  });

  it("registers the hook for exactly the read tools, run through node", () => {
    const settings = JSON.parse(readRepo(SETTINGS_PATH));
    const entries = settings.hooks?.PreToolUse ?? [];
    assert.equal(entries.length, 1, "expected one PreToolUse hook group");

    const [group] = entries;
    // Matcher covers the three read tools and nothing that would over-fire.
    assert.deepEqual(group.matcher.split("|").sort(), ["Glob", "Grep", "Read"]);
    const command = group.hooks.map((h) => h.command).join("\n");
    assert.match(command, /^node /, "hook must run through node, not jq/bash");
    assert.match(
      command,
      new RegExp(HOOK_PATH.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
    assert.match(
      command,
      /\$CLAUDE_PROJECT_DIR/,
      "hook path must resolve from the checkout root",
    );
  });

  it("loads the hook into every confined agent step", () => {
    for (const { workflow: name, step } of CONFINED_AGENT_STEPS) {
      const agent = namedStep(workflow(name), step);
      assert.match(
        agent,
        new RegExp(
          `settings:\\s*${SETTINGS_PATH.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
        ),
        `${step} must pass the read-confinement settings`,
      );
    }
  });

  it("restores the hook from the base before an untrusted-code agent runs", () => {
    for (const { workflow: name, step } of RESTORE_STEPS) {
      const restore = namedStep(workflow(name), step);
      assert.match(
        restore,
        /\.github\/agent-runtime\b/,
        `${step} must restore .github/agent-runtime from the base`,
      );
    }
  });
});

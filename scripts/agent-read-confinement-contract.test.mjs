// Contract for the read-confinement PreToolUse hook that binds the agents'
// Read / Grep / Glob to $GITHUB_WORKSPACE. Concept: agent-allowlist-unscoped-
// read-tools (GHSA-xqww-rh2g-g5v9). The `(./**)` allowlist scoping was inert —
// an allow entry pre-approves and cannot revoke the action's base read grant, so
// confinement has to be a deny decision, which a hook makes on the resolved path.
//
// The hook is also held outside the workspace it confines. Concept:
// agent-writable-read-confinement-hook (GHSA-8fp9-89wc-g9f6). A control the
// governed session can write is only a default, so each job stages the script
// and its settings from a trusted commit into $RUNNER_TEMP, read-only, and the
// hook command blocks the read when the staged script cannot run.

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { decide } from "../.github/agent-runtime/confine-reads-to-workspace.mjs";
import {
  jobContaining,
  namedStep,
  runBlock,
  stripShellComments,
} from "./workflow-contract-helpers.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const readRepo = (...p) => readFileSync(join(root, ...p), "utf8");

const SETTINGS_PATH = ".github/agent-runtime/read-confinement.settings.json";
const HOOK_PATH = ".github/agent-runtime/confine-reads-to-workspace.mjs";
const HOOK_FILE = "confine-reads-to-workspace.mjs";
const SETTINGS_FILE = "read-confinement.settings.json";

// Where the trusted copies live while an agent runs: under the runner's temp
// directory, which is outside the checkout.
const STAGED_DIR = "agent-read-confinement";
const STAGE_STEP =
  "Stage trusted read-confinement hook outside the agent workspace";
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// The three agent steps that read third-party text and publish. Each must load
// the hook. The implementer is deliberately out of scope here — it edits and
// builds, a different trust decision — so it is not listed. `trustedSha` is the
// commit each job stages the hook from: the checked-out default branch for the
// planner, the PR base wherever a pull request supplies the tree. `gated` says
// whether the job has a gate step: the planner's gate is a separate job, so its
// staging step carries no condition, while the other two run it only past theirs.
const CONFINED_AGENT_STEPS = [
  {
    workflow: "claude-agent-pipeline.yml",
    step: "Run planner (Claude Code)",
    trustedSha: /TRUSTED_SHA:\s*\$\{\{\s*github\.sha\s*\}\}/,
    gated: false,
  },
  {
    workflow: "claude-code-review.yml",
    step: "Run code review (Claude Code)",
    trustedSha:
      /TRUSTED_SHA:\s*\$\{\{\s*github\.event\.pull_request\.base\.sha\s*\}\}/,
    restore: "Restore trusted review runtime from PR base",
    gated: true,
  },
  {
    workflow: "claude-security-audit.yml",
    step: "Run security audit (Claude Code)",
    trustedSha:
      /TRUSTED_SHA:\s*\$\{\{\s*github\.event\.pull_request\.base\.sha \|\| github\.sha\s*\}\}/,
    restore: "Restore trusted audit runtime from PR base",
    gated: true,
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
    assert.equal(group.hooks.length, 1, "expected one hook command");
    const [{ command }] = group.hooks;
    assert.match(command, /^node /, "hook must run through node, not jq/bash");
    // The staged copy, and nothing that resolves into the checkout: the session
    // this hook governs can write there. This is the tracked template; staging
    // replaces the RUNNER_TEMP prefix with the absolute staged path.
    assert.equal(
      command,
      `node "$RUNNER_TEMP/${STAGED_DIR}/${HOOK_FILE}" || exit 2`,
      "hook must run the staged copy and block when it cannot",
    );
    assert.doesNotMatch(
      command,
      /CLAUDE_PROJECT_DIR|GITHUB_WORKSPACE|\.github\//,
    );
  });

  it("loads the staged hook settings into every confined agent step", () => {
    for (const { workflow: name, step } of CONFINED_AGENT_STEPS) {
      const agent = namedStep(workflow(name), step);
      assert.match(
        agent,
        new RegExp(
          `^\\s*settings:\\s*\\$\\{\\{\\s*runner\\.temp\\s*\\}\\}/${STAGED_DIR}/${escapeRegExp(SETTINGS_FILE)}\\s*$`,
          "m",
        ),
        `${step} must pass the staged read-confinement settings`,
      );
      assert.doesNotMatch(
        stripShellComments(agent),
        /\.github\/agent-runtime/,
        `${step} must not load a hook file from the checkout`,
      );
    }
  });

  it("stages the hook from a trusted commit, read-only, before every confined agent step", () => {
    for (const {
      workflow: name,
      step,
      trustedSha,
      restore,
      gated,
    } of CONFINED_AGENT_STEPS) {
      const yml = workflow(name);
      // Positions within the agent's own job: another job runs on another
      // runner, whose temp directory the agent never sees.
      const job = jobContaining(yml, step);
      const position = (heading) => {
        const at = job.indexOf(`- name: ${heading}`);
        assert.ok(at >= 0, `${name}: expected "${heading}" in the agent's job`);
        return at;
      };
      assert.ok(
        position(STAGE_STEP) < position(step),
        `${name}: staging must precede the agent`,
      );
      // The base commit is fetched by the restore step when a PR run lacks it.
      if (restore) {
        assert.ok(
          position(restore) < position(STAGE_STEP),
          `${name}: staging must follow the base restore`,
        );
      }

      const stage = namedStep(yml, STAGE_STEP);
      const header = stripShellComments(
        stage.slice(0, stage.search(/^\s*run: \|/m)),
      );
      assert.match(header, trustedSha, `${name}: unexpected trusted commit`);
      // Staged on every run that reaches the agent, and a failure stops the
      // job. A gated job runs it past exactly its gate, the same condition the
      // agent step carries; without a gate it carries no condition at all. A
      // missing gate is caught too: the step would then run on a no-op run whose
      // checkout was skipped, and fail it.
      assert.doesNotMatch(header, /github\.event_name|continue-on-error/);
      assert.deepEqual(
        [...header.matchAll(/^\s*if:.*$/gm)].map(([line]) => line.trim()),
        gated ? ["if: steps.gate.outputs.proceed == 'true'"] : [],
        `${name}: staging must run exactly when the agent does`,
      );
      // Nothing else in the workflow reaches the staged directory.
      const elsewhere = stripShellComments(yml)
        .replace(stripShellComments(stage), "")
        .replace(stripShellComments(namedStep(yml, step)), "");
      assert.doesNotMatch(
        elsewhere,
        new RegExp(STAGED_DIR),
        `${name}: only the staging and agent steps may name the staged directory`,
      );

      const code = stripShellComments(runBlock(stage));
      assert.match(code, /^set -euo pipefail$/m);
      assert.doesNotMatch(
        code,
        /set \+|\|\|/,
        `${name}: staging must not mask a failure`,
      );
      assert.match(
        code,
        new RegExp(`STAGED="\\$RUNNER_TEMP/${STAGED_DIR}"`),
        `${name}: must stage under the runner temp directory`,
      );
      // Read from the commit object, never from the working tree.
      assert.match(
        code,
        /git show "\$TRUSTED_SHA:\.github\/agent-runtime\/\$file" > "\$STAGED\/\$file"/,
      );
      for (const file of [HOOK_FILE, SETTINGS_FILE]) {
        assert.match(code, new RegExp(`\\b${escapeRegExp(file)}\\b`));
      }
      assert.doesNotMatch(code, /\bcp\b|GITHUB_WORKSPACE/);
      // An empty sha would read the index; an empty script runs cleanly and
      // decides nothing. Both are refused.
      assert.match(code, /^test -n "\$TRUSTED_SHA"$/m);
      assert.match(code, /^\s*test -s "\$STAGED\/\$file"$/m);
      // The staged settings name the staged script by its absolute path, so the
      // hook command does not depend on RUNNER_TEMP reaching the hook process.
      // The prefix is checked before it is substituted.
      assert.match(
        code,
        /case "\$RUNNER_TEMP" in\s+"" \| \*\[!A-Za-z0-9_.\/:-\]\*\)/,
      );
      assert.match(
        code,
        /^SETTINGS="\$STAGED\/read-confinement\.settings\.json"$/m,
      );
      assert.match(
        code,
        /^sed -i "s\|\[\$\]RUNNER_TEMP\/agent-read-confinement\/\|\$STAGED\/\|" "\$SETTINGS"$/m,
      );
      assert.match(
        code,
        /^grep -qF "\$STAGED\/confine-reads-to-workspace\.mjs" "\$SETTINGS"$/m,
      );
      // Read-only, so a write primitive that reaches outside the workspace but
      // cannot change file modes — every tool these jobs grant today — cannot
      // replace the copy or drop another beside it.
      assert.match(
        code,
        /^chmod 400 "\$STAGED\/confine-reads-to-workspace\.mjs" "\$SETTINGS"$/m,
      );
      assert.match(code, /chmod 500 "\$STAGED"/);
    }
  });

  it("runs the staged hook whatever the workspace holds, and blocks when it cannot run", () => {
    // Executes the shipped staging shell and the shipped hook command over a
    // scratch repository, so the property is checked by behaviour, not by text.
    const tmp = mkdtempSync(join(tmpdir(), "hook-staging-")).replaceAll(
      "\\",
      "/",
    );
    try {
      const repo = `${tmp}/repo`;
      mkdirSync(`${repo}/.github/agent-runtime`, { recursive: true });
      const git = (...args) =>
        execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
      for (const path of [HOOK_PATH, SETTINGS_PATH]) {
        writeFileSync(`${repo}/${path}`, readRepo(path));
      }
      git("init", "-q");
      git("add", "-A");
      git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "c");
      const trusted = git("rev-parse", "HEAD");
      // Changes a session could make after checkout, never committed.
      writeFileSync(`${repo}/${HOOK_PATH}`, "// emptied\n");
      writeFileSync(`${repo}/${SETTINGS_PATH}`, "{}\n");

      const outside = {
        tool_name: "Read",
        tool_input: { file_path: `${tmp}/outside.txt` },
      };
      const inside = {
        tool_name: "Read",
        tool_input: { file_path: "src/main.rs" },
      };
      // Runs the shipped staging shell of one workflow into its own temp dir.
      const stage = (name, runnerTemp, sha) =>
        spawnSync(
          "bash",
          ["-c", runBlock(namedStep(workflow(name), STAGE_STEP))],
          {
            cwd: repo,
            encoding: "utf8",
            env: { ...process.env, RUNNER_TEMP: runnerTemp, TRUSTED_SHA: sha },
          },
        );
      // The hook command a settings document registers.
      const commandIn = (settingsText) =>
        JSON.parse(settingsText).hooks.PreToolUse[0].hooks[0].command;
      // Runs a hook command as the runtime would, with RUNNER_TEMP set to
      // `runnerTemp`, or unset when it is null.
      const hook = (command, payload, runnerTemp = null) => {
        const env = { ...process.env, GITHUB_WORKSPACE: repo };
        if (runnerTemp === null) delete env.RUNNER_TEMP;
        else env.RUNNER_TEMP = runnerTemp;
        return spawnSync("bash", ["-c", command], {
          cwd: repo,
          encoding: "utf8",
          input: JSON.stringify(payload),
          env,
        });
      };

      for (const { workflow: name } of CONFINED_AGENT_STEPS) {
        const runnerTemp = `${tmp}/runner-${name}`;
        const staged = stage(name, runnerTemp, trusted);
        assert.equal(staged.status, 0, `${name}: ${staged.stderr}`);
        // The staged settings name the staged script outright.
        const command = commandIn(
          readFileSync(`${runnerTemp}/${STAGED_DIR}/${SETTINGS_FILE}`, "utf8"),
        );
        assert.equal(
          command,
          `node "${runnerTemp}/${STAGED_DIR}/${HOOK_FILE}" || exit 2`,
          `${name}: staged settings must name the staged script by absolute path`,
        );
        // A Windows clone may hold CRLF in the working tree and LF in the object.
        const lf = (text) => text.replaceAll("\r\n", "\n");
        assert.equal(
          lf(readFileSync(`${runnerTemp}/${STAGED_DIR}/${HOOK_FILE}`, "utf8")),
          lf(readRepo(HOOK_PATH)),
          `${name}: must stage the committed hook, not the workspace copy`,
        );
        // Windows has no owner-write bit for chmod to clear; the runners do.
        if (process.platform !== "win32") {
          const mode = (path) => statSync(path).mode & 0o777;
          assert.equal(mode(`${runnerTemp}/${STAGED_DIR}`), 0o500);
          assert.equal(mode(`${runnerTemp}/${STAGED_DIR}/${HOOK_FILE}`), 0o400);
        }

        // Decided by the staged copy whether or not RUNNER_TEMP reaches the
        // hook process.
        for (const env of [runnerTemp, null]) {
          const denied = hook(command, outside, env);
          assert.equal(denied.status, 0, denied.stderr);
          assert.match(denied.stdout, /"permissionDecision":"deny"/);
          const allowed = hook(command, inside, env);
          assert.equal(allowed.status, 0, allowed.stderr);
          assert.equal(allowed.stdout, "");
        }
      }

      // A script that is absent or cannot be parsed blocks the read: the runtime
      // treats exit 2 as a refusal and any other failure as no decision. Run
      // through the template, pointed at a directory holding no usable copy.
      const template = commandIn(readRepo(SETTINGS_PATH));
      const absent = `${tmp}/runner-absent`;
      mkdirSync(`${absent}/${STAGED_DIR}`, { recursive: true });
      const missing = hook(template, outside, absent);
      assert.equal(missing.status, 2, "a missing staged hook must block");

      writeFileSync(
        `${absent}/${STAGED_DIR}/${HOOK_FILE}`,
        "this is not javascript (\n",
      );
      const broken = hook(template, outside, absent);
      assert.equal(broken.status, 2, "an unparseable staged hook must block");

      // Staging refuses what it must not stage: each case stops the job.
      const commitWith = (contents) => {
        if (contents === null) git("rm", "-q", "--cached", HOOK_PATH);
        else {
          writeFileSync(`${repo}/${HOOK_PATH}`, contents);
          git("add", HOOK_PATH);
        }
        git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "c");
        return git("rev-parse", "HEAD");
      };
      // Run in order, each sha taken when its case runs. An empty sha comes
      // first, while the index still holds the committed hook, so reading the
      // index would succeed if the sha were not checked. A committed zero-byte
      // script: git show succeeds and writes nothing, so only the empty-script
      // check stands between it and a hook that confines nothing.
      const refused = [
        ["an empty trusted sha", "nosha", () => ""],
        [
          "a RUNNER_TEMP holding an unexpected character",
          "with space",
          () => trusted,
        ],
        ["a zero-byte hook", "zero", () => commitWith("")],
        ["no hook", "gone", () => commitWith(null)],
      ];
      for (const [label, dir, shaFor] of refused) {
        const sha = shaFor();
        for (const { workflow: name } of CONFINED_AGENT_STEPS) {
          const result = stage(name, `${tmp}/runner-${dir}-${name}`, sha);
          assert.notEqual(
            result.status,
            0,
            `${name}: staging ${label} must fail`,
          );
        }
      }
    } finally {
      // The staged directories are read-only; open them up so cleanup can run.
      if (process.platform !== "win32") {
        spawnSync("chmod", ["-R", "u+w", tmp]);
      }
      rmSync(tmp, { recursive: true, force: true });
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

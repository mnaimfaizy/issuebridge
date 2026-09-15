import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  namedStep,
  runBlock,
  stepsAfter,
  stripShellComments,
  trackedSymlinkTarget,
  workflowPermissions,
} from "./workflow-contract-helpers.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function readRepo(...parts) {
  return readFileSync(join(root, ...parts), "utf8");
}

function readWorkflow() {
  return readRepo(".github", "workflows", "claude-security-audit.yml");
}

function toolAllowlists(yml) {
  const prTools = yml.match(/PR_TOOLS='([^']*)'/)?.[1] ?? "";
  const fullTools = yml.match(/FULL_TOOLS="([^"]*)"/)?.[1] ?? "";
  assert.ok(prTools, "expected PR_TOOLS allowlist");
  assert.ok(fullTools, "expected FULL_TOOLS allowlist");

  // FULL_TOOLS builds on PR_TOOLS, so resolve the reference the way the shell
  // would or pr-mode rules go unchecked in full mode. Match the reference
  // itself rather than testing the result for leftovers: `${PR_TOOLS}` and
  // bare `$PR_TOOLS` both interpolate in shell, and a plain string replace of
  // the braced form leaves the bare form silently unresolved.
  const reference = fullTools.match(/\$\{PR_TOOLS\}|\$PR_TOOLS\b/);
  assert.ok(reference, "expected FULL_TOOLS to build on PR_TOOLS");
  const resolvedFull = fullTools.replace(reference[0], prTools);
  return { prTools, fullTools, resolvedFull };
}

// Bash rules are command-prefix rules, not path rules: `Bash(cat:*)` permits
// that binary with any argument, so it reads anywhere the runner user can, not
// just the workspace. This agent runs over attacker-influenced PR text and its
// report reaches a world-readable log, so its Bash rules are reviewed one by
// one. Deny by default — enumerate what is permitted, never what is banned.
//
// Read / Glob / Grep are the workspace-scoped tools the audit procedure asks
// for; nothing in the Skill or prompt shells out. `find` is deliberately absent:
// `find -exec` runs arbitrary commands and would escape this list entirely.
// Deliberately not the same set as the one in ci-workflow-contract.test.mjs,
// which guards the planner and reviewer: this job has no public comment channel,
// so it needs no `gh pr` rule, and it enumerates `git ls-files` because `find`
// was removed. Each workflow's set is its own trust decision — keep them apart,
// and change one without assuming the other should follow.
const REVIEWED_BASH_RULES = new Set([
  "Bash(git diff:*)",
  "Bash(git log:*)",
  "Bash(git show:*)",
  "Bash(git ls-files:*)",
]);

/** Every `Bash…` entry in an allowlist, as its literal rule text. */
function bashEntries(allowlist) {
  return [...allowlist.matchAll(/Bash(?:\([^)]*\))?/g)].map(([rule]) => rule);
}

// The non-shell half of the same decision, matched by tool name: narrowing an
// entry with a path rule, such as `Read(./**)`, needs no edit here, while a new
// tool always does. `Write` is here deliberately: the agent must write its
// report. What it can reach is held instead by the staging contract below — no
// credentialed step runs code from the workspace this tool writes into.
const REVIEWED_TOOLS = new Set(["Read", "Glob", "Grep", "Write"]);

/** Every entry in an allowlist, splitting on commas outside a rule's parens. */
function allowlistEntries(allowlist) {
  return [...allowlist.matchAll(/[^,(]+(?:\([^)]*\))?/g)]
    .map(([entry]) => entry.trim())
    .filter(Boolean);
}

/** Entries no one signed off on: shell rules by literal text, tools by name. */
function unreviewedEntries(allowlist) {
  return allowlistEntries(allowlist).filter((entry) => {
    const tool = entry.match(/^[^(]+/)[0];
    return tool === "Bash"
      ? !REVIEWED_BASH_RULES.has(entry)
      : !REVIEWED_TOOLS.has(tool);
  });
}

// Commands a step holding a secret after the scan may run. Deny by default: the
// agent can write anywhere in the workspace, so such a step runs the staged
// script and the plumbing that checks it, and nothing else.
const CREDENTIALED_STEP_COMMANDS = new Set([
  "set",
  "[",
  "echo",
  "exit",
  "fi",
  "printf",
  "sha256sum",
  '"$SCRIPT"',
]);

/** Names of the secrets a block of workflow text references, in either syntax. */
function secretNames(text) {
  return [
    ...text.matchAll(/secrets(?:\.(\w+)|\[\s*['"]([^'"]+)['"]\s*\])/g),
  ].map(([, dotted, bracketed]) => dotted ?? bracketed);
}

/** The command word of each simple command in a comment-stripped shell body. */
function commandWords(code) {
  return code
    .replace(/\\\n/g, " ")
    .split(/\n|&&|\|\||;|\|/)
    .map((segment) => {
      const words = segment.trim().split(/\s+/).filter(Boolean);
      while (
        /^(?:if|then|else|elif|!|[A-Za-z_]\w*=\S*)$/.test(words[0] ?? "")
      ) {
        words.shift();
      }
      return words[0];
    })
    .filter(Boolean);
}

describe("security-audit Skill / prompt / workflow contract (#150)", () => {
  const yml = readWorkflow();
  const skill = readRepo(".agents", "skills", "security-audit", "SKILL.md");
  const prompt = readRepo(".github", "security-audit", "prompt.md");
  const reportFormat = readRepo(
    ".agents",
    "skills",
    "security-audit",
    "report-format.md",
  );
  const threatPack = readRepo(
    ".agents",
    "skills",
    "security-audit",
    "threat-model.md",
  );
  const operatorDoc = readRepo("docs", "security-audit.md");

  it("keeps pr as a mode of one pull_request workflow, never pull_request_target", () => {
    assert.match(yml, /^\s*pull_request:\s*$/m);
    assert.doesNotMatch(yml, /^\s*pull_request_target:/m);
    assert.match(yml, /agent:security-audit/);
    assert.match(skill, /`pr`/);
    assert.match(skill, /`full`/);
    assert.doesNotMatch(skill, /\| `manual` \|/);
  });

  it("schedules full weekly at Sunday 14:00 UTC and names Monday 00:00 AEST", () => {
    assert.match(yml, /cron:\s*"0 14 \* \* 0"/);
    assert.match(yml, /Monday 00:00 AEST/);
    assert.match(yml, /workflow_dispatch:/);
  });

  it("emails only the scheduled full job", () => {
    const email = namedStep(yml, "Email report + transcript (optional)");
    assert.match(email, /github\.event_name == 'schedule'/);
    assert.doesNotMatch(email, /workflow_dispatch/);
    assert.doesNotMatch(email, /pull_request/);
  });

  it("runs lockfile scanners only on full, writes JSON to workspace files, and never echoes or uploads them", () => {
    const osv = namedStep(yml, "Scan lockfiles (OSV)");
    const cargo = namedStep(yml, "Scan lockfile (cargo-audit)");
    const prGate = /steps\.gate\.outputs\.mode == 'full'/;

    assert.match(osv, prGate);
    assert.match(cargo, prGate);
    assert.match(osv, /osv-scanner/);
    assert.match(osv, /-L package-lock\.json/);
    assert.match(osv, /-L src-tauri\/Cargo\.lock/);
    assert.match(osv, /--format json/);
    assert.match(osv, /security-audit-osv\.json/);
    assert.doesNotMatch(osv, /osv-scanner fix|--call-analysis/);
    assert.match(cargo, /cargo-audit audit/);
    assert.match(cargo, /--json/);
    assert.match(cargo, /security-audit-cargo-audit\.json/);
    assert.doesNotMatch(cargo, /cargo audit fix|cargo-audit fix/);

    assert.doesNotMatch(yml, /npm audit/);
    assert.doesNotMatch(yml, /^\s*uses:.*upload-artifact/m);
    assert.doesNotMatch(osv, /\bcat\b.*security-audit-osv\.json/);
    assert.doesNotMatch(cargo, /\bcat\b.*security-audit-cargo-audit\.json/);
    assert.doesNotMatch(osv, /echo '\{\}'/);
    const brief = namedStep(yml, "Build audit brief");
    assert.match(brief, /if \[ "\$MODE" = "full" \]/);
  });

  it("fetches open Dependabot alerts only on full, with vulnerability-alerts read, and continues without dumping the body", () => {
    const fetch = namedStep(yml, "Fetch open Dependabot alerts");
    assert.match(fetch, /steps\.gate\.outputs\.mode == 'full'/);
    assert.match(yml, /vulnerability-alerts:\s*read/);
    assert.doesNotMatch(workflowPermissions(yml), /security-events:/);
    assert.match(fetch, /dependabot\/alerts/);
    assert.match(fetch, /state=open/);
    assert.match(fetch, /security-audit-dependabot\.json/);
    assert.match(fetch, /continue|continuing without/i);
    assert.doesNotMatch(fetch, /\bcat\b.*dependabot/);
  });

  it("does not grant the agent spawn, audit CLIs, or advisory HTTP", () => {
    const { prTools, fullTools } = toolAllowlists(yml);
    for (const tools of [prTools, fullTools]) {
      assert.doesNotMatch(tools, /Agent|Task|Spawn|Skill/);
      assert.doesNotMatch(tools, /WebFetch|WebSearch/);
    }
    assert.doesNotMatch(fullTools, /npm audit/);
    // Bash rules are covered by the deny-by-default test below, which is
    // strictly stronger than naming npm / cargo / curl / gh / osv here.
  });

  it("holds every allowlist entry to a reviewed list, and pr mode to no shell", () => {
    const { prTools, resolvedFull } = toolAllowlists(yml);

    // pr mode audits attacker-authored code and needs no shell at all.
    assert.deepEqual(
      bashEntries(prTools),
      [],
      "pr allowlist must hold no Bash rule",
    );
    for (const [mode, tools] of [
      ["pr", prTools],
      ["full", resolvedFull],
    ]) {
      assert.deepEqual(
        unreviewedEntries(tools),
        [],
        `${mode} allowlist holds an entry that is not on a reviewed list`,
      );
    }
  });

  it("reviews tools by name, so narrowing one with a path rule needs no test edit", () => {
    assert.deepEqual(
      unreviewedEntries("Read(./**),Glob,Grep(src/**),Write"),
      [],
    );
    assert.deepEqual(unreviewedEntries("Read,Edit,WebFetch"), [
      "Edit",
      "WebFetch",
    ]);
    assert.deepEqual(
      unreviewedEntries("Bash(git diff:*),Bash(curl:*),Bash,Bash(git diff)"),
      ["Bash(curl:*)", "Bash", "Bash(git diff)"],
    );
  });

  it("stages the credentialed scripts outside the agent workspace before the scan, on every run", () => {
    const heading = "Stage trusted audit scripts outside the agent workspace";
    const position = (name) => {
      const at = yml.indexOf(`- name: ${name}`);
      assert.ok(at >= 0, `expected step "${name}"`);
      return at;
    };
    // The base commit is fetched by the restore step when a PR run lacks it.
    assert.ok(
      position("Restore trusted audit runtime from PR base") <
        position(heading),
      "staging must follow the base restore",
    );
    assert.ok(
      position(heading) < position("Run security audit (Claude Code)"),
      "staging must precede the scan",
    );

    const code = stripShellComments(namedStep(yml, heading));
    // Every run that proceeds, not only pull requests: a full run executes these
    // scripts with the same secrets after the same agent.
    assert.match(code, /if: steps\.gate\.outputs\.proceed == 'true'\s/);
    assert.doesNotMatch(code, /github\.event_name/);
    assert.match(
      code,
      /TRUSTED_SHA:\s*\$\{\{\s*github\.event\.pull_request\.base\.sha \|\| github\.sha\s*\}\}/,
    );
    assert.match(code, /STAGED="\$RUNNER_TEMP\/security-audit-staged"/);
    assert.match(code, /echo "dir=\$STAGED" >> "\$GITHUB_OUTPUT"/);
    for (const script of ["publish-draft-advisory.sh", "notify-email.sh"]) {
      // Read from the commit object, never from the working tree.
      const escaped = script.replaceAll(".", "\\.");
      assert.match(
        code,
        new RegExp(
          `git show "\\$TRUSTED_SHA:\\.github/security-audit/${escaped}" > "\\$STAGED/${escaped}"`,
        ),
      );
    }
  });

  it("runs credentialed scripts only from the staged copy, verified first", () => {
    for (const [heading, script, output] of [
      [
        "Publish draft Security Advisory (private, always)",
        "publish-draft-advisory.sh",
        "publisher_sha256",
      ],
      [
        "Email report + transcript (optional)",
        "notify-email.sh",
        "notifier_sha256",
      ],
    ]) {
      const code = stripShellComments(namedStep(yml, heading));
      const escaped = script.replaceAll(".", "\\.");
      assert.match(
        code,
        new RegExp(
          `SCRIPT_SHA256:\\s*\\$\\{\\{\\s*steps\\.stage\\.outputs\\.${output}\\s*\\}\\}`,
        ),
        `${heading} must take the digest recorded before the scan`,
      );
      assert.match(
        code,
        /STAGED_DIR:\s*\$\{\{\s*steps\.stage\.outputs\.dir\s*\}\}/,
        `${heading} must take the staged directory from the staging step`,
      );
      assert.match(code, new RegExp(`SCRIPT="\\$STAGED_DIR/${escaped}"`));
      const verify = code.search(/sha256sum -c --quiet -/);
      const run = code.search(/^\s*"\$SCRIPT" \\/m);
      assert.ok(verify >= 0, `${heading} must verify the staged script`);
      assert.ok(run > verify, `${heading} must verify before it runs`);
      assert.doesNotMatch(code, /\.github\/security-audit\//);
    }
  });

  it("reaches only staged scripts and report data in a step that holds a secret after the scan", () => {
    // A secret outside a step's own env would reach steps this test cannot see.
    const beforeSteps = yml.slice(0, yml.search(/^\s+steps:\s*$/m));
    assert.deepEqual(
      secretNames(stripShellComments(beforeSteps)),
      [],
      "secrets must be passed through step env, not workflow or job env",
    );

    const allowedPath =
      /^\$STAGED_DIR\/[\w.-]+\.sh$|^\$GITHUB_WORKSPACE\/security-audit-(?:report\.md|cli\.log|session\.md)$/;
    const credentialed = stepsAfter(
      yml,
      "Run security audit (Claude Code)",
    ).filter((step) =>
      secretNames(step).some((name) => name !== "GITHUB_TOKEN"),
    );
    assert.ok(
      credentialed.length > 0,
      "expected credentialed steps after the scan",
    );
    for (const step of credentialed) {
      const name = step.match(/^- name: ([^\r\n]+)/)?.[1];
      const code = stripShellComments(runBlock(step));

      assert.doesNotMatch(
        code,
        /\$\(|`|<\(/,
        `${name} must not substitute command output`,
      );
      assert.deepEqual(
        commandWords(code).filter(
          (word) => !CREDENTIALED_STEP_COMMANDS.has(word),
        ),
        [],
        `${name} runs a command that is not on the reviewed list`,
      );
      const paths = [...code.matchAll(/[^\s"'=]*\/[^\s"']*/g)].map(([p]) => p);
      assert.deepEqual(
        paths.filter((path) => !allowedPath.test(path)),
        [],
        `${name} names a path outside the staged scripts and report data`,
      );
    }
  });

  it("runs the staged copy and fails closed when it changed or its digest is missing", () => {
    // Executes the shipped staging and publish shell over a scratch repository,
    // so a later edit to either is checked by behaviour, not only by its text.
    const tmp = mkdtempSync(join(tmpdir(), "audit-staging-")).replaceAll(
      "\\",
      "/",
    );
    try {
      const repo = `${tmp}/repo`;
      mkdirSync(`${repo}/.github/security-audit`, { recursive: true });
      const git = (...args) =>
        execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
      const commitScripts = (scripts) => {
        for (const [script, body] of Object.entries(scripts)) {
          const path = `${repo}/.github/security-audit/${script}`;
          if (body === null) rmSync(path);
          else writeFileSync(path, `#!/usr/bin/env bash\n${body}\n`);
        }
        git("add", "-A");
        git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "c");
        return git("rev-parse", "HEAD");
      };
      git("init", "-q");
      const trusted = commitScripts({
        "publish-draft-advisory.sh": 'echo "trusted publisher ran"',
        "notify-email.sh": 'echo "trusted notifier ran"',
      });
      // A change the agent could make after checkout, never committed.
      writeFileSync(
        `${repo}/.github/security-audit/publish-draft-advisory.sh`,
        '#!/usr/bin/env bash\necho "workspace copy ran"\n',
      );

      const shell = (heading, env) =>
        spawnSync("bash", ["-c", runBlock(namedStep(yml, heading))], {
          cwd: repo,
          encoding: "utf8",
          env: { ...process.env, ...env },
        });
      const stage = (sha) => {
        const out = `${tmp}/output-${sha}`;
        writeFileSync(out, "");
        const result = shell(
          "Stage trusted audit scripts outside the agent workspace",
          {
            RUNNER_TEMP: `${tmp}/runner-${sha}`,
            GITHUB_OUTPUT: out,
            TRUSTED_SHA: sha,
          },
        );
        assert.equal(result.status, 0, result.stderr);
        return Object.fromEntries(
          readFileSync(out, "utf8")
            .trim()
            .split("\n")
            .map((line) => line.split(/=(.*)/s).slice(0, 2)),
        );
      };
      const publish = (outputs, digest = outputs.publisher_sha256) =>
        shell("Publish draft Security Advisory (private, always)", {
          GH_TOKEN: "unused",
          GITHUB_WORKSPACE: repo,
          STAGED_DIR: outputs.dir,
          SCRIPT_SHA256: digest ?? "",
        });

      const staged = stage(trusted);
      const clean = publish(staged);
      assert.equal(clean.status, 0, clean.stderr);
      assert.match(clean.stdout, /trusted publisher ran/);
      assert.doesNotMatch(clean.stdout, /workspace copy ran/);

      assert.notEqual(
        publish(staged, "").status,
        0,
        "missing digest must fail",
      );

      writeFileSync(
        `${staged.dir}/publish-draft-advisory.sh`,
        '#!/usr/bin/env bash\necho "changed after staging"\n',
      );
      const changed = publish(staged);
      assert.notEqual(changed.status, 0, "changed staged copy must fail");
      assert.doesNotMatch(changed.stdout, /changed after staging/);

      // Email is optional: a missing notifier must not stop the scan, and its
      // step must then be refused rather than run anything.
      const withoutNotifier = stage(
        commitScripts({
          "publish-draft-advisory.sh": 'echo "trusted publisher ran"',
          "notify-email.sh": null,
        }),
      );
      assert.equal(withoutNotifier.notifier_sha256, undefined);
      const email = shell("Email report + transcript (optional)", {
        GITHUB_WORKSPACE: repo,
        STAGED_DIR: withoutNotifier.dir,
        SCRIPT_SHA256: "",
      });
      assert.notEqual(email.status, 0, "email without a digest must fail");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("gives the agent step no tool grant beyond the resolved allowlist", () => {
    // The allowlist variable is only worth guarding if its consumer cannot widen
    // it: a second --allowedTools, or a flag that skips the permission check,
    // would bypass every assertion above.
    const scan = namedStep(yml, "Run security audit (Claude Code)");
    const grants = [...scan.matchAll(/--allowedTools/g)];
    assert.equal(grants.length, 1, "expected exactly one --allowedTools grant");
    assert.match(
      scan,
      /--allowedTools "\$\{\{ steps\.tools\.outputs\.allowed \}\}"/,
    );
    // Only flags that widen or skip the check. --disallowedTools narrows, so it
    // is not banned here.
    assert.doesNotMatch(
      yml,
      /--dangerously-skip-permissions|--permission-mode/,
    );
  });

  it("does not persist checkout credentials into the audit workspace", () => {
    const checkout = yml.indexOf("uses: actions/checkout@");
    const restore = yml.indexOf("Restore trusted audit runtime from PR base");

    assert.ok(checkout >= 0, "expected a checkout step");
    assert.ok(restore > checkout, "checkout must precede the restore step");

    // Default persist-credentials: true writes the job token into .git/config,
    // which this agent reads with a workspace-scoped tool while auditing an
    // attacker-influenced PR diff. The job never pushes; later gh steps pass
    // their token explicitly. Matches the pipeline and review workflows.
    assert.match(yml.slice(checkout, restore), /persist-credentials:\s*false/);
  });

  it("restores base files without fetching an unadvertised SHA", () => {
    // persist-credentials: false makes a want anonymous, and GitHub rejects an
    // anonymous want for an unadvertised object. Fetch the advertised base
    // branch, and only when the object is missing, matching claude-code-review.
    for (const heading of ["Restore trusted audit runtime from PR base"]) {
      const block = namedStep(yml, heading);
      assert.doesNotMatch(
        block,
        /^\s*git fetch[^\n]*origin "\$BASE_SHA"/m,
        `${heading} must not fetch a raw SHA`,
      );
      // Anchored on ^{commit}: restore_from_base() also runs `git cat-file -e
      // "$BASE_SHA:<path>"`, which would satisfy a looser pattern even with the
      // guard deleted.
      assert.match(
        block,
        /if ! git cat-file -e "\$BASE_SHA\^\{commit\}"/,
        `${heading} must guard the fetch on the object being absent`,
      );
      assert.match(block, /git fetch[^\n]*origin "\$BASE_BRANCH"/);
      // Unset under `set -u` would abort the job, so the env must supply it.
      assert.match(
        block,
        /BASE_BRANCH:\s*\$\{\{\s*github\.event\.pull_request\.base\.ref\s*\}\}/,
        `${heading} must define BASE_BRANCH in its env`,
      );
    }
  });

  it("restores agent memory files from anywhere in the tree, not just the root", () => {
    const block = namedStep(yml, "Restore trusted audit runtime from PR base");

    // Claude Code loads CLAUDE.md / CLAUDE.local.md from subdirectories on
    // demand and reads .claude/rules recursively, so a memory file a PR adds
    // below the root reaches the agent as instructions. A fixed list of root
    // paths cannot name it: the step has to enumerate candidates from the tree.
    // Assert the code, not the prose beside it: every name below also appears in
    // the explanatory comment, so matching the step text alone proves nothing.
    // Enumerate NUL-delimited — git quotes non-ASCII paths by default, and a
    // quoted path neither matches a filter nor resolves back to a file.
    assert.match(block, /git ls-files -z/, "must enumerate the head tree");
    assert.match(
      block,
      /git ls-tree -r -z --name-only "\$BASE_SHA"/,
      "must enumerate the base tree so a deleted memory file is restored too",
    );
    assert.match(
      block,
      /\*\/CLAUDE\.md\|\*\/CLAUDE\.local\.md\|\*\/AGENTS\.md\|\*\/\.mcp\.json/,
      "sweep must match memory files at any depth",
    );
    assert.match(
      block,
      /\.claude\|\.claude\/\*\|\*\/\.claude\|\*\/\.claude\/\*/,
      "sweep must match a .claude directory at any depth, bare or with children",
    );
    // An enumeration nothing consumes is dead code.
    assert.match(
      block,
      /while IFS= read -r -d '' path; do/,
      "sweep must iterate the enumerated candidates",
    );
    assert.match(
      block,
      /done < "\$MEMORY_LIST"/,
      "sweep must consume the list",
    );
    // The explicit prompt pack still has to be restored whether or not the head
    // contains it, so the enumeration supplements the list rather than replacing it.
    // The skill entry names the tree, not this job's own directory in it: the
    // runtime loads every skill through the symlink, so restoring one is not enough.
    for (const trustedPath of [
      ".github/security-audit/prompt.md",
      ".agents/skills",
    ]) {
      assert.match(block, new RegExp(trustedPath.replaceAll(".", "\\.")));
    }
  });

  it("pins every third-party action in the audit workflow to a commit SHA", () => {
    const refs = [
      ...yml.matchAll(/^\s*uses:\s*([^/\s]+\/[^@\s]+)@([^\s#]+)/gm),
    ].filter(([, action]) => !action.startsWith("actions/"));
    assert.ok(refs.length > 0, "expected a third-party action");
    for (const [, action, ref] of refs) {
      assert.match(
        ref,
        /^[0-9a-f]{40}$/,
        `${action} must use an immutable commit SHA`,
      );
    }
  });

  it("keeps the default model at Opus 5 with the existing override and turn budget", () => {
    assert.match(yml, /claude-opus-5/);
    assert.match(yml, /CLAUDE_SECURITY_AUDIT_MODEL/);
    assert.match(yml, /--max-turns 100/);
    assert.doesNotMatch(yml, /claude-fable|fable-5/i);
  });

  it("requires an evidence class on each finding, with fileability in the portable procedure", () => {
    for (const source of [skill, reportFormat]) {
      assert.match(source, /dependency-advisory/);
      assert.match(source, /code-path/);
      assert.match(source, /missing-control/);
    }
    assert.match(skill, /GHSA|OSV|RUSTSEC|CVE/);
    assert.match(
      skill,
      /`pr` cannot file `dependency-advisory`|pr` files only/,
    );
  });

  it("keeps pack assets out of the portable procedure", () => {
    assert.doesNotMatch(skill, /\bDrafts?\b/);
    assert.doesNotMatch(skill, /\bPublish\b/);
    assert.doesNotMatch(skill, /commands\.rs|github_http\.rs/);
    assert.doesNotMatch(skill, /claude-security-audit\.yml/);
    assert.match(threatPack, /Draft/);
    assert.match(threatPack, /Publish/);
    assert.match(threatPack, /commands\.rs/);
    assert.match(threatPack, /draft GitHub Security Advisory|draft GHSA/i);
  });

  it("projects the CI prompt from the Skill without extra procedure", () => {
    assert.match(prompt, /\.agents\/skills\/security-audit\/SKILL\.md/);
    assert.match(prompt, /follow/i);
    assert.doesNotMatch(prompt, /Do not modify application source/i);
    assert.doesNotMatch(prompt, /audit complete:/i);

    assert.doesNotMatch(prompt, /npm audit/i);
    assert.doesNotMatch(prompt, /osv-scanner|cargo audit/i);
    assert.doesNotMatch(prompt, /\bweekly\b|\bmonthly\b/i);
    assert.doesNotMatch(prompt, /github_http\.rs|commands\.rs/);
    assert.doesNotMatch(prompt, /\| `manual` \|/);
  });

  it("does not let operator docs add procedure the Skill lacks", () => {
    assert.match(operatorDoc, /SKILL\.md/);
    assert.doesNotMatch(operatorDoc, /npm audit/i);
    assert.doesNotMatch(operatorDoc, /Copilot CLI/);
    assert.match(operatorDoc, /Sunday 14:00 UTC|Monday 00:00 AEST/);
    assert.match(operatorDoc, /schedule/i);
  });
  it("restores the whole skill tree the runtime symlink resolves to", () => {
    const block = stripShellComments(
      namedStep(yml, "Restore trusted audit runtime from PR base"),
    );

    // `.claude/skills` is a symlink to the whole skill tree, so restoring that
    // path restores the link, not what it points at. The target is derived
    // rather than assumed: retargeting the symlink has to fail here instead of
    // silently pointing the sweep at a tree the runtime no longer loads.
    const skillTree = trackedSymlinkTarget(root, ".claude/skills");
    assert.equal(
      skillTree,
      ".agents/skills",
      "runtime skill symlink no longer resolves to the tree the sweep covers",
    );

    assert.ok(
      block.includes(`${skillTree}|${skillTree}/*`),
      `sweep must match every path under ${skillTree}, at any depth`,
    );

    // Restoring one directory out of the tree is the defect being fixed: every
    // sibling skill stays PR-authored while the agent loads from the link.
    const singleSkillDir = new RegExp(
      `${skillTree.replaceAll(".", "\\.")}/[A-Za-z0-9_-]+`,
    );
    assert.doesNotMatch(
      block,
      singleSkillDir,
      "restore step must not name one skill directory instead of the tree",
    );

    // A pull request can replace a tracked symlink with a real directory and
    // track files under it. Once the link is restored those paths resolve
    // through it, so removing one would delete what it points at.
    assert.ok(
      block.includes('elif resolves_through_symlink "$path"; then'),
      "removal must not follow a symlinked ancestor into the skill tree",
    );
  });

  it("logs report metadata as closed-set values, never as report lines", () => {
    const sinks = [
      [
        "Collect transcript step",
        stripShellComments(namedStep(yml, "Collect transcript")),
      ],
      [
        "publish-draft-advisory.sh",
        stripShellComments(
          readRepo(".github", "security-audit", "publish-draft-advisory.sh"),
        ),
      ],
    ];

    for (const [where, code] of sinks) {
      // The report is written by the agent and this log is world-readable.
      // Selecting lines by metadata prefix and emitting them whole was the
      // defect: the tail of a matched line is unbounded in length and count.
      assert.ok(
        !code.includes("Max severity|Finding count"),
        `${where} still selects report lines by metadata prefix`,
      );

      // Pattern-independent form of the same rule. A grep that prints matched
      // lines puts agent-authored report text on stdout whatever it matches, so
      // every grep reading the report must be testing (-q) or counting (-c).
      // Each match binds to the nearest `grep` before the report argument, so a
      // quiet grep earlier on the line cannot vouch for a printing one after it.
      // A flag letter appearing inside the search pattern itself would fool this;
      // the literal check above and the value assertions below are the backstop.
      const reportGreps = [
        ...code.matchAll(/grep\b((?:(?!grep\b)[^\n])*?)"\$REPORT"/g),
      ];
      assert.ok(
        reportGreps.length > 0,
        `${where}: expected at least one grep over the report`,
      );
      for (const [text, args] of reportGreps) {
        assert.ok(
          /(^|\s)-[A-Za-z]*[qc]/.test(args),
          `${where} reads the report with a printing grep: ${text.trim()}`,
        );
      }

      // Each value is matched whole (-x). A prefix match would readmit
      // arbitrary trailing text on an otherwise well-formed line.
      assert.ok(
        code.includes("grep -qxiE"),
        `${where} lost the whole-value match`,
      );

      for (const field of ["Mode", "Date", "Max severity", "Finding count"]) {
        assert.ok(
          code.includes(`log_report_field "${field}"`),
          `${where} stopped logging ${field} through the validator`,
        );
      }

      assert.ok(code.includes("'pr|full'"), `${where} lost the mode enum`);
      assert.ok(
        code.includes("'none|medium|high|critical'"),
        `${where} lost the severity enum`,
      );
      assert.ok(
        code.includes("'[0-9]{4}-[0-9]{2}-[0-9]{2}'"),
        `${where} lost the date pattern`,
      );
      assert.ok(
        code.includes("'[0-9]{1,6}'"),
        `${where} lost the finding-count pattern`,
      );

      // A value that fails its pattern is replaced, not printed.
      assert.ok(
        code.includes("(unrecognized)"),
        `${where} lost the rejected-value placeholder`,
      );

      // Scope is free text by contract, so only its presence is reportable.
      assert.ok(
        !code.includes('log_report_field "Scope"'),
        `${where} logs the free-text Scope value`,
      );
      assert.ok(
        code.includes("grep -qE '^- [*][*]Scope:[*][*]'"),
        `${where} lost the Scope presence check`,
      );
    }
  });
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function readRepo(...parts) {
  return readFileSync(join(root, ...parts), "utf8");
}

function readWorkflow() {
  return readRepo(".github", "workflows", "claude-security-audit.yml");
}

function namedStep(yml, heading) {
  const start = yml.indexOf(`- name: ${heading}`);
  assert.ok(start >= 0, `expected step "${heading}"`);
  const rest = yml.slice(start + 1);
  const next = rest.search(/^\s+- name:/m);
  return next < 0 ? yml.slice(start) : yml.slice(start, start + 1 + next);
}

function toolAllowlists(yml) {
  const prTools = yml.match(/PR_TOOLS='([^']*)'/)?.[1] ?? "";
  const fullTools = yml.match(/FULL_TOOLS="([^"]*)"/)?.[1] ?? "";
  assert.ok(prTools, "expected PR_TOOLS allowlist");
  assert.ok(fullTools, "expected FULL_TOOLS allowlist");
  return { prTools, fullTools };
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
    assert.doesNotMatch(
      yml.slice(yml.indexOf("permissions:"), yml.indexOf("jobs:")),
      /security-events:/,
    );
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
      assert.doesNotMatch(tools, /Bash\((?:npm|cargo|curl|gh|osv)/);
      assert.doesNotMatch(tools, /WebFetch|WebSearch/);
    }
    assert.doesNotMatch(fullTools, /npm audit/);
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
    assert.match(yml, /--max-turns 60/);
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
});

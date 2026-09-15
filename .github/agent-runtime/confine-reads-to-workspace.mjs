#!/usr/bin/env node
// PreToolUse hook: confine the built-in Read / Grep / Glob tools to the job's
// workspace ($GITHUB_WORKSPACE).
//
// Why a hook, not an --allowedTools scope: `--allowedTools` accumulates onto the
// action's base Read/Glob/Grep grant, and an allow entry only pre-approves a
// call — it cannot revoke the base grant, so `Read(./**)` does NOT confine these
// tools (proved live: reading /etc/hostname still succeeded under it). Only a
// deny decides a call, and a deny glob cannot cleanly express "everything
// outside the tree". A PreToolUse hook can: it sees the resolved path and denies
// anything outside the workspace, so a runner file (/etc/*, /proc/self/environ,
// ~/.config/*) cannot be read and funnelled to a public comment. Ledger concept:
// agent-allowlist-unscoped-read-tools (GHSA-xqww-rh2g-g5v9).
//
// Contract: stdin is the PreToolUse hook JSON. Print a deny decision as JSON on
// stdout to refuse an out-of-tree read; print nothing (exit 0) to let the normal
// permission flow proceed. A hook error is not a deny, so malformed input that we
// cannot judge is allowed through rather than exiting non-zero — except a missing
// workspace, where we fail closed.
import { resolve } from "node:path";

const READ_TOOLS = new Set(["Read", "Grep", "Glob"]);

function deny(reason) {
  process.stdout.write(
    `${JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    })}\n`,
  );
}

/** Decide on one hook payload. Returns a deny reason, or null to allow. */
export function decide(payload, workspace) {
  const tool = payload?.tool_name;
  if (!READ_TOOLS.has(tool)) return null; // other tools: their own rules

  // Read uses file_path; Grep and Glob use path. Absent → the tool defaults to
  // the working directory, which is the workspace, so allow.
  const target = payload?.tool_input?.file_path ?? payload?.tool_input?.path;
  if (target == null || target === "") return null;

  if (!workspace) return "read confinement hook: GITHUB_WORKSPACE is unset";

  // resolve() canonicalizes `.`/`..` against the workspace and yields an
  // absolute path; a path already absolute is kept. It does not follow symlinks,
  // so pair it with the containment check below rather than trusting the string.
  const abs = resolve(workspace, String(target));
  const ws = resolve(workspace);
  const inside = abs === ws || abs.startsWith(`${ws}/`) || abs.startsWith(`${ws}\\`);
  if (inside) return null;

  return `read confined to the workspace; refused a path outside GITHUB_WORKSPACE: ${abs}`;
}

async function main() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8").trim();

  let payload;
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    return; // unparseable input is not something we can judge — allow through
  }

  const reason = decide(payload, process.env.GITHUB_WORKSPACE);
  if (reason) deny(reason);
}

// Only run when invoked as the hook, so the unit test can import `decide`.
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("confine-reads-to-workspace.mjs")) {
  main();
}

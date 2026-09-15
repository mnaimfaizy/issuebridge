/**
 * Shared helpers for the workflow contract tests.
 *
 * Deliberately free of policy: what each workflow is allowed to do stays in its
 * own contract file, because each is a separate trust decision. Only mechanics
 * live here — locating a step, extracting its shell, stripping shell comments,
 * reading a tracked symlink — so the two suites cannot drift on how they read
 * the same YAML.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { posix } from "node:path";

/**
 * A single `- name: <heading>` step, ending before the next step begins.
 *
 * Scoped rather than open-ended: a slice running past the step would let an
 * unrelated command in a later step satisfy an assertion about this one.
 */
export function namedStep(yml, heading) {
  return stepsFrom(yml, heading)[0];
}

/** Every step after the `- name: <heading>` step, cut exactly as `namedStep` cuts. */
export function stepsAfter(yml, heading) {
  return stepsFrom(yml, heading).slice(1);
}

/**
 * The `- name: <heading>` step and every step after it, each starting at its
 * `- name:` line. The one splitter behind `namedStep` and `stepsAfter`, so the
 * two can never disagree about where a step ends. The last runs to end of file.
 */
function stepsFrom(yml, heading) {
  const start = yml.indexOf(`- name: ${heading}`);
  assert.ok(start >= 0, `expected step "${heading}"`);
  const bounds = [
    start,
    ...[...yml.slice(start + 1).matchAll(/^\s+- name:/gm)].map(
      (match) => start + 1 + match.index,
    ),
  ];
  return bounds.map((from, i) =>
    yml.slice(from, bounds[i + 1] ?? yml.length).replace(/^\s+/, ""),
  );
}

/**
 * The shell body of a step's `run: |` block, dedented, with LF line endings, as
 * the runner would hand it to bash. Lets a test execute the shipped code rather
 * than a copy of it.
 */
export function runBlock(step) {
  const lines = step.replace(/\r\n/g, "\n").split("\n");
  const at = lines.findIndex((line) => /^\s*run: \|\s*$/.test(line));
  assert.ok(at >= 0, "expected a run: | block");
  const runIndent = lines[at].search(/\S/);
  const body = [];
  for (const line of lines.slice(at + 1)) {
    if (line.trim() !== "" && line.search(/\S/) <= runIndent) break;
    body.push(line);
  }
  const indent = Math.min(
    ...body.filter((line) => line.trim()).map((line) => line.search(/\S/)),
  );
  return `${body
    .map((line) => line.slice(indent))
    .join("\n")
    .trimEnd()}\n`;
}

/**
 * The workflow-level `permissions:` block, before `jobs:`; empty when absent.
 *
 * Anchored to column 0 so a job-level block, or the word in a comment, is never
 * mistaken for it.
 */
export function workflowPermissions(yml) {
  const start = yml.search(/^permissions:\s*$/m);
  const jobs = yml.search(/^jobs:\s*$/m);
  assert.ok(jobs >= 0, "expected a jobs: block");
  return start < 0 || start > jobs ? "" : yml.slice(start, jobs);
}

/**
 * Shell code with `#` comments removed, whole-line and trailing alike.
 *
 * Assertions about a control must bind to the code, not to the prose beside it:
 * these steps carry comments that name every path and flag the code uses, so an
 * assertion run against the raw text can pass on the explanation alone. A `#`
 * inside quotes is data, not a comment — several patterns contain `###`.
 */
export function stripShellComments(code) {
  return code
    .split("\n")
    .map((line) => {
      let quote = null;
      for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];
        if (quote) {
          if (ch === quote) quote = null;
        } else if (ch === "'" || ch === '"') {
          quote = ch;
        } else if (ch === "#" && (i === 0 || /\s/.test(line[i - 1]))) {
          return line.slice(0, i);
        }
      }
      return line;
    })
    .join("\n");
}

/**
 * Repo-relative path a **tracked** symlink resolves to, as POSIX.
 *
 * Read from the index rather than the working tree. The workflows restore from
 * git, so what git records is what matters, and a working-tree read would also
 * accept an entry that is no longer tracked at all. It sidesteps two clone
 * variations besides: a Windows clone holds the entry either as a real symlink
 * whose target comes back with backslashes, or — when `core.symlinks` is off —
 * as a plain file holding the target text (see the Windows clone note in
 * CLAUDE.md).
 */
export function trackedSymlinkTarget(root, rel) {
  const entry = execFileSync("git", ["ls-files", "-s", "--", rel], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  assert.ok(entry, `${rel} is not tracked by git`);

  const [mode, sha] = entry.split(/\s+/);
  assert.equal(
    mode,
    "120000",
    `${rel} is tracked as mode ${mode}, not a symlink`,
  );

  const target = execFileSync("git", ["cat-file", "blob", sha], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  return posix.normalize(posix.join(posix.dirname(rel), target));
}

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  checkPlanComment,
  PLAN_MARKER,
  renderHiddenFindings,
} from "../.github/agent-pipeline/plan-render-check.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(root, ".github", "agent-pipeline", "plan-render-check.mjs");

/** The kinds found in `text`, in order, without line numbers. */
function kinds(text) {
  return renderHiddenFindings(text).map((finding) => finding.kind);
}

// The maintainer who applies `agent:implement` approves the plan as GitHub
// renders it; the implementer reads the raw text. A plan is accepted only when
// nothing in it is hidden by, or changed by, rendering.
describe("plan render check", () => {
  it("accepts a plain markdown plan", () => {
    const plan = [
      "## Agent plan",
      "",
      "Issue #12. Goals:",
      "",
      "- Change `src-tauri/src/core/mod.rs` so a Draft keeps its labels.",
      "- [ ] Add a test; a < b and 3 > 2 hold.",
      "",
      "| file | change |",
      "| ---- | ------ |",
      "| `a.rs` | edit |",
      "",
      "Set $GITHUB_WORKSPACE once.",
    ].join("\n");
    assert.deepEqual(kinds(plan), []);
  });

  it("accepts anything inside a fenced block, which renders as written", () => {
    const plan = [
      "Steps:",
      "",
      "```rust",
      "let v: Vec<String> = vec![]; // <!-- not hidden here -->",
      'let s = "[a](b) [c]: d &amp; $x$";',
      "```",
      "",
      "~~~text",
      "<details>shown verbatim</details>",
      "~~~",
    ].join("\n");
    assert.deepEqual(kinds(plan), []);
  });

  it("refuses HTML outside a fenced block, comments included", () => {
    assert.deepEqual(kinds("Plan.\n<!-- hidden -->\n"), ["html"]);
    assert.deepEqual(kinds("<details><summary>x</summary>y</details>"), [
      "html",
    ]);
    assert.deepEqual(kinds("text </p> text"), ["html"]);
    assert.deepEqual(kinds("<?php ?>"), ["html"]);
    assert.deepEqual(kinds("<!DOCTYPE html>"), ["html"]);
  });

  it("refuses angle-bracket text in an inline code span, which is not parsed", () => {
    // Inline code spans can pair across lines and blocks, so the check does
    // not try to find them; generics belong in a fenced block.
    assert.deepEqual(kinds("Use `Vec<String>` here."), ["html"]);
  });

  it("refuses character references, which can render as invisible characters", () => {
    assert.deepEqual(kinds("a&#8203;b"), ["character-reference"]);
    assert.deepEqual(kinds("a&#x200B;b"), ["character-reference"]);
    assert.deepEqual(kinds("a&zwj;b"), ["character-reference"]);
    assert.deepEqual(kinds("AT & T"), []);
  });

  it("refuses links, images and reference definitions", () => {
    assert.deepEqual(kinds("See [docs](https://example.com)."), ["link"]);
    assert.deepEqual(kinds("![alt text](https://example.com/a.png)"), ["link"]);
    assert.deepEqual(kinds('[ref]: https://example.com "title"'), [
      "reference-definition",
    ]);
    assert.deepEqual(kinds("[//]: # (a markdown comment)"), [
      "reference-definition",
    ]);
  });

  it("refuses math, which can render text invisibly", () => {
    assert.deepEqual(kinds("Inline $x$ math."), ["math"]);
    assert.deepEqual(kinds("$$\nx\n$$"), ["math"]);
    assert.deepEqual(kinds("Set $A and\nthen $B."), ["math"]);
    assert.deepEqual(kinds("Set $A.\n\nThen $B."), []);
  });

  it("refuses a fence whose info string is not a plain language name", () => {
    assert.deepEqual(kinds("```math\nx\n```"), ["fence-info"]);
    assert.deepEqual(kinds("```mermaid\ngraph TD\n```"), ["fence-info"]);
    assert.deepEqual(kinds("```bash some hidden words\nls\n```"), [
      "fence-info",
    ]);
    assert.deepEqual(kinds("```\nls\n```\n\n~~~bash\nls\n~~~"), []);
  });

  it("refuses invisible and format characters anywhere, even in a fence", () => {
    for (const char of [
      "\u200B",
      "\u200D",
      "\u202E",
      "\u2066",
      "\uFEFF",
      "\u00AD",
      "\u2028",
      "\u00A0",
      "\u3164",
      "\u2800",
      "\uFE0F",
      "\u{E0041}",
      "\u{E0100}",
    ]) {
      const code = char.codePointAt(0).toString(16);
      assert.deepEqual(kinds(`a${char}b`), ["invisible-character"], code);
      assert.deepEqual(
        kinds(`\`\`\`\na${char}b\n\`\`\``),
        ["invisible-character"],
        `${code} in a fence`,
      );
    }
  });

  it("refuses control characters and a lone carriage return, but accepts CRLF", () => {
    assert.deepEqual(kinds("a\u0007b"), ["control-character"]);
    assert.deepEqual(kinds("```\nx\n```\r<b>"), ["control-character", "html"]);
    assert.deepEqual(kinds("line one\r\nline two\r\n"), []);
    assert.deepEqual(kinds("tab\tok"), []);
  });

  it("does not treat an indented fence as code", () => {
    // Inside a container a fence can end before its closing line, so only a
    // fence that starts in column 0 is treated as code.
    assert.ok(kinds(" ```\n<b>\n ```").includes("html"));
    assert.ok(kinds("- item\n  ```\n  x\n<b>\n  ```").includes("html"));
  });

  it("refuses a fence indented by one to three spaces", () => {
    // GitHub opens a fence indented up to three spaces. Were it ignored, a
    // column-0 closing fence after it would read here as an opener, and
    // everything after that as code.
    const plan = [
      "Plan",
      "",
      " ```",
      "shown code",
      "```",
      "<!-- hidden -->",
      "[x](https://example.com)",
      "```",
    ].join("\n");
    assert.ok(kinds(plan).includes("indented-fence"));
    assert.ok(kinds("  ```mermaid\n%% hidden\n```").includes("indented-fence"));
    assert.ok(kinds("   ~~~\nx\n~~~").includes("indented-fence"));
    // Four spaces is an indented code block, which renders as written.
    assert.deepEqual(kinds("    ```"), []);
  });

  it("does not treat a backtick fence with a backtick in its info string as code", () => {
    assert.deepEqual(kinds("```a`b\n<b>\n```"), ["html"]);
  });

  it("closes a fence only on a matching run of the same character", () => {
    assert.deepEqual(kinds("````\n```\n<b>\n````"), []);
    assert.deepEqual(kinds("```\n~~~\n<b>\n```"), []);
    assert.deepEqual(kinds("```\nx\n``` <b>\n"), []);
    assert.deepEqual(kinds("```\nx\n```\n<b>"), ["html"]);
  });

  it("treats an unclosed fence as code to the end, as GitHub does", () => {
    assert.deepEqual(kinds("Plan.\n\n```\n<b>\n"), []);
  });

  it("reports the line of each finding", () => {
    assert.deepEqual(renderHiddenFindings("ok\n\n<b>\nok\n[a](b)"), [
      { line: 3, kind: "html" },
      { line: 5, kind: "link" },
    ]);
  });
});

describe("plan comment check", () => {
  it("accepts a comment that starts with the marker and is otherwise clean", () => {
    assert.deepEqual(
      checkPlanComment(`${PLAN_MARKER}\n\n## Agent plan\n\nDo it.`),
      [],
    );
  });

  it("refuses a comment without the leading marker", () => {
    assert.deepEqual(checkPlanComment("## Agent plan\n\nDo it."), [
      { line: 1, kind: "missing-marker" },
    ]);
  });

  it("refuses a second marker or any other hidden content after the first", () => {
    assert.deepEqual(
      checkPlanComment(`${PLAN_MARKER}\n\nDo it.\n${PLAN_MARKER}`),
      [{ line: 4, kind: "html" }],
    );
  });

  it("runs as a command: exit 0 when clean, exit 1 with findings on stderr", () => {
    const clean = spawnSync(process.execPath, [script, "--comment"], {
      input: `${PLAN_MARKER}\n\n## Agent plan\n\nDo it.\n`,
      encoding: "utf8",
    });
    assert.equal(clean.status, 0, clean.stderr);

    const hidden = spawnSync(process.execPath, [script, "--comment"], {
      input: `${PLAN_MARKER}\n\nDo it.\n<!-- secret -->\n`,
      encoding: "utf8",
    });
    assert.equal(hidden.status, 1);
    assert.match(hidden.stderr, /line 4: html/);
    // Findings name a line and a kind, never the text, so a log stays short.
    assert.doesNotMatch(hidden.stderr, /secret/);

    const plan = spawnSync(process.execPath, [script], {
      input: "## Agent plan\n\n<b>\n",
      encoding: "utf8",
    });
    assert.equal(plan.status, 1);
    assert.match(plan.stderr, /line 3: html/);
  });
});

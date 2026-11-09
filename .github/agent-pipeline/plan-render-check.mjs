// Agent pipeline: refuse a plan that holds anything GitHub's rendering hides.
//
// The maintainer who applies `agent:implement` approves the plan comment as
// GitHub renders it. The implementer (verified-plan.md) and the reviewer's Spec
// axis read the comment's raw text. Those must be the same document, so a plan
// is accepted only when nothing in it is hidden by, or changed by, rendering.
// It fails closed: the check does not strip anything, it refuses.
//
// This is deliberately stricter than markdown. It does not parse inline code
// spans, which can pair across lines and blocks, so angle-bracket text belongs
// in a fenced block. Only a fence that starts in column 0 counts as code,
// because inside a container a fence can end before its closing line.
//
// Each workflow loads this file from a commit object (`git show <sha>:<path>`)
// before any agent session runs, never from the working tree.
//
// Usage: node plan-render-check.mjs [--comment] < plan
//   --comment  the input is a whole plan comment, which must start with the
//              pipeline marker; the marker itself is the one comment allowed.
// Exit 0 when clean; 1 with one "line N: kind" per finding on stderr; 2 on
// bad usage. Findings never quote the text.

import { pathToFileURL } from "node:url";

export const PLAN_MARKER = "<!-- agent-pipeline-plan -->";

// Fenced block languages that GitHub shows as written. A renderer such as
// math or mermaid draws the block instead, and anything else in an info string
// is never shown.
const PLAIN_LANGUAGES = new Set([
  "",
  "bash",
  "sh",
  "shell",
  "console",
  "powershell",
  "pwsh",
  "ps1",
  "text",
  "txt",
  "plaintext",
  "diff",
  "json",
  "jsonc",
  "yaml",
  "yml",
  "toml",
  "ini",
  "rust",
  "rs",
  "ts",
  "typescript",
  "tsx",
  "js",
  "javascript",
  "jsx",
  "mjs",
  "css",
  "html",
  "xml",
  "md",
  "markdown",
  "sql",
  "php",
  "python",
  "py",
]);

// Characters that render as nothing, as something other than themselves, or
// that reorder what is shown: format characters (zero-width, bidirectional
// controls, tags), line and paragraph separators, every space but U+0020,
// variation selectors, and letters that render blank.
const INVISIBLE =
  /[\p{Cf}\p{Zl}\p{Zp}\p{Co}\u034F\u115F\u1160\u2800\u3164\uFFA0\uFE00-\uFE0F\u{E0100}-\u{E01EF}]|(?! )\p{Zs}/u;
// Control characters other than tab. Line endings are split off before this
// runs, so it never sees a newline or a carriage return.
const CONTROL = /(?!\t)\p{Cc}/u;

// Outside a fence. Raw HTML (comments, tags, declarations, processing
// instructions) is hidden or changed by rendering.
const HTML = /<[A-Za-z/!?]/;
// A character reference can render as an invisible character.
const CHARACTER_REFERENCE =
  /&(?:#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});/;
// A link shows its text, not its destination or title; an image shows neither.
const LINK = /\]\(/;
// A reference definition is never shown, which is what makes `[//]: # (…)`
// a markdown comment.
const REFERENCE_DEFINITION = /\]:/;

const FENCE_OPEN = /^(`{3,}|~{3,})(.*)$/;
// GitHub also opens a fence indented one to three spaces. Treating one as text
// would let a later column-0 fence read here as an opener while GitHub reads it
// as the closer, so an indented fence is refused instead.
const INDENTED_FENCE = /^ {1,3}(`{3,}|~{3,})/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;

/**
 * Every construct in `text` that GitHub's rendering hides or shows differently
 * from the raw text, as `{ line, kind }` with 1-based lines, in order.
 */
export function renderHiddenFindings(text) {
  const findings = [];
  // Split as CommonMark does: CRLF, a lone CR and LF all end a line. A lone CR
  // is also refused, since an editor shows it as part of one line.
  const parts = text.split(/(\r\n|\r|\n)/);
  const lines = parts.filter((_, index) => index % 2 === 0);
  parts.forEach((part, index) => {
    if (part === "\r") findings.push({ line: (index + 1) / 2, kind: "control-character" });
  });
  let fence = null;
  // `$` count and first line of the current blank-line block outside fences.
  // Inline math needs two `$` in one paragraph; blank-line blocks are coarser
  // than paragraphs, so counting over them is the stricter choice.
  let dollars = 0;
  let blockStart = 0;

  const endBlock = () => {
    if (dollars >= 2) findings.push({ line: blockStart, kind: "math" });
    dollars = 0;
    blockStart = 0;
  };

  lines.forEach((line, index) => {
    const number = index + 1;
    if (CONTROL.test(line)) findings.push({ line: number, kind: "control-character" });
    if (INVISIBLE.test(line)) {
      findings.push({ line: number, kind: "invisible-character" });
    }

    if (fence) {
      const close = line.match(FENCE_CLOSE);
      if (close && close[1][0] === fence.char && close[1].length >= fence.length) {
        fence = null;
      }
      return;
    }

    const open = line.match(FENCE_OPEN);
    if (open && !(open[1][0] === "`" && open[2].includes("`"))) {
      endBlock();
      fence = { char: open[1][0], length: open[1].length };
      if (!PLAIN_LANGUAGES.has(open[2].trim().toLowerCase())) {
        findings.push({ line: number, kind: "fence-info" });
      }
      return;
    }

    if (line.trim() === "") {
      endBlock();
      return;
    }
    if (INDENTED_FENCE.test(line)) findings.push({ line: number, kind: "indented-fence" });
    if (blockStart === 0) blockStart = number;
    dollars += line.split("$").length - 1;

    if (HTML.test(line)) findings.push({ line: number, kind: "html" });
    if (CHARACTER_REFERENCE.test(line)) {
      findings.push({ line: number, kind: "character-reference" });
    }
    if (LINK.test(line)) findings.push({ line: number, kind: "link" });
    if (REFERENCE_DEFINITION.test(line)) {
      findings.push({ line: number, kind: "reference-definition" });
    }
  });
  endBlock();

  return findings.sort((a, b) => a.line - b.line);
}

/**
 * Findings for a whole plan comment: it must start with the pipeline marker,
 * and everything after the marker must render as written. Lines count from
 * the start of the comment.
 */
export function checkPlanComment(body) {
  if (!body.startsWith(PLAN_MARKER)) return [{ line: 1, kind: "missing-marker" }];
  // Blank out the marker so the line numbers stay those of the comment.
  return renderHiddenFindings(" ".repeat(PLAN_MARKER.length) + body.slice(PLAN_MARKER.length));
}

async function main(args) {
  const comment = args.length === 1 && args[0] === "--comment";
  if (args.length > 1 || (args.length === 1 && !comment)) {
    process.stderr.write("usage: plan-render-check.mjs [--comment] < plan\n");
    return 2;
  }
  let input = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) input += chunk;

  const findings = comment ? checkPlanComment(input) : renderHiddenFindings(input);
  for (const { line, kind } of findings) process.stderr.write(`line ${line}: ${kind}\n`);
  return findings.length === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
